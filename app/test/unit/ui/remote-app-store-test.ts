import { describe, it } from 'node:test'
import assert from 'node:assert'

import { IAppState } from '../../../src/lib/app-state'
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
})
