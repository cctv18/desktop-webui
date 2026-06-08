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

export function stripVTControlCharacters(value: string) {
  return value.replace(
    /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    ''
  )
}

export default {
  format,
  inspect,
  promisify,
  stripVTControlCharacters,
}
