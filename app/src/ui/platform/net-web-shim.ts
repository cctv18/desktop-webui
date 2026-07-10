function unavailable(): never {
  throw new Error('Network sockets are only available on the GitDesk WebUI server')
}

export interface AddressInfo {
  readonly address: string
  readonly family: string
  readonly port: number
}

export class Socket {
  public pipe<T>(destination: T) {
    return destination
  }

  public write() {
    unavailable()
  }

  public end() {}

  public destroy() {
    return this
  }

  public on() {
    return this
  }

  public once() {
    return this
  }

  public removeAllListeners() {
    return this
  }

  public ref() {
    return this
  }

  public unref() {
    return this
  }
}

export class Server {
  public listen() {
    unavailable()
  }

  public close(callback?: (error?: Error) => void) {
    callback?.()
    return this
  }

  public address(): AddressInfo | string | null {
    return null
  }

  public on() {
    return this
  }

  public once() {
    return this
  }

  public removeAllListeners() {
    return this
  }

  public ref() {
    return this
  }

  public unref() {
    return this
  }
}

export function connect() {
  unavailable()
}

export function createConnection() {
  unavailable()
}

export function createServer() {
  return new Server()
}

export function isIPv4(input: string) {
  const parts = input.split('.')
  return (
    parts.length === 4 &&
    parts.every(part => {
      if (!/^\d+$/.test(part)) {
        return false
      }

      const value = Number(part)
      return value >= 0 && value <= 255 && String(value) === part
    })
  )
}

export default {
  Server,
  Socket,
  connect,
  createConnection,
  createServer,
  isIPv4,
}
