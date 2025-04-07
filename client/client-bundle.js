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
      this.videoElement = document.getElementById("webcam");
      this.canvas = document.getElementById("canvas");
      this.responseContainer = document.getElementById("responses");
      this.statusElement = document.getElementById("status");
      const toggleButton = document.getElementById("toggleButton");
      const sendContextButton = document.getElementById("sendContextButton");
      const debugButton = document.getElementById("debugButton");
      const videoToggleButton = document.getElementById("videoToggleButton");
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
        this.connectToWebSocket();
        this.imageInterval = window.setInterval(() => {
          this.captureAndSendImage();
        }, 1e3);
      } catch (error) {
        console.error("Failed to access media devices:", error);
        this.handleError(error);
      }
    }
    connectToWebSocket() {
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
          }));
        }
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
      if (!contextInput || !contextInput.value.trim()) {
        this.updateStatus("Please enter context before sending", true);
        return;
      }
      const context = contextInput.value.trim();
      this.updateStatus("Sending context to Gemini...");
      try {
        const response = await fetch("http://localhost:9000/ai-context/gemini-live", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            context
          })
        });
        if (response.ok) {
          this.updateStatus("Context set successfully");
          this.addResponse(`<em>New AI context set:</em> ${context}`);
        } else {
          const errorText = await response.text();
          throw new Error(`Failed to set context: ${response.status} ${errorText}`);
        }
      } catch (error) {
        console.error("Error sending context:", error);
        this.updateStatus(`Failed to set context: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    }
  };
  window.addEventListener("DOMContentLoaded", () => {
    new VideoClient();
  });
})();
