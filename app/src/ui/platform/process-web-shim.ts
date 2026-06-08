type ProcessListener = (...args: ReadonlyArray<unknown>) => void

const listeners = new Map<string, Set<ProcessListener>>()

const processEnv: NodeJS.ProcessEnv = {
  NODE_ENV: __DEV__ ? 'development' : 'production',
}

function detectPlatform(): NodeJS.Platform {
  if (typeof navigator === 'undefined') {
    return 'linux'
  }

  const platform =
    ((navigator as any).userAgentData?.platform as string | undefined) ??
    navigator.platform ??
    navigator.userAgent
  const value = platform.toLowerCase()

  if (value.includes('win')) {
    return 'win32'
  }

  if (value.includes('mac') || value.includes('darwin')) {
    return 'darwin'
  }

  if (value.includes('android')) {
    return 'linux'
  }

  return 'linux'
}

function detectArch(): NodeJS.Architecture {
  if (typeof navigator === 'undefined') {
    return 'x64'
  }

  const userAgent = navigator.userAgent.toLowerCase()

  if (userAgent.includes('aarch64') || userAgent.includes('arm64')) {
    return 'arm64'
  }

  if (userAgent.includes('arm')) {
    return 'arm'
  }

  return 'x64'
}

function on(event: string, listener: ProcessListener) {
  let eventListeners = listeners.get(event)
  if (eventListeners === undefined) {
    eventListeners = new Set()
    listeners.set(event, eventListeners)
  }

  eventListeners.add(listener)
  return processShim
}

function once(event: string, listener: ProcessListener) {
  const wrapped: ProcessListener = (...args: ReadonlyArray<unknown>) => {
    off(event, wrapped)
    listener(...args)
  }

  return on(event, wrapped)
}

function off(event: string, listener: ProcessListener) {
  listeners.get(event)?.delete(listener)
  return processShim
}

function emit(event: string, ...args: ReadonlyArray<unknown>) {
  const eventListeners = listeners.get(event)
  if (eventListeners === undefined) {
    return false
  }

  for (const listener of eventListeners) {
    listener(...args)
  }

  return eventListeners.size > 0
}

const processShim = {
  arch: detectArch(),
  argv: [],
  browser: true,
  cwd: () => '/',
  emit,
  env: processEnv,
  execPath: 'GitDesk WebUI',
  exitCode: undefined as number | undefined,
  getSystemVersion: () =>
    typeof navigator === 'undefined' ? '' : navigator.userAgent,
  nextTick: (callback: (...args: ReadonlyArray<unknown>) => void) => {
    Promise.resolve().then(callback)
  },
  off,
  on,
  once,
  platform: detectPlatform(),
  removeListener: off,
  stderr: null,
  stdout: null,
  type: 'renderer',
  versions: {},
}

;(globalThis as any).process = (globalThis as any).process ?? processShim

export const arch = processShim.arch
export const argv = processShim.argv
export const browser = processShim.browser
export const cwd = processShim.cwd
export const env = processShim.env
export const execPath = processShim.execPath
export const nextTick = processShim.nextTick
export const platform = processShim.platform
export const stderr = processShim.stderr
export const stdout = processShim.stdout
export const type = processShim.type
export const versions = processShim.versions

export { emit, off, on, once }

export default processShim
