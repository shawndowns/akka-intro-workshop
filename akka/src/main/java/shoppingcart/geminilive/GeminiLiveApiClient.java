package shoppingcart.geminilive;

import akka.Done;
import akka.NotUsed;
import akka.http.javadsl.Http;
import akka.http.javadsl.model.StatusCodes;
import akka.http.javadsl.model.ws.BinaryMessage;
import akka.http.javadsl.model.ws.Message;
import akka.http.javadsl.model.ws.TextMessage;
import akka.http.javadsl.model.ws.WebSocketRequest;
import akka.stream.Materializer;
import akka.stream.javadsl.Flow;
import akka.stream.javadsl.Source;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.deser.std.StdDeserializer;
import com.fasterxml.jackson.databind.module.SimpleModule;
import com.fasterxml.jackson.databind.ser.std.StdSerializer;
import com.fasterxml.jackson.datatype.jdk8.Jdk8Module;
import shoppingcart.geminilive.LiveProtocol.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.Base64;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.Optional;
import java.util.stream.Collectors;

import static akka.Done.done;
import static akka.NotUsed.notUsed;

public class GeminiLiveApiClient {

  private static final Logger logger = LoggerFactory.getLogger(GeminiLiveApiClient.class);

  // ws json protocol config

  private static final class ByteArraySerializer extends StdSerializer<byte[]> {
    public ByteArraySerializer() {
      super(byte[].class);
    }
    @Override
    public void serialize(byte[] value, JsonGenerator gen, SerializerProvider provider) throws IOException {
      gen.writeString(Base64.getEncoder().encodeToString(value));
    }
  }

  private static final class ByteArrayDeserializer extends StdDeserializer<byte[]> {
    public ByteArrayDeserializer() {
      super(byte[].class);
    }
    @Override
    public byte[] deserialize(JsonParser p, DeserializationContext ctxt) throws IOException, JsonProcessingException {
      JsonNode node = p.getCodec().readTree(p);
      String base64 = node.asText();
      return Base64.getDecoder().decode(base64);
    }
  }

  // Best to use our own to configure for the Google API json requirements
  private static final ObjectMapper objectMapper = new ObjectMapper();

