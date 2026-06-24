import * as React from 'react'

interface IBannerErrorBoundaryProps {
  readonly resetKey: string
  readonly onError: (error: Error, errorInfo: React.ErrorInfo) => void
  readonly children: React.ReactNode
}

interface IBannerErrorBoundaryState {
  readonly hasError: boolean
  readonly resetKey: string
}

export class BannerErrorBoundary extends React.Component<
  IBannerErrorBoundaryProps,
  IBannerErrorBoundaryState
> {
  public state: IBannerErrorBoundaryState = {
    hasError: false,
    resetKey: this.props.resetKey,
  }

  public static getDerivedStateFromError(): Partial<IBannerErrorBoundaryState> {
    return { hasError: true }
  }

  public static getDerivedStateFromProps(
    props: IBannerErrorBoundaryProps,
    state: IBannerErrorBoundaryState
  ): Partial<IBannerErrorBoundaryState> | null {
    if (props.resetKey === state.resetKey) {
      return null
    }

    return { hasError: false, resetKey: props.resetKey }
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.props.onError(error, errorInfo)
  }

  public render(): React.ReactNode {
    return this.state.hasError ? null : this.props.children
  }
}
