import type * as grpc from '@grpc/grpc-js';
import type { MessageTypeDefinition } from '@grpc/proto-loader';

import type { VideoServiceEndpointClient as _VideoServiceEndpointClient, VideoServiceEndpointDefinition as _VideoServiceEndpointDefinition } from './VideoServiceEndpoint';

type SubtypeConstructor<Constructor extends new (...args: any) => any, Subtype> = {
  new(...args: ConstructorParameters<Constructor>): Subtype;
};

export interface ProtoGrpcType {
  Ack: MessageTypeDefinition
  Chunk: MessageTypeDefinition
  VideoServiceEndpoint: SubtypeConstructor<typeof grpc.Client, _VideoServiceEndpointClient> & { service: _VideoServiceEndpointDefinition }
}

