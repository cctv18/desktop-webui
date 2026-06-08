type DigestEncoding = 'hex' | 'base64' | 'base64url'

class ByteBuffer extends Uint8Array {
  public toString(encoding: DigestEncoding = 'hex') {
    switch (encoding) {
      case 'base64':
        return bytesToBase64(this)
      case 'base64url':
        return bytesToBase64(this)
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/g, '')
      case 'hex':
      default:
        return bytesToHex(this)
    }
  }
}

class WebHash {
  private value = 2166136261

  public update(data: string | Uint8Array) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data

    for (const byte of bytes) {
      this.value ^= byte
      this.value = Math.imul(this.value, 16777619) >>> 0
    }

    return this
  }

  public digest(encoding: DigestEncoding = 'hex') {
    const bytes = new ByteBuffer(32)

    for (let i = 0; i < bytes.length; i++) {
      this.value ^= i
      this.value = Math.imul(this.value, 16777619) >>> 0
      bytes[i] = (this.value >>> ((i % 4) * 8)) & 0xff
    }

    return bytes.toString(encoding)
  }
}

export function randomBytes(size: number) {
  const bytes = new ByteBuffer(size)

  if (globalThis.crypto?.getRandomValues !== undefined) {
    globalThis.crypto.getRandomValues(bytes)
    return bytes
  }

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256)
  }

  return bytes
}

export function randomUUID() {
  if (globalThis.crypto?.randomUUID !== undefined) {
    return globalThis.crypto.randomUUID()
  }

  const bytes = randomBytes(16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = bytesToHex(bytes)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function createHash(_algorithm: string) {
  return new WebHash()
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function bytesToBase64(bytes: Uint8Array) {
  let value = ''

  for (const byte of bytes) {
    value += String.fromCharCode(byte)
  }

  return btoa(value)
}

export default {
  createHash,
  randomBytes,
  randomUUID,
}
