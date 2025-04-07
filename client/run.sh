#!/bin/bash
echo "Checking dependencies..."

curl --location 'http://localhost:9000/ai-context/gemini-live' \
--header 'Content-Type: application/json' \
--data '{
    "context": "This is John. Greet John. John is has some questions about products in a shopping cart. The shopping cart data is in this JSON:"
}'

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

if [ ! -d "../node_modules" ]; then
  echo "Installing dependencies..."
  cd ..
  # Install necessary packages including gRPC
  npm install
fi

echo "Stopping any existing ts-node processes..."
pkill -f "ts-node" || true

echo "Bundling client-side code..."
# This creates a browser-compatible bundle from client.ts
npx esbuild ./client.ts --bundle --outfile=./client-bundle.js

# Run server on port 3001
echo "Starting server on port 3001..."
PORT=3001 ts-node ./server.ts