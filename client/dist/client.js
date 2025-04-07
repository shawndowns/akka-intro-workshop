"use strict";
// video-client.ts
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const grpc = __importStar(require("@grpc/grpc-js"));
const protoLoader = __importStar(require("@grpc/proto-loader"));
const path_1 = require("path");
// Define the path to your .proto file
const PROTO_PATH = (0, path_1.join)(__dirname, 'video-service.proto');
// Load the protobuf definition
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const videoService = protoDescriptor.VideoServiceEndpoint;
// gRPC client setup
const client = new videoService('localhost:50051', // Replace with your gRPC server address
grpc.credentials.createInsecure());
// Function to capture image from webcam and stream it
function captureAndStreamImage() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Check if we're in a browser-like environment with mediaDevices
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Webcam access is not supported in this environment');
            }
            // Request webcam access
            const stream = yield navigator.mediaDevices.getUserMedia({ video: true });
            const video = document.createElement('video');
            video.srcObject = stream;
            yield new Promise((resolve) => {
                video.onloadedmetadata = () => {
                    video.play();
                    resolve(null);
                };
            });
            // Create a canvas to capture the image
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const context = canvas.getContext('2d');
            if (!context)
                throw new Error('Could not get canvas context');
            // Draw the video frame to canvas and convert to JPEG
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageDataUrl = canvas.toDataURL('image/jpeg');
            const imageBuffer = Buffer.from(imageDataUrl.split(',')[1], 'base64');
            // Clean up: stop the video stream
            stream.getTracks().forEach((track) => track.stop());
            // Set up the gRPC stream
            const call = client.StreamVideo((error, response) => {
                if (error) {
                    console.error('Stream ended with error:', error);
                }
                else {
                    console.log('Stream completed successfully');
                }
            });
            // Send the image as a single chunk
            const chunk = {
                mime_type: 'image/jpeg',
                payload: imageBuffer,
            };
            call.write(chunk);
            call.end();
            // Handle server acknowledgments
            call.on('data', (ack) => {
                console.log('Received ack from server:', ack.message);
            });
            call.on('error', (error) => {
                console.error('gRPC stream error:', error);
            });
            call.on('end', () => {
                console.log('Server ended the stream');
            });
        }
        catch (error) {
            console.error('Error capturing or streaming image:', error);
        }
    });
}
// Run the function
captureAndStreamImage().catch(console.error);
