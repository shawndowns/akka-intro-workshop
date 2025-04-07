// Original file: video-service.proto

import type * as grpc from '@grpc/grpc-js'
import type { MethodDefinition } from '@grpc/proto-loader'
import type { Ack as _Ack, Ack__Output as _Ack__Output } from './Ack';
import type { Chunk as _Chunk, Chunk__Output as _Chunk__Output } from './Chunk';

export interface VideoServiceEndpointClient extends grpc.Client {
  StreamVideo(metadata: grpc.Metadata, options?: grpc.CallOptions): grpc.ClientDuplexStream<_Chunk, _Ack__Output>;
  StreamVideo(options?: grpc.CallOptions): grpc.ClientDuplexStream<_Chunk, _Ack__Output>;
  streamVideo(metadata: grpc.Metadata, options?: grpc.CallOptions): grpc.ClientDuplexStream<_Chunk, _Ack__Output>;
  streamVideo(options?: grpc.CallOptions): grpc.ClientDuplexStream<_Chunk, _Ack__Output>;
  
}

export interface VideoServiceEndpointHandlers extends grpc.UntypedServiceImplementation {
  StreamVideo: grpc.handleBidiStreamingCall<_Chunk__Output, _Ack>;
  
}

export interface VideoServiceEndpointDefinition extends grpc.ServiceDefinition {
  StreamVideo: MethodDefinition<_Chunk, _Ack, _Chunk__Output, _Ack__Output>
}
