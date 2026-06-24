import { describe, it } from 'node:test'
import assert from 'node:assert'

import { getMultiCommitOperationUndoHandler } from '../../../src/ui/banners/multi-commit-undo'

describe('multi-commit undo banner behavior', () => {
  it('routes WebUI undo clicks through the dispatcher RPC descriptor', async () => {
    const calls = new Array<ReadonlyArray<unknown>>()
    const undoAction = {
      repository: { name: 'repo' } as any,
      operationState: { operationDetail: { kind: 'Cherry-pick' } } as any,
      commitsCount: 2,
    }

    const handler = getMultiCommitOperationUndoHandler(
      'web',
      {
        undoMultiCommitOperationFromBanner: (...args: ReadonlyArray<unknown>) => {
          calls.push(args)
          return Promise.resolve(true)
        },
      } as any,
      () => {
        throw new Error('fallback should not run')
      },
      undoAction
    )

    await handler()

    assert.deepEqual(calls, [
      [undoAction.operationState, undoAction.repository, undoAction.commitsCount],
    ])
  })

  it('keeps the in-process callback outside the WebUI renderer', async () => {
    let fallbackCount = 0
    const handler = getMultiCommitOperationUndoHandler(
      'ui',
      {} as any,
      () => {
        fallbackCount++
      },
      {
        repository: {} as any,
        operationState: {} as any,
        commitsCount: 1,
      }
    )

    await handler()

    assert.equal(fallbackCount, 1)
  })
})
