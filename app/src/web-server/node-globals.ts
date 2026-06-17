import 'fake-indexeddb/auto'
import * as Fs from 'fs'
import * as Path from 'path'
import { randomUUID, webcrypto } from 'crypto'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  public get length() {
    return this.values.size
  }

  public clear() {
    this.values.clear()
  }

  public getItem(key: string) {
    return this.values.get(key) ?? null
  }

  public key(index: number) {
    return Array.from(this.values.keys())[index] ?? null
  }

  public removeItem(key: string) {
    this.values.delete(key)
  }

  public setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

class PersistentStorage extends MemoryStorage {
  public constructor(private readonly filePath: string) {
    super()
    this.load()
  }

  public clear() {
    super.clear()
    this.save()
  }

  public removeItem(key: string) {
    super.removeItem(key)
    this.save()
  }

  public setItem(key: string, value: string) {
    super.setItem(key, value)
    this.save()
  }

  private load() {
    try {
      const raw = Fs.readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw)

      if (parsed !== null && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string') {
            super.setItem(key, value)
          }
        }
      }
    } catch {
      // Missing or unreadable storage should behave like an empty profile.
    }
  }

  private save() {
    const data: Record<string, string> = {}

    for (let i = 0; i < this.length; i++) {
      const key = this.key(i)
      if (key !== null) {
        data[key] = this.getItem(key) ?? ''
      }
    }

    writePrivateJsonFile(this.filePath, data)
  }
}

const noop = () => {}
const g = globalThis as any

installArrayPolyfills()

function isStorageLike(value: unknown): value is Storage {
  if (value === null || typeof value !== 'object') {
    return false
  }

  const storage = value as Partial<Storage>
  return (
    typeof storage.getItem === 'function' &&
    typeof storage.setItem === 'function' &&
    typeof storage.removeItem === 'function' &&
    typeof storage.clear === 'function' &&
    typeof storage.key === 'function'
  )
}

function setIfMissing(target: any, key: string, value: unknown) {
  if (target[key] === undefined) {
    target[key] = value
  }
}

function installArrayPolyfills() {
  const arrayPrototype = Array.prototype as any

  if (typeof arrayPrototype.toSorted !== 'function') {
    Object.defineProperty(arrayPrototype, 'toSorted', {
      configurable: true,
      value<T>(this: ReadonlyArray<T>, compareFn?: (a: T, b: T) => number) {
        return [...this].sort(compareFn)
      },
    })
  }

  if (typeof arrayPrototype.toReversed !== 'function') {
    Object.defineProperty(arrayPrototype, 'toReversed', {
      configurable: true,
      value<T>(this: ReadonlyArray<T>) {
        return [...this].reverse()
      },
    })
  }
}

function getWebUIDataDirectory() {
  const fromEnv = process.env.GITDESK_WEBUI_DATA_DIR
  const fromArgs = getArgValue('--data-dir')
  const raw =
    fromEnv && fromEnv.trim().length > 0
      ? fromEnv
      : fromArgs && fromArgs.trim().length > 0
      ? fromArgs
      : Path.join(process.cwd(), '.gitdesk-webui')

  const resolved = Path.resolve(raw)
  Fs.mkdirSync(resolved, { recursive: true, mode: 0o700 })
  return resolved
}

function getArgValue(name: string) {
  const index = process.argv.indexOf(name)

  if (index < 0) {
    return undefined
  }

  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : undefined
}

