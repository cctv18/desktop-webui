import { describe, it, mock } from 'node:test'
import assert from 'node:assert'

import { IAppState, SelectionType } from '../../../src/lib/app-state'
import {
  MultiCommitOperationKind,
  MultiCommitOperationStepKind,
} from '../../../src/models/multi-commit-operation'
import { PopupType } from '../../../src/models/popup'
import { RemoteAppStore } from '../../../src/ui/runtime/remote-app-store'

const testRepositoryPath = 'test/repository'

mock.module('../../../src/ui/main-process-proxy', {
  namedExports: {
    executeMenuItem: () => {},
    executeMenuItemById: () => {},
  },
})

function makeState(overrides: Partial<IAppState> = {}): IAppState {
  return {
    allPopups: [],
    currentPopup: null,
    errorCount: 0,
    appMenuState: [],
    ...overrides,
  } as IAppState
}

describe('createRemoteDispatcher', () => {
  it('clears stale multi-commit progress abort confirmation before initializing a new operation', async () => {
    const repository = { id: 1, path: testRepositoryPath }
    const branch = { name: 'main', tip: { sha: 'main-tip' } }
    const commit = { sha: 'commit-a', summary: 'Commit A' }
    const operationDetail = {
      kind: MultiCommitOperationKind.CherryPick,
      sourceBranch: branch,
      branchCreated: false,
      commits: [commit],
    }
    const operationState = {
      step: { kind: MultiCommitOperationStepKind.ShowProgress },
      operationDetail,
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
    const calls: Array<{
      readonly property: string
      readonly params: unknown
    }> = []
    const rpc = {
      invoke(property: string, params: unknown) {
        calls.push({ property, params })
        return Promise.resolve()
      },
    }
    const { createRemoteDispatcher } = await import(
      '../../../src/ui/runtime/remote-dispatcher'
    )
    const dispatcher = createRemoteDispatcher(rpc as any, store) as any

    store.beginMultiCommitProgressAbortConfirmation(repository as any)

    await dispatcher.initializeMultiCommitOperation(
      repository,
      operationDetail,
      null,
      [commit],
      'fresh-tip',
      {
        kind: MultiCommitOperationStepKind.ChooseBranch,
        defaultBranch: null,
        currentBranch: branch,
        allBranches: [branch],
        recentBranches: [],
      }
    )

    const selectedState = store.getState().selectedState
    const multiCommitOperationState =
      selectedState?.type === SelectionType.Repository
        ? selectedState.state.multiCommitOperationState
        : null

    assert.equal(
      multiCommitOperationState?.step.kind,
      MultiCommitOperationStepKind.ShowProgress
    )
    assert.deepEqual(
      calls.map(call => call.property),
      ['initializeMultiCommitOperation']
    )
  })
})
