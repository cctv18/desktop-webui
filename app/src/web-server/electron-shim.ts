const noop = () => {}

export const ipcRenderer = {
  invoke: async () => undefined,
  send: noop,
  sendSync: noop,
  on: noop,
  once: noop,
  removeListener: noop,
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
