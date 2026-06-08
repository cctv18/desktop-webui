export function promisify(fn: (...args: ReadonlyArray<any>) => any) {
  return (...args: ReadonlyArray<any>) =>
    new Promise((resolve, reject) => {
      fn(...args, (error: Error | null, value: unknown) => {
        if (error !== null && error !== undefined) {
          reject(error)
          return
        }

        resolve(value)
      })
    })
}

export function format(value: unknown, ...args: ReadonlyArray<unknown>) {
  if (args.length === 0) {
    return String(value)
  }

  let index = 0
  return String(value).replace(/%[sdjifoO%]/g, match => {
    if (match === '%%') {
      return '%'
    }

    const arg = args[index++]
    return match === '%j' ? JSON.stringify(arg) : String(arg)
  })
}

export function inspect(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function inherits(
  constructor: Function,
  superConstructor: Function
): void {
  if (typeof constructor !== 'function') {
    throw new TypeError('The constructor to inherit from must be a function')
  }

  if (typeof superConstructor !== 'function') {
    throw new TypeError('The super constructor must be a function')
  }

  ;(constructor as Function & { super_: Function }).super_ = superConstructor
  Object.setPrototypeOf(
    constructor.prototype,
    superConstructor.prototype ?? Object.prototype
  )
}

export function getSystemErrorName(code: number) {
  switch (code) {
    case -2:
      return 'ENOENT'
    case -13:
      return 'EACCES'
    case -17:
      return 'EEXIST'
    case -20:
      return 'ENOTDIR'
    case -21:
      return 'EISDIR'
    case -22:
      return 'EINVAL'
    case -24:
      return 'EMFILE'
    case -28:
      return 'ENOSPC'
    case -32:
      return 'EPIPE'
    case -98:
      return 'EADDRINUSE'
    case -111:
      return 'ECONNREFUSED'
    default:
      if (code >= 0) {
        throw new Error('err >= 0')
      }

      return `Unknown system error ${code}`
  }
}

export function stripVTControlCharacters(value: string) {
  return value.replace(
    /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    ''
  )
}

export default {
  format,
  getSystemErrorName,
  inherits,
  inspect,
  promisify,
  stripVTControlCharacters,
}
