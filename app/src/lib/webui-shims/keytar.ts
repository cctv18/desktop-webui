import * as Fs from 'fs'
import * as Path from 'path'

const store = new Map<string, string>()
let loaded = false

function key(service: string, account: string) {
  return `${service}\0${account}`
}

export async function setPassword(
  service: string,
  account: string,
  password: string
) {
  loadStore()
  store.set(key(service, account), password)
  saveStore()
}

export async function getPassword(service: string, account: string) {
  loadStore()
  return store.get(key(service, account)) ?? null
}

export async function deletePassword(service: string, account: string) {
  loadStore()
  const deleted = store.delete(key(service, account))
  saveStore()
  return deleted
}

function loadStore() {
  if (loaded) {
    return
  }

  loaded = true

  if (__PROCESS_KIND__ !== 'web-server') {
    loadBrowserStore()
    return
  }

  try {
    const raw = Fs.readFileSync(getStorePath(), 'utf8')
    const parsed = JSON.parse(raw)

    if (parsed !== null && typeof parsed === 'object') {
      for (const [entryKey, value] of Object.entries(parsed)) {
        if (typeof value === 'string') {
          store.set(entryKey, value)
        }
      }
    }
  } catch {
    // Missing or unreadable credential storage behaves like an empty keychain.
  }
}

function saveStore() {
  if (__PROCESS_KIND__ !== 'web-server') {
    saveBrowserStore()
    return
  }

  const data = Object.fromEntries(store.entries())
  const storePath = getStorePath()
  Fs.mkdirSync(Path.dirname(storePath), { recursive: true, mode: 0o700 })
  Fs.writeFileSync(storePath, `${JSON.stringify(data, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

function loadBrowserStore() {
  try {
    const raw = localStorage.getItem(getBrowserStoreKey())
    const parsed = raw ? JSON.parse(raw) : null

    if (parsed !== null && typeof parsed === 'object') {
      for (const [entryKey, value] of Object.entries(parsed)) {
        if (typeof value === 'string') {
          store.set(entryKey, value)
        }
      }
    }
  } catch {
    // Ignore browser storage failures.
  }
}

function saveBrowserStore() {
  try {
    localStorage.setItem(
      getBrowserStoreKey(),
      JSON.stringify(Object.fromEntries(store.entries()))
    )
  } catch {
    // Ignore browser storage failures.
  }
}

function getStorePath() {
  return Path.join(getDataDirectory(), 'tokens.json')
}

function getDataDirectory() {
  const raw =
    process.env.GITDESK_WEBUI_DATA_DIR && process.env.GITDESK_WEBUI_DATA_DIR.trim()
      ? process.env.GITDESK_WEBUI_DATA_DIR
      : getArgValue('--data-dir') ?? Path.join(process.cwd(), '.gitdesk-webui')

  return Path.resolve(raw)
}

function getArgValue(name: string) {
  const index = process.argv.indexOf(name)

  if (index < 0) {
    return undefined
  }

  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : undefined
}

function getBrowserStoreKey() {
  return 'gitdesk-webui:keytar'
}
