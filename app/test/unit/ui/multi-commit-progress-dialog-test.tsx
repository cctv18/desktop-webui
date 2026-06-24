import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as React from 'react'
import { ipcRenderer } from 'electron'

import { fireEvent, render, screen } from '../../helpers/ui/render'
import { ProgressDialog } from '../../../src/ui/multi-commit-operation/dialog/progress-dialog'
import { ProgressAbortConfirmationDialog } from '../../../src/ui/multi-commit-operation/dialog/progress-abort-confirmation-dialog'
import { MultiCommitOperationKind } from '../../../src/models/multi-commit-operation'

describe('multi-commit progress dialog', () => {
  const progress = {
    kind: 'multiCommitOperation' as const,
    value: 0,
    position: 1,
    totalCommitCount: 2,
    currentCommitSummary: 'pick me',
  }

  it('asks for confirmation before aborting an in-progress operation', async () => {
    const previousSend = (ipcRenderer as any).send
    ;(ipcRenderer as any).send = () => {}
    let abortCount = 0

    try {
      render(
        <ProgressDialog
          progress={progress}
          emoji={new Map()}
          operation={MultiCommitOperationKind.CherryPick}
          onAbort={() => {
            abortCount++
            return Promise.resolve()
          }}
        />
      )

      fireEvent.click(screen.getByText('Abort cherry-pick'))

      assert.ok(
        screen.getByText('Are you sure you want to abort this cherry-pick?')
      )
      assert.equal(abortCount, 0)

      fireEvent.click(screen.getByText('Abort cherry-pick'))

      assert.equal(abortCount, 1)
    } finally {
      ;(ipcRenderer as any).send = previousSend
    }
  })

  it('groups abort confirmation buttons side by side', async () => {
    const previousSend = (ipcRenderer as any).send
    ;(ipcRenderer as any).send = () => {}

    try {
      render(
        <ProgressDialog
          progress={progress}
          emoji={new Map()}
          operation={MultiCommitOperationKind.Squash}
          onAbort={() => Promise.resolve()}
        />
      )

      fireEvent.click(screen.getByText('Abort squash'))

      const cancel = screen.getByText('Cancel')
      const abort = screen.getByText('Abort squash')
      const buttonGroup = cancel.closest('.button-group')

      assert.ok(buttonGroup)
      assert.equal(buttonGroup, abort.closest('.button-group'))
      assert.equal(buttonGroup?.classList.contains('destructive'), true)
      assert.equal((abort as HTMLButtonElement).type, 'button')
      assert.equal((cancel as HTMLButtonElement).type, 'submit')
    } finally {
      ;(ipcRenderer as any).send = previousSend
    }
  })

  it('uses the standard destructive button group for persistent abort confirmation', async () => {
    const previousSend = (ipcRenderer as any).send
    ;(ipcRenderer as any).send = () => {}

    try {
      render(
        <ProgressAbortConfirmationDialog
          operation={MultiCommitOperationKind.Reorder}
          completedOperationCount={null}
          onCancel={() => {}}
          onConfirmAbort={() => Promise.resolve()}
        />
      )

      const cancel = screen.getByText('Cancel')
      const abort = screen.getByText('Abort reorder')
      const buttonGroup = abort.closest('.button-group')

      assert.ok(buttonGroup)
      assert.equal(buttonGroup, cancel.closest('.button-group'))
      assert.equal(buttonGroup?.classList.contains('destructive'), true)
      assert.equal((abort as HTMLButtonElement).type, 'button')
      assert.equal((cancel as HTMLButtonElement).type, 'submit')
    } finally {
      ;(ipcRenderer as any).send = previousSend
    }
  })
})
