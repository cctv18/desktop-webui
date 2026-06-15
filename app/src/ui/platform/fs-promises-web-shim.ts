import { invokeWebUIRPC } from '../../lib/webui-rpc'

function unavailable(): never {
  throw new Error('File system access is only available on the GitDesk WebUI server')
}

interface IWebStats {
  readonly size: number
  readonly isFile: boolean
  readonly isDirectory: boolean
  readonly isSymbolicLink: boolean
}

class WebStats {
  public readonly size: number
  private readonly file: boolean
  private readonly directory: boolean
  private readonly symbolicLink: boolean

  public constructor(stats: IWebStats) {
    this.size = stats.size
    this.file = stats.isFile
    this.directory = stats.isDirectory
    this.symbolicLink = stats.isSymbolicLink
  }

  public isFile() {
    return this.file
  }

  public isDirectory() {
    return this.directory
  }

  public isSymbolicLink() {
    return this.symbolicLink
  }
}

export const constants = {
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
}

export async function access(path: string) {
  return invokeWebUIRPC<void>('filesystem.access', [path])
}

export async function appendFile() {
  unavailable()
}

export async function chmod(path: string, mode: string | number) {
  return invokeWebUIRPC<void>('filesystem.chmod', [path, mode])
}

export async function cp() {
  unavailable()
}

export async function lstat(path: string) {
  return new WebStats(
    await invokeWebUIRPC<IWebStats>('filesystem.lstat', [path])
  )
}

export async function mkdtemp() {
  unavailable()
}

export async function mkdir(
  path: string,
  options?: { readonly recursive?: boolean; readonly mode?: number }
) {
  return invokeWebUIRPC<string | undefined>('filesystem.mkdir', [path, options])
}

export async function open() {
  unavailable()
}

export async function readdir(path: string) {
  return invokeWebUIRPC<ReadonlyArray<string>>('filesystem.readdir', [path])
}

export async function readFile(path: string, encoding?: BufferEncoding) {
  return invokeWebUIRPC<string>('filesystem.readFile', [path, encoding])
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

export async function stat(path: string) {
  return new WebStats(
    await invokeWebUIRPC<IWebStats>('filesystem.stat', [path])
  )
}

export async function symlink() {
  unavailable()
}

export async function unlink() {
  unavailable()
}

export async function writeFile(path: string, data: string) {
  return invokeWebUIRPC<void>('filesystem.writeFile', [path, data])
}

export default {
  access,
  appendFile,
  chmod,
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
