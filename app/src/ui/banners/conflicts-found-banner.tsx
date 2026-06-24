import * as React from 'react'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Banner } from './banner'
import { LinkButton } from '../lib/link-button'

interface IConflictsFoundBannerProps {
  /**
   * Description of the operation to continue
   * Examples:
   *  - rebasing <strong>target-branch-name</strong>
   *  - cherry-picking onto <strong>target-branch-name</strong>
   *  - squashing commits on <strong>target-branch-name</strong>
   */
  readonly operationDescription: string | JSX.Element
  /** Callback to fire when the dialog should be reopened */
  readonly onOpenConflictsDialog: () => void
  /** Callback to fire to dismiss the banner */
  readonly onDismissed: () => void
}

export class ConflictsFoundBanner extends React.Component<
  IConflictsFoundBannerProps,
  {}
> {
  private openDialog = async () => {
    this.props.onDismissed()
    this.props.onOpenConflictsDialog()
  }

  private onDismissed = () => {
    log.warn(
      `[ConflictsBanner] This cannot be dismissed by default unless the user clicks on the link`
    )
  }

  public render() {
    const operationDescription = getOperationDescriptionText(
      this.props.operationDescription
    )

    return (
      <Banner
        id="conflicts-found-banner"
        dismissable={false}
        onDismissed={this.onDismissed}
      >
        <Octicon className="alert-icon" symbol={octicons.alert} />
        <div className="banner-message">
          <span>
            Resolve conflicts to continue {operationDescription}.
          </span>
          <LinkButton onClick={this.openDialog}>View conflicts</LinkButton>
        </div>
      </Banner>
    )
  }
}

function getOperationDescriptionText(description: string | JSX.Element) {
  if (typeof description === 'string') {
    return description
  }

  if (React.isValidElement(description)) {
    return description
  }

  const text = getTextFromSerializedReactNode(description)
  return text.length > 0 ? text : 'the operation'
}

function getTextFromSerializedReactNode(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return ''
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value.map(getTextFromSerializedReactNode).join('')
  }

  if (typeof value !== 'object') {
    return ''
  }

  const props = (value as { readonly props?: { readonly children?: unknown } })
    .props

  if (props === undefined) {
    return ''
  }

  return getTextFromSerializedReactNode(props.children)
}
