export const constants = {
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
}

function unavailable(): never {
  throw new Error('File system access is only available on the GitDesk WebUI server')
}

export interface WriteStream {
  write(
    chunk: string | Uint8Array,
    callback?: (error?: Error | null) => void
  ): boolean
  close(callback?: (error?: Error | null) => void): void
  end(callback?: () => void): void
  on(event: string, listener: (...args: ReadonlyArray<unknown>) => void): this
}

export function access() {
  unavailable()
}

export function appendFile() {
  unavailable()
}

export function copyFile() {
  unavailable()
}

export function createReadStream() {
  unavailable()
}

export function createWriteStream() {
  unavailable()
}

export function existsSync() {
  return false
}

export function lstat() {
  unavailable()
}

export function mkdir() {
  unavailable()
}

export function mkdtemp() {
  unavailable()
}

export function open() {
  unavailable()
}

export function readFile() {
  unavailable()
}

export function readFileSync() {
  unavailable()
}

export function readdir() {
  unavailable()
}

export function readlink() {
  unavailable()
}

export function realpath() {
  unavailable()
}

export function rm() {
  unavailable()
}

export function rmdir() {
  unavailable()
}

export function stat() {
  unavailable()
}

export function statSync() {
  unavailable()
}

export function symlink() {
  unavailable()
}

export function unlink() {
  unavailable()
}

export function watch() {
  unavailable()
}

export function writeFile() {
  unavailable()
}

export default {
  access,
  appendFile,
  constants,
  copyFile,
  createReadStream,
  createWriteStream,
  existsSync,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readFileSync,
  readdir,
  readlink,
  realpath,
  rm,
  rmdir,
  stat,
  statSync,
  symlink,
  unlink,
  watch,
  writeFile,
}
