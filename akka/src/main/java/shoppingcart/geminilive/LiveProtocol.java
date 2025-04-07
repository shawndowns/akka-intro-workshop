package shoppingcart.geminilive;

import java.util.List;
import java.util.Map;
import java.util.Optional;

public interface LiveProtocol {

  record Blob(byte[] data, String mimeType) {}

  enum Outcome {
    OUTCOME_UNSPECIFIED,
    OUTCOME_OK,
    OUTCOME_FAILED,
    OUTCOME_DEADLINE_EXCEEDED
  }
  enum Language {
    LANGUAGE_UNSPECIFIED,
    PYTHON
  }
  record CodeExecutionResult(Outcome outcome, Optional<String> output) {}

  record ExecutableCode(String code, Optional<Language> language) {}
  record FileData(String fileUri, String mimeType) {}

  /**
   *
   * @param id The unique id of the function call. If populated, the client to execute the
   *    <code>function_call</code> and return the response with the matching <code>id</code>.
   * @param args The function parameters and values. See <code>FunctionDeclaration.parameters</code> for parameter details.
   * @param name The name of the function to call. Matches <code>FunctionDeclaration.name</code>
   */
  record FunctionCall(Optional<String> id, Map<String, Object> args, String name) {}

  /**
   * @param id The id of the function call this response is for. Populated by the client
   *    to match the corresponding function call <code>id</code>
   * @param name  The name of the function to call. Matches <code>FunctionDeclaration.name</code> and <code>FunctionCall.name</code>.
   * @param response The function response in JSON object format. Use "output" key to specify function output and "error" key to specify error details (if any). If "output" and "error" keys are not specified, then whole "response" is treated as function output.
   */
  record FunctionResponse(Optional<String> id,
                                 String name,
                                 // FIXME not sure this would actually work with Jackson, would probably need a custom ser/deser and would not work for
                                 //        the third case because jackson needs a type hint
                                 Map<String, Object> response) {}



  record LiveClientToolResponse(List<FunctionResponse> functionResponses) {}

  // FIXME format for the offsets unclear, not documented https://github.com/googleapis/python-genai/blob/main/google/genai/types.py#L343
  record VideoMetadata(Optional<String> endOffset, Optional<String> startOffset) {}

  /**
   * "Exactly one field within a Part should be set, representing the specific type
   *   of content being conveyed. Using multiple fields within the same `Part`
   *   instance is considered invalid."
   * <p>
   * Quite funky modelling because 1:1 impl of python structure which in turn is 1:1 with json protocol
   *
   * @param videoMetadata Metadata for a given video
   * @param thought Indicates if the part is thought from the model
   * @param codeExecutionResult Result of executing the <code>ExecutableCode</code>
   * @param executableCode Code generated by the model that is meant to be executed
   * @param fileData URI based data
   * @param functionCall A predicted <code>FunctionCall</code> returned from the model that contains a string representing the <code>FunctionDeclaration.name</code> with the parameters and their values
   * @param functionResponse The result output of a <code>FunctionCall</code> that contains a string representing the <code>FunctionDeclaration.name</code> and a structured JSON object containing any output from the function call. It is used as context to the model.
   * @param inlineData Inlined bytes data
   * @param text Text part (can be code)
   */
  // Based on https://github.com/googleapis/python-genai/blob/main/google/genai/types.py#L551
  record Part(
      Optional<VideoMetadata> videoMetadata,
      Optional<Boolean> thought,
      Optional<CodeExecutionResult> codeExecutionResult,
      Optional<ExecutableCode> executableCode,
      Optional<FileData> fileData,
      Optional<FunctionCall> functionCall,
      Optional<FunctionResponse> functionResponse,
      Optional<Blob> inlineData,
      Optional<String> text
  ) {

    public static Part text(String text) {
      return new Part(Optional.empty(), Optional.empty(),Optional.empty(),Optional.empty(),Optional.empty(),Optional.empty(),Optional.empty(),Optional.empty(), Optional.of(text));
    }

  }

