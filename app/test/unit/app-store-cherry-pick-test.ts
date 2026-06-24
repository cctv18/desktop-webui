import { describe, it } from 'node:test'
import assert from 'node:assert'

import { shouldRefreshRepositoryBeforeCherryPick } from '../../src/lib/stores/cherry-pick-refresh'

describe('AppStore cherry-pick behavior', () => {
  it('does not run a full pre-cherry-pick refresh in the WebUI server', () => {
    assert.equal(shouldRefreshRepositoryBeforeCherryPick('web-server'), false)
  })

  it('keeps the existing pre-cherry-pick refresh outside the WebUI server', () => {
    assert.equal(shouldRefreshRepositoryBeforeCherryPick('renderer'), true)
  })
})
