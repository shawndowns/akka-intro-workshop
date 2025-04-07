"use strict";
(() => {
  // client.ts
  var VideoClient = class {
    constructor() {
      this.videoElement = null;
      this.canvas = null;
      this.mediaStream = null;
      this.isRecording = false;
      this.responseContainer = null;
      this.imageInterval = null;
      this.socket = null;
      this.statusElement = null;
      this._audioContext = null;
      this._audioProcessor = null;
      this._audioDebugCounter = 0;
      this.messageBuffer = [];
      this.messageBufferTimer = null;
      this.isBufferingMessages = false;
      this.cartContentsElement = null;
      this.videoElement = document.getElementById("webcam");
      this.canvas = document.getElementById("canvas");
      this.responseContainer = document.getElementById("responses");
      this.statusElement = document.getElementById("status");
      this.cartContentsElement = document.getElementById("cartContents");
      const toggleButton = document.getElementById("toggleButton");
      const sendContextButton = document.getElementById("sendContextButton");
      const debugButton = document.getElementById("debugButton");
      const videoToggleButton = document.getElementById("videoToggleButton");
      const addItemButton = document.getElementById("addItemButton");
      if (toggleButton) {
        toggleButton.addEventListener("click", () => this.toggleRecording());
      } else {
        console.error("Toggle button not found");
      }
      if (sendContextButton) {
        sendContextButton.addEventListener("click", () => this.sendContext());
      } else {
        console.error("Send context button not found");
      }
      if (debugButton) {
        debugButton.addEventListener("click", () => this.enableDebugMode());
      } else {
        console.log("Debug button not found");
      }
      if (videoToggleButton) {
        videoToggleButton.addEventListener("click", () => this.toggleVideoVisibility());
      } else {
        console.error("Video toggle button not found");
      }
      if (addItemButton) {
        addItemButton.addEventListener("click", () => this.addItemToCart());
      } else {
        console.error("Add item button not found");
      }
      this.updateStatus("Ready");
    }
    updateStatus(message, isError = false) {
      if (!this.statusElement) return;
      this.statusElement.textContent = message;
      this.statusElement.className = isError ? "status error" : message.includes("Connected") ? "status connected" : "status";
    }
    async toggleRecording() {
      const button = document.getElementById("toggleButton");
      if (!this.isRecording) {
        button.textContent = "End";
        this.isRecording = true;
        this.updateStatus("Starting...");
        try {
          await this.startRecording();
        } catch (error) {
          console.error("Error starting recording:", error);
          this.handleError(error);
        }
      } else {
        this.stopRecording();
        button.textContent = "Start";
        this.updateStatus("Ready");
      }
    }
    async startRecording() {
      try {
        this.updateStatus("Accessing camera and microphone...");
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
        if (!this.videoElement) return;
        this.videoElement.srcObject = this.mediaStream;
        this.updateStatus("Camera and microphone ready");
        const audioContext = new AudioContext({
          sampleRate: 16e3
          // Match Python client's SEND_SAMPLE_RATE
        });
        const source = audioContext.createMediaStreamSource(this.mediaStream);
        const processor = audioContext.createScriptProcessor(1024, 1, 1);
        source.connect(processor);
        processor.connect(audioContext.destination);
        processor.onaudioprocess = (e) => {
          if (!this.isRecording) return;
          if (this._audioDebugCounter === void 0) {
            this._audioDebugCounter = 0;
          }
          if (this._audioDebugCounter % 10 === 0) {
            console.log(`Audio processing: packet #${this._audioDebugCounter}, buffer size: ${e.inputBuffer.getChannelData(0).length}`);
          }
          this._audioDebugCounter++;
          const inputData = e.inputBuffer.getChannelData(0);
          const pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
          }
          this.sendAudioData(pcmData.buffer);
        };
        this._audioContext = audioContext;
        this._audioProcessor = processor;
        this.updateStatus("Connecting to server...");
        this.connectToWebSocket().then(() => {
          const aiContextIdInput = document.getElementById("aiContextIdInput");
          const cartIdInput = document.getElementById("cartIdInput");
          const aiContextId = aiContextIdInput.value;
          const cartId = cartIdInput.value;
          if (!aiContextId || !cartId) {
            console.error("AI Context ID or Cart ID is missing.");
            this.updateStatus("Error: AI Context ID and Cart ID must be set before starting.", true);
            this.stopRecording();
            return;
          }
          if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            console.log(`Sending startStream message with aiContextId: ${aiContextId}, cartId: ${cartId}`);
            this.socket.send(JSON.stringify({
              type: "startStream",
              aiContextId,
              cartId
            }));
          } else {
            console.error("WebSocket not open when trying to send startStream");
            this.updateStatus("Error: Could not initiate stream with server.", true);
            this.stopRecording();
            return;
          }
          this.updateStatus("Starting image capture...");
          this.imageInterval = window.setInterval(() => {
            this.captureAndSendImage();
          }, 1e3);
        }).catch((error) => {
          console.error("Failed to connect WebSocket for streaming:", error);
          this.updateStatus("Error: Failed to connect to server for streaming.", true);
          this.stopRecording();
        });
      } catch (error) {
        console.error("Failed to access media devices:", error);
        this.handleError(error);
      }
    }
    connectToWebSocket() {
      return new Promise((resolve, reject) => {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.hostname || "localhost";
        const port = window.location.port || "3001";
        const wsUrl = `${protocol}//${host}:${port}/ws`;
        this.socket = new WebSocket(wsUrl);
        this.socket.onopen = () => {
          console.log("Connected to WebSocket server at", wsUrl);
          this.updateStatus("Connected to server");
          if (this.socket) {
            this.socket.send(JSON.stringify({
              type: "config"
              // Let server know we are ready to potentially start a stream
            }));
          }
          resolve();
        };
        this.socket.onmessage = (event) => {
          const message = event.data.toString();
          try {
            const jsonMessage = JSON.parse(message);
            if (jsonMessage.status) {
              if (jsonMessage.message) {
                this.updateStatus(jsonMessage.message, jsonMessage.status === "error");
              }
              if (jsonMessage.status === "data" && jsonMessage.data && jsonMessage.data.message) {
                this.processMessage(jsonMessage.data.message);
              }
            } else {
              this.processMessage(message);
            }
          } catch (e) {
            this.processMessage(message);
          }
        };
        this.socket.onerror = (error) => {
          console.error("WebSocket error:", error);
          this.updateStatus("Connection error", true);
          this.handleError(error);
          reject(error);
        };
        this.socket.onclose = () => {
          console.log("WebSocket connection closed");
          this.updateStatus("Connection closed", this.isRecording);
          if (this.isRecording) {
            this.stopRecording();
            const button = document.getElementById("toggleButton");
            button.textContent = "Start";
          }
        };
      });
    }
    stopRecording() {
      this.isRecording = false;
      if (this.imageInterval) {
        clearInterval(this.imageInterval);
        this.imageInterval = null;
      }
      if (this._audioProcessor) {
        this._audioProcessor.disconnect();
        this._audioProcessor = null;
      }
      if (this._audioContext) {
        this._audioContext.close().catch(console.error);
        this._audioContext = null;
      }
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((track) => track.stop());
        this.mediaStream = null;
      }
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.close();
        this.socket = null;
      }
    }
    captureAndSendImage() {
      if (!this.isRecording || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      if (!this.videoElement || !this.canvas) return;
      const context = this.canvas.getContext("2d");
      if (!context) return;
      context.drawImage(this.videoElement, 0, 0, this.canvas.width, this.canvas.height);
      this.canvas.toBlob((blob) => {
        if (blob && this.socket && this.socket.readyState === WebSocket.OPEN) {
          console.log(`Captured image: ${blob.size} bytes`);
          const reader = new FileReader();
          reader.onloadend = () => {
            if (reader.result && this.socket) {
              const message = {
                type: "image",
                mimeType: "image/jpeg",
                data: reader.result
              };
              console.log(`Sending image data: ${reader.result.toString().substring(0, 50)}...`);
              this.socket.send(JSON.stringify(message));
            }
          };
          reader.readAsDataURL(blob);
        }
      }, "image/jpeg", 0.8);
    }
    sendAudioData(arrayBuffer) {
      if (!this.isRecording || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      try {
        const uint8Array = new Uint8Array(arrayBuffer);
        const base64Data = this.arrayBufferToBase64(uint8Array);
        const dataUrl = `data:audio/pcm;base64,${base64Data}`;
        const message = {
          type: "audio",
          data: dataUrl
        };
        console.log(`Sending audio data: ${uint8Array.length} bytes`);
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        console.error("Error sending audio data:", error);
        console.error("Error details:", error instanceof Error ? error.message : String(error));
      }
    }
    // Helper method to convert ArrayBuffer to base64 string
    arrayBufferToBase64(buffer) {
      let binary = "";
      const bytes = new Uint8Array(buffer);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return window.btoa(binary);
    }
    addResponse(message) {
      if (!this.responseContainer) return;
      if (message.startsWith("INFO:") || message.startsWith("ERROR:") || !message.trim() || message === "{}" || message === '{"message":""}' || message === "Setup complete") {
        return;
      }
      const responseItem = document.createElement("div");
      responseItem.className = "response-item";
      responseItem.innerHTML = message;
      this.responseContainer.appendChild(responseItem);
      this.responseContainer.scrollTop = this.responseContainer.scrollHeight;
    }
    handleError(error) {
      console.error("Error:", error);
      this.updateStatus("Error occurred", true);
      if (this.isRecording) {
        this.stopRecording();
        const button = document.getElementById("toggleButton");
        button.textContent = "Start";
      }
    }
    toggleVideoVisibility() {
      if (!this.videoElement) return;
      const button = document.getElementById("videoToggleButton");
      if (this.videoElement.classList.contains("hidden")) {
        this.videoElement.classList.remove("hidden");
        button.textContent = "Hide Video";
      } else {
        this.videoElement.classList.add("hidden");
        button.textContent = "Show Video";
      }
    }
    enableDebugMode() {
      this.updateStatus("Debug mode enabled");
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          type: "debug",
          action: "testGrpcService",
          serviceName: "VideoServiceEndpoint"
        }));
      } else {
        this.connectToWebSocket();
      }
    }
    // New helper method to extract and process message content
    processMessage(message) {
      if (!message || message === "{}" || message === '{"message":""}' || message === "Setup complete" || message.includes("sent audio data") || message.includes("sent image data")) {
        return;
      }
      let content = message;
      if (content.startsWith("Content:")) {
        content = content.substring("Content:".length).trim();
      }
      try {
        if (content.includes("LiveServerMessage") || content.includes("LiveServerContent") || content.includes("modelTurn")) {
          const jsonObj = JSON.parse(content);
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
        console.log("Could not parse as LiveServerMessage, using raw content");
      }
      this.bufferMessage(content);
    }
    // New method to buffer messages for 3 seconds
    bufferMessage(message) {
      this.messageBuffer.push(message);
      if (this.isBufferingMessages) {
        return;
      }
      this.isBufferingMessages = true;
      if (this.messageBufferTimer !== null) {
        window.clearTimeout(this.messageBufferTimer);
      }
      this.messageBufferTimer = window.setTimeout(() => {
        this.processBufferedMessages();
      }, 1e3);
    }
    // Process all buffered messages
    processBufferedMessages() {
      if (this.messageBuffer.length > 0) {
        const combinedMessage = this.messageBuffer.join(" ");
        this.addResponse(combinedMessage.replace(
          /\*\*(.*?)\*\*/g,
          '<span style="font-weight: bold; color: #ffce4a">**$1**</span>'
        ).replace(/(\s,)/g, ","));
        this.messageBuffer = [];
      }
      this.isBufferingMessages = false;
    }
    async sendContext() {
      const contextInput = document.getElementById("contextInput");
      const aiContextIdInput = document.getElementById("aiContextIdInput");
      const context = contextInput.value;
      const aiContextId = aiContextIdInput.value;
      if (!context || !aiContextId) {
        console.error("Context or AI Context ID input not found or empty.");
        this.updateStatus("Error: Context or AI Context ID cannot be empty.", true);
        return;
      }
      try {
        this.updateStatus(`Sending AI context with ID: ${aiContextId}...`);
        const protocol = window.location.protocol;
        const host = window.location.hostname;
        const port = 9e3;
        const url = `${protocol}//${host}:${port}/ai-context/${aiContextId}`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ context })
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const responseData = await response.text();
        this.updateStatus(`AI Context set successfully (ID: ${aiContextId}): ${responseData}`);
        console.log("AI Context set response:", responseData);
      } catch (error) {
        console.error("Error sending AI context:", error);
        this.updateStatus("Error sending AI context.", true);
        this.handleError(error);
      }
    }
    async addItemToCart() {
      const cartIdInput = document.getElementById("cartIdInput");
      const productIdInput = document.getElementById("productIdInput");
      const productNameInput = document.getElementById("productNameInput");
      const quantityInput = document.getElementById("quantityInput");
      const cartId = cartIdInput.value;
      const productId = productIdInput.value;
      const name = productNameInput.value;
      const quantity = parseInt(quantityInput.value, 10);
      if (!cartId || !productId || !name || isNaN(quantity) || quantity <= 0) {
        console.error("Invalid cart item input.");
        this.updateStatus("Error: Please provide valid Cart ID, Product ID, Name, and Quantity (>0).", true);
        return;
      }
      const item = {
        productId,
        name,
        quantity
      };
      try {
        this.updateStatus(`Adding item '${name}' to cart ID: ${cartId}...`);
        const protocol = window.location.protocol;
        const host = window.location.hostname;
        const port = 9e3;
        const url = `${protocol}//${host}:${port}/carts/${cartId}/item`;
        const response = await fetch(url, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(item)
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        this.updateStatus(`Item '${name}' added to cart ${cartId}.`);
        console.log(`Item added/updated in cart ${cartId}`);
        this.displayCart(cartId);
      } catch (error) {
        console.error("Error adding item to cart:", error);
        this.updateStatus("Error adding item to cart.", true);
        this.handleError(error);
      }
    }
    async displayCart(cartId) {
      if (!this.cartContentsElement) {
        console.error("Cart contents element not found.");
        return;
      }
      try {
        this.updateStatus(`Fetching cart ${cartId}...`);
        const protocol = window.location.protocol;
        const host = window.location.hostname;
        const port = 9e3;
        const url = `${protocol}//${host}:${port}/carts/${cartId}`;
        const response = await fetch(url, {
          method: "GET"
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
        let cartHtml = `<h3>Cart: ${cartId}</h3>`;
        if (cartData.items && cartData.items.length > 0) {
          cartHtml += "<ul>";
          cartData.items.forEach((item) => {
            cartHtml += `<li>${item.name} (ID: ${item.productId}) - Quantity: ${item.quantity}</li>`;
          });
          cartHtml += "</ul>";
        } else {
          cartHtml += "<p>Cart is empty.</p>";
        }
        this.cartContentsElement.innerHTML = cartHtml;
      } catch (error) {
        console.error(`Error fetching cart ${cartId}:`, error);
        this.updateStatus(`Error fetching cart ${cartId}.`, true);
        this.cartContentsElement.innerHTML = `<p>Error loading cart ${cartId}.</p>`;
        this.handleError(error);
      }
    }
  };
  window.addEventListener("DOMContentLoaded", () => {
    new VideoClient();
  });
})();