  /**
   *
   * @param parts List of parts that constitute a single message. Each part may have
   *       a different IANA MIME type.
   * @param role  The producer of the content. Must be either 'user' or
   *       'model'. Useful to set for multi-turn conversations, otherwise can be
   *       left blank or unset. If role is not specified, SDK will determine the role.
   */
  record Content(List<Part> parts, Optional<String> role) {
    public Content {
      role.ifPresent(value -> {
        if (!value.equals("user") && !value.equals("model"))
          throw new IllegalArgumentException("role must be 'user' or 'model' or empty option");
      });
    }
  }

  record PrebuiltVoiceConfig(String voiceName) {}
  record VoiceConfig(PrebuiltVoiceConfig prebuiltVoiceConfig) {}
  record SpeechConfig(VoiceConfig voiceConfig) {}

  // Defined here: https://ai.google.dev/api/generate-content#v1beta.GenerationConfig
  record GenerationConfig(
      List<String> stopSequences,
      Optional<String> responseMimeType,
      Optional<String> responseSchema,
      Optional<Integer> candidateCount,
      Optional<Integer> maxOutputTokens,
      Optional<Double> temperature,
      Optional<Double> topP,
      Optional<Integer> topK,
      Optional<Double> presencePenalty,
      Optional<Double> frequencyPenalty,
      Optional<Boolean> logprobs,
      Optional<Boolean> enableEnhancedCivicAnswers,
      // note: value is actually an enum
      List<String> responseModalities,
      Optional<SpeechConfig> speechConfig) {

        public GenerationConfig(String modality) {
          this(
            List.of(), 
            Optional.empty(), 
            Optional.empty(), 
            Optional.empty(), 
            Optional.empty(), 
            Optional.empty(), 
            Optional.empty(), 
            Optional.empty(), 
            Optional.empty(), 
            Optional.empty(), 
            Optional.empty(), 
            Optional.empty(), 
            List.of(modality),
            Optional.empty()
          );
        }

      }

  // FIXME unclear what this is
  record Tool() {}

  /**
   *
   * @param model The model's resource name. This serves as an ID for the Model to use. Format: models/{model}
   * @param generationConfig
   * @param systemInstruction The user provided system instructions for the model. Note: Only text should be used in parts.
   *                          Content in each part will be in a separate paragraph.
   * @param tools A list of Tools the model may use to generate the next response.
   */
  record GenerateContentSetup(
      String model,
      Optional<GenerationConfig> generationConfig,
      Optional<Content> systemInstruction,
      List<Tool> tools
  ) {
    public static GenerateContentSetup modelWithDefaults(String model, String modality) {
      return new GenerateContentSetup(model, Optional.of(new GenerationConfig(modality)), Optional.empty(), List.of());
    }
  }

  /**
   * The JSON object must have exactly one of the fields from the following object set:
   * @param setup
   * @param clientContent
   * @param realtimeInput
   * @param toolResponse
   */
  record LiveClientMessage(
      Optional<GenerateContentSetup> setup,
      Optional<LiveClientContent> clientContent,
      Optional<LiveClientRealtimeInput> realtimeInput,
      Optional<LiveClientToolResponse> toolResponse
      ) {

    public static LiveClientMessage setup(GenerateContentSetup generateContentSetup) {
      return new LiveClientMessage(Optional.of(generateContentSetup), Optional.empty(), Optional.empty(), Optional.empty());
    }

    public static LiveClientMessage clientContent(LiveClientContent clientContent) {
      return new LiveClientMessage(Optional.empty(), Optional.of(clientContent), Optional.empty(), Optional.empty());
    }

    public static LiveClientMessage realtimeInput(LiveClientRealtimeInput realtimeInput) {
      return new LiveClientMessage(Optional.empty(), Optional.empty(), Optional.of(realtimeInput), Optional.empty());
    }

    public static LiveClientMessage toolResponse(LiveClientToolResponse toolResponse) {
      return new LiveClientMessage(Optional.empty(), Optional.empty(), Optional.empty(), Optional.of(toolResponse));
    }

  }

