import * as Path from 'path'
import { getDocumentsPath } from './app-proxy'

const localStorageKey = 'last-clone-location'

/** The path to the default directory. */
export async function getDefaultDir(): Promise<string> {
  const storedPath = localStorage.getItem(localStorageKey)

  if (storedPath !== null && Path.isAbsolute(storedPath)) {
    return storedPath
  }

  return Path.join(await getDefaultRootPath(), 'GitHub')
}

export function setDefaultDir(path: string) {
  if (__PROCESS_KIND__ === 'web' && !Path.isAbsolute(path)) {
    return
  }

  localStorage.setItem(localStorageKey, path)
}

async function getDefaultRootPath(): Promise<string> {
  if (__PROCESS_KIND__ === 'web') {
    return getWebUIDefaultRootPath()
  }

  if (__PROCESS_KIND__ === 'web-server') {
    return process.env.GITDESK_WEBUI_DEFAULT_ROOT ?? process.cwd()
  }

  return getDocumentsPath()
}

async function getWebUIDefaultRootPath() {
  try {
    const response = await fetch('/api/health')
    const payload = await response.json()
    const allowedRoot = Array.isArray(payload.allowedRoots)
      ? payload.allowedRoots.find(
          (value: unknown): value is string =>
            typeof value === 'string' && Path.isAbsolute(value)
        )
      : null

    if (allowedRoot !== null && allowedRoot !== undefined) {
      return allowedRoot
    }
  } catch (error) {
    log.error('Unable to load GitDesk WebUI allowed roots', error as Error)
  }

  return '/'
}
