package shoppingcart.api;

import akka.javasdk.annotations.Acl;
import akka.javasdk.annotations.http.HttpEndpoint;
import akka.javasdk.annotations.http.Get;
import akka.javasdk.annotations.http.Post;
import akka.javasdk.client.ComponentClient;

import java.util.concurrent.CompletionStage;

import shoppingcart.application.AIContextEntity;
import shoppingcart.domain.AIContext;

@Acl(allow = @Acl.Matcher(principal = Acl.Principal.INTERNET))
@HttpEndpoint("/ai-context")
public class AIContextEndpoint {

    private final ComponentClient componentClient;
    
    public AIContextEndpoint(ComponentClient componentClient) {
        this.componentClient = componentClient;
    }

    @Post("/{aiContextId}")
    public CompletionStage<String> set(String aiContextId, AIContext aiContext) {
        return componentClient.forKeyValueEntity(aiContextId)
          .method(AIContextEntity::set)
          .invokeAsync(aiContext.context())
          .thenApply(AIContext::context);
    }

    @Get("/{aiContextId}")
    public CompletionStage<String> get(String aiContextId) {
      return componentClient.forKeyValueEntity(aiContextId)
        .method(AIContextEntity::get)
        .invokeAsync()
        .thenApply(AIContext::context);
    }
}