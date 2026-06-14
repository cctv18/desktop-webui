import type { IMenu } from '../../models/app-menu'
import type { IMenuItemState } from '../../lib/menu-update'
import type { MenuLabelsEvent } from '../../models/menu-labels'
import {
  applyWebAppMenuState,
  getDefaultWebAppMenu,
  getDefaultWebMenuLabels,
  getWebMenuEventForItem,
  getWebMenuExternalURL,
} from '../../lib/webui-app-menu'

const noop = () => undefined
const storagePrefix = 'gitdesk-webui:'
const zoomStorageKey = `${storagePrefix}zoom-factor`
const themeSourceStorageKey = `${storagePrefix}native-theme-source`

type IPCListener = (event: unknown, ...args: ReadonlyArray<any>) => void
type WebContextMenuItem = {
  readonly label?: string
  readonly type?: 'separator' | 'checkbox'
  readonly checked?: boolean
  readonly enabled?: boolean
  readonly role?: string
  readonly submenu?: ReadonlyArray<WebContextMenuItem>
}

const listeners = new Map<string, Set<IPCListener>>()
let lastPointer = { x: 80, y: 80 }
let currentMenuLabels = getDefaultWebMenuLabels()
let currentMenuState = new Map<string, IMenuItemState>()
let currentAppMenu = getDefaultWebAppMenu(currentMenuLabels)
let windowZoomFactor = readStoredZoomFactor()
let nativeThemeSource = readStoredThemeSource()

applyWindowZoomFactor()

window.addEventListener(
  'mousedown',
  event => {
    lastPointer = { x: event.clientX, y: event.clientY }
  },
  true
)

window.addEventListener(
  'contextmenu',
  event => {
    lastPointer = { x: event.clientX, y: event.clientY }
  },
  true
)

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
      return shouldUseDarkColors()
    case 'get-current-window-state':
      return 'normal'
    case 'get-current-window-zoom-factor':
      return windowZoomFactor
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
      return showWebContextualMenu(args[0])
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

