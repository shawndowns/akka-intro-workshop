// Original file: video-service.proto


export interface Chunk {
  'mimeType'?: (string);
  'payload'?: (Buffer | Uint8Array | string);
}

export interface Chunk__Output {
  'mimeType': (string);
  'payload': (Buffer);
}
