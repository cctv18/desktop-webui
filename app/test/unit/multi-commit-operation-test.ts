import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  isIdMultiCommitOperation,
  MultiCommitOperationKind,
  MultiCommitOperationStepKind,
  conflictSteps,
} from '../../src/models/multi-commit-operation'
import {
  isConflictsFlow,
  createMultiCommitOperationState,
  getMultiCommitOperationChooseBranchStep,
} from '../../src/lib/multi-commit-operation'
import { TipState } from '../../src/models/tip'

describe('multi-commit-operation', () => {
  describe('isIdMultiCommitOperation', () => {
    it('returns true for Rebase', () => {
      assert.equal(isIdMultiCommitOperation('Rebase'), true)
    })

    it('returns true for Cherry-pick', () => {
      assert.equal(isIdMultiCommitOperation('Cherry-pick'), true)
    })

    it('returns true for Squash', () => {
      assert.equal(isIdMultiCommitOperation('Squash'), true)
    })

    it('returns true for Merge', () => {
      assert.equal(isIdMultiCommitOperation('Merge'), true)
    })

    it('returns true for Reorder', () => {
      assert.equal(isIdMultiCommitOperation('Reorder'), true)
    })

    it('returns false for unknown operations', () => {
      assert.equal(isIdMultiCommitOperation('Unknown'), false)
      assert.equal(isIdMultiCommitOperation(''), false)
      assert.equal(isIdMultiCommitOperation('rebase'), false)
    })
  })

  describe('conflictSteps', () => {
    it('includes ShowConflicts', () => {
      assert.ok(
        conflictSteps.includes(MultiCommitOperationStepKind.ShowConflicts)
      )
    })

    it('includes ConfirmAbort', () => {
      assert.ok(
        conflictSteps.includes(MultiCommitOperationStepKind.ConfirmAbort)
      )
    })

    it('does not include ChooseBranch', () => {
      assert.equal(
        conflictSteps.includes(MultiCommitOperationStepKind.ChooseBranch),
        false
      )
    })
  })

  describe('isConflictsFlow', () => {
    it('returns false when popup is not open', () => {
      assert.equal(isConflictsFlow(false, null), false)
    })

    it('returns false when state is null', () => {
      assert.equal(isConflictsFlow(true, null), false)
    })

    it('returns false when step is not a conflict step', () => {
      const state = {
        step: { kind: MultiCommitOperationStepKind.ShowProgress },
        operationDetail: { kind: MultiCommitOperationKind.Rebase },
        progress: { kind: 'multiCommitOperation' as const, value: 0 },
        userHasResolvedConflicts: false,
      } as any

      assert.equal(isConflictsFlow(true, state), false)
    })

    it('returns true when in ShowConflicts step', () => {
      const state = {
        step: { kind: MultiCommitOperationStepKind.ShowConflicts },
        operationDetail: { kind: MultiCommitOperationKind.Rebase },
        progress: { kind: 'multiCommitOperation' as const, value: 0 },
        userHasResolvedConflicts: false,
      } as any

      assert.equal(isConflictsFlow(true, state), true)
    })

    it('returns true when in ConfirmAbort step', () => {
      const state = {
        step: { kind: MultiCommitOperationStepKind.ConfirmAbort },
        operationDetail: { kind: MultiCommitOperationKind.CherryPick },
        progress: { kind: 'multiCommitOperation' as const, value: 0 },
        userHasResolvedConflicts: true,
      } as any

      assert.equal(isConflictsFlow(true, state), true)
    })
  })

  describe('getMultiCommitOperationChooseBranchStep', () => {
    it('throws when tip is not valid', () => {
      const state = {
        branchesState: {
          tip: { kind: TipState.Unknown },
          defaultBranch: null,
          allBranches: [],
          recentBranches: [],
        },
      } as any

      assert.throws(() => {
        getMultiCommitOperationChooseBranchStep(state)
      })
    })

    it('returns ChooseBranch step with branch info when tip is valid', () => {
      const currentBranch = {
        name: 'feature',
        tip: { sha: 'abc123' },
        type: 0,
      }
      const defaultBranch = {
        name: 'main',
        tip: { sha: 'def456' },
        type: 0,
      }

      const state = {
        branchesState: {
          tip: { kind: TipState.Valid, branch: currentBranch },
          defaultBranch,
          allBranches: [currentBranch, defaultBranch],
          recentBranches: [currentBranch],
        },
      } as any

      const step = getMultiCommitOperationChooseBranchStep(state)

      assert.equal(step.kind, MultiCommitOperationStepKind.ChooseBranch)
      assert.equal(step.currentBranch, currentBranch)
      assert.equal(step.defaultBranch, defaultBranch)
      assert.equal(step.allBranches.length, 2)
    })
  })

  describe('createMultiCommitOperationState', () => {
    it('uses ShowProgress as the default initial step', () => {
      const state = createMultiCommitOperationState(
        {
          kind: MultiCommitOperationKind.CherryPick,
          sourceBranch: null,
          branchCreated: false,
          commits: [],
        },
        null,
        [],
        'abc123'
      )

      assert.equal(state.step.kind, MultiCommitOperationStepKind.ShowProgress)
      assert.equal(state.progress.value, 0)
      assert.equal(state.originalBranchTip, 'abc123')
    })

    it('can initialize directly to ChooseBranch for context-menu cherry-pick', () => {
      const currentBranch = {
        name: 'feature',
        tip: { sha: 'abc123' },
        type: 0,
      }
      const targetBranch = {
        name: 'main',
        tip: { sha: 'def456' },
        type: 0,
      }
      const chooseBranchStep = {
        kind: MultiCommitOperationStepKind.ChooseBranch,
        defaultBranch: targetBranch,
        currentBranch,
        allBranches: [currentBranch, targetBranch],
        recentBranches: [currentBranch],
      } as any

      const state = createMultiCommitOperationState(
        {
          kind: MultiCommitOperationKind.CherryPick,
          sourceBranch: currentBranch as any,
          branchCreated: false,
          commits: [],
        },
        null,
        [],
        currentBranch.tip.sha,
        chooseBranchStep
      )

      assert.equal(state.step, chooseBranchStep)
      assert.equal(state.step.kind, MultiCommitOperationStepKind.ChooseBranch)
    })
  })
})
