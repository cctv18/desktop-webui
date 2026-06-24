import type { Repository } from '../../models/repository'

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export async function endCherryPickAfterUnexpectedError(
  repository: Repository,
  error: unknown,
  endMultiCommitOperation: (repository: Repository) => void,
  postError: (error: Error) => Promise<void>
): Promise<void> {
  endMultiCommitOperation(repository)
  await postError(toError(error))
}