  /**
   * User input that is sent in real time.
   * <p>
   *   This is different from `ClientContentUpdate` in a few ways:
   * <p>
   *     - Can be sent continuously without interruption to model generation.
   *     - If there is a need to mix data interleaved across the
   *       `ClientContentUpdate` and the `RealtimeUpdate`, server attempts to
   *       optimize for best response, but there are no guarantees.
   *     - End of turn is not explicitly specified, but is rather derived from user
   *       activity (for example, end of speech).
   *     - Even before the end of turn, the data is processed incrementally
   *       to optimize for a fast start of the response from the model.
   *     - Is always assumed to be the user's input (cannot be used to populate
   *       conversation history).
   * @param mediaChunks Inlined bytes data for media input.
   */
  record LiveClientRealtimeInput(List<Blob> mediaChunks) {}

  /**
   *
   * @param turns The content appended to the current conversation with the model.
   *       For single-turn queries, this is a single instance. For multi-turn
   *       queries, this is a repeated field that contains conversation history and
   *       latest request.
   * @param turnComplete If true, indicates that the server content generation should start with
   *   the currently accumulated prompt. Otherwise, the server will await
   *   additional messages before starting generation.
   */
  record LiveClientContent(List<Content> turns, boolean turnComplete) {

        // Overloaded constructor for simplified creation
        public LiveClientContent(String text, String role) {
          this(
              List.of(new Content(
                  List.of(Part.text(text)),
                  Optional.of(role)
              )),
              true
          );
      }

  }

  /**
   * Sent in response to a <code>LiveGenerateContentSetup</code> message from the client.
   */
  record LiveServerSetupComplete() {}

  /**
   * Incremental server update generated by the model in response to client messages.
   * <p>
   * Content is generated as quickly as possible, and not in real time. Clients
   * may choose to buffer and play it out in real time.
   *
   * @param modelTurn The content that the model has generated as part of the current conversation with the user
   * @param turnComplete If true, indicates that the model is done generating. Generation will only start in response to additional client messages. Can be set alongside `content`, indicating that the `content` is the last in the turn.
   * @param interrupted If true, indicates that a client message has interrupted current model generation. If the client is playing out the content in realtime, this is a good signal to stop and empty the current queue.
   */
  record LiveServerContent(Optional<Content> modelTurn, Optional<Boolean> turnComplete, Optional<Boolean> interrupted) {}

  /**
   * Request for the client to execute the <code>function_calls</code> and return the responses with the matching <code>id</code>s.
   */
  record LiveServerToolCall(List<FunctionCall> functionCalls) {}

  /**
   * Notification for the client that a previously issued `ToolCallMessage` with the specified `id`s should have been not executed and should be cancelled.
   * <p>
   * If there were side effects to those tool calls, clients may attempt to undo
   * the tool calls. This message occurs only in cases where the clients interrupt
   * server turns.
   */
  record LiveServerToolCallCancellation(List<String> ids) {}

  /**
   * @param setupComplete Sent in response to a `LiveClientSetup` message from the client
   * @param serverContent Content generated by the model in response to client messages
   * @param toolCall Request for the client to execute the <code>function_calls</code> and return the responses with the matching <code>id</code>s.
   * @param toolCallCancellation Notification for the client that a previously issued <code>ToolCallMessage</code> with the specified <code>id</code>s should have been not executed and should be cancelled
   */
  record LiveServerMessage(
      Optional<LiveServerSetupComplete> setupComplete,
      Optional<LiveServerContent> serverContent,
      Optional<LiveServerToolCall> toolCall,
      Optional<LiveServerToolCallCancellation> toolCallCancellation) {}


}
