import { describe, it } from 'node:test'
import assert from 'node:assert'

import { endCherryPickAfterUnexpectedError } from '../../src/ui/dispatcher/cherry-pick-error'

describe('Dispatcher cherry-pick error handling', () => {
  it('ends the multi-commit operation and posts the unexpected error', async () => {
    const repository = { name: 'test' } as any
    const error = new Error('refresh did not finish')
    const endedRepositories = new Array<unknown>()
    const postedErrors = new Array<Error>()

    await endCherryPickAfterUnexpectedError(
      repository,
      error,
      repo => endedRepositories.push(repo),
      err => {
        postedErrors.push(err)
        return Promise.resolve()
      }
    )

    assert.deepEqual(endedRepositories, [repository])
    assert.deepEqual(postedErrors, [error])
  })

  it('wraps non-Error throwables before posting', async () => {
    const postedErrors = new Array<Error>()

    await endCherryPickAfterUnexpectedError(
      {} as any,
      'plain failure',
      () => {},
      err => {
        postedErrors.push(err)
        return Promise.resolve()
      }
    )

    assert.equal(postedErrors.length, 1)
    assert.equal(postedErrors[0].message, 'plain failure')
  })
})
