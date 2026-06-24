import type { Dispatcher } from '../dispatcher'
import type { IMultiCommitOperationState } from '../../lib/app-state'
import type { Repository } from '../../models/repository'

export interface IMultiCommitOperationUndoAction {
  readonly repository: Repository
  readonly operationState: IMultiCommitOperationState
  readonly commitsCount: number
}

export type MultiCommitOperationUndoHandler = () => void | Promise<unknown>

export function getMultiCommitOperationUndoHandler(
  processKind: string,
  dispatcher: Dispatcher,
  fallback: MultiCommitOperationUndoHandler,
  undoAction?: IMultiCommitOperationUndoAction
): MultiCommitOperationUndoHandler {
  if (processKind === 'web' && undoAction !== undefined) {
    return () =>
      dispatcher.undoMultiCommitOperationFromBanner(
        undoAction.operationState,
        undoAction.repository,
        undoAction.commitsCount
      )
  }

  return fallback
}
