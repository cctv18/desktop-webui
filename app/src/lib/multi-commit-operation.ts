import { Branch } from '../models/branch'
import { Commit, CommitOneLine } from '../models/commit'
import {
  ChooseBranchStep,
  conflictSteps,
  MultiCommitOperationDetail,
  MultiCommitOperationStep,
  MultiCommitOperationStepKind,
} from '../models/multi-commit-operation'
import { TipState } from '../models/tip'
import { IMultiCommitOperationState, IRepositoryState } from './app-state'

export function createMultiCommitOperationState(
  operationDetail: MultiCommitOperationDetail,
  targetBranch: Branch | null,
  commits: ReadonlyArray<Commit | CommitOneLine>,
  originalBranchTip: string | null,
  initialStep: MultiCommitOperationStep = {
    kind: MultiCommitOperationStepKind.ShowProgress,
  }
): IMultiCommitOperationState {
  return {
    step: initialStep,
    operationDetail,
    progress: {
      kind: 'multiCommitOperation',
      currentCommitSummary: commits.length > 0 ? commits[0].summary : '',
      position: 1,
      totalCommitCount: commits.length,
      value: 0,
    },
    userHasResolvedConflicts: false,
    useCopilotConflictResolution: false,
    copilotResolutions: null,
    copilotResolutionSummary: null,
    copilotResolutionProgress: null,
    copilotResolutionAbortController: null,
    originalBranchTip,
    targetBranch,
  }
}

/**
 * Setup the multi commit operation state when the user needs to select a branch as the
 * base for the operation.
 */
export function getMultiCommitOperationChooseBranchStep(
  state: IRepositoryState,
  initialBranch?: Branch | null
): ChooseBranchStep {
  const { defaultBranch, allBranches, recentBranches, tip } =
    state.branchesState
  let currentBranch: Branch | null = null

  if (tip.kind === TipState.Valid) {
    currentBranch = tip.branch
  } else {
    throw new Error(
      'Tip is not in a valid state, which is required to start the multi commit operation'
    )
  }

  return {
    kind: MultiCommitOperationStepKind.ChooseBranch,
    defaultBranch,
    currentBranch,
    allBranches,
    recentBranches,
    initialBranch: initialBranch !== null ? initialBranch : undefined,
  }
}

export function isConflictsFlow(
  isMultiCommitOperationPopupOpen: boolean,
  multiCommitOperationState: IMultiCommitOperationState | null
): boolean {
  return (
    isMultiCommitOperationPopupOpen &&
    multiCommitOperationState !== null &&
    conflictSteps.includes(multiCommitOperationState.step.kind)
  )
}
