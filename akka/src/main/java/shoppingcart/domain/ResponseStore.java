package shoppingcart.domain;

import java.util.ArrayList;

public record ResponseStore(String id, ArrayList<String> responses) {
    public ResponseStore onAddResponse(ResponseStoreEvent.AddReponse addReponse) {
        ArrayList<String> newResponses = this.responses();
        newResponses.add(0, addReponse.response());
        if (newResponses.size() > 50) newResponses.remove(newResponses.size() - 1);
        return new ResponseStore(this.id, newResponses);
    }
}
