import type { IMenu, MenuItem as AppMenuItem } from '../models/app-menu'
import type { IMenuItemState } from './menu-update'
import type { MenuLabelsEvent } from '../models/menu-labels'
import type { MenuEvent } from '../main-process/menu'

type MenuStateUpdate = {
  readonly id: string
  readonly state: IMenuItemState
}

const defaultLabels: MenuLabelsEvent = {
  selectedShell: null,
  selectedExternalEditor: null,
  askForConfirmationOnRepositoryRemoval: true,
  askForConfirmationOnForcePush: true,
}

export function getDefaultWebMenuLabels(): MenuLabelsEvent {
  return defaultLabels
}

export function getDefaultWebAppMenu(
  labels: MenuLabelsEvent = defaultLabels
): IMenu {
  const selectedShell = labels.selectedShell ?? 'shell'
  const selectedExternalEditor = labels.selectedExternalEditor ?? 'external editor'
  const contributionTargetDefaultBranch = truncate(
    labels.contributionTargetDefaultBranch ?? 'default branch',
    25
  )
  const pushLabel = labels.isForcePushForCurrentRepository
    ? labels.askForConfirmationOnForcePush
      ? 'Force P&ush...'
      : 'Force P&ush'
    : 'P&ush'
  const removeRepositoryLabel = labels.askForConfirmationOnRepositoryRemoval
    ? '&Remove...'
    : '&Remove'
  const stashAllChangesLabel =
    labels.askForConfirmationWhenStashingAllChanges === false
      ? '&Stash all changes'
      : '&Stash all changes...'
  const stashedChangesLabel = labels.isStashedChangesVisible
    ? 'H&ide stashed changes'
    : 'Sho&w stashed changes'
  const changesFilterLabel = labels.isChangesFilterVisible
    ? 'Hide toggle chan&ges filter'
    : 'Show toggle chan&ges filter'
  const pullRequestLabel = labels.hasCurrentPullRequest
    ? 'View &pull request on GitHub'
    : 'Create pull &request'

  return {
    type: 'menu',
    items: [
      submenu('file-menu', '&File', [
        item('new-repository', 'New &repository...', 'Ctrl+N'),
        separator('file-separator-1'),
        item('add-local-repository', 'Add &local repository...', 'Ctrl+O'),
        item('clone-repository', 'Clo&ne repository...', 'Ctrl+Shift+O'),
        separator('file-separator-2'),
        item('preferences', '&Options...', 'Ctrl+,'),
      ]),
      submenu('edit-menu', '&Edit', [
        item('select-all', 'Select &all', 'Ctrl+A'),
        separator('edit-separator-1'),
        item('find-text', '&Find', 'Ctrl+F'),
        item('toggle-changes-filter', changesFilterLabel, 'Ctrl+L'),
      ]),
      submenu('view-menu', '&View', [
        item('show-changes', '&Changes', 'Ctrl+1'),
        item('show-history', '&History', 'Ctrl+2'),
        item('show-repository-list', 'Repository &list', 'Ctrl+T'),
        item('show-branches-list', '&Branches list', 'Ctrl+B'),
        item('show-worktrees-list', 'Wor&ktrees list', 'Ctrl+Alt+W'),
        separator('view-separator-1'),
        item('go-to-commit-message', 'Go to &summary', 'Ctrl+G'),
        item('toggle-stashed-changes', stashedChangesLabel, 'Ctrl+H'),
        separator('view-separator-2'),
        item('reset-zoom', 'Reset zoom', 'Ctrl+0'),
        item('zoom-in', 'Zoom in', 'Ctrl+='),
        item('zoom-out', 'Zoom out', 'Ctrl+-'),
        separator('view-separator-3'),
        item('increase-active-resizable-width', 'Expand active resizable', 'Ctrl+9'),
        item('decrease-active-resizable-width', 'Contract active resizable', 'Ctrl+8'),
      ]),
      submenu('repository', '&Repository', [
        item('push', pushLabel, 'Ctrl+P'),
        item('pull', 'Pu&ll', 'Ctrl+Shift+P'),
        item('fetch', '&Fetch', 'Ctrl+Shift+T'),
        item('remove-repository', removeRepositoryLabel, 'Ctrl+Backspace'),
        separator('repository-separator-1'),
        item('view-repository-on-github', '&View on GitHub', 'Ctrl+Shift+G'),
        item('open-in-shell', `O&pen in ${selectedShell}`, 'Ctrl+`'),
        item('open-working-directory', 'Show in file &manager', 'Ctrl+Shift+F'),
        item(
          'open-external-editor',
          `&Open in ${selectedExternalEditor}`,
          'Ctrl+Shift+A'
        ),
        item('open-with-external-editor', 'Open &with...', 'Ctrl+Shift+Alt+A'),
        separator('repository-separator-2'),
        item(
          'create-issue-in-repository-on-github',
          'Create &issue on GitHub',
          'Ctrl+I'
        ),
        separator('repository-separator-3'),
        item('create-worktree', 'New work&tree...', 'Ctrl+Shift+W'),
        separator('repository-separator-4'),
        item('show-repository-settings', 'Repository &settings...'),
      ]),
      submenu('branch', '&Branch', [
        item('create-branch', 'New &branch...', 'Ctrl+Shift+N'),
        item('rename-branch', '&Rename...', 'Ctrl+Shift+R'),
        item('delete-branch', '&Delete...', 'Ctrl+Shift+D'),
        separator('branch-separator-1'),
        item('discard-all-changes', 'Discard all changes...', 'Ctrl+Shift+Backspace'),
        item('stash-all-changes', stashAllChangesLabel, 'Ctrl+Shift+S'),
        separator('branch-separator-2'),
        item(
          'update-branch-with-contribution-target-branch',
          `&Update from ${contributionTargetDefaultBranch}`,
          'Ctrl+Shift+U'
        ),
        item('compare-to-branch', '&Compare to branch', 'Ctrl+Shift+B'),
        item('merge-branch', '&Merge into current branch...', 'Ctrl+Shift+M'),
        item(
          'squash-and-merge-branch',
          'Squas&h and merge into current branch...',
          'Ctrl+Shift+H'
        ),
        item('rebase-branch', 'R&ebase current branch...', 'Ctrl+Shift+E'),
        separator('branch-separator-3'),
        item('compare-on-github', 'Compare on &GitHub', 'Ctrl+Shift+C'),
        item('branch-on-github', 'View branch on GitHub', 'Ctrl+Alt+B'),
        item('preview-pull-request', 'Preview pull request', 'Ctrl+Alt+P'),
        item('create-pull-request', pullRequestLabel, 'Ctrl+R'),
      ]),
      submenu('help-menu', '&Help', [
        item('submit-issue', 'Report issue...'),
        item('contact-support', '&Contact GitHub support...'),
        item('show-user-guides', 'Show User Guides'),
        item('show-keyboard-shortcuts', 'Show keyboard shortcuts'),
        separator('help-separator-1'),
        item('about', '&About GitDesk WebUI'),
      ]),
    ],
  }
}

