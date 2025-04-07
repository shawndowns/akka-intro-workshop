package shoppingcart.application;

import akka.Done;
import akka.javasdk.annotations.ComponentId;
import akka.javasdk.eventsourcedentity.EventSourcedEntity;
import akka.javasdk.eventsourcedentity.EventSourcedEntityContext;

import shoppingcart.domain.ResponseStore;
import shoppingcart.domain.ResponseStoreEvent;

import java.util.ArrayList;

@ComponentId("reponse-store")
public class ResponseStoreEntity extends EventSourcedEntity<ResponseStore, ResponseStoreEvent> {

  public ResponseStoreEntity(EventSourcedEntityContext context) {
    this.entityId = context.entityId();
  }

  private final String entityId;

  @Override
  public ResponseStore emptyState() {
    return new ResponseStore(entityId, new ArrayList<>());
  }

  public Effect<Done> addResponse(String response) {
    return effects().persist(new ResponseStoreEvent.AddReponse(response)).thenReply(newState -> Done.getInstance());
  }

  @Override
  public ResponseStore applyEvent(ResponseStoreEvent event) {
    return switch (event) {
      case ResponseStoreEvent.AddReponse evt -> currentState().onAddResponse(evt); 
    };
  }
}
