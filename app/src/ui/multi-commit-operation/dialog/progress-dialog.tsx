import * as React from 'react'
import { formatRebaseValue } from '../../../lib/rebase'
import { RichText } from '../../lib/rich-text'
import { Dialog, DialogContent, DialogFooter } from '../../dialog'
import { Button } from '../../lib/button'
import { Octicon } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'
import { IMultiCommitOperationProgress } from '../../../models/progress'
import { Emoji } from '../../../lib/emoji'

interface IProgressDialogProps {
  /**
   * This is expected to be capitalized.
   *
   * Examples:
   *  - Rebase
   *  - Cherry-pick
   *  - Squash
   *  - Reorder
   */
  readonly operation: string
  readonly progress: IMultiCommitOperationProgress
  readonly emoji: Map<string, Emoji>
  readonly onAbort: () => Promise<void>
}

interface IProgressDialogState {
  readonly isConfirmingAbort: boolean
  readonly isAborting: boolean
}

export class ProgressDialog extends React.Component<
  IProgressDialogProps,
  IProgressDialogState
> {
  public constructor(props: IProgressDialogProps) {
    super(props)
    this.state = {
      isConfirmingAbort: false,
      isAborting: false,
    }
  }

  private get operationLabel() {
    return __DARWIN__
      ? this.props.operation
      : this.props.operation.toLowerCase()
  }

  private onBeginAbort = () => {
    this.setState({ isConfirmingAbort: true })
  }

  private onCancelAbort = () => {
    this.setState({ isConfirmingAbort: false })
  }

  private onConfirmAbort = async () => {
    if (this.state.isAborting) {
      return
    }

    this.setState({ isAborting: true })
    await this.props.onAbort()
  }

  public render() {
    const { progress, operation, emoji } = this.props
    const { position, totalCommitCount, value, currentCommitSummary } = progress

    const progressValue = formatRebaseValue(value)
    const operationLabel = this.operationLabel

    if (this.state.isConfirmingAbort) {
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
          onDismissed={this.onCancelAbort}
          type="warning"
          role="alertdialog"
          ariaDescribedBy="abort-operation-confirmation"
        >
          <DialogContent>
            <div className="column-left" id="abort-operation-confirmation">
              <p>
                Are you sure you want to abort this {operationLabel}?
              </p>
              <p>
                This will close the progress window and ask Git to abort the
                in-progress operation.
              </p>
            </div>
          </DialogContent>
          <DialogFooter>
            <Button
              type="button"
              disabled={this.state.isAborting}
              onClick={this.onCancelAbort}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={this.state.isAborting}
              onClick={this.onConfirmAbort}
            >
              Abort {operationLabel}
            </Button>
          </DialogFooter>
        </Dialog>
      )
    }

    return (
      <Dialog
        dismissDisabled={true}
        id="multi-commit-progress"
        title={`${operation} in progress`}
      >
        <DialogContent>
          <div>
            <progress value={progressValue} />

            <div className="details">
              <div className="green-circle">
                <Octicon symbol={octicons.check} />
              </div>
              <div className="summary">
                <div className="message">
                  Commit {position} of {totalCommitCount}
                </div>
                <div className="detail">
                  <RichText emoji={emoji} text={currentCommitSummary || ''} />
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button
            type="button"
            disabled={this.state.isAborting}
            onClick={this.onBeginAbort}
          >
            Abort {operationLabel}
          </Button>
        </DialogFooter>
      </Dialog>
    )
  }
}
