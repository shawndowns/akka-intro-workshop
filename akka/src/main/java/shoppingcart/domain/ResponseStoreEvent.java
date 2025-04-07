package shoppingcart.domain;

import akka.javasdk.annotations.TypeName;

public sealed interface ResponseStoreEvent {
    @TypeName("add-reponse")
    record AddReponse(String response) implements ResponseStoreEvent {}
}