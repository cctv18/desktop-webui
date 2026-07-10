export type DefaultDirStorageTarget =
  | 'backend-rpc'
  | 'backend-file'
  | 'local-storage'

export function getDefaultDirStorageTarget(
  processKind: string
): DefaultDirStorageTarget {
  if (processKind === 'web') {
    return 'backend-rpc'
  }

  if (processKind === 'web-server') {
    return 'backend-file'
  }

  return 'local-storage'
}
