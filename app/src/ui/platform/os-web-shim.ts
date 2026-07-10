export const EOL = '\n'

export function homedir() {
  return ''
}

export function tmpdir() {
  return '/tmp'
}

export function type() {
  return 'Browser'
}

export function release() {
  const processShim = (globalThis as any).process
  const systemVersion =
    typeof processShim?.getSystemVersion === 'function'
      ? processShim.getSystemVersion()
      : undefined

  return typeof systemVersion === 'string' && /^\d+(\.\d+)*$/.test(systemVersion)
    ? systemVersion
    : '0.0.0'
}

export function platform() {
  return (globalThis as any).process?.platform ?? 'browser'
}

export default {
  EOL,
  homedir,
  platform,
  release,
  tmpdir,
  type,
}
