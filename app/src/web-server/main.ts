import * as Fs from 'fs'
import * as Http from 'http'
import * as Path from 'path'
import { WebRuntime } from './runtime'
import { parseAllowedRoots, PathGuard } from './path-guard'

type ServerEvent = {
  readonly type: string
  readonly payload: unknown
}

const args = parseArgs(process.argv.slice(2))
const host = args.host ?? process.env.GITDESK_HOST ?? '127.0.0.1'
const port = parseInt(args.port ?? process.env.GITDESK_PORT ?? '8080', 10)
const staticRoot =
  args.staticRoot ?? process.env.GITDESK_STATIC_ROOT ?? Path.join(__dirname, 'web')
const allowedRoots = parseAllowedRoots(
  args.allowedRoot ?? process.env.GITDESK_ALLOWED_ROOTS,
  process.cwd()
)

const pathGuard = new PathGuard(allowedRoots)
const runtime = new WebRuntime(pathGuard)
const eventClients = new Set<Http.ServerResponse>()

runtime.onDidUpdate(state => {
  broadcast({ type: 'state', payload: state })
})

runtime.dispatcher.loadInitialState().catch(error => {
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
    writeJson(res, 200, runtime.getState())
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    subscribeEvents(res)
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/rpc') {
    const body = await readJson(req)
    const method = `${body.method ?? ''}`
    const params = Array.isArray(body.params) ? body.params : []

    try {
      const result = await runtime.invoke(method, params)
      writeJson(res, 200, { ok: true, result })
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

function subscribeEvents(res: Http.ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  eventClients.add(res)
  res.write(`data: ${JSON.stringify({ type: 'state', payload: runtime.getState() })}\n\n`)
  res.on('close', () => eventClients.delete(res))
}

function broadcast(event: ServerEvent) {
  const line = `data: ${JSON.stringify(event)}\n\n`
  for (const client of eventClients) {
    client.write(line)
  }
}

function serveStatic(pathname: string, res: Http.ServerResponse) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname
  const absolutePath = Path.resolve(
    staticRoot,
    requestedPath.replace(/^\/+/, '')
  )

  if (!absolutePath.startsWith(Path.resolve(staticRoot))) {
    writeJson(res, 403, { error: 'Forbidden' })
    return
  }

  Fs.readFile(absolutePath, (error, data) => {
    if (error) {
      writeJson(res, 404, { error: 'Not found' })
      return
    }

    res.writeHead(200, { 'Content-Type': contentType(absolutePath) })
    res.end(data)
  })
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
    default:
      return 'application/octet-stream'
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
