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
  return typeof navigator === 'undefined' ? '' : navigator.userAgent
}

export function platform() {
  return 'browser'
}

export default {
  EOL,
  homedir,
  platform,
  release,
  tmpdir,
  type,
}
