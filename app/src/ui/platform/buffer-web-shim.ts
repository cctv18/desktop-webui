export const kMaxLength = Number.MAX_SAFE_INTEGER
export const kStringMaxLength = Number.MAX_SAFE_INTEGER
export const INSPECT_MAX_BYTES = 50

export type Buffer = Uint8Array

export const Buffer = {
  alloc(size: number) {
    return new Uint8Array(size)
  },

  concat(chunks: ReadonlyArray<Uint8Array>) {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const bytes = new Uint8Array(length)
    let offset = 0

    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }

    return bytes
  },

  from(value: string | ArrayBuffer | ArrayLike<number> | Iterable<number>) {
    if (typeof value === 'string') {
      return new TextEncoder().encode(value)
    }

    if (Symbol.iterator in Object(value) && !('length' in Object(value))) {
      return new Uint8Array(Array.from(value as Iterable<number>))
    }

    return new Uint8Array(value as ArrayBuffer | ArrayLike<number>)
  },

  isBuffer(value: unknown) {
    return value instanceof Uint8Array
  },
}

export const SlowBuffer = Buffer

export default {
  Buffer,
  INSPECT_MAX_BYTES,
  SlowBuffer,
  kMaxLength,
  kStringMaxLength,
}
