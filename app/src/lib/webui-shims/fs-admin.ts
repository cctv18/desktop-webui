type Callback = (error: Error | null) => void

function unsupported(operation: string, callback: Callback) {
  callback(new Error(`fs-admin.${operation} is not available in GitDesk WebUI`))
}

export function unlink(_path: string, callback: Callback) {
  unsupported('unlink', callback)
}

export function makeTree(_path: string, callback: Callback) {
  unsupported('makeTree', callback)
}

export function symlink(_target: string, _path: string, callback: Callback) {
  unsupported('symlink', callback)
}
