import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as WebSocket from 'ws';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

// Get the current directory
const currentDir = __dirname;

// Load the proto file - use try/catch to handle errors gracefully
let protoDescriptor: any = null;
let ChunkType: any = null;
try {
  const PROTO_PATH = path.resolve(__dirname, '../akka/src/main/proto/video-service.proto');
  console.log(`Loading proto file from: ${PROTO_PATH}`);
  
  // Load the proto definitions
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  });
  
  protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
  // Store reference to the Chunk message type
  ChunkType = protoDescriptor.Chunk;
  console.log('Proto file loaded successfully');
  console.log('Available types:', Object.keys(protoDescriptor));
} catch (error) {
  console.error('Failed to load proto file:', error);
  // Exit or handle gracefully if proto loading fails critically
  process.exit(1); // Optional: Exit if proto is critical
}

// Define expected service and method names (adjust if your .proto uses different names)
const EXPECTED_SERVICE_NAME = 'VideoServiceEndpoint'; // Corrected: No 'video.' prefix needed based on logs
const EXPECTED_STREAM_METHOD = 'streamVideo';

// Create HTTP server for serving our web client
const server = http.createServer((req, res) => {
  console.log(`Request for ${req.url}`);
  
  let filePath = path.join(currentDir, req.url || '');
  if (req.url === '/' || req.url === '') {
    filePath = path.join(currentDir, 'index.html');
  }
  
  const extname = path.extname(filePath);
  let contentType = 'text/html';
  
  switch (extname) {
    case '.js':
      contentType = 'text/javascript';
      break;
    case '.css':
      contentType = 'text/css';
      break;
    case '.json':
      contentType = 'application/json';
      break;
    case '.png':
      contentType = 'image/png';
      break;
    case '.jpg':
      contentType = 'image/jpg';
      break;
  }
  
  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        // File not found
        res.writeHead(404);
        res.end('404 - File Not Found');
      } else {
        // Server error
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`);
      }
    } else {
      // Serve the file
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

// Create WebSocket server
const wss = new WebSocket.Server({ 
  server,
  path: '/ws'
});

// Handle WebSocket connections
wss.on('connection', (ws: WebSocket.WebSocket) => {
  console.log('Client connected to WebSocket');
  
  // Communication variables
  let isStreaming = false;
  let grpcClient: any = null;
  let call: any = null;
  
  // Handle messages from WebSocket client
  ws.on('message', (message) => {
    try {
      console.log('Received WebSocket message');
      
      // Parse the message
      const parsedMessage = JSON.parse(message.toString());
      
      // Handle debug message
      if (parsedMessage.type === 'debug') {
        console.log('Debug message:', parsedMessage);
        
        if (parsedMessage.action === 'testConnection') {
          // Test if we can connect to the gRPC service
          try {
            // Check if protoDescriptor was loaded successfully
            if (!protoDescriptor) {
              ws.send(JSON.stringify({
                status: 'error',
                message: 'Proto file not loaded'
              }));
              return;
            }
            
            // Find the service in the descriptor
            console.log('Available services in proto:', Object.keys(protoDescriptor));
            
            // Create a simple HTTP request to test basic connectivity to port 9000
            // Note: This only tests HTTP reachability, not gRPC service health
            const http = require('http');
            const req = http.request({
              hostname: 'localhost',
              port: 9000,
              path: '/',
              method: 'GET',
              timeout: 3000 // 3 second timeout
            }, (res: http.IncomingMessage) => {
              console.log(`Port 9000 connectivity test: ${res.statusCode}`);
              ws.send(JSON.stringify({
                status: 'info',
                message: `Port 9000 responded with status: ${res.statusCode}`
              }));
            });
            
            req.on('error', (e: Error) => {
              console.error(`Port 443 connectivity error: ${e.message}`);
              ws.send(JSON.stringify({
                status: 'error',
                message: `Cannot connect to port 443: ${e.message}`
              }));
            });
            
            req.end();
          } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error('Debug connection test error:', errorMessage);
            ws.send(JSON.stringify({
              status: 'error',
              message: `Debug test error: ${errorMessage}`
            }));
          }
        }
        
        if (parsedMessage.action === 'testGrpcService') {
          // Use the expected service name for the test
          const serviceName = EXPECTED_SERVICE_NAME; 
          console.log(`Testing gRPC service: ${serviceName}`);
          
          try {
            // Find the service directly
            const ServiceClass = protoDescriptor[serviceName];
            if (!ServiceClass) {
              ws.send(JSON.stringify({
                status: 'error',
                message: `Service '${serviceName}' not found in proto file. Available: ${Object.keys(protoDescriptor).join(', ')}`
              }));
              return;
            }
            
            console.log(`Found service ${serviceName}, creating client`);
            const testClient = new ServiceClass(
              'localhost:9000'
            );
            
            // Log all available methods
            const methods = Object.keys(testClient);
            console.log(`Available methods on ${serviceName}:`, methods);
            
            ws.send(JSON.stringify({
              status: 'info',
              message: `gRPC service '${serviceName}' found with methods: ${methods.join(', ')}`
            }));
          } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error(`Error testing gRPC service '${serviceName}':`, errorMessage);
            ws.send(JSON.stringify({
              status: 'error',
              message: `Error testing gRPC service '${serviceName}': ${errorMessage}`
            }));
          }
        }
        
        return; // Exit after handling debug message
      }
      
      // Handle config message - initialize gRPC client
      if (parsedMessage.type === 'config') {
        console.log('Config message received - initializing gRPC client');
        
        try {
          // Check if protoDescriptor was loaded successfully
          if (!protoDescriptor) {
            ws.send(JSON.stringify({
              status: 'error',
              message: 'Proto file not loaded'
            }));
            return;
          }
          
          // Print available services for debugging
          console.log('Available services in proto:', Object.keys(protoDescriptor));
          
          // Directly look for the expected service
          const VideoService = protoDescriptor[EXPECTED_SERVICE_NAME];
          
          if (!VideoService) {
            ws.send(JSON.stringify({
              status: 'error',
              message: `Expected gRPC service '${EXPECTED_SERVICE_NAME}' not found in proto definition. Available services: ${Object.keys(protoDescriptor).join(', ')}`
            }));
            console.error(`Service ${EXPECTED_SERVICE_NAME} not found. Available:`, Object.keys(protoDescriptor));
            return;
          }
          
          console.log(`Found expected service: ${EXPECTED_SERVICE_NAME}`);
          
          // Create gRPC client with secure credentials (assuming insecure for localhost)
          grpcClient = new VideoService(
            'localhost:9000', // Target gRPC server address
            grpc.credentials.createInsecure() // Use insecure for local development
          );
          
          console.log('gRPC client initialized for service:', EXPECTED_SERVICE_NAME);
          console.log('Available methods:', Object.keys(grpcClient));
          
          ws.send(JSON.stringify({
            status: 'success',
            message: 'gRPC client initialized'
          }));
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          console.error('Error initializing gRPC client:', errorMessage);
          ws.send(JSON.stringify({
            status: 'error',
            message: `Failed to initialize gRPC client: ${errorMessage}`
          }));
        }
        
        return;
      }
      
      // For image or audio data
      if (parsedMessage.data && typeof parsedMessage.data === 'string' && 
          parsedMessage.data.startsWith('data:')) {
        
        // Extract binary data from data URL
        const dataUrl = parsedMessage.data;
        const [header, base64Data] = dataUrl.split(',');
        const binary = Buffer.from(base64Data, 'base64');
        
        console.log(`Received ${parsedMessage.type} data: ${binary.length} bytes`);
        
        // Add extra debugging for audio data
        if (parsedMessage.type === 'audio') {
          console.log(`Audio data details - Header: ${header}`);
          console.log(`Audio data first few bytes: ${binary.slice(0, Math.min(20, binary.length)).toString('hex')}`);
          
          // If audio data is suspiciously small, log a warning
          if (binary.length < 1000) {
            console.warn(`WARNING: Audio data is only ${binary.length} bytes, which is unusually small for audio`);
            console.warn('This may indicate a problem with audio capture or encoding on the client side');
          }
        }
        
        // Check if we have a gRPC client
        if (!grpcClient) {
          console.log('No gRPC client available, echoing data back');
          ws.send(JSON.stringify({
            status: 'data',
            message: `Received ${parsedMessage.type} data (no gRPC connection)`,
            type: parsedMessage.type
          }));
          return;
        }
        
        // Try to send data to gRPC service
        try {
          // If we don't have an active stream, create one
          if (!isStreaming || !call) {
            console.log('Starting new gRPC stream');
            
            try {
              // Check if the expected stream method exists on the client
              if (typeof grpcClient[EXPECTED_STREAM_METHOD] !== 'function') {
                throw new Error(`Method '${EXPECTED_STREAM_METHOD}' not found on gRPC client. Available methods: ${Object.keys(grpcClient).join(', ')}`);
              }
              
              console.log(`Calling method: ${EXPECTED_STREAM_METHOD}`);
              
              // Create a streaming call with proper error handling
              call = grpcClient[EXPECTED_STREAM_METHOD]({
                "deadline": Date.now() + 60000  // 60 second deadline - adjust as needed
              });
              isStreaming = true;
              
              // Handle incoming responses from gRPC server
              call.on('data', (response: any) => {
                console.log('Received gRPC response:', response);
                
                if (ws.readyState === WebSocket.OPEN) {
                  // Send a cleaner formatted message to the client
                  ws.send(JSON.stringify({
                    status: 'data',
                    message: 'Content from server',
                    data: {
                      message: response.message || JSON.stringify(response)
                    }
                  }));
                }
              });
              
              call.on('end', () => {
                console.log('gRPC stream ended');
                isStreaming = false;
                call = null;
                
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    status: 'info',
                    message: 'gRPC stream ended'
                  }));
                }
              });
              
              call.on('error', (err: Error) => {
                console.error('gRPC stream error:', err);
                console.error('Error details:', err.stack || 'No stack trace available');
                isStreaming = false;
                call = null;
                
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    status: 'error',
                    message: `gRPC stream error: ${err.message}`,
                    details: err.stack
                  }));
                }
              });
              
              console.log('Stream handlers set up');
            } catch (e) {
              const errorMessage = e instanceof Error ? e.message : String(e);
              console.error('Error setting up gRPC stream:', errorMessage);
              ws.send(JSON.stringify({
                status: 'error',
                message: `Failed to set up gRPC stream: ${errorMessage}`
              }));
              return;
            }
          }
          
          // Send the data through the gRPC stream
          // Format the message to exactly match what Python client is sending
          // Python uses: video_service_pb2.Chunk(mime_type=mime_type, payload=image_bytes)
          if (!ChunkType) {
            console.log('ChunkType is not available, using simple object');
          }
          
          // Create the message with mime_type and payload
          const messageType = parsedMessage.type;
          
          // Extract the actual MIME type from the data URL header if possible
          let mimeType;
          if (messageType === 'audio') {
            const audioFormatMatch = header.match(/data:(audio\/[^;]+);/);
            mimeType = audioFormatMatch ? audioFormatMatch[1] : 'audio/pcm';
            console.log(`Using audio MIME type: ${mimeType} (extracted from header: ${!!audioFormatMatch})`);
          } else {
            // For images, continue using image/jpeg
            mimeType = 'image/jpeg';
          }
          
          // Create the message with mime_type and payload
          const message = {
            mime_type: mimeType,
            payload: binary
          };
          
          console.log(`Sending ${messageType} data to gRPC service (${binary.length} bytes)`);
          console.log('Message structure:', JSON.stringify({
            mime_type: mimeType,
            payload_length: binary.length // Log length instead of full payload
          }));
          
          // Add additional debug info for the audio format
          if (messageType === 'audio') {
            // Try to determine more details about the audio format from the header
            const audioFormatMatch = header.match(/data:(audio\/[^;]+);/);
            const actualMimeType = audioFormatMatch ? audioFormatMatch[1] : 'unknown';
            
            console.log(`Actual audio MIME type from header: ${actualMimeType}`);
            console.log(`Using MIME type for gRPC: ${mimeType}`);
            
            // If the header suggests a different format than what we're using, warn about it
            if (actualMimeType !== 'unknown' && actualMimeType !== mimeType) {
              console.warn(`WARNING: Client is sending ${actualMimeType} but we're telling gRPC it's ${mimeType}`);
              console.warn('Consider updating the audio MIME type to match what the client is sending');
            }
          }
          
          call.write(message);
          
          // Also echo to the client that we received the data
          ws.send(JSON.stringify({
            status: 'info',
            message: `Sent ${parsedMessage.type} data to gRPC service`
          }));
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          console.error('Error sending data to gRPC service:', errorMessage);
          
          // Reset streaming state on error
          isStreaming = false;
          call = null;
          
          ws.send(JSON.stringify({
            status: 'error',
            message: `Error sending data to gRPC service: ${errorMessage}`
          }));
        }
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          status: 'error',
          message: 'Error processing message'
        }));
      }
    }
  });
  
  // Handle WebSocket close
  ws.on('close', () => {
    console.log('WebSocket connection closed');
    
    // End the gRPC stream if active
    if (isStreaming && call) {
      try {
        call.end();
      } catch (e) {
        console.error('Error ending gRPC call:', e);
      }
    }
    
    isStreaming = false;
    call = null;
  });
});

// Use port from environment variable or default to 3001
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(`WebSocket server available at ws://localhost:${PORT}/ws`);
  console.log(`Serving files from: ${currentDir}`);
}); 