  static {
    // config based on https://github.com/googleapis/python-genai/blob/main/google/genai/_common.py#L182
    SimpleModule customModule = new SimpleModule();
    // byte payloads base64 encoded https://github.com/googleapis/python-genai/blob/main/google/genai/_common.py#L190
    customModule.addSerializer(byte[].class, new ByteArraySerializer());
    customModule.addDeserializer(byte[].class, new ByteArrayDeserializer());
    objectMapper.registerModule(customModule);
    objectMapper.registerModule(new Jdk8Module());
    objectMapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);
    objectMapper.setSerializationInclusion(JsonInclude.Include.NON_ABSENT);
    objectMapper.setSerializationInclusion(JsonInclude.Include.NON_EMPTY);
    // https://github.com/googleapis/python-genai/blob/main/google/genai/_common.py#L183C23-L183C48
    objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.LOWER_CAMEL_CASE);
  }


  // From: https://github.com/googleapis/python-genai/blob/main/google/genai/_api_client.py#L283
  private static final String apiVersion = "v1alpha";

  // From https://github.com/googleapis/python-genai/blob/main/google/genai/_api_client.py#L291
  private static final String wsBaseUrl = "wss://generativelanguage.googleapis.com/";


  private final String apiKey;

  // FIXME not sure what the right level of SDK support would be to allow low-level/more advanced HTTP client calls
  //       passing the entire extension for now
  // FIXME using global now, probably needs to select region
  public GeminiLiveApiClient(String apiKey) {
    this.apiKey = apiKey;
  }

  // FIXME what is the input
  // FIXME what is the output
  public Source<LiveServerMessage, NotUsed> connect(GenerateContentSetup setup, Source<LiveClientMessage, ?> input) {
    return Source.fromMaterializer((materializer, attributes) -> {
      // Note: we don't have public API access to the actor system or HTTP for low level requests directly in the SDK
      var http = Http.get(materializer.system());
      var url = wsBaseUrl + "ws/google.ai.generativelanguage." + apiVersion + ".GenerativeService.BidiGenerateContent?key=" + apiKey;
      var wsFlow = http.webSocketClientFlow(WebSocketRequest.create(url))
          .mapMaterializedValue(upgradeFuture -> {
             upgradeFuture.whenComplete((upgrade, error) -> {
               if (error != null) {
                 logger.error("Failed to connect to Gemini Live", error);
               } else if (upgrade.response().status().equals(StatusCodes.SWITCHING_PROTOCOLS)) {
                 logger.debug("Successfully connected to Gemini Live");
               } else {
                 throw new RuntimeException("Connected to Gemini Live but websocket upgrade failed (status: " + upgrade.response().status() + ")");
               }
             });
            return notUsed();
          });

      // Commands to API must wait for ack on setup
      var setupResponseSeen = new CompletableFuture<Done>();

      Source<LiveClientMessage, NotUsed> delayedClientMessages = Source.fromSourceCompletionStage(setupResponseSeen.thenApply(done -> input))
          .mapMaterializedValue(ignored -> notUsed());

      var inputToWebSocket = Source.single(LiveClientMessage.setup(setup)).concat(delayedClientMessages)
          .map(GeminiLiveApiClient::multiModalInputToWsMessage);

      var webSocketToOutput = Flow.<Message>create()
          .mapAsync(1, wsMessage -> multiModalOutputFromWsMessage(wsMessage, materializer))
          .map((output) -> {
            if (output.setupComplete().isPresent()) {
              // happens only once, we must hold of sending any requests until we have seen it
              // FIXME we should perhaps drop that initial setup done message so that the client does not see it?
              setupResponseSeen.complete(done());
            }
            return output;
          });

      return inputToWebSocket.via(wsFlow).via(webSocketToOutput);

    }).mapMaterializedValue(ignored -> notUsed());
  }

  private static Message multiModalInputToWsMessage(LiveClientMessage message) {
    try {
      var jsonString = objectMapper.writeValueAsString(message);
      //logger.debug("Outgoing Gemini JSON: {}", jsonString);

      /*if (message.realtimeInput().isPresent()) {
        LiveClientRealtimeInput input = message.realtimeInput().get();
        // Replace each Blob's data with an empty byte array while keeping mimeType
        var sanitizedBlobs = input.mediaChunks().stream()
            .map(blob -> new Blob(new byte[0], blob.mimeType()))
            .collect(Collectors.toList());
        LiveClientRealtimeInput sanitizedInput = new LiveClientRealtimeInput(sanitizedBlobs);
        message = new LiveClientMessage(
            message.setup(),
            message.clientContent(),
            Optional.of(sanitizedInput),
            message.toolResponse()
        );
      }

      var sanitizedJsonString = objectMapper.writeValueAsString(message);
      logger.info("Outgoing Gemini JSON: {}", sanitizedJsonString);*/

      return TextMessage.create(jsonString);
    } catch (JsonProcessingException e) {
      throw new RuntimeException("Failed to serialize outgoing message " + message + " to json", e);
    }
  }

  private final static long MAX_STRICT_DURATION = 5000;

  private static CompletionStage<LiveServerMessage> multiModalOutputFromWsMessage(Message message, Materializer materializer) {
    if (message instanceof TextMessage textMessage) {
      if (message.isStrict()) {
        var responseJson = textMessage.getStrictText();
        try {
          return CompletableFuture.completedFuture(objectMapper.readValue(responseJson, LiveServerMessage.class));
        } catch (JsonProcessingException e) {
          throw new RuntimeException("Failed to parse response json: " + responseJson, e);
        }
      } else {
        return textMessage.toStrict(MAX_STRICT_DURATION, materializer).thenCompose(strict -> multiModalOutputFromWsMessage(strict, materializer));
      }
     } else if (message instanceof BinaryMessage binaryMessage) {
      if (message.isStrict()) {
        var responseJson = binaryMessage.getStrictData().utf8String();
        try {
          return CompletableFuture.completedFuture(objectMapper.readValue(responseJson, LiveServerMessage.class));
        } catch (JsonProcessingException e) {
          throw new RuntimeException("Failed to parse response json: " + responseJson, e);
        }
      } else {
        return binaryMessage.toStrict(MAX_STRICT_DURATION, materializer).thenCompose(strict -> multiModalOutputFromWsMessage(strict, materializer));
      }
    } else {
      // can never happen, but compiler doesn't know
      throw new UnsupportedOperationException("Unsupported message type: " + message.getClass().getName());
    }

  }


}
