import type { IMenu } from '../models/app-menu'
import type { IMenuItemState } from '../lib/menu-update'
import type { MenuLabelsEvent } from '../models/menu-labels'
import {
  applyWebAppMenuState,
  getDefaultWebAppMenu,
  getDefaultWebMenuLabels,
  getWebMenuEventForItem,
} from '../lib/webui-app-menu'

const noop = () => {}

type IPCListener = (event: unknown, ...args: ReadonlyArray<any>) => void

const listeners = new Map<string, Set<IPCListener>>()
let currentMenuLabels = getDefaultWebMenuLabels()
let currentMenuState = new Map<string, IMenuItemState>()
let currentAppMenu = getDefaultWebAppMenu(currentMenuLabels)

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
  const menuEvent = getWebMenuEventForItem(id, currentMenuLabels, item?.label)

  if (menuEvent !== null) {
    emitIPC('menu-event', menuEvent)
  }
}
