package shoppingcart.api;

import akka.NotUsed;
import akka.javasdk.annotations.GrpcEndpoint;
import akka.javasdk.annotations.Acl;
import akka.javasdk.client.ComponentClient;
import akka.stream.Materializer;
import akka.stream.javadsl.Source;
import akka.japi.Pair;
import akka.japi.pf.PFBuilder;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.typesafe.config.Config;
import shoppingcart.application.AIContextEntity;
import shoppingcart.application.ShoppingCartEntity;
import shoppingcart.video.Ack;
import shoppingcart.video.Chunk;
import shoppingcart.video.ContextIds;
import shoppingcart.video.StreamInput;
import shoppingcart.video.VideoServiceEndpoint;
import shoppingcart.application.ResponseStoreEntity;
import shoppingcart.geminilive.GeminiLiveApiClient;
import shoppingcart.geminilive.LiveProtocol.*;
import shoppingcart.domain.ShoppingCart;
import shoppingcart.domain.AIContext;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Acl(allow = @Acl.Matcher(principal = Acl.Principal.INTERNET))
@GrpcEndpoint
public class VideoServiceEndpointImpl implements VideoServiceEndpoint {

    private final Logger logger = LoggerFactory.getLogger(VideoServiceEndpointImpl.class);

    private final Config config;
    private final ComponentClient componentClient;
    private final Materializer materializer;
    private final ObjectMapper objectMapper;

    private final String geminiAPIKey;

    public VideoServiceEndpointImpl(Config config, ComponentClient componentClient, Materializer materializer) {
        this.config = config;
        this.componentClient = componentClient;
        this.materializer = materializer;
        this.objectMapper = new ObjectMapper();

        this.geminiAPIKey = config.getString("app.gemini-api-key");
    }

    private Source<LiveClientMessage, NotUsed> getAIContext(String aiContextId, String cartId) {
        logger.info("Fetching AI Context for id '{}' and Cart id '{}'", aiContextId, cartId);
        CompletionStage<AIContext> aiContextFuture = componentClient.forKeyValueEntity(aiContextId)
                .method(AIContextEntity::get)
                .invokeAsync();

        CompletionStage<ShoppingCart> cartFuture = componentClient.forEventSourcedEntity(cartId)
                .method(ShoppingCartEntity::getCart)
                .invokeAsync();

        CompletionStage<LiveClientMessage> combinedFuture = aiContextFuture.thenCombine(cartFuture, (aiContext, cart) -> {
            try {
                String cartJson = objectMapper.writeValueAsString(cart);
                // Combine AI context and cart JSON into a single string
                String combinedContext = String.format("Context:\n%s\n\nShopping Cart:\n%s", aiContext.context(), cartJson);
                logger.info("Generated initial context message using Jackson");
                // Create a single client message
                return LiveClientMessage.clientContent(new LiveClientContent(combinedContext, "user"));
            } catch (JsonProcessingException e) {
                logger.error("Failed to serialize ShoppingCart to JSON for cartId '{}'", cartId, e);
                // Propagate the error by completing the stage exceptionally
                throw new RuntimeException("Failed to serialize shopping cart", e);
            }
        });

        return Source.completionStage(combinedFuture);
    }

    @Override
    public Source<Ack, NotUsed> streamVideo(Source<StreamInput, NotUsed> in) {

        var client = new GeminiLiveApiClient(geminiAPIKey);

        Source<LiveClientMessage, NotUsed> contentStream = in.prefixAndTail(1)
            .flatMapConcat(pair -> {
                List<StreamInput> firstList = pair.first();
                Source<StreamInput, NotUsed> tail = pair.second();

                if (!firstList.isEmpty() && firstList.get(0).hasContextIds()) {
                    ContextIds contextIds = firstList.get(0).getContextIds();
                    String aiContextId = contextIds.getAiContextId();
                    String cartId = contextIds.getCartId();

                    if (aiContextId == null || aiContextId.isEmpty() || cartId == null || cartId.isEmpty()) {
                        logger.error("ContextIds message is missing ai_context_id or cart_id");
                        return Source.<LiveClientMessage>failed(
                            new IllegalArgumentException("ContextIds message requires non-empty ai_context_id and cart_id"));
                    }

                    logger.info("Received ContextIds: aiContextId={}, cartId={}", aiContextId, cartId);

                    Source<LiveClientMessage, NotUsed> initialContextSource = getAIContext(aiContextId, cartId);

                    Source<LiveClientMessage, NotUsed> chunkStream = tail
                        .map(streamInput -> {
                            if (!streamInput.hasChunk()) {
                                String errorMsg = "Expected Chunk message after ContextIds, but received: " + streamInput.getContentCase();
                                logger.warn(errorMsg);
                                throw new IllegalArgumentException(errorMsg);
                            }
                            return streamInput.getChunk();
                        })
                        .map(chunk -> {
                            var mediaChunks = List.of(new Blob(chunk.getPayload().toByteArray(), chunk.getMimeType()));
                            return LiveClientMessage.realtimeInput(new LiveClientRealtimeInput(mediaChunks));
                        });

                    return initialContextSource.concat(chunkStream);

                } else {
                    String errorMsg = firstList.isEmpty() ? "Input stream was empty. Expected ContextIds message first."
                                                : "Stream did not start with ContextIds message. Started with: " + firstList.get(0).getContentCase();
                    logger.error(errorMsg);
                    return Source.<LiveClientMessage>failed(new IllegalArgumentException(errorMsg));
                }
            });

        return client.connect(GenerateContentSetup.modelWithDefaults("models/gemini-2.0-flash-exp", "TEXT"), contentStream)
            .mapMaterializedValue(whatever -> {
                logger.info("Stream to Gemini connected");
                return whatever;
            }).map(liveServerMessage -> {
                var ack = Ack.newBuilder();
                boolean responseAdded = false;

                if (liveServerMessage.setupComplete().isPresent()) {
                     ack.setMessage("Setup complete");
                }

                if (ack.getMessage().isEmpty() && liveServerMessage.serverContent().isPresent()) {
                    LiveServerContent serverContent = liveServerMessage.serverContent().get();
                    if (serverContent.modelTurn().isPresent() &&
                      !serverContent.modelTurn().get().parts().isEmpty() &&
                      serverContent.modelTurn().get().parts().get(0).text().isPresent()) {
                        var response = serverContent.modelTurn().get().parts().get(0).text().get();
                        if (!response.isBlank()) {
                           logger.info("Storing Gemini Response snippet");
                           componentClient
                               .forEventSourcedEntity("gemini")
                               .method(ResponseStoreEntity::addResponse)
                               .invokeAsync(response);
                           ack.setMessage("Content: " + response);
                           responseAdded = true;
                        }
                    }
                }

                if (!responseAdded) {
                   if (liveServerMessage.toolCall().isPresent()) {
                       ack.setMessage("Tool call received");
                   } else if (liveServerMessage.toolCallCancellation().isPresent()) {
                       ack.setMessage("Tool call cancellation received");
                   } else if (ack.getMessage().isEmpty()){
                       ack.setMessage("Processing...");
                   }
                }

                return ack.build();
            })
            .recover(new PFBuilder<Throwable, Ack>()
                .matchAny(e -> {
                    logger.error("Error in Gemini stream processing: {}", e.getMessage(), e);
                    return Ack.newBuilder().setMessage("Error: " + e.getMessage()).build();
                })
                .build());
    }
}
