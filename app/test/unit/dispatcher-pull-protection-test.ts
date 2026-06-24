import { describe, it } from 'node:test'
import assert from 'node:assert'

import { Repository } from '../../src/models/repository'
import { RetryActionType } from '../../src/models/retry-actions'
import { getPullRetryAction } from '../../src/ui/dispatcher/pull-protection'

describe('Dispatcher pull protection', () => {
  it('creates a retry action that lets the stash dialog resume pull', () => {
    const repository = new Repository('C:\\repo', 1, null, false)

    assert.deepEqual(getPullRetryAction(repository), {
      type: RetryActionType.Pull,
      repository,
    })
  })
})
