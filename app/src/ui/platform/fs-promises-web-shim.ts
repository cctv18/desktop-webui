function unavailable(): never {
  throw new Error('File system access is only available on the GitDesk WebUI server')
}

export const constants = {
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
}

export async function access() {
  unavailable()
}

export async function appendFile() {
  unavailable()
}

export async function cp() {
  unavailable()
}

export async function lstat() {
  unavailable()
}

export async function mkdtemp() {
  unavailable()
}

export async function mkdir() {
  unavailable()
}

export async function open() {
  unavailable()
}

export async function readdir() {
  unavailable()
}

export async function readFile() {
  unavailable()
}

export async function readlink() {
  unavailable()
}

export async function realpath() {
  unavailable()
}

export async function rm() {
  unavailable()
}

export async function stat() {
  unavailable()
}

export async function symlink() {
  unavailable()
}

export async function unlink() {
  unavailable()
}

export async function writeFile() {
  unavailable()
}

export default {
  access,
  appendFile,
  constants,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
}
