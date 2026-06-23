import * as React from 'react'
import { join } from 'path'
import { Dialog, DialogContent, DialogFooter } from '../../dialog'
import { Dispatcher } from '../../dispatcher'
import { Emoji } from '../../../lib/emoji'
import { Repository } from '../../../models/repository'
import { MultiCommitOperationStepKind } from '../../../models/multi-commit-operation'
import { MultiCommitOperationConflictState } from '../../../lib/app-state'
import {
  WorkingDirectoryStatus,
  WorkingDirectoryFileChange,
  isConflictWithMarkers,
} from '../../../models/status'
import { getUnmergedFiles, isConflictedFile } from '../../../lib/status'
import { ManualConflictResolution } from '../../../models/manual-conflict-resolution'
import {
  IFileResolution,
  ICopilotResolutionSummary,
} from '../../../lib/copilot-conflict-resolution'
import { IMenuItem } from '../../../lib/menu-item'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { Button } from '../../lib/button'
import { Octicon } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'
import { PathText } from '../../lib/path-text'
import {
  OpenWithDefaultProgramLabel,
  RevealInFileManagerLabel,
} from '../../lib/context-menu'
import { openFile } from '../../lib/open-file'
import { revealInFileManager } from '../../../lib/app-shell'
import { CopilotConflictsResolutionSummary } from './copilot-conflicts-resolution-summary'
import { MultiCommitOperationKind } from '../../../models/multi-commit-operation'
import {
  Popover,
  PopoverAnchorPosition,
  PopoverDecoration,
} from '../../lib/popover'

/**
 * The resolution choice for a file in the Copilot conflicts dialog.
 * - 'copilot': Use Copilot's suggestion
 * - 'ours': Use our side (current branch)
 * - 'theirs': Use their side (incoming branch)
 */
type CopilotFileResolutionChoice = 'copilot' | 'ours' | 'theirs'
type CopilotFileMenuKind = 'resolution' | 'overflow'

interface ICopilotFileMenuState {
  readonly path: string
  readonly kind: CopilotFileMenuKind
}

interface ICopilotConflictsDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly conflictState: MultiCommitOperationConflictState
  readonly workingDirectory: WorkingDirectoryStatus
  readonly operationKind: MultiCommitOperationKind
  readonly copilotResolutions: ReadonlyArray<IFileResolution> | null
  readonly copilotResolutionSummary: ICopilotResolutionSummary | null
  readonly resolvedExternalEditor: string | null
  readonly openFileInExternalEditor: (path: string) => void
  readonly onContinueAfterConflicts: () => Promise<void>
  readonly onAbort: () => Promise<void>
  readonly onDismissed: () => void
  readonly emoji: Map<string, Emoji>
}

interface ICopilotConflictsDialogState {
  readonly isContinuing: boolean
  readonly activeMenu: ICopilotFileMenuState | null
}

/**
 * Dialog shown after Copilot has resolved conflicts.
 *
 * Displays the list of conflicted files with Copilot resolution indicators,
 * per-file reasoning, and resolution choice dropdowns. Allows the user to
 * continue the operation or go back to manual resolution.
 */
export class CopilotConflictsDialog extends React.Component<
  ICopilotConflictsDialogProps,
  ICopilotConflictsDialogState
