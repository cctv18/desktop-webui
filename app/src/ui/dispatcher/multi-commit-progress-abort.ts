import {
  ConfirmAbortProgressStep,
  MultiCommitOperationStep,
  MultiCommitOperationStepKind,
} from '../../models/multi-commit-operation'

export function isProgressAbortConfirmationStep(
  step: MultiCommitOperationStep
): step is ConfirmAbortProgressStep {
  return step.kind === MultiCommitOperationStepKind.ConfirmAbortProgress
}

export function markProgressAbortConfirmationCompleted(
  step: ConfirmAbortProgressStep,
  count: number
): ConfirmAbortProgressStep {
  return {
    ...step,
    completedOperation: { count },
  }
}
