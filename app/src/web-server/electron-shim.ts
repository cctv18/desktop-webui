import type { IMenu, MenuItem as AppMenuItem } from '../models/app-menu'

const noop = () => {}

type IPCListener = (event: unknown, ...args: ReadonlyArray<any>) => void

const listeners = new Map<string, Set<IPCListener>>()

function send(channel: string, ...args: ReadonlyArray<any>) {
  switch (channel) {
    case 'get-app-menu':
      emitIPC('app-menu', getDefaultAppMenu())
      break
    case 'execute-menu-item-by-id':
      emitIPC('menu-event', getMenuEventForItem(`${args[0] ?? ''}`))
      break
  }
}

function on(channel: string, listener: IPCListener) {
  let channelListeners = listeners.get(channel)
  if (channelListeners === undefined) {
    channelListeners = new Set()
    listeners.set(channel, channelListeners)
  }

  channelListeners.add(listener)
  return ipcRenderer
}

function once(channel: string, listener: IPCListener) {
  const wrapped: IPCListener = (event, ...args) => {
    removeListener(channel, wrapped)
    listener(event, ...args)
  }

  return on(channel, wrapped)
}

function removeListener(channel: string, listener: IPCListener) {
  listeners.get(channel)?.delete(listener)
  return ipcRenderer
}

function emitIPC(channel: string, ...args: ReadonlyArray<any>) {
  const channelListeners = listeners.get(channel)
  if (channelListeners === undefined) {
    return
  }

  const event = { sender: ipcRenderer }
  for (const listener of channelListeners) {
    listener(event, ...args)
  }
}

export const ipcRenderer = {
  invoke: async () => undefined,
  send,
  sendSync: noop,
  on,
  once,
  removeListener,
}

export const clipboard = {
  writeText: noop,
  readText: () => '',
}

export const shell = {
  beep: noop,
  openExternal: async () => true,
  openPath: async () => '',
  showItemInFolder: noop,
  trashItem: async () => undefined,
}

export const webUtils = {
  getPathForFile: (file: File & { path?: string }) => file.path ?? file.name,
}

export const app = {
  getPath: () => '',
  getAppPath: () => '',
  getVersion: () => __APP_VERSION__,
  quit: noop,
}

export const nativeTheme = {
  shouldUseDarkColors: false,
  themeSource: 'system',
  on: noop,
}

export class BrowserWindow {}
export class Menu {}
export class MenuItem {}

export default {
  app,
  BrowserWindow,
  clipboard,
  ipcRenderer,
  Menu,
  MenuItem,
  nativeTheme,
  shell,
  webUtils,
}

function getDefaultAppMenu(): IMenu {
  return {
    type: 'menu',
    items: [
      submenu('file-menu', '&File', [
        item('new-repository', '&New repository...', 'Ctrl+N'),
        item('add-local-repository', '&Add local repository...', 'Ctrl+O'),
        item('clone-repository', '&Clone repository...', 'Ctrl+Shift+O'),
        separator('file-separator-1'),
        item('preferences', '&Options...', 'Ctrl+,'),
        separator('file-separator-2'),
        item('about', '&About GitDesk WebUI'),
      ]),
      submenu('edit-menu', '&Edit', [
        item('select-all', 'Select &all', 'Ctrl+A'),
        item('find-text', '&Find', 'Ctrl+F'),
        item('toggle-changes-filter', 'Show changes &filter'),
      ]),
      submenu('view-menu', '&View', [
        item('show-changes', '&Changes', 'Ctrl+1'),
        item('show-history', '&History', 'Ctrl+2'),
        separator('view-separator-1'),
        item('show-repository-list', 'Current &repository', 'Ctrl+R'),
        item('show-branches-list', 'Current &branch', 'Ctrl+B'),
        item('show-worktrees-list', 'Current &worktree'),
        separator('view-separator-2'),
        item('go-to-commit-message', 'Go to commit &message', 'Ctrl+G'),
      ]),
      submenu('repository-menu', '&Repository', [
        item('fetch', '&Fetch', 'Ctrl+Shift+F'),
        item('pull', '&Pull', 'Ctrl+Shift+P'),
        item('push', 'P&ush', 'Ctrl+P'),
        separator('repository-separator-1'),
        item('open-working-directory', 'Show in file &manager'),
        item('open-external-editor', 'Open in external &editor'),
        item('open-in-shell', 'Open in &shell'),
        separator('repository-separator-2'),
        item('view-repository-on-github', 'View on &GitHub'),
        item('create-issue-in-repository-on-github', 'Create &issue on GitHub'),
        item('create-pull-request', 'Create pull &request'),
        item('preview-pull-request', 'Preview pull request'),
        separator('repository-separator-3'),
        item('show-repository-settings', 'Repository &settings...'),
        item('remove-repository', '&Remove repository'),
      ]),
      submenu('branch-menu', '&Branch', [
        item('create-branch', '&New branch...', 'Ctrl+Shift+N'),
        item('rename-branch', '&Rename branch...'),
        item('delete-branch', '&Delete branch...'),
        separator('branch-separator-1'),
        item('compare-to-branch', '&Compare to branch'),
        item('merge-branch', '&Merge into current branch...'),
        item('squash-and-merge-branch', '&Squash and merge into current branch...'),
        item('rebase-branch', '&Rebase current branch...'),
        item(
          'update-branch-with-contribution-target-branch',
          '&Update from default branch'
        ),
        separator('branch-separator-2'),
        item('compare-on-github', 'Compare on GitHub'),
        item('branch-on-github', 'View branch on GitHub'),
      ]),
    ],
  }
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

function getMenuEventForItem(id: string) {
  switch (id) {
    case 'new-repository':
      return 'create-repository'
    case 'preferences':
      return 'show-preferences'
    case 'about':
      return 'show-about'
    case 'show-repository-list':
      return 'choose-repository'
    case 'show-branches-list':
      return 'show-branches'
    case 'show-worktrees-list':
      return 'show-worktrees'
    case 'create-pull-request':
      return 'open-pull-request'
    case 'toggle-stashed-changes':
      return 'show-stashed-changes'
    default:
      return id
  }
}
