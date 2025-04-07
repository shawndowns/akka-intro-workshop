package shoppingcart.api;

import akka.NotUsed;
import akka.javasdk.annotations.GrpcEndpoint;
import akka.javasdk.annotations.Acl;
import akka.javasdk.client.ComponentClient;
import akka.stream.javadsl.Source;
import com.typesafe.config.Config;
import shoppingcart.application.AIContextEntity;
import shoppingcart.application.ShoppingCartEntity;
import shoppingcart.video.Ack;
import shoppingcart.video.Chunk;
import shoppingcart.video.VideoServiceEndpoint;
import shoppingcart.application.ResponseStoreEntity;
import shoppingcart.geminilive.GeminiLiveApiClient;
import shoppingcart.geminilive.LiveProtocol.*;
import shoppingcart.domain.ShoppingCart;
import shoppingcart.domain.AIContext;

import java.util.List;
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

    private final String geminiAPIKey;

    //FIXME: Get from stream and populate first message with AIContext
    private final String aiContextId;
    
    public VideoServiceEndpointImpl(Config config, ComponentClient componentClient) {
        this.config = config;
        this.componentClient = componentClient;

        this.geminiAPIKey = config.getString("app.gemini-api-key");
        this.aiContextId = config.getString("app.ai-context-id");
    }

    private String shoppingCartToJson(ShoppingCart cart) {
        // Manual JSON construction - using a library like Jackson/Gson is recommended for robustness
        String itemsJson = cart.items().stream()
            .map(item -> String.format(
                "{\"productId\": \"%s\", \"name\": \"%s\", \"quantity\": %d}",
                item.productId(),
                // Basic JSON string escaping for quotes and backslashes
                item.name().replace("\\", "\\\\").replace("\"", "\\\""), 
                item.quantity()
            ))
            .collect(Collectors.joining(","));

        return String.format(
            "{\"cartId\": \"%s\", \"items\": [%s], \"checkedOut\": %b}",
            cart.cartId(),
            itemsJson,
            cart.checkedOut()
        );
    }

    private Source<LiveClientMessage, NotUsed> getAIContext() {
        // FIXME: Cart ID "123" is hardcoded, should likely be dynamic
        CompletionStage<AIContext> aiContextFuture = componentClient.forKeyValueEntity(aiContextId)
                .method(AIContextEntity::get)
                .invokeAsync();

        CompletionStage<ShoppingCart> cartFuture = componentClient.forEventSourcedEntity("123")
                .method(ShoppingCartEntity::getCart)
                .invokeAsync();

        CompletionStage<LiveClientMessage> combinedFuture = aiContextFuture.thenCombine(cartFuture, (aiContext, cart) -> {
            String cartJson = shoppingCartToJson(cart);
            // Combine AI context and cart JSON into a single string
            String combinedContext = String.format("Context:\\n%s\\n\\nShopping Cart:\\n%s", aiContext.context(), cartJson);
            // Create a single client message
            return LiveClientMessage.clientContent(new LiveClientContent(combinedContext, "user"));
        });

        return Source.completionStage(combinedFuture);
    }

    @Override
    public Source<Ack, NotUsed> streamVideo(Source<Chunk, NotUsed> in) {

        var client = new GeminiLiveApiClient(geminiAPIKey);

        var liveContentStream = in.map(chunk -> {
            var mediaChunks = List.of(new Blob(chunk.getPayload().toByteArray(), chunk.getMimeType()));
            return LiveClientMessage.realtimeInput(new LiveClientRealtimeInput(mediaChunks));
        });

        var contentStream = getAIContext().concat(liveContentStream);

        return client.connect(GenerateContentSetup.modelWithDefaults("models/gemini-2.0-flash-exp", "TEXT"), contentStream)
            .mapMaterializedValue(whatever -> {
                logger.info("Stream started/connected");
                return whatever;
            }).map(liveServerMessage -> {
                logger.info("Message: {}", liveServerMessage);

                var ack = Ack.newBuilder();

                liveServerMessage.setupComplete().ifPresent(setupComplete -> {
                    ack.setMessage("Setup complete");
                });

                liveServerMessage.serverContent().ifPresent(serverContent -> {
                    if (serverContent.modelTurn().isPresent() &&
                      !serverContent.modelTurn().get().parts().isEmpty() &&
                      serverContent.modelTurn().get().parts().get(0).text().isPresent()) {
                        var response = serverContent.modelTurn().get().parts().get(0).text().get();
                        componentClient
                            .forEventSourcedEntity("gemini")
                            .method(ResponseStoreEntity::addResponse)
                            .invokeAsync(response);
                        ack.setMessage("Content: " +  response);
                    }
                });

                liveServerMessage.toolCall().ifPresent(toolCall -> {
                    ack.setMessage("Tool call");
                });

                liveServerMessage.toolCallCancellation().ifPresent(toolCallCancellation -> {
                    ack.setMessage("Tool call cancellation");
                });

                return ack.build();
            });
    }
}
