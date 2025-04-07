curl --location 'https://jolly-flower-9491.aws-us-east-2.akka.services/ai-context/gemini-live' \
--header 'Content-Type: application/json' \
--data '{
    "context": "This is Shawn. Greet Shawn. Shawn is trying to learn ASL alphabet. He will show you a sign and guess what that he is showing. Please tell him correct or tell him the actual sign he is holding up. If he is not holding up a valid ASL alphabet sign then please tell him it is not a valid sign."
}'