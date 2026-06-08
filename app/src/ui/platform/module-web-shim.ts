function unavailable(): never {
  throw new Error('CommonJS module loading is only available on the GitDesk WebUI server')
}

export const builtinModules: ReadonlyArray<string> = []

export function createRequire() {
  return () => unavailable()
}

export default {
  builtinModules,
  createRequire,
}