function send(channel: string, ...args: ReadonlyArray<any>) {
  switch (channel) {
    case 'get-app-menu':
      emitIPC('app-menu', currentAppMenu)
      break
    case 'execute-menu-item-by-id':
      executeWebMenuItemById(`${args[0] ?? ''}`, args[1])
      break
    case 'update-menu-state':
      updateWebMenuState(args[0])
      break
    case 'update-preferred-app-menu-item-labels':
      updateWebMenuLabels(args[0])
      break
    case 'set-window-zoom-factor':
      setWindowZoomFactor(Number(args[0]))
      break
    case 'set-native-theme-source':
      setNativeThemeSource(`${args[0] ?? 'system'}`)
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
  invoke,
  send,
  sendSync: noop,
  on,
  once,
  removeListener,
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
  get shouldUseDarkColors() {
    return shouldUseDarkColors()
  },
  get themeSource() {
    return nativeThemeSource
  },
  set themeSource(value: string) {
    setNativeThemeSource(value)
  },
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

export function getDefaultAppMenu(): IMenu {
  return currentAppMenu
}

function updateWebMenuState(items: unknown) {
  if (!Array.isArray(items)) {
    return
  }

  let hasChanges = false

  for (const item of items) {
    const id = `${item?.id ?? ''}`
    const state = item?.state as IMenuItemState | undefined

    if (id.length === 0 || state === undefined) {
      continue
    }

    const currentState = currentMenuState.get(id)

    if (currentState?.enabled === state.enabled) {
      continue
    }

    currentMenuState.set(id, { ...currentState, ...state })
    hasChanges = true
  }

  if (hasChanges) {
    rebuildWebMenu()
  }
}

function updateWebMenuLabels(labels: MenuLabelsEvent | undefined) {
  if (labels === undefined) {
    return
  }

  currentMenuLabels = labels
  rebuildWebMenu()
}

function rebuildWebMenu() {
  currentAppMenu = applyWebAppMenuState(
    getDefaultWebAppMenu(currentMenuLabels),
    Array.from(currentMenuState, ([id, state]) => ({ id, state }))
  )
  emitIPC('app-menu', currentAppMenu)
}

function executeWebMenuItemById(id: string, item?: { readonly label?: string }) {
  if (executeLocalWebMenuItem(id)) {
    return
  }

  const externalURL = getWebMenuExternalURL(id)

  if (externalURL !== null) {
    window.open(externalURL, '_blank', 'noopener')
    return
  }

  const menuEvent = getWebMenuEventForItem(id, currentMenuLabels, item?.label)

  if (menuEvent !== null) {
    emitIPC('menu-event', menuEvent)
  }
}

function executeLocalWebMenuItem(id: string): boolean {
  switch (id) {
    case 'reset-zoom':
      setWindowZoomFactor(1)
      return true
    case 'zoom-in':
      setWindowZoomFactor(getNextZoomFactor(1))
      return true
    case 'zoom-out':
      setWindowZoomFactor(getNextZoomFactor(-1))
      return true
    default:
      return false
  }
}

function getNextZoomFactor(direction: 1 | -1) {
  const zoomFactors =
    direction > 0
      ? [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
      : [2, 1.75, 1.5, 1.25, 1.1, 1, 0.9, 0.8, 0.75, 0.67, 0.5, 0.33, 0.25]

  const currentZoom = findClosestZoomFactor(windowZoomFactor, zoomFactors)
  const nextZoom = zoomFactors.find(f =>
    direction > 0 ? f > currentZoom : f < currentZoom
  )

  return nextZoom ?? currentZoom
}

function findClosestZoomFactor(
  value: number,
  candidates: ReadonlyArray<number>
) {
  return candidates.reduce((closest, candidate) =>
    Math.abs(candidate - value) < Math.abs(closest - value)
      ? candidate
      : closest
  )
}

function readStoredZoomFactor() {
  const raw = window.localStorage.getItem(zoomStorageKey)
  const parsed = raw === null ? NaN : parseFloat(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function setWindowZoomFactor(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return
  }

  const normalized = Math.max(0.25, Math.min(2, value))
  if (normalized === windowZoomFactor) {
    return
  }

  windowZoomFactor = normalized
  window.localStorage.setItem(zoomStorageKey, `${normalized}`)
  applyWindowZoomFactor()
  emitIPC('zoom-factor-changed', normalized)
}

function applyWindowZoomFactor() {
  const zoom = windowZoomFactor === 1 ? '' : `${windowZoomFactor}`
  const target = document.body ?? document.documentElement
  ;(target.style as any).zoom = zoom
}

function readStoredThemeSource() {
  const raw = window.localStorage.getItem(themeSourceStorageKey)
  return raw === 'light' || raw === 'dark' || raw === 'system'
    ? raw
    : 'system'
}

function setNativeThemeSource(value: string) {
  const next =
    value === 'light' || value === 'dark' || value === 'system'
      ? value
      : 'system'

  if (next === nativeThemeSource) {
    return
  }

  nativeThemeSource = next
  window.localStorage.setItem(themeSourceStorageKey, next)
  emitIPC('native-theme-updated')
}

function shouldUseDarkColors() {
  if (nativeThemeSource === 'dark') {
    return true
  }

  if (nativeThemeSource === 'light') {
    return false
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

function showWebContextualMenu(items: unknown) {
  const menuItems = Array.isArray(items)
    ? (items as ReadonlyArray<WebContextMenuItem>)
    : []

  if (menuItems.length === 0) {
    return Promise.resolve(null)
  }

  return new Promise<ReadonlyArray<number> | null>(resolve => {
    const overlay = document.createElement('div')
    const submenus = new Map<number, HTMLElement>()
    let done = false

    overlay.style.position = 'fixed'
    overlay.style.inset = '0'
    overlay.style.zIndex = '2147483647'
    overlay.style.background = 'transparent'

    const cleanup = (result: ReadonlyArray<number> | null) => {
      if (done) {
        return
      }

      done = true
      window.removeEventListener('keydown', onKeyDown)
      overlay.remove()
      resolve(result)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cleanup(null)
      }
    }

    overlay.addEventListener('mousedown', event => {
      if (event.target === overlay) {
        cleanup(null)
      }
    })

    window.addEventListener('keydown', onKeyDown)
    document.body.appendChild(overlay)

    const rootMenu = buildWebContextMenu(
      menuItems,
      [],
      lastPointer.x,
      lastPointer.y,
      overlay,
      submenus,
      cleanup
    )

    overlay.appendChild(rootMenu)
  })
}

function buildWebContextMenu(
  items: ReadonlyArray<WebContextMenuItem>,
  indices: ReadonlyArray<number>,
  left: number,
  top: number,
  overlay: HTMLElement,
  submenus: Map<number, HTMLElement>,
  onSelect: (indices: ReadonlyArray<number> | null) => void
) {
  const menu = document.createElement('div')
  const width = 280
  const safeLeft = Math.max(8, Math.min(left, window.innerWidth - width - 8))
  const safeTop = Math.max(8, Math.min(top, window.innerHeight - 24))

  menu.style.position = 'fixed'
  menu.style.left = `${safeLeft}px`
  menu.style.top = `${safeTop}px`
  menu.style.minWidth = `${width}px`
  menu.style.maxWidth = '420px'
  menu.style.padding = '4px 0'
  menu.style.background = 'var(--background-color, #fff)'
  menu.style.color = 'var(--text-color, #24292f)'
  menu.style.border = '1px solid var(--box-border-color, #d0d7de)'
  menu.style.boxShadow = '0 8px 24px rgba(27, 31, 36, 0.18)'
  menu.style.font = 'menu'

  for (const [idx, rawItem] of items.entries()) {
    if (rawItem.role?.toLowerCase() === 'editmenu') {
      appendMenuRow(menu, { label: 'Edit', enabled: false }, [])
      continue
    }

    const itemIndices = [...indices, idx]

    if (rawItem.type === 'separator') {
      const separator = document.createElement('div')
      separator.style.margin = '4px 0'
      separator.style.borderTop = '1px solid var(--box-border-color, #d0d7de)'
      menu.appendChild(separator)
      continue
    }

    const row = appendMenuRow(menu, rawItem, itemIndices)
    const enabled = rawItem.enabled !== false

    row.addEventListener('mouseenter', () => {
      removeSubmenusFromDepth(submenus, itemIndices.length)

      if (!enabled || rawItem.submenu === undefined) {
        return
      }

      const rect = row.getBoundingClientRect()
      const submenuElement = buildWebContextMenu(
        rawItem.submenu,
        itemIndices,
        rect.right - 2,
        rect.top,
        overlay,
        submenus,
        onSelect
      )

      submenus.set(itemIndices.length, submenuElement)
      overlay.appendChild(submenuElement)
    })

    row.addEventListener('click', event => {
      event.stopPropagation()

      if (!enabled || rawItem.submenu !== undefined) {
        return
      }

      onSelect(itemIndices)
    })
  }

  return menu
}

function appendMenuRow(
  menu: HTMLElement,
  item: WebContextMenuItem,
  indices: ReadonlyArray<number>
) {
  const row = document.createElement('div')
  const enabled = item.enabled !== false
  const labelPrefix =
    item.type === 'checkbox' ? (item.checked ? '[x] ' : '[ ] ') : ''
  const label = `${labelPrefix}${item.label ?? item.role ?? ''}`

  row.textContent = item.submenu === undefined ? label : `${label} >`
  row.dataset.indices = indices.join(',')
  row.style.boxSizing = 'border-box'
  row.style.display = 'block'
  row.style.width = '100%'
  row.style.padding = '5px 28px 5px 16px'
  row.style.whiteSpace = 'nowrap'
  row.style.overflow = 'hidden'
  row.style.textOverflow = 'ellipsis'
  row.style.cursor = enabled ? 'default' : 'not-allowed'
  row.style.opacity = enabled ? '1' : '0.5'
  row.setAttribute('role', 'menuitem')

  if (enabled) {
    row.addEventListener('mouseenter', () => {
      row.style.background = 'var(--button-hover-background-color, #0969da)'
      row.style.color = 'var(--button-hover-text-color, #fff)'
    })
    row.addEventListener('mouseleave', () => {
      row.style.background = 'transparent'
      row.style.color = 'inherit'
    })
  }

  menu.appendChild(row)
  return row
}

function removeSubmenusFromDepth(
  submenus: Map<number, HTMLElement>,
  depth: number
) {
  for (const [submenuDepth, element] of submenus) {
    if (submenuDepth >= depth) {
      element.remove()
      submenus.delete(submenuDepth)
    }
  }
}
