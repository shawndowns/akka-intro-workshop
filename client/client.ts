/**
 * Video client for connecting to the video service
 * Handles webcam capture, audio recording, and communication with the server
 */

class VideoClient {
  private videoElement: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private mediaStream: MediaStream | null = null;
  private isRecording: boolean = false;
  private responseContainer: HTMLDivElement | null = null;
  private imageInterval: number | null = null;
  private socket: WebSocket | null = null;
  private statusElement: HTMLDivElement | null = null;
  private _audioContext: AudioContext | null = null;
  private _audioProcessor: ScriptProcessorNode | null = null;
  private _audioDebugCounter: number = 0;
  private messageBuffer: string[] = [];
  private messageBufferTimer: number | null = null;
  private isBufferingMessages: boolean = false;
  private cartContentsElement: HTMLDivElement | null = null;

  constructor() {
    // Find UI elements defined in index.html
    this.videoElement = document.getElementById('webcam') as HTMLVideoElement;
    this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
    this.responseContainer = document.getElementById('responses') as HTMLDivElement;
    this.statusElement = document.getElementById('status') as HTMLDivElement;
    this.cartContentsElement = document.getElementById('cartContents') as HTMLDivElement;
    const toggleButton = document.getElementById('toggleButton') as HTMLButtonElement;
    const sendContextButton = document.getElementById('sendContextButton') as HTMLButtonElement;
    const debugButton = document.getElementById('debugButton') as HTMLButtonElement;
    const videoToggleButton = document.getElementById('videoToggleButton') as HTMLButtonElement;
    const addItemButton = document.getElementById('addItemButton') as HTMLButtonElement;

    // Add event listeners
    if (toggleButton) {
      toggleButton.addEventListener('click', () => this.toggleRecording());
    } else {
      console.error('Toggle button not found');
    }
    if (sendContextButton) {
      sendContextButton.addEventListener('click', () => this.sendContext());
    } else {
      console.error('Send context button not found');
    }
    if (debugButton) {
      debugButton.addEventListener('click', () => this.enableDebugMode());
    } else {
      // Optional: Log if debug button not found, might not be an error
      console.log('Debug button not found');
    }
    if (videoToggleButton) {
      videoToggleButton.addEventListener('click', () => this.toggleVideoVisibility());
    } else {
      console.error('Video toggle button not found');
    }
    if (addItemButton) {
      addItemButton.addEventListener('click', () => this.addItemToCart());
    } else {
      console.error('Add item button not found');
    }

    // Initial status update
    this.updateStatus('Ready');
  }

  private updateStatus(message: string, isError: boolean = false): void {
    if (!this.statusElement) return;
    
    this.statusElement.textContent = message;
    this.statusElement.className = isError ? 'status error' : (
      message.includes('Connected') ? 'status connected' : 'status'
    );
  }

  private async toggleRecording(): Promise<void> {
    const button = document.getElementById('toggleButton') as HTMLButtonElement;
    
    if (!this.isRecording) {
      button.textContent = 'End';
      this.isRecording = true;
      this.updateStatus('Starting...');
      
      try {
        // Start recording
        await this.startRecording();
      } catch (error) {
        console.error('Error starting recording:', error);
        this.handleError(error);
      }
    } else {
      this.stopRecording();
      button.textContent = 'Start';
      this.updateStatus('Ready');
    }
  }

