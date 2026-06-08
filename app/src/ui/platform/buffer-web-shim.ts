export const kMaxLength = Number.MAX_SAFE_INTEGER
export const kStringMaxLength = Number.MAX_SAFE_INTEGER
export const INSPECT_MAX_BYTES = 50

export class Buffer extends Uint8Array {
  public static from(value: string | ArrayBuffer | ArrayLike<number>) {
    if (typeof value === 'string') {
      return new TextEncoder().encode(value)
    }

    return new Uint8Array(value as ArrayLike<number>)
  }

  public static isBuffer(value: unknown) {
    return value instanceof Uint8Array
  }
}

export const SlowBuffer = Buffer

export default {
  Buffer,
  INSPECT_MAX_BYTES,
  SlowBuffer,
  kMaxLength,
  kStringMaxLength,
}
