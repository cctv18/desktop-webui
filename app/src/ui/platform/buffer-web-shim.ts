import type { Buffer as NodeBuffer } from 'buffer'

type BufferConstructor = typeof import('buffer').Buffer

const bufferModule = require('buffer/index.js') as {
  readonly Buffer: BufferConstructor
  readonly SlowBuffer?: BufferConstructor
  readonly INSPECT_MAX_BYTES?: number
  readonly kMaxLength?: number
  readonly kStringMaxLength?: number
}

export type Buffer = NodeBuffer

export const Buffer = bufferModule.Buffer
export const SlowBuffer = bufferModule.SlowBuffer ?? Buffer
export const INSPECT_MAX_BYTES = bufferModule.INSPECT_MAX_BYTES ?? 50
export const kMaxLength =
  bufferModule.kMaxLength ??
  (Buffer as any).kMaxLength ??
  Number.MAX_SAFE_INTEGER
export const kStringMaxLength =
  bufferModule.kStringMaxLength ??
  (Buffer as any).kStringMaxLength ??
  Number.MAX_SAFE_INTEGER

const globalObject = globalThis as typeof globalThis & {
  Buffer?: BufferConstructor
}

if (globalObject.Buffer === undefined) {
  globalObject.Buffer = Buffer
}

export default {
  Buffer,
  INSPECT_MAX_BYTES,
  SlowBuffer,
  kMaxLength,
  kStringMaxLength,
}
