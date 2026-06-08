export const sep = '/'
export const delimiter = ':'

export function normalize(path: string) {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/')
}

export function join(...parts: ReadonlyArray<string>) {
  return normalize(parts.filter(x => x.length > 0).join('/'))
}

export function basename(path: string, ext?: string) {
  const name = normalize(path).split('/').filter(Boolean).pop() ?? ''
  return ext !== undefined && name.endsWith(ext) ? name.slice(0, -ext.length) : name
}

export function dirname(path: string) {
  const parts = normalize(path).split('/').filter(Boolean)
  parts.pop()
  return path.startsWith('/') ? `/${parts.join('/')}` : parts.join('/') || '.'
}

export function extname(path: string) {
  const name = basename(path)
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index) : ''
}

export function isAbsolute(path: string) {
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)
}

export function resolve(...parts: ReadonlyArray<string>) {
  return normalize(join(...parts))
}

export const posix = {
  basename,
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  resolve,
  sep,
}

export const win32 = posix
