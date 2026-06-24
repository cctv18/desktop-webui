import { describe, it } from 'node:test'
import assert from 'node:assert'

import { markProgressAbortConfirmationCompleted } from '../../src/ui/dispatcher/multi-commit-progress-abort'
import {
  ConfirmAbortProgressStep,
  MultiCommitOperationStepKind,
} from '../../src/models/multi-commit-operation'

describe('multi-commit progress abort confirmation', () => {
  it('keeps the abort confirmation step open when the operation completes first', () => {
    const step: ConfirmAbortProgressStep = {
      kind: MultiCommitOperationStepKind.ConfirmAbortProgress,
    }

    const completed = markProgressAbortConfirmationCompleted(step, 3)

    assert.equal(
      completed.kind,
      MultiCommitOperationStepKind.ConfirmAbortProgress
    )
    assert.deepEqual(completed.completedOperation, { count: 3 })
  })
})
