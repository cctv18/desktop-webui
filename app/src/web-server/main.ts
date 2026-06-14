import * as Fs from 'fs'
import * as Http from 'http'
import * as Path from 'path'
import { WebRuntime } from './runtime'
import { parseAllowedRoots, PathGuard } from './path-guard'
import { serializeForWeb } from '../lib/webui-serialization'
import { IOAuthAction } from '../lib/parse-app-url'

type ServerEvent = {
  readonly type: string
  readonly payload: unknown
}

const args = parseArgs(process.argv.slice(2))
const DefaultWebUIOAuthClientId = 'Ov23liz1Wb08XDEhs7tm'
const host = args.host ?? process.env.GITDESK_HOST ?? '127.0.0.1'
const port = parseInt(args.port ?? process.env.GITDESK_PORT ?? '8080', 10)
const staticRoot =
  args.staticRoot ??
  args['static-root'] ??
  process.env.GITDESK_STATIC_ROOT ??
  Path.join(__dirname, 'web')
process.env.GITDESK_WEBUI_STATIC_ROOT = staticRoot
setEnvIfValue(
  'GITDESK_WEBUI_OAUTH_CLIENT_ID',
  args.oauthClientId ??
    args['oauth-client-id'] ??
    process.env.GITDESK_WEBUI_OAUTH_CLIENT_ID ??
    DefaultWebUIOAuthClientId
)
setEnvIfValue(
  'GITDESK_WEBUI_OAUTH_CLIENT_SECRET',
  args.oauthClientSecret ?? args['oauth-client-secret']
)
setEnvIfValue(
  'GITDESK_WEBUI_GIT_PATH',
  args.gitPath ?? args['git-path']
)
setEnvIfValue(
  'GITDESK_WEBUI_GIT_DIRECTORY',
  args.gitDirectory ?? args['git-directory']
)
setEnvIfValue(
  'GITDESK_WEBUI_GIT_EXEC_PATH',
  args.gitExecPath ?? args['git-exec-path']
)
setEnvIfValue(
  'GITDESK_WEBUI_DATA_DIR',
  args.dataDir ?? args['data-dir']
)
setEnvIfValue(
  'GITDESK_WEBUI_GIT_CONFIG_GLOBAL',
  args.gitConfigGlobal ?? args['git-config-global']
)
setEnvIfValue(
  'GITDESK_WEBUI_COPILOT_CLI_PATH',
  args.copilotCliPath ?? args['copilot-cli-path']
)
const publicBaseURL = resolvePublicBaseURL(
  args.publicUrl ?? args['public-url'] ?? process.env.GITDESK_WEBUI_URL,
  host,
  port
)
process.env.GITDESK_WEBUI_URL = publicBaseURL
const configuredOAuthCallbackURL =
  args.oauthCallbackUrl ??
  args['oauth-callback-url'] ??
  process.env.GITDESK_WEBUI_OAUTH_CALLBACK_URL
process.env.GITDESK_WEBUI_OAUTH_CALLBACK_URL =
  configuredOAuthCallbackURL ||
  new URL('/oauth/callback', publicBaseURL).toString()
const allowedRoots = parseAllowedRoots(
  args.allowedRoot ?? args['allowed-root'] ?? process.env.GITDESK_ALLOWED_ROOTS,
  process.cwd()
)
process.env.GITDESK_WEBUI_DEFAULT_ROOT = allowedRoots[0]

const pathGuard = new PathGuard(allowedRoots)
const runtime = new WebRuntime(pathGuard)
const eventClients = new Set<Http.ServerResponse>()

runtime.onDidUpdate(state => {
  broadcast({ type: 'state', payload: serializeForWeb(state) })
})

const initialStatePromise = runtime.dispatcher
  .loadInitialState()
  .catch(error => {
    log.error('Unable to load initial WebUI state', error)
  })

const server = Http.createServer(async (req, res) => {
  try {
    await route(req, res)
  } catch (error) {
    writeJson(res, 500, {
      error: serializeError(error),
    })
  }
})

server.listen(port, host, () => {
  log.info(
    `GitDesk WebUI listening on http://${host}:${port}; allowed roots: ${allowedRoots.join(
      ', '
    )}`
  )
  log.info(
    `GitDesk WebUI public URL: ${publicBaseURL}; OAuth callback: ${process.env.GITDESK_WEBUI_OAUTH_CALLBACK_URL}`
  )
  log.info(
    `GitDesk WebUI OAuth client: ${
      process.env.GITDESK_WEBUI_OAUTH_CLIENT_ID ? 'configured' : 'not configured'
    }`
  )
})

