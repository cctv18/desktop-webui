export function shouldRefreshRepositoryBeforeCherryPick(
  processKind: string
): boolean {
  return processKind !== 'web-server'
}
