const noop = () => undefined

export const ipcRenderer = {
  invoke: async () => undefined,
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
