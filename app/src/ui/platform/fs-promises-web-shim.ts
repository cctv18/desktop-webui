function unavailable(): never {
  throw new Error('File system access is only available on the GitDesk WebUI server')
}

export async function access() {
  unavailable()
}

export async function lstat() {
  unavailable()
}

export async function mkdir() {
  unavailable()
}

export async function readdir() {
  unavailable()
}

export async function readFile() {
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