async function route(req: Http.IncomingMessage, res: Http.ServerResponse) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? host}`)

  if (req.method === 'GET' && url.pathname === '/api/health') {
    writeJson(res, 200, {
      ok: true,
      version: __APP_VERSION__,
      allowedRoots: pathGuard.allowedRoots,
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    await initialStatePromise
    writeJson(res, 200, serializeForWeb(runtime.getState()))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    await initialStatePromise
    subscribeEvents(res)
    return
  }

  if (req.method === 'GET' && url.pathname === '/oauth/callback') {
    await handleOAuthCallback(url, res)
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/rpc') {
    await initialStatePromise
    const body = await readJson(req)
    const method = `${body.method ?? ''}`
    const params = Array.isArray(body.params) ? body.params : []

    try {
      const result = await runtime.invoke(method, params)
      writeJson(res, 200, { ok: true, result: serializeForWeb(result) })
    } catch (error) {
      writeJson(res, 200, {
        ok: false,
        error: serializeError(error),
      })
    }
    return
  }

  serveStatic(url.pathname, res)
}

async function handleOAuthCallback(url: URL, res: Http.ServerResponse) {
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  if (!code || !state) {
    writeHtml(
      res,
      400,
      'GitDesk WebUI sign in failed',
      'The OAuth callback is missing the required code or state.'
    )
    return
  }

  const action: IOAuthAction = { name: 'oauth', code, state }
  await runtime.dispatcher.dispatchURLAction(action)

  writeHtml(
    res,
    200,
    'GitDesk WebUI sign in complete',
    'Authentication has completed. You can return to GitDesk WebUI.'
  )
}

function subscribeEvents(res: Http.ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  eventClients.add(res)
  res.write(
    `data: ${JSON.stringify({
      type: 'state',
      payload: serializeForWeb(runtime.getState()),
    })}\n\n`
  )
  res.on('close', () => eventClients.delete(res))
}

function broadcast(event: ServerEvent) {
  const line = `data: ${JSON.stringify(event)}\n\n`
  for (const client of eventClients) {
    client.write(line)
  }
}

function serveStatic(pathname: string, res: Http.ServerResponse) {
  const decodedPathname = decodeURLPathname(pathname)
  if (decodedPathname === null) {
    writeJson(res, 400, { error: 'Bad request' })
    return
  }

  const requestedPath = decodedPathname === '/' ? '/index.html' : decodedPathname
  const absolutePath = Path.resolve(
    staticRoot,
    requestedPath.replace(/^\/+/, '')
  )
  const absoluteStaticRoot = Path.resolve(staticRoot)

  if (
    absolutePath !== absoluteStaticRoot &&
    !absolutePath.startsWith(`${absoluteStaticRoot}${Path.sep}`)
  ) {
    writeJson(res, 403, { error: 'Forbidden' })
    return
  }

  Fs.readFile(absolutePath, (error, data) => {
    if (error) {
      const fallbackPath = getStaticFallbackPath(requestedPath)

      if (fallbackPath !== null && fallbackPath !== absolutePath) {
        Fs.readFile(fallbackPath, (fallbackError, fallbackData) => {
          if (fallbackError) {
            writeJson(res, 404, { error: 'Not found' })
            return
          }

          res.writeHead(200, {
            'Content-Type': contentType(fallbackPath),
          })
          res.end(fallbackData)
        })
        return
      }

      writeJson(res, 404, { error: 'Not found' })
      return
    }

    res.writeHead(200, { 'Content-Type': contentType(absolutePath) })
    res.end(data)
  })
}

function getStaticFallbackPath(requestedPath: string) {
  if (requestedPath !== '/favicon.ico') {
    return null
  }

  return Path.resolve(staticRoot, 'static', 'favicon.ico')
}

function decodeURLPathname(pathname: string) {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return null
  }
}

function readJson(req: Http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks = new Array<Buffer>()
    req.on('data', chunk => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function writeJson(res: Http.ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

function writeHtml(
  res: Http.ServerResponse,
  status: number,
  title: string,
  message: string
) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </body>
</html>`)
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }

  return { name: 'Error', message: `${error}` }
}

function contentType(file: string) {
  switch (Path.extname(file)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'application/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.svg':
      return 'image/svg+xml'
    case '.ico':
      return 'image/x-icon'
    default:
      return 'application/octet-stream'
  }
}

function resolvePublicBaseURL(
  configuredURL: string | undefined,
  host: string,
  port: number
) {
  const rawURL =
    configuredURL && configuredURL.trim().length > 0
      ? configuredURL.trim()
      : `http://${formatHostForURL(host)}:${port}`

  const url = new URL(rawURL)
  url.hash = ''
  url.search = ''
  return url.toString()
}

function formatHostForURL(host: string) {
  if (host === '0.0.0.0' || host === '::' || host === '[::]') {
    return '127.0.0.1'
  }

  if (host.includes(':') && !host.startsWith('[')) {
    return `[${host}]`
  }

  return host
}

function setEnvIfValue(key: string, value: string | undefined) {
  if (value !== undefined && value.length > 0) {
    process.env[key] = value
  }
}

function parseArgs(values: ReadonlyArray<string>) {
  const result: Record<string, string> = {}

  for (let i = 0; i < values.length; i++) {
    const current = values[i]

    if (!current.startsWith('--')) {
      continue
    }

    const key = current.slice(2)
    const next = values[i + 1]

    if (next !== undefined && !next.startsWith('--')) {
      result[key] = next
      i++
    } else {
      result[key] = '1'
    }
  }

  return result
}
