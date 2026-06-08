export const setTimeout = globalThis.setTimeout.bind(globalThis)
export const clearTimeout = globalThis.clearTimeout.bind(globalThis)
export const setInterval = globalThis.setInterval.bind(globalThis)
export const clearInterval = globalThis.clearInterval.bind(globalThis)
export const setImmediate = (handler: (...args: ReadonlyArray<any>) => void) =>
  globalThis.setTimeout(handler, 0)
export const clearImmediate = globalThis.clearTimeout.bind(globalThis)

export default {
  clearImmediate,
  clearInterval,
  clearTimeout,
  setImmediate,
  setInterval,
  setTimeout,
}
