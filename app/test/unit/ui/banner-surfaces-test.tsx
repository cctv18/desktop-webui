import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { BranchAlreadyUpToDate } from '../../../src/ui/banners/branch-already-up-to-date-banner'
import { Banner } from '../../../src/ui/banners/banner'
import { CherryPickUndone } from '../../../src/ui/banners/cherry-pick-undone'
import { ConflictsFoundBanner } from '../../../src/ui/banners/conflicts-found-banner'
import { BannerErrorBoundary } from '../../../src/ui/banners/banner-error-boundary'
import { SuccessBanner } from '../../../src/ui/banners/success-banner'
import {
  advanceTimersBy,
  enableTestTimers,
  resetTestTimers,
} from '../../helpers/ui/timers'
import { fireEvent, render, screen } from '../../helpers/ui/render'

describe('banner surfaces', () => {
  beforeEach(() => {
    enableTestTimers(['setTimeout'])
  })

  afterEach(() => {
    resetTestTimers()
  })

  it('focuses the first suitable banner element and auto-dismisses on focus out', () => {
    let dismissed = 0

    function onDismissed() {
      dismissed++
    }

    const view = render(
      <Banner id="test-banner" timeout={500} onDismissed={onDismissed}>
        <a href="https://example.com/help">Learn more</a>
      </Banner>
    )

    const banner = view.container.querySelector('#test-banner.banner')
    const link = screen.getByRole('link', { name: 'Learn more' })
    const dismissButton = screen.getByRole('button', {
      name: 'Dismiss this message',
    })

    assert.notEqual(banner, null)
    assert.ok(dismissButton)

    advanceTimersBy(200)

    assert.equal(document.activeElement, link)

    fireEvent.focusOut(link, { relatedTarget: document.body })

    advanceTimersBy(500)

    assert.equal(dismissed, 1)
  })

  it('renders success banner content and triggers dismiss plus undo from the undo link', () => {
    let dismissed = 0
    let undone = 0

    function onDismissed() {
      dismissed++
    }

    function onUndo() {
      undone++
    }

    render(
      <SuccessBanner timeout={750} onDismissed={onDismissed} onUndo={onUndo}>
        Branch renamed successfully.
      </SuccessBanner>
    )

    const undoButton = screen.getByRole('button', { name: 'Undo' })

    assert.ok(screen.getByText('Branch renamed successfully.'))
    assert.notEqual(document.querySelector('.success-contents'), null)
    assert.notEqual(document.querySelector('.green-circle .check-icon'), null)

    fireEvent.click(undoButton)

    assert.equal(dismissed, 1)
    assert.equal(undone, 1)
  })

  it('renders branch up-to-date banner messages with and without the compared branch', () => {
    function onDismissed() {}

    const view = render(
      <BranchAlreadyUpToDate
        ourBranch="main"
        theirBranch="origin/main"
        onDismissed={onDismissed}
      />
    )

    assert.ok(screen.getByText('main'))
    assert.ok(screen.getByText('origin/main'))
    assert.ok(
      view.container.textContent?.includes('is already up to date with')
    )

    view.rerender(
      <BranchAlreadyUpToDate ourBranch="release" onDismissed={onDismissed} />
    )

    assert.ok(screen.getByText('release'))
    assert.ok(view.container.textContent?.includes('is already up to date'))
  })

  it('renders cherry-pick undone messages with singular and plural commit copy', () => {
    function onDismissed() {}

    const view = render(
      <CherryPickUndone
        countCherryPicked={1}
        targetBranchName="main"
        onDismissed={onDismissed}
      />
    )

    assert.ok(
      view.container.textContent?.includes(
        'Cherry-pick undone. Successfully removed the 1 copied commit from'
      )
    )
    assert.ok(screen.getByText('main'))

    view.rerender(
      <CherryPickUndone
        countCherryPicked={3}
        targetBranchName="release"
        onDismissed={onDismissed}
      />
    )

    assert.ok(
      view.container.textContent?.includes(
        'Cherry-pick undone. Successfully removed the 3 copied commits from'
      )
    )
    assert.ok(screen.getByText('release'))
  })

  it('renders serialized conflict operation descriptions without crashing', () => {
    function onDismissed() {}
    function onOpenConflictsDialog() {}

    const serializedDescription = {
      key: null,
      ref: null,
      props: {
        children: [
          'cherry-picking onto',
          ' ',
          {
            key: null,
            ref: null,
            props: { children: 'feature' },
            _owner: null,
            _store: {},
          },
        ],
      },
      _owner: null,
      _store: {},
    } as any

    const view = render(
      <ConflictsFoundBanner
        operationDescription={serializedDescription}
        onOpenConflictsDialog={onOpenConflictsDialog}
        onDismissed={onDismissed}
      />
    )

    assert.ok(
      view.container.textContent?.includes(
        'Resolve conflicts to continue cherry-picking onto feature.'
      )
    )
  })

  it('isolates banner render errors and recovers when the banner changes', () => {
    let errors = 0
    const previousConsoleError = console.error

    class ThrowingBanner extends React.Component {
      public render() {
        throw new Error('banner failed to render')
      }
    }

    console.error = () => {}

    try {
      const view = render(
        <BannerErrorBoundary resetKey="bad" onError={() => errors++}>
          <ThrowingBanner />
        </BannerErrorBoundary>
      )

      assert.equal(errors, 1)
      assert.equal(view.container.textContent, '')

      view.rerender(
        <BannerErrorBoundary resetKey="good" onError={() => errors++}>
          <div>Recovered banner</div>
        </BannerErrorBoundary>
      )

      assert.equal(errors, 1)
      assert.ok(screen.getByText('Recovered banner'))
    } finally {
      console.error = previousConsoleError
    }
  })
})
