const noop = () => undefined
const storagePrefix = 'gitdesk-webui:'

function promptForServerPath(kind: 'open' | 'save', options?: any) {
  const defaultPath =
    typeof options?.defaultPath === 'string' ? options.defaultPath : ''
  const title =
    typeof options?.title === 'string'
      ? options.title
      : kind === 'open'
      ? 'Open server path'
      : 'Save server path'
  const value = window.prompt(`${title}\nServer path:`, defaultPath)
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

async function invoke(channel: string, ...args: ReadonlyArray<any>) {
  switch (channel) {
    case 'show-open-dialog':
      return promptForServerPath('open', args[0])
    case 'show-save-dialog':
      return promptForServerPath('save', args[0])
    case 'open-external':
      window.open(`${args[0] ?? ''}`, '_blank', 'noopener')
      return true
    case 'is-window-focused':
      return document.hasFocus()
    case 'should-use-dark-colors':
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
    case 'get-current-window-state':
      return 'normal'
    case 'get-current-window-zoom-factor':
      return 1
    case 'is-window-maximized':
      return false
    case 'get-path':
    case 'get-app-path':
      return ''
    case 'get-app-architecture':
      return navigator.userAgent.includes('arm64') ? 'arm64' : 'x64'
    case 'is-running-under-arm64-translation':
      return false
    case 'resolve-proxy':
      return 'DIRECT'
    case 'is-in-application-folder':
      return null
    case 'check-for-updates':
    case 'move-to-applications-folder':
    case 'move-to-trash':
    case 'show-item-in-folder':
      return undefined
    case 'show-contextual-menu':
      return null
    case 'save-guid':
      localStorage.setItem(`${storagePrefix}guid`, `${args[0] ?? ''}`)
      return undefined
    case 'get-guid':
      return localStorage.getItem(`${storagePrefix}guid`) ?? ''
    case 'show-notification':
      return showNotification(`${args[0] ?? ''}`, `${args[1] ?? ''}`)
    case 'get-notifications-permission':
      return getNotificationPermission()
    case 'request-notifications-permission':
      return requestNotificationPermission()
    default:
      return undefined
  }
}

export const ipcRenderer = {
  invoke,
  send: noop,
  sendSync: noop,
  on: noop,
  once: noop,
  removeListener: noop,
}

export const clipboard = {
  writeText(text: string) {
    navigator.clipboard?.writeText(text).catch(() => undefined)
  },
  readText() {
    return ''
  },
}

export const shell = {
  beep: noop,
  openExternal: async (url: string) => {
    window.open(url, '_blank', 'noopener')
    return true
  },
  openPath: async (path: string) => {
    window.open(path, '_blank', 'noopener')
    return ''
  },
  showItemInFolder: noop,
  trashItem: async () => undefined,
}

export const webUtils = {
  getPathForFile: (file: File & { path?: string }) => file.path ?? file.name,
}

export const nativeTheme = {
  shouldUseDarkColors: window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  themeSource: 'system',
  on: noop,
}

export const app = {
  getPath: () => '',
  getAppPath: () => '',
  getVersion: () => __APP_VERSION__,
  quit: noop,
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

function getNotificationPermission() {
  return typeof Notification === 'undefined' ? 'denied' : Notification.permission
}

async function requestNotificationPermission() {
  if (typeof Notification === 'undefined') {
    return false
  }

  const permission = await Notification.requestPermission()
  return permission === 'granted'
}

async function showNotification(title: string, body: string) {
  if (typeof Notification === 'undefined') {
    return null
  }

  if (Notification.permission === 'default') {
    await Notification.requestPermission()
  }

  if (Notification.permission !== 'granted') {
    return null
  }

  const notification = new Notification(title, { body })
  return notification.tag || null
}
