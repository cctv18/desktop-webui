import assert from 'node:assert'
import { describe, it } from 'node:test'

import { getToolbarDropdownLayoutRect } from '../../../src/ui/toolbar/dropdown-geometry'

describe('toolbar dropdown geometry', () => {
  it('converts zoomed client rect coordinates back to layout coordinates', () => {
    const rect = {
      top: 10,
      left: 25,
      right: 150,
      bottom: 75,
      width: 125,
      height: 65,
    } as DOMRect

    assert.deepStrictEqual(getToolbarDropdownLayoutRect(rect, 1.25), {
      top: 8,
      left: 20,
      right: 120,
      bottom: 60,
      width: 100,
      height: 52,
    })
  })

  it('leaves coordinates unchanged when the zoom factor is invalid', () => {
    const rect = {
      top: 10,
      left: 20,
      right: 120,
      bottom: 40,
      width: 100,
      height: 30,
    } as DOMRect

    assert.deepStrictEqual(getToolbarDropdownLayoutRect(rect, 0), {
      top: 10,
      left: 20,
      right: 120,
      bottom: 40,
      width: 100,
      height: 30,
    })
  })
})