export function applyWebAppMenuState(
  menu: IMenu,
  updates: ReadonlyArray<MenuStateUpdate>
): IMenu {
  if (updates.length === 0) {
    return menu
  }

  const updateMap = new Map(updates.map(update => [update.id, update.state]))
  return mapMenu(menu, item => {
    const state = updateMap.get(item.id)

    if (state === undefined || item.type === 'separator') {
      return item
    }

    return {
      ...item,
      ...state,
    }
  })
}

export function getWebMenuEventForItem(
  id: string,
  labels: MenuLabelsEvent = defaultLabels,
  itemLabel?: string
): MenuEvent | null {
  const normalizedLabel = itemLabel?.replace(/&/g, '').toLowerCase()

  switch (id) {
    case 'new-repository':
      return 'create-repository'
    case 'preferences':
      return 'show-preferences'
    case 'about':
      return 'show-about'
    case 'push':
      return labels.isForcePushForCurrentRepository ||
        normalizedLabel?.includes('force push')
        ? 'force-push'
        : 'push'
    case 'show-repository-list':
      return 'choose-repository'
    case 'show-branches-list':
      return 'show-branches'
    case 'show-worktrees-list':
      return 'show-worktrees'
    case 'create-pull-request':
      return 'open-pull-request'
    case 'toggle-stashed-changes':
      return labels.isStashedChangesVisible ||
        normalizedLabel?.startsWith('hide')
        ? 'hide-stashed-changes'
        : 'show-stashed-changes'
    case 'submit-issue':
    case 'contact-support':
    case 'show-user-guides':
    case 'show-keyboard-shortcuts':
      return null
    default:
      return id as MenuEvent
  }
}

export function getWebMenuExternalURL(id: string): string | null {
  switch (id) {
    case 'submit-issue':
      return 'https://github.com/desktop/desktop/issues/new/choose'
    case 'contact-support':
      return `https://github.com/contact?from_desktop_app=1&app_version=${__APP_VERSION__}`
    case 'show-user-guides':
      return 'https://docs.github.com/en/desktop'
    case 'show-keyboard-shortcuts':
      return 'https://docs.github.com/en/desktop/installing-and-configuring-github-desktop/overview/keyboard-shortcuts'
    default:
      return null
  }
}

function mapMenu(
  menu: IMenu,
  transform: (item: AppMenuItem) => AppMenuItem
): IMenu {
  const items = menu.items.map(item => {
    const itemWithMappedSubmenu =
      item.type === 'submenuItem'
        ? { ...item, menu: mapMenu(item.menu, transform) }
        : item

    return transform(itemWithMappedSubmenu)
  })

  const selectedItem =
    menu.selectedItem === undefined
      ? undefined
      : items.find(item => item.id === menu.selectedItem?.id)

  return selectedItem === undefined
    ? { ...menu, items }
    : { ...menu, items, selectedItem }
}

function item(
  id: string,
  label: string,
  accelerator: string | null = null,
  enabled = true
): AppMenuItem {
  return {
    id,
    type: 'menuItem',
    label,
    enabled,
    visible: true,
    accelerator,
    accessKey: getAccessKey(label),
  }
}

function separator(id: string): AppMenuItem {
  return { id, type: 'separator', visible: true }
}

function submenu(
  id: string,
  label: string,
  items: ReadonlyArray<AppMenuItem>
): AppMenuItem {
  return {
    id,
    type: 'submenuItem',
    label,
    enabled: true,
    visible: true,
    menu: { id, type: 'menu', items },
    accessKey: getAccessKey(label),
  }
}

function getAccessKey(label: string) {
  const match = label.match(/&([^&])/)
  return match ? match[1] : null
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, Math.max(0, maxLength - 3))}...`
}
