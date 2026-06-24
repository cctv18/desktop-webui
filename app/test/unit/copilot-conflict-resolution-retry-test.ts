import { describe, it } from 'node:test'
import assert from 'node:assert'

import { runCopilotConflictResolutionWithRetry } from '../../src/lib/copilot/conflict-resolution-retry'

describe('runCopilotConflictResolutionWithRetry', () => {
  it('retries one transient failure before returning to the manual conflict dialog', async () => {
    const attempts = new Array<number>()
    const retryReasons = new Array<string>()

    const result = await runCopilotConflictResolutionWithRetry(
      async attempt => {
        attempts.push(attempt)

        if (attempt === 1) {
          throw new Error('transient session startup failure')
        }

        return 'resolved'
      },
      {
        onRetry: error => retryReasons.push(error.message),
      }
    )

    assert.equal(result, 'resolved')
    assert.deepEqual(attempts, [1, 2])
    assert.deepEqual(retryReasons, ['transient session startup failure'])
  })
})
