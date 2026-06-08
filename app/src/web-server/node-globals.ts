import 'fake-indexeddb/auto'

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

const noop = () => {}
const g = globalThis as any

const defaultLocationHref =
  process.env.GITDESK_WEBUI_URL ?? 'http://127.0.0.1:8080/'

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

if (g.location === undefined) {
  g.location = createLocationShim(defaultLocationHref)
}

if (g.localStorage === undefined) {
  g.localStorage = new MemoryStorage()
}

if (g.window === undefined) {
  g.window = {
    addEventListener: noop,
    removeEventListener: noop,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    location: g.location,
  }
} else if (g.window.location === undefined) {
  g.window.location = g.location
}

if (g.document === undefined) {
  g.document = {
    cookie: '',
    addEventListener: noop,
    removeEventListener: noop,
    location: g.location,
    body: {
      classList: {
        add: noop,
        remove: noop,
        contains: () => false,
      },
    },
  }
} else if (g.document.location === undefined) {
  g.document.location = g.location
}

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
