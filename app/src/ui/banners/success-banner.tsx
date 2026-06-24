import * as React from 'react'
import { LinkButton } from '../lib/link-button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Banner } from './banner'

interface ISuccessBannerProps {
  readonly timeout: number
  readonly onDismissed: () => void
  readonly onUndo?: () => void | Promise<unknown>
}

interface ISuccessBannerState {
  readonly isUndoing: boolean
}

export class SuccessBanner extends React.Component<
  ISuccessBannerProps,
  ISuccessBannerState
> {
  public constructor(props: ISuccessBannerProps) {
    super(props)
    this.state = { isUndoing: false }
  }

  private undo = async () => {
    if (this.state.isUndoing) {
      return
    }

    this.setState({ isUndoing: true })
    this.props.onDismissed()

    if (this.props.onUndo === undefined) {
      return
    }

    await this.props.onUndo()
  }

  private renderUndo = () => {
    if (this.props.onUndo === undefined) {
      return
    }
    return (
      <LinkButton onClick={this.undo} disabled={this.state.isUndoing}>
        Undo
      </LinkButton>
    )
  }

  public render() {
    return (
      <Banner
        id="successful"
        timeout={this.props.timeout}
        onDismissed={this.props.onDismissed}
      >
        <div className="green-circle">
          <Octicon className="check-icon" symbol={octicons.checkCircleFill} />
        </div>
        <div className="banner-message">
          <span className="success-contents">{this.props.children}</span>
          {this.renderUndo()}
        </div>
      </Banner>
    )
  }
}
