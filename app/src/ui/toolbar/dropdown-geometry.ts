export interface IToolbarDropdownLayoutRect {
  readonly top: number
  readonly left: number
  readonly right: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

export function getToolbarDropdownLayoutRect(
  rect: ClientRect,
  zoomFactor: number
): IToolbarDropdownLayoutRect {
  const divisor = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1

  return {
    top: rect.top / divisor,
    left: rect.left / divisor,
    right: rect.right / divisor,
    bottom: rect.bottom / divisor,
    width: rect.width / divisor,
    height: rect.height / divisor,
  }
}

export function getCurrentToolbarDropdownZoomFactor() {
  const zoom =
    (document.body?.style as { readonly zoom?: string | number } | undefined)
      ?.zoom ??
    (
      document.documentElement?.style as
        | { readonly zoom?: string | number }
        | undefined
    )?.zoom

  const parsed = typeof zoom === 'number' ? zoom : parseFloat(`${zoom ?? ''}`)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}
