import * as React from 'react'

import { Dialog, DialogContent, DialogFooter } from '../../dialog'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { MultiCommitOperationKind } from '../../../models/multi-commit-operation'

interface IProgressAbortConfirmationDialogProps {
  readonly operation: MultiCommitOperationKind
  readonly completedOperationCount: number | null
  readonly onCancel: () => void
  readonly onConfirmAbort: () => Promise<void>
}

interface IProgressAbortConfirmationDialogState {
  readonly isAborting: boolean
}

export class ProgressAbortConfirmationDialog extends React.Component<
  IProgressAbortConfirmationDialogProps,
  IProgressAbortConfirmationDialogState
> {
  public constructor(props: IProgressAbortConfirmationDialogProps) {
    super(props)
    this.state = { isAborting: false }
  }

  private get operationLabel() {
    return __DARWIN__
      ? this.props.operation
      : this.props.operation.toLowerCase()
  }

  private onConfirmAbort = async () => {
    if (this.state.isAborting) {
      return
    }

    this.setState({ isAborting: true })
    await this.props.onConfirmAbort()
  }

  public render() {
    const { completedOperationCount, operation } = this.props
    const operationLabel = this.operationLabel
    const completed = completedOperationCount !== null

    return (
      <Dialog
        dismissDisabled={this.state.isAborting}
        id="multi-commit-progress-abort"
        title={
          __DARWIN__
            ? `Confirm Abort ${operation}`
            : `Confirm abort ${operationLabel}`
        }
        disabled={this.state.isAborting}
        onDismissed={this.props.onCancel}
        onSubmit={this.onConfirmAbort}
        type="warning"
        role="alertdialog"
        ariaDescribedBy="abort-operation-confirmation"
      >
        <DialogContent>
          <div className="column-left" id="abort-operation-confirmation">
            <p>Are you sure you want to abort this {operationLabel}?</p>
            <p>
              {completed
                ? 'The operation has already completed. Aborting now will undo the completed operation.'
                : 'This will close the progress window and ask Git to abort the in-progress operation.'}
            </p>
          </div>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            destructive={true}
            okButtonText={`Abort ${operationLabel}`}
            okButtonDisabled={this.state.isAborting}
            cancelButtonDisabled={this.state.isAborting}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}
