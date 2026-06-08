type Listener = (...args: ReadonlyArray<unknown>) => void

export interface TransformOptions {
  readonly autoDestroy?: boolean
  readonly emitClose?: boolean
  readonly encoding?: BufferEncoding
  readonly transform?: (
    chunk: unknown,
    encoding: BufferEncoding,
    callback: (error?: Error | null, data?: unknown) => void
  ) => void
}

export class Writable {
  public write(
    _chunk: unknown,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void
  ) {
    const cb =
      typeof encodingOrCallback === 'function'
        ? encodingOrCallback
        : callback
    cb?.()
    return true
  }

  public end(callback?: () => void) {
    callback?.()
    return this
  }

  public on(_event: string, _listener: Listener) {
    return this
  }

  public once(_event: string, _listener: Listener) {
    return this
  }

  public emit() {
    return false
  }
}

export class Readable extends Writable {}

export class Transform extends Writable {
  public constructor(private readonly options: TransformOptions = {}) {
    super()
  }

  public write(
    chunk: unknown,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void
  ) {
    const cb =
      typeof encodingOrCallback === 'function'
        ? encodingOrCallback
        : callback

    if (this.options.transform !== undefined) {
      this.options.transform(chunk, 'utf8', cb ?? (() => {}))
      return true
    }

    cb?.()
    return true
  }

  public pipe<T>(destination: T) {
    return destination
  }
}

export default {
  Readable,
  Transform,
  Writable,
}