  private async startRecording(): Promise<void> {
    try {
      this.updateStatus('Accessing camera and microphone...');
      
      // Request access to webcam and microphone
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      
      if (!this.videoElement) return;
      
      // Set up webcam
      this.videoElement.srcObject = this.mediaStream;
      this.updateStatus('Camera and microphone ready');
      
      // Set up audio processing using AudioContext instead of MediaRecorder
      const audioContext = new AudioContext({
        sampleRate: 16000, // Match Python client's SEND_SAMPLE_RATE
      });
      
      // Create audio source from the stream
      const source = audioContext.createMediaStreamSource(this.mediaStream);
      
      // Create script processor node to access raw audio data
      // Note: ScriptProcessorNode is deprecated but still works in all browsers
      // while AudioWorklet is newer but requires more complex setup
      const processor = audioContext.createScriptProcessor(1024, 1, 1);
      
      // Connect the source to the processor
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      // Process audio data
      processor.onaudioprocess = (e) => {
        if (!this.isRecording) return;
        
        // Debug - log that audio processing is happening
        if (this._audioDebugCounter === undefined) {
          this._audioDebugCounter = 0;
        }
        
        // Log every 10th audio packet to avoid flooding the console
        if (this._audioDebugCounter % 10 === 0) {
          console.log(`Audio processing: packet #${this._audioDebugCounter}, buffer size: ${e.inputBuffer.getChannelData(0).length}`);
        }
        this._audioDebugCounter++;
        
        // Get raw PCM audio data from input channel
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Convert Float32Array to Int16Array (matching Python's FORMAT = pyaudio.paInt16)
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          // Convert float (-1.0 to 1.0) to int16 (-32768 to 32767)
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }
        
        // Send audio data - we can directly use the ArrayBuffer from the Int16Array
        this.sendAudioData(pcmData.buffer);
      };
      
      // Store reference to clean up later
      this._audioContext = audioContext;
      this._audioProcessor = processor;
      
      // Connect to WebSocket server
      this.updateStatus('Connecting to server...');
      // Ensure WebSocket is connected *before* sending the start message
      this.connectToWebSocket().then(() => {
        // Send the context IDs to the server to initiate the gRPC stream
        const aiContextIdInput = document.getElementById('aiContextIdInput') as HTMLInputElement;
        const cartIdInput = document.getElementById('cartIdInput') as HTMLInputElement;
        const aiContextId = aiContextIdInput.value;
        const cartId = cartIdInput.value;

        if (!aiContextId || !cartId) {
          console.error('AI Context ID or Cart ID is missing.');
          this.updateStatus('Error: AI Context ID and Cart ID must be set before starting.', true);
          this.stopRecording(); // Stop if IDs are missing
          return;
        }

        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
          console.log(`Sending startStream message with aiContextId: ${aiContextId}, cartId: ${cartId}`);
          this.socket.send(JSON.stringify({
            type: 'startStream',
            aiContextId: aiContextId,
            cartId: cartId
          }));
        } else {
          console.error('WebSocket not open when trying to send startStream');
          this.updateStatus('Error: Could not initiate stream with server.', true);
          this.stopRecording();
          return;
        }
        
        // Start capturing images *after* successfully sending the start message
        this.updateStatus('Starting image capture...');
        this.imageInterval = window.setInterval(() => {
          this.captureAndSendImage();
        }, 1000);

      }).catch(error => {
        console.error("Failed to connect WebSocket for streaming:", error);
        this.updateStatus('Error: Failed to connect to server for streaming.', true);
        this.stopRecording();
      });

      // Image capture interval is now started within the connectToWebSocket().then() block
      /* 
      this.imageInterval = window.setInterval(() => {
        this.captureAndSendImage();
      }, 1000);
      */
      
    } catch (error) {
      console.error('Failed to access media devices:', error);
      this.handleError(error);
    }
  }

  private connectToWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Connect to WebSocket server (server.ts)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname || 'localhost';
      const port = window.location.port || '3001';
      
      const wsUrl = `${protocol}//${host}:${port}/ws`;
      
      this.socket = new WebSocket(wsUrl);
      
      this.socket.onopen = () => {
        console.log('Connected to WebSocket server at', wsUrl);
        this.updateStatus('Connected to server');
        
        // Initialize gRPC connection config *on the server side* is fine here,
        // but the actual stream start depends on the startStream message
        if (this.socket) {
          this.socket.send(JSON.stringify({
            type: 'config' // Let server know we are ready to potentially start a stream
          }));
        }
        resolve(); // Resolve the promise when the connection is open
      };
      
      this.socket.onmessage = (event) => {
        const message = event.data.toString();
        
        try {
          // Try to parse as JSON first
          const jsonMessage = JSON.parse(message);
          
          // Handle status messages
          if (jsonMessage.status) {
            // Update status for all status messages
            if (jsonMessage.message) {
              this.updateStatus(jsonMessage.message, jsonMessage.status === 'error');
            }
            
            // Only process content from data messages
            if (jsonMessage.status === 'data' && jsonMessage.data && jsonMessage.data.message) {
              this.processMessage(jsonMessage.data.message);
            }
          } else {
            // Non-status JSON - try to process as content
            this.processMessage(message);
          }
        } catch (e) {
          // Not JSON - try to process as plain text
          this.processMessage(message);
        }
      };
      
      this.socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.updateStatus('Connection error', true);
        this.handleError(error);
        reject(error); // Reject the promise on error
      };
      
      this.socket.onclose = () => {
        console.log('WebSocket connection closed');
        this.updateStatus('Connection closed', this.isRecording);
        
        if (this.isRecording) {
          this.stopRecording();
          const button = document.getElementById('toggleButton') as HTMLButtonElement;
          button.textContent = 'Start';
        }
      };
    });
  }

  private stopRecording(): void {
    this.isRecording = false;
    
    // Stop image capture interval
    if (this.imageInterval) {
      clearInterval(this.imageInterval);
      this.imageInterval = null;
    }
    
    // Clean up audio context and processor
    if (this._audioProcessor) {
      this._audioProcessor.disconnect();
      this._audioProcessor = null;
    }
    
    if (this._audioContext) {
      this._audioContext.close().catch(console.error);
      this._audioContext = null;
    }
    
    // Stop all media tracks
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    
    // Close WebSocket connection
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
      this.socket = null;
    }
  }

  private captureAndSendImage(): void {
    if (!this.isRecording || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (!this.videoElement || !this.canvas) return;
    
    const context = this.canvas.getContext('2d');
    if (!context) return;
    
    // Draw video frame to canvas
    context.drawImage(this.videoElement, 0, 0, this.canvas.width, this.canvas.height);
    
    // Convert canvas to JPEG
    this.canvas.toBlob((blob) => {
      if (blob && this.socket && this.socket.readyState === WebSocket.OPEN) {
        console.log(`Captured image: ${blob.size} bytes`);
        
        // Convert blob to base64 for easier transport over WebSocket
        const reader = new FileReader();
        reader.onloadend = () => {
          if (reader.result && this.socket) {
            const message = {
              type: 'image',
              mimeType: 'image/jpeg',
              data: reader.result
            };
            
            console.log(`Sending image data: ${reader.result.toString().substring(0, 50)}...`);
            this.socket.send(JSON.stringify(message));
          }
        };
        reader.readAsDataURL(blob);
      }
    }, 'image/jpeg', 0.8);
  }

  private sendAudioData(arrayBuffer: ArrayBuffer): void {
    if (!this.isRecording || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    
    try {
      // Convert ArrayBuffer to Uint8Array for processing
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Convert to base64
      const base64Data = this.arrayBufferToBase64(uint8Array);
      
      // Create a data URL with the correct MIME type (audio/pcm)
      const dataUrl = `data:audio/pcm;base64,${base64Data}`;
      
      const message = {
        type: 'audio',
        data: dataUrl
      };
      
      console.log(`Sending audio data: ${uint8Array.length} bytes`);
      this.socket.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending audio data:', error);
      console.error('Error details:', error instanceof Error ? error.message : String(error));
    }
  }
  
  // Helper method to convert ArrayBuffer to base64 string
  private arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    
    return window.btoa(binary);
  }

  private addResponse(message: string): void {
    if (!this.responseContainer) return;
    
    // Skip INFO and ERROR messages and empty messages
    if (message.startsWith('INFO:') || 
        message.startsWith('ERROR:') || 
        !message.trim() || 
        message === '{}' || 
        message === '{"message":""}' ||
        message === 'Setup complete') {
      return;
    }
    
    // Create a new response item for this message
    const responseItem = document.createElement('div');
    responseItem.className = 'response-item';
    responseItem.innerHTML = message;
    
    // Add to container
    this.responseContainer.appendChild(responseItem);
    
    // Scroll to the bottom
    this.responseContainer.scrollTop = this.responseContainer.scrollHeight;
  }

  private handleError(error: unknown): void {
    console.error('Error:', error);
    this.updateStatus('Error occurred', true);
    
    // Reset to initial state
    if (this.isRecording) {
      this.stopRecording();
      const button = document.getElementById('toggleButton') as HTMLButtonElement;
      button.textContent = 'Start';
    }
  }

  private toggleVideoVisibility(): void {
    if (!this.videoElement) return;
    
    const button = document.getElementById('videoToggleButton') as HTMLButtonElement;
    
    if (this.videoElement.classList.contains('hidden')) {
      // Show video
      this.videoElement.classList.remove('hidden');
      button.textContent = 'Hide Video';
    } else {
      // Hide video
      this.videoElement.classList.add('hidden');
      button.textContent = 'Show Video';
    }
  }

  private enableDebugMode(): void {
    // Show connection status
    this.updateStatus('Debug mode enabled');
    
    // Try connecting directly via a test request
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: 'debug',
        action: 'testGrpcService',
        serviceName: 'VideoServiceEndpoint'
      }));
    } else {
      // If not connected, try to connect
      this.connectToWebSocket();
    }
  }

  // New helper method to extract and process message content
  private processMessage(message: string): void {
    // Skip empty or system messages
    if (!message || 
        message === '{}' || 
        message === '{"message":""}' ||
        message === 'Setup complete' ||
        message.includes('sent audio data') ||
        message.includes('sent image data')) {
      return;
    }
    
    let content = message;
    
    // Remove "Content:" prefix if present
    if (content.startsWith('Content:')) {
      content = content.substring('Content:'.length).trim();
    }
    
    // Try to extract content from LiveServerMessage structure
    try {
      if (content.includes('LiveServerMessage') || 
          content.includes('LiveServerContent') || 
          content.includes('modelTurn')) {
        const jsonObj = JSON.parse(content);
        
        // Extract text from parts if available
        if (jsonObj.serverContent?.modelTurn?.parts) {
          const parts = jsonObj.serverContent.modelTurn.parts;
          for (const part of parts) {
            if (part.text) {
              content = part.text;
              break;
            }
          }
        }
      }
    } catch (e) {
      // If parsing fails, just use the original content
      console.log('Could not parse as LiveServerMessage, using raw content');
    }

    // Instead of displaying immediately, buffer the message
    this.bufferMessage(content);
  }

  // New method to buffer messages for 3 seconds
  private bufferMessage(message: string): void {
    // Add message to buffer
    this.messageBuffer.push(message);
    
    // If we're already buffering, just add to the existing buffer
    if (this.isBufferingMessages) {
      return;
    }
    
    // Start buffering for 3 seconds
    this.isBufferingMessages = true;
    
    // Clear any existing timer
    if (this.messageBufferTimer !== null) {
      window.clearTimeout(this.messageBufferTimer);
    }
    
    // Set a timer to process buffered messages after 3 seconds
    this.messageBufferTimer = window.setTimeout(() => {
      this.processBufferedMessages();
    }, 1000);
  }
  
  // Process all buffered messages
  private processBufferedMessages(): void {
    // Only display if we have messages
    if (this.messageBuffer.length > 0) {
      // Combine all messages with line breaks between them
      const combinedMessage = this.messageBuffer.join(' ');
      
      
      // Display the combined message
      this.addResponse(combinedMessage.replace(
        /\*\*(.*?)\*\*/g, 
        '<span style="font-weight: bold; color: #ffce4a">**$1**</span>'
      ).replace(/(\s,)/g, ','));
      
      // Clear the buffer
      this.messageBuffer = [];
    }
    
    // Reset the buffering flag
    this.isBufferingMessages = false;
  }

  private async sendContext(): Promise<void> {
    const contextInput = document.getElementById('contextInput') as HTMLTextAreaElement;
    const aiContextIdInput = document.getElementById('aiContextIdInput') as HTMLInputElement;
    const context = contextInput.value;
    const aiContextId = aiContextIdInput.value;

    if (!context || !aiContextId) {
      console.error('Context or AI Context ID input not found or empty.');
      this.updateStatus('Error: Context or AI Context ID cannot be empty.', true);
      return;
    }

    try {
      this.updateStatus(`Sending AI context with ID: ${aiContextId}...`);
      
      // Construct the URL for the AI context endpoint
      const protocol = window.location.protocol;
      const host = window.location.hostname;
      const port = 9000; // Assuming the backend runs on port 9000
      const url = `${protocol}//${host}:${port}/ai-context/${aiContextId}`;

      // Send the context to the backend using fetch
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ context: context }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const responseData = await response.text(); // Assuming the endpoint returns the context string
      this.updateStatus(`AI Context set successfully (ID: ${aiContextId}): ${responseData}`);
      console.log('AI Context set response:', responseData);

    } catch (error) {
      console.error('Error sending AI context:', error);
      this.updateStatus('Error sending AI context.', true);
      this.handleError(error);
    }
  }

  private async addItemToCart(): Promise<void> {
    const cartIdInput = document.getElementById('cartIdInput') as HTMLInputElement;
    const productIdInput = document.getElementById('productIdInput') as HTMLInputElement;
    const productNameInput = document.getElementById('productNameInput') as HTMLInputElement;
    const quantityInput = document.getElementById('quantityInput') as HTMLInputElement;

    const cartId = cartIdInput.value;
    const productId = productIdInput.value;
    const name = productNameInput.value;
    const quantity = parseInt(quantityInput.value, 10);

    if (!cartId || !productId || !name || isNaN(quantity) || quantity <= 0) {
        console.error('Invalid cart item input.');
        this.updateStatus('Error: Please provide valid Cart ID, Product ID, Name, and Quantity (>0).', true);
        return;
    }

    const item = {
        productId: productId,
        name: name,
        quantity: quantity
    };

    try {
        this.updateStatus(`Adding item '${name}' to cart ID: ${cartId}...`);
        const protocol = window.location.protocol;
        const host = window.location.hostname;
        const port = 9000; // Backend port
        const url = `${protocol}//${host}:${port}/carts/${cartId}/item`;

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(item),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        this.updateStatus(`Item '${name}' added to cart ${cartId}.`);
        console.log(`Item added/updated in cart ${cartId}`);

        // After adding the item, refresh the cart display
        this.displayCart(cartId);

    } catch (error) {
        console.error('Error adding item to cart:', error);
        this.updateStatus('Error adding item to cart.', true);
        this.handleError(error);
    }
  }

  private async displayCart(cartId: string): Promise<void> {
    if (!this.cartContentsElement) {
        console.error('Cart contents element not found.');
        return;
    }

    try {
        this.updateStatus(`Fetching cart ${cartId}...`);
        const protocol = window.location.protocol;
        const host = window.location.hostname;
        const port = 9000; // Backend port
        const url = `${protocol}//${host}:${port}/carts/${cartId}`;

        const response = await fetch(url, {
            method: 'GET',
        });

        if (!response.ok) {
            if (response.status === 404) {
              this.cartContentsElement.innerHTML = `<p>Cart ${cartId} not found.</p>`;
              this.updateStatus(`Cart ${cartId} not found.`);
              return;
            } 
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const cartData = await response.json();
        this.updateStatus(`Cart ${cartId} loaded.`);
        console.log(`Cart ${cartId} contents:`, cartData);

        // Display cart contents
        let cartHtml = `<h3>Cart: ${cartId}</h3>`;
        if (cartData.items && cartData.items.length > 0) {
            cartHtml += '<ul>';
            cartData.items.forEach((item: any) => {
                cartHtml += `<li>${item.name} (ID: ${item.productId}) - Quantity: ${item.quantity}</li>`;
            });
            cartHtml += '</ul>';
        } else {
            cartHtml += '<p>Cart is empty.</p>';
        }
        this.cartContentsElement.innerHTML = cartHtml;

    } catch (error) {
        console.error(`Error fetching cart ${cartId}:`, error);
        this.updateStatus(`Error fetching cart ${cartId}.`, true);
        this.cartContentsElement.innerHTML = `<p>Error loading cart ${cartId}.</p>`;
        this.handleError(error);
    }
  }
}

// Initialize the client when the page is loaded
window.addEventListener('DOMContentLoaded', () => {
  new VideoClient();
}); 