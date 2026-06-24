import { describe, it } from 'node:test'
import assert from 'node:assert'

import { BannerType } from '../../../src/models/banner'
import { IAppState, SelectionType } from '../../../src/lib/app-state'
import {
  MultiCommitOperationKind,
  MultiCommitOperationStepKind,
} from '../../../src/models/multi-commit-operation'
import { PopupType } from '../../../src/models/popup'
import { RemoteAppStore } from '../../../src/ui/runtime/remote-app-store'

function makeState(overrides: Partial<IAppState> = {}): IAppState {
  return {
    allPopups: [],
    currentPopup: null,
    errorCount: 0,
    appMenuState: [],
    ...overrides,
  } as IAppState
}

describe('RemoteAppStore', () => {
  it('keeps a remote multi-commit operation popup above local non-error popups', () => {
    const store = new RemoteAppStore(makeState(), { invoke() {} } as any)

    store.showLocalPopup({
      type: PopupType.ConfirmCommitFilteredChanges,
      onCommitAnyway: () => {},
      showFilesToBeCommitted: () => {},
    } as any)

    const multiCommitPopup = {
      id: 1,
      type: PopupType.MultiCommitOperation,
      repository: { path: 'H:\\oplus\\gitdesk-webui\\win\\repo' },
    } as any

    store.setState(
      makeState({
        allPopups: [multiCommitPopup],
        currentPopup: multiCommitPopup,
      })
    )

    assert.equal(
      store.getState().currentPopup?.type,
      PopupType.MultiCommitOperation
    )
  })

  it('keeps progress abort confirmation open if the server completes before the confirmation step lands', () => {
    const repository = { id: 1, path: 'H:\\oplus\\gitdesk-webui\\win\\repo' }
    const operationState = {
      step: { kind: MultiCommitOperationStepKind.ShowProgress },
      operationDetail: { kind: MultiCommitOperationKind.Squash },
      progress: {
        kind: 'multiCommitOperation',
        title: 'Squash in progress',
        value: 0,
        position: 0,
        totalCommitCount: 2,
      },
      userHasResolvedConflicts: false,
      useCopilotConflictResolution: false,
      copilotResolutions: null,
      copilotResolutionProgress: null,
      copilotResolutionSummary: null,
      copilotResolutionAbortController: null,
      originalBranchTip: 'base-sha',
      targetBranch: null,
    } as any
    const multiCommitPopup = {
      id: 1,
      type: PopupType.MultiCommitOperation,
      repository,
    } as any
    const store = new RemoteAppStore(
      makeState({
        selectedState: {
          type: SelectionType.Repository,
          repository,
          state: {
            multiCommitOperationState: operationState,
          },
        } as any,
        allPopups: [multiCommitPopup],
        currentPopup: multiCommitPopup,
      }),
      { invoke() {} } as any
    )

    store.beginMultiCommitProgressAbortConfirmation(repository as any)

    store.setState(
      makeState({
        selectedState: {
          type: SelectionType.Repository,
          repository,
          state: {
            multiCommitOperationState: null,
          },
        } as any,
        currentBanner: {
          type: BannerType.SuccessfulSquash,
          count: 2,
          onUndo: () => {},
          undoAction: {
            repository,
            operationState,
            commitsCount: 2,
          },
        } as any,
        allPopups: [],
        currentPopup: null,
      })
    )

    const state = store.getState()
    assert.equal(state.currentPopup?.type, PopupType.MultiCommitOperation)

    const selectedState = state.selectedState
    assert.equal(selectedState?.type, SelectionType.Repository)
    const multiCommitOperationState =
      selectedState?.type === SelectionType.Repository
        ? selectedState.state.multiCommitOperationState
        : null

    assert.equal(
      multiCommitOperationState?.step.kind,
      MultiCommitOperationStepKind.ConfirmAbortProgress
    )
    assert.deepEqual(
      multiCommitOperationState?.step.kind ===
        MultiCommitOperationStepKind.ConfirmAbortProgress
        ? multiCommitOperationState.step.completedOperation
        : undefined,
      { count: 2 }
    )
  })

  it('does not keep progress abort confirmation over a fresh choose-branch operation', () => {
    const repository = { id: 1, path: 'H:\\oplus\\gitdesk-webui\\win\\repo' }
    const currentBranch = { name: 'main', tip: { sha: 'main-tip' } }
    const commit = { sha: 'commit-a', summary: 'Commit A' }
    const originalOperationState = {
      step: { kind: MultiCommitOperationStepKind.ShowProgress },
      operationDetail: {
        kind: MultiCommitOperationKind.CherryPick,
        sourceBranch: currentBranch,
        branchCreated: false,
        commits: [commit],
      },
      progress: {
        kind: 'multiCommitOperation',
        title: 'Cherry-pick in progress',
        value: 0,
        position: 0,
        totalCommitCount: 1,
      },
      userHasResolvedConflicts: false,
      useCopilotConflictResolution: false,
      copilotResolutions: null,
      copilotResolutionProgress: null,
      copilotResolutionSummary: null,
      copilotResolutionAbortController: null,
      originalBranchTip: 'old-tip',
      targetBranch: null,
    } as any
    const freshOperationState = {
      ...originalOperationState,
      step: {
        kind: MultiCommitOperationStepKind.ChooseBranch,
        defaultBranch: null,
        currentBranch,
        allBranches: [currentBranch],
        recentBranches: [],
      },
      originalBranchTip: 'fresh-tip',
    } as any
    const multiCommitPopup = {
      id: 1,
      type: PopupType.MultiCommitOperation,
      repository,
    } as any
    const store = new RemoteAppStore(
      makeState({
        selectedState: {
          type: SelectionType.Repository,
          repository,
          state: {
            multiCommitOperationState: originalOperationState,
          },
        } as any,
        allPopups: [multiCommitPopup],
        currentPopup: multiCommitPopup,
      }),
      { invoke() {} } as any
    )

    store.beginMultiCommitProgressAbortConfirmation(repository as any)

    store.setState(
      makeState({
        selectedState: {
          type: SelectionType.Repository,
          repository,
          state: {
            multiCommitOperationState: freshOperationState,
          },
        } as any,
        allPopups: [multiCommitPopup],
        currentPopup: multiCommitPopup,
      })
    )

    const selectedState = store.getState().selectedState
    const multiCommitOperationState =
      selectedState?.type === SelectionType.Repository
        ? selectedState.state.multiCommitOperationState
        : null

    assert.equal(
      multiCommitOperationState?.step.kind,
      MultiCommitOperationStepKind.ChooseBranch
    )
  })

})