function writePrivateJsonFile(filePath: string, data: unknown) {
  const directory = Path.dirname(filePath)
  Fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  Fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

const defaultLocationHref =
  process.env.GITDESK_WEBUI_URL ?? 'http://127.0.0.1:8080/'
const dataDirectory = getWebUIDataDirectory()

const requestAnimationFrameShim = (callback: FrameRequestCallback) =>
  setTimeout(() => callback(Date.now()), 16)
const cancelAnimationFrameShim = (handle: ReturnType<typeof setTimeout>) =>
  clearTimeout(handle)

function createLocationShim(href: string) {
  const url = new URL(href)

  return {
    href: url.href,
    protocol: url.protocol,
    host: url.host,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    origin: url.origin,
    assign: noop,
    reload: noop,
    replace: noop,
    toString: () => url.href,
  }
}

function createClassListShim() {
  const values = new Set<string>()

  return {
    add: (...tokens: ReadonlyArray<string>) => {
      for (const token of tokens) {
        values.add(token)
      }
    },
    remove: (...tokens: ReadonlyArray<string>) => {
      for (const token of tokens) {
        values.delete(token)
      }
    },
    contains: (token: string) => values.has(token),
    toggle: (token: string, force?: boolean) => {
      const shouldAdd = force ?? !values.has(token)
      if (shouldAdd) {
        values.add(token)
      } else {
        values.delete(token)
      }
      return shouldAdd
    },
  }
}

function createStyleShim() {
  const values = new Map<string, string>()

  return {
    setProperty: (key: string, value: string) => values.set(key, value),
    getPropertyValue: (key: string) => values.get(key) ?? '',
    removeProperty: (key: string) => {
      const value = values.get(key) ?? ''
      values.delete(key)
      return value
    },
  }
}

function createElementShim(tagName = 'div'): any {
  const children = new Array<any>()

  return {
    tagName: tagName.toUpperCase(),
    children,
    classList: createClassListShim(),
    style: createStyleShim(),
    textContent: '',
    innerText: '',
    innerHTML: '',
    offsetHeight: 0,
    offsetTop: 0,
    offsetWidth: 0,
    clientHeight: 0,
    clientWidth: 0,
    scrollHeight: 0,
    scrollWidth: 0,
    appendChild: (child: any) => {
      children.push(child)
      return child
    },
    removeChild: (child: any) => {
      const index = children.indexOf(child)
      if (index >= 0) {
        children.splice(index, 1)
      }
      return child
    },
    contains: () => false,
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    setAttribute: noop,
    getAttribute: () => null,
    removeAttribute: noop,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => false,
    focus: noop,
    blur: noop,
  }
}

if (g.location === undefined) {
  g.location = createLocationShim(defaultLocationHref)
}

if (!isStorageLike(g.localStorage)) {
  g.localStorage = new PersistentStorage(
    Path.join(dataDirectory, 'local-storage.json')
  )
}

setIfMissing(g, 'crypto', {
  ...webcrypto,
  randomUUID,
})
setIfMissing(g.crypto, 'randomUUID', randomUUID)
setIfMissing(
  g.crypto,
  'getRandomValues',
  webcrypto.getRandomValues.bind(webcrypto)
)

g.window = g.window ?? {}
setIfMissing(g.window, 'addEventListener', noop)
setIfMissing(g.window, 'removeEventListener', noop)
setIfMissing(g.window, 'dispatchEvent', () => false)
setIfMissing(g.window, 'setTimeout', setTimeout)
setIfMissing(g.window, 'clearTimeout', clearTimeout)
setIfMissing(g.window, 'setInterval', setInterval)
setIfMissing(g.window, 'clearInterval', clearInterval)
setIfMissing(g.window, 'requestAnimationFrame', requestAnimationFrameShim)
setIfMissing(g.window, 'cancelAnimationFrame', cancelAnimationFrameShim)
setIfMissing(g.window, 'crypto', g.crypto)
setIfMissing(g.window, 'location', g.location)
if (!isStorageLike(g.window.localStorage)) {
  g.window.localStorage = g.localStorage
}
setIfMissing(g.window, 'URL', URL)
setIfMissing(g.window, 'URLSearchParams', URLSearchParams)
setIfMissing(g.window, 'innerWidth', 1280)
setIfMissing(g.window, 'innerHeight', 800)
setIfMissing(g.window, 'outerWidth', 1280)
setIfMissing(g.window, 'outerHeight', 800)
setIfMissing(g.window, 'focus', noop)
setIfMissing(g.window, 'getSelection', () => null)
setIfMissing(g.window, 'matchMedia', () => ({
  addEventListener: noop,
  addListener: noop,
  dispatchEvent: () => false,
  matches: false,
  media: '',
  onchange: null,
  removeEventListener: noop,
  removeListener: noop,
}))

setIfMissing(g, 'requestAnimationFrame', requestAnimationFrameShim)
setIfMissing(g, 'cancelAnimationFrame', cancelAnimationFrameShim)

g.document = g.document ?? {}
setIfMissing(g.document, 'cookie', '')
setIfMissing(g.document, 'addEventListener', noop)
setIfMissing(g.document, 'removeEventListener', noop)
setIfMissing(g.document, 'dispatchEvent', () => false)
setIfMissing(g.document, 'location', g.location)
setIfMissing(g.document, 'activeElement', null)
setIfMissing(g.document, 'body', createElementShim('body'))
setIfMissing(g.document, 'documentElement', createElementShim('html'))
setIfMissing(g.document, 'createElement', (tagName: string) =>
  createElementShim(tagName)
)
setIfMissing(g.document, 'createTextNode', (text: string) => ({
  textContent: text,
}))
setIfMissing(g.document, 'getElementById', () => null)
setIfMissing(g.document, 'querySelector', () => null)
setIfMissing(g.document, 'querySelectorAll', () => [])
setIfMissing(g.document, 'getSelection', () => null)
setIfMissing(g.document, 'contains', () => false)
setIfMissing(g.document, 'hasFocus', () => false)

if (g.navigator === undefined) {
  g.navigator = {
    userAgent: 'GitDesk-WebUI-Server',
  }
}

if (g.log === undefined) {
  g.log = {
    error: (message: string, error?: Error) => console.error(message, error),
    warn: (message: string, error?: Error) => console.warn(message, error),
    info: (message: string, error?: Error) => console.info(message, error),
    debug: (message: string, error?: Error) => console.debug(message, error),
  } as IDesktopLogger
}

const requiredServerBrowserShims = [
  ['global.location', () => g.location],
  ['global.requestAnimationFrame', () => g.requestAnimationFrame],
  ['global.cancelAnimationFrame', () => g.cancelAnimationFrame],
  ['window.location', () => g.window.location],
  ['window.URL', () => g.window.URL],
  ['window.requestAnimationFrame', () => g.window.requestAnimationFrame],
  ['window.cancelAnimationFrame', () => g.window.cancelAnimationFrame],
  ['window.innerWidth', () => g.window.innerWidth],
  ['window.innerHeight', () => g.window.innerHeight],
  ['document.body', () => g.document.body],
  ['document.documentElement', () => g.document.documentElement],
  ['document.createElement', () => g.document.createElement],
  ['document.createTextNode', () => g.document.createTextNode],
  ['document.getElementById', () => g.document.getElementById],
  ['document.activeElement', () => g.document.activeElement],
  ['navigator.userAgent', () => g.navigator.userAgent],
] as const

const missingServerBrowserShims = requiredServerBrowserShims
  .filter(([, resolve]) => resolve() === undefined)
  .map(([name]) => name)

if (missingServerBrowserShims.length > 0) {
  throw new Error(
    `GitDesk WebUI server browser shim is incomplete: ${missingServerBrowserShims.join(
      ', '
    )}`
  )
}
