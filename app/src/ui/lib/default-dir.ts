import * as Path from 'path'
import { getDocumentsPath } from './app-proxy'

const localStorageKey = 'last-clone-location'

/** The path to the default directory. */
export async function getDefaultDir(): Promise<string> {
  const defaultRootPath = await getDefaultRootPath()
  const defaultDir = getDefaultCloneDirectory(defaultRootPath)
  const storedPath = localStorage.getItem(localStorageKey)

  if (storedPath !== null && Path.isAbsolute(storedPath)) {
    if (isLegacyWebUIDefaultDir(storedPath, defaultRootPath)) {
      return defaultDir
    }

    return storedPath
  }

  return defaultDir
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

function getDefaultCloneDirectory(defaultRootPath: string) {
  if (__PROCESS_KIND__ === 'web' || __PROCESS_KIND__ === 'web-server') {
    return Path.join(defaultRootPath, 'repo')
  }

  return Path.join(defaultRootPath, 'GitHub')
}

function isLegacyWebUIDefaultDir(storedPath: string, defaultRootPath: string) {
  if (__PROCESS_KIND__ !== 'web' && __PROCESS_KIND__ !== 'web-server') {
    return false
  }

  const legacyDefaultDirs = [
    Path.join(defaultRootPath, 'GitHub'),
    Path.join(defaultRootPath, 'Github'),
    Path.join(defaultRootPath, 'out', 'GitHub'),
    Path.join(defaultRootPath, 'out', 'Github'),
  ]

  return legacyDefaultDirs.some(path => pathsEqual(storedPath, path))
}

function pathsEqual(a: string, b: string) {
  const normalizedA = Path.normalize(a)
  const normalizedB = Path.normalize(b)

  return __WIN32__
    ? normalizedA.toLocaleLowerCase() === normalizedB.toLocaleLowerCase()
    : normalizedA === normalizedB
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