> {
  private readonly dropdownHandlers = new Map<string, () => void>()
  private readonly overflowHandlers = new Map<string, () => void>()
  private readonly dropdownRefs = new Map<string, HTMLButtonElement>()
  private readonly overflowRefs = new Map<string, HTMLButtonElement>()

  public constructor(props: ICopilotConflictsDialogProps) {
    super(props)
    this.state = { isContinuing: false, activeMenu: null }
  }

  private onBackToManual = () => {
    this.closeActiveMenu()
    const { dispatcher, repository, conflictState } = this.props

    dispatcher.setMultiCommitOperationStepWithCopilotResolution(
      repository,
      {
        kind: MultiCommitOperationStepKind.ShowConflicts,
        conflictState,
      },
      false
    )
  }

  private onContinue = async () => {
    this.setState({ isContinuing: true, activeMenu: null })
    try {
      // Write Copilot resolutions to disk before continuing the operation.
      // Done here (shared) so it works for merge, rebase, and cherry-pick.
      await this.props.dispatcher.applyCopilotConflictResolutions(
        this.props.repository
      )
      await this.props.onContinueAfterConflicts()
    } catch (e) {
      this.setState({ isContinuing: false })
      throw e
    }
  }

  private onAbort = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    this.closeActiveMenu()
    await this.props.onAbort()
  }

  private closeActiveMenu = () => {
    if (this.state.activeMenu !== null) {
      this.setState({ activeMenu: null })
    }
  }

  private toggleActiveMenu(path: string, kind: CopilotFileMenuKind): void {
    this.setState(state => {
      const { activeMenu } = state
      if (activeMenu?.path === path && activeMenu.kind === kind) {
        return { activeMenu: null }
      }

      return { activeMenu: { path, kind } }
    })
  }

  private getResolutionForFile(path: string): CopilotFileResolutionChoice {
    const manualResolution =
      this.props.conflictState.manualResolutions.get(path)
    if (manualResolution === ManualConflictResolution.ours) {
      return 'ours'
    }
    if (manualResolution === ManualConflictResolution.theirs) {
      return 'theirs'
    }
    return 'copilot'
  }

  private getResolutionLabel(choice: CopilotFileResolutionChoice): string {
    const { ourBranch, theirBranch } = this.props.conflictState
    switch (choice) {
      case 'copilot':
        return 'Copilot'
      case 'ours':
        return ourBranch ?? 'Current'
      case 'theirs':
        return theirBranch ?? 'Incoming'
    }
  }

  private buildResolutionMenuItems(path: string): ReadonlyArray<IMenuItem> {
    const { conflictState } = this.props
    const currentChoice = this.getResolutionForFile(path)
    const { ourBranch, theirBranch } = conflictState

    const oursLabel = `Use the modified file${
      ourBranch ? ` from ${ourBranch}` : ''
    }`
    const theirsLabel = `Use the modified file${
      theirBranch ? ` from ${theirBranch}` : ''
    }`

    return [
      {
        label: "Use Copilot's suggestion",
        type: 'checkbox',
        checked: currentChoice === 'copilot',
        action: () => this.setResolution(path, 'copilot'),
      },
      {
        label: oursLabel,
        type: 'checkbox',
        checked: currentChoice === 'ours',
        action: () => this.setResolution(path, 'ours'),
      },
      {
        label: theirsLabel,
        type: 'checkbox',
        checked: currentChoice === 'theirs',
        action: () => this.setResolution(path, 'theirs'),
      },
    ]
  }

  private onResolutionDropdownClick = (path: string) => {
    this.toggleActiveMenu(path, 'resolution')
  }

  private setResolution(
    path: string,
    choice: CopilotFileResolutionChoice
  ): void {
    const { dispatcher, repository } = this.props

    if (choice === 'copilot') {
      dispatcher.updateManualConflictResolution(repository, path, null)
    } else if (choice === 'ours') {
      dispatcher.updateManualConflictResolution(
        repository,
        path,
        ManualConflictResolution.ours
      )
    } else {
      dispatcher.updateManualConflictResolution(
        repository,
        path,
        ManualConflictResolution.theirs
      )
    }
  }

  private buildOverflowMenuItems(path: string): ReadonlyArray<IMenuItem> {
    const { repository, dispatcher, resolvedExternalEditor } = this.props
    const absolutePath = join(repository.path, path)

    const items: IMenuItem[] = []

    if (resolvedExternalEditor !== null) {
      items.push({
        label: `Open in ${resolvedExternalEditor}`,
        action: () => this.props.openFileInExternalEditor(absolutePath),
      })
    }

    items.push(
      {
        label: OpenWithDefaultProgramLabel,
        action: () => openFile(absolutePath, dispatcher),
      },
      {
        label: RevealInFileManagerLabel,
        action: () => revealInFileManager(repository, path),
      }
    )

    return items
  }

  private onOverflowMenuClick = (path: string) => {
    this.toggleActiveMenu(path, 'overflow')
  }

  private getResolutionDropdownClickHandler(path: string): () => void {
    let handler = this.dropdownHandlers.get(path)
    if (handler === undefined) {
      handler = () => this.onResolutionDropdownClick(path)
      this.dropdownHandlers.set(path, handler)
    }
    return handler
  }

  private getOverflowMenuClickHandler(path: string): () => void {
    let handler = this.overflowHandlers.get(path)
    if (handler === undefined) {
      handler = () => this.onOverflowMenuClick(path)
      this.overflowHandlers.set(path, handler)
    }
    return handler
  }

  private getDropdownRefHandler(
    path: string
  ): (button: HTMLButtonElement | null) => void {
    return button => {
      if (button === null) {
        this.dropdownRefs.delete(path)
      } else {
        this.dropdownRefs.set(path, button)
      }
    }
  }

  private getOverflowRefHandler(
    path: string
  ): (button: HTMLButtonElement | null) => void {
    return button => {
      if (button === null) {
        this.overflowRefs.delete(path)
      } else {
        this.overflowRefs.set(path, button)
      }
    }
  }

  private renderMenuItems(items: ReadonlyArray<IMenuItem>): JSX.Element {
    return (
      <div className="copilot-conflicts-file-menu-items" role="menu">
        {items.map((item, index) => {
          if (item.type === 'separator') {
            return (
              <div
                key={index}
                className="copilot-conflicts-file-menu-separator"
                role="separator"
              />
            )
          }

          const enabled = item.enabled !== false
          const role =
            item.type === 'checkbox' ? 'menuitemcheckbox' : 'menuitem'

          return (
            <button
              key={index}
              className="copilot-conflicts-file-menu-item"
              disabled={!enabled}
              role={role}
              aria-checked={
                item.type === 'checkbox' ? item.checked === true : undefined
              }
              onClick={event => {
                event.preventDefault()
                this.closeActiveMenu()
                item.action?.()
              }}
            >
              <span className="copilot-conflicts-file-menu-checkmark">
                {item.type === 'checkbox' && item.checked === true && (
                  <Octicon symbol={octicons.check} />
                )}
              </span>
              <span className="copilot-conflicts-file-menu-label">
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    )
  }

  private renderActiveMenu(path: string): JSX.Element | null {
    const { activeMenu } = this.state
    if (activeMenu === null || activeMenu.path !== path) {
      return null
    }

    const isResolutionMenu = activeMenu.kind === 'resolution'
    const anchor = isResolutionMenu
      ? this.dropdownRefs.get(path) ?? null
      : this.overflowRefs.get(path) ?? null
    const items = isResolutionMenu
      ? this.buildResolutionMenuItems(path)
      : this.buildOverflowMenuItems(path)

    return (
      <Popover
        className="copilot-conflicts-file-menu"
        anchor={anchor}
        anchorPosition={PopoverAnchorPosition.BottomRight}
        decoration={PopoverDecoration.None}
        onClickOutside={this.closeActiveMenu}
        onMousedownOutside={this.closeActiveMenu}
        trapFocus={false}
        isDialog={false}
        style={{ zIndex: 20 }}
      >
        {this.renderMenuItems(items)}
      </Popover>
    )
  }

  private getResolutionForPath(path: string): IFileResolution | undefined {
    return this.props.copilotResolutions?.find(r => r.path === path)
  }

  private isFileResolvedExternally(file: WorkingDirectoryFileChange): boolean {
    if (!isConflictedFile(file.status)) {
      return false
    }
    const manualResolution = this.props.conflictState.manualResolutions.get(
      file.path
    )
    if (manualResolution !== undefined) {
      return false
    }
    if (isConflictWithMarkers(file.status)) {
      return file.status.conflictMarkerCount === 0
    }
    return false
  }

  private renderResolvedExternally(
    file: WorkingDirectoryFileChange
  ): JSX.Element {
    return (
      <li key={file.path} className="copilot-conflicts-file-item resolved">
        <Octicon className="file-octicon" symbol={octicons.fileCode} />
        <div className="copilot-file-details">
          <PathText path={file.path} />
          <span className="copilot-file-resolved-text">
            No conflicts remaining
          </span>
        </div>
        <div className="green-circle">
          <Octicon symbol={octicons.check} />
        </div>
      </li>
    )
  }

  private renderConflictedFile(file: WorkingDirectoryFileChange): JSX.Element {
    const resolution = this.getResolutionForPath(file.path)
    const choice = this.getResolutionForFile(file.path)
    const choiceLabel = this.getResolutionLabel(choice)
    const reasoning = resolution?.reasoning

    const iconSymbol =
      choice === 'copilot' ? octicons.copilot : octicons.fileCode
    const reasoningText =
      choice === 'copilot' && reasoning
        ? reasoning
        : choice === 'ours'
        ? `Using changes from ${
            this.props.conflictState.ourBranch ?? 'current branch'
          }`
        : choice === 'theirs'
        ? `Using changes from ${
            this.props.conflictState.theirBranch ?? 'incoming branch'
          }`
        : undefined

    const onDropdownClick = this.getResolutionDropdownClickHandler(file.path)
    const onOverflowClick = this.getOverflowMenuClickHandler(file.path)

    return (
      <li key={file.path} className="copilot-conflicts-file-item">
        <Octicon className="copilot-file-icon" symbol={iconSymbol} />
        <div className="copilot-file-details">
          <PathText path={file.path} />
          {reasoningText !== undefined && (
            <span className="copilot-file-reasoning">{reasoningText}</span>
          )}
        </div>
        <div className="copilot-file-actions">
          <Button
            className="copilot-resolution-dropdown"
            onClick={onDropdownClick}
            disabled={this.state.isContinuing}
            onButtonRef={this.getDropdownRefHandler(file.path)}
            ariaExpanded={
              this.state.activeMenu?.path === file.path &&
              this.state.activeMenu.kind === 'resolution'
            }
            ariaHaspopup="menu"
          >
            {choice === 'copilot' && <Octicon symbol={octicons.copilot} />}
            {choiceLabel}
            <Octicon symbol={octicons.triangleDown} />
          </Button>
          <Button
            className="copilot-overflow-menu"
            onClick={onOverflowClick}
            disabled={this.state.isContinuing}
            ariaLabel="File options"
            onButtonRef={this.getOverflowRefHandler(file.path)}
            ariaExpanded={
              this.state.activeMenu?.path === file.path &&
              this.state.activeMenu.kind === 'overflow'
            }
            ariaHaspopup="menu"
          >
            <Octicon symbol={octicons.kebabHorizontal} />
          </Button>
          {this.renderActiveMenu(file.path)}
        </div>
      </li>
    )
  }

  private renderResolutionSummary(): JSX.Element | null {
    const { copilotResolutionSummary, operationKind, repository, emoji } =
      this.props
    if (copilotResolutionSummary === null) {
      return null
    }
    return (
      <CopilotConflictsResolutionSummary
        summary={copilotResolutionSummary}
        operationKind={operationKind}
        emoji={emoji}
        gitHubRepository={repository.gitHubRepository}
        onMarkdownLinkClicked={this.onMarkdownLinkClicked}
      />
    )
  }

  private onMarkdownLinkClicked = (url: string): void => {
    this.props.dispatcher.openInBrowser(url)
  }

  private renderFileList(
    files: ReadonlyArray<WorkingDirectoryFileChange>
  ): JSX.Element {
    const conflictedFiles = files.filter(f => isConflictedFile(f.status))

    return (
      <ul className="copilot-conflicts-file-list">
        {conflictedFiles.map(file =>
          this.isFileResolvedExternally(file)
            ? this.renderResolvedExternally(file)
            : this.renderConflictedFile(file)
        )}
      </ul>
    )
  }

  public render() {
    const { operationKind, workingDirectory } = this.props
    const { isContinuing } = this.state

    const unmergedFiles = getUnmergedFiles(workingDirectory)
    const operation = __DARWIN__ ? operationKind : operationKind.toLowerCase()

    return (
      <Dialog
        id="copilot-conflicts-dialog"
        dismissDisabled={isContinuing}
        onDismissed={this.props.onDismissed}
        onSubmit={this.onContinue}
        title={`Resolve conflicts before ${operationKind}`}
        loading={isContinuing}
        disabled={isContinuing}
      >
        <DialogContent>
          {this.renderResolutionSummary()}
          {this.renderFileList(unmergedFiles)}
        </DialogContent>
        <DialogFooter>
          <div className="copilot-conflicts-footer">
            <Button onClick={this.onBackToManual} disabled={isContinuing}>
              Switch to manual
            </Button>
            <OkCancelButtonGroup
              okButtonText={`Continue ${operation}`}
              cancelButtonText={`Abort ${operation}`}
              onCancelButtonClick={this.onAbort}
              cancelButtonDisabled={isContinuing}
            />
          </div>
        </DialogFooter>
      </Dialog>
    )
  }
}
