export interface ChildProcess {
  readonly pid?: number
  readonly stdout?: unknown
  readonly stderr?: unknown
  readonly stdin?: unknown
  kill(signal?: string): boolean
  on(event: string, listener: (...args: ReadonlyArray<unknown>) => void): this
  once(event: string, listener: (...args: ReadonlyArray<unknown>) => void): this
}

export interface SpawnOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly shell?: boolean | string
  readonly windowsHide?: boolean
  readonly detached?: boolean
  readonly stdio?: unknown
}

export interface ExecFileOptions extends SpawnOptions {
  readonly encoding?: BufferEncoding
  readonly timeout?: number
  readonly maxBuffer?: number
  readonly killSignal?: string
}

function unavailable(): never {
  throw new Error('Process execution is only available on the GitDesk WebUI server')
}

export function exec() {
  unavailable()
}

export function execFile() {
  unavailable()
}

export function fork() {
  unavailable()
}

export function spawn() {
  unavailable()
}

export default {
  exec,
  execFile,
  fork,
  spawn,
}
