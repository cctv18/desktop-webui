export const URL = globalThis.URL
export const URLSearchParams = globalThis.URLSearchParams

export interface IParsedUrl {
  readonly protocol?: string | null
  readonly slashes?: boolean | null
  readonly auth?: string | null
  readonly host?: string | null
  readonly port?: string | null
  readonly hostname?: string | null
  readonly hash?: string | null
  readonly search?: string | null
  readonly query?: string | Record<string, string | ReadonlyArray<string>>
  readonly pathname?: string | null
  readonly path?: string | null
  readonly href?: string
}

export function parse(raw: string, parseQueryString = false): IParsedUrl {
  try {
    const url = new URL(raw)
    const query = parseQueryString
      ? parseSearchParams(url.searchParams)
      : url.search.length > 0
        ? url.search.substring(1)
        : null

    return {
      protocol: url.protocol,
      slashes: raw.includes('//'),
      auth:
        url.username.length > 0 || url.password.length > 0
          ? `${url.username}:${url.password}`
          : null,
      host: url.host,
      port: url.port.length > 0 ? url.port : null,
      hostname: url.hostname,
      hash: url.hash.length > 0 ? url.hash : null,
      search: url.search.length > 0 ? url.search : null,
      query,
      pathname: url.pathname,
      path: `${url.pathname}${url.search}`,
      href: url.href,
    }
  } catch {
    return parseRelative(raw, parseQueryString)
  }
}

export function format(value: IParsedUrl) {
  const pathname = value.pathname ?? ''
  const query =
    typeof value.query === 'string'
      ? value.query
      : value.query !== undefined
        ? new URLSearchParams(value.query as Record<string, string>).toString()
        : ''
  const search =
    value.search ??
    (query.length > 0 ? `${query.startsWith('?') ? '' : '?'}${query}` : '')

  if (value.protocol !== undefined && value.host !== undefined) {
    return `${value.protocol}//${value.host}${pathname}${search}${
      value.hash ?? ''
    }`
  }

  return `${pathname}${search}${value.hash ?? ''}`
}

export function fileURLToPath(value: string | URL) {
  const url = value instanceof URL ? value : new URL(value)
  return decodeURIComponent(url.pathname)
}

export function pathToFileURL(path: string) {
  const normalized = path.replace(/\\/g, '/')
  const pathname = normalized.startsWith('/') ? normalized : `/${normalized}`
  return new URL(`file://${encodeURI(pathname)}`)
}

function parseSearchParams(searchParams: URLSearchParams) {
  const result: Record<string, string | Array<string>> = {}

  for (const [key, value] of searchParams.entries()) {
    const existing = result[key]
    if (existing === undefined) {
      result[key] = value
    } else if (Array.isArray(existing)) {
      existing.push(value)
    } else {
      result[key] = [existing, value]
    }
  }

  return result
}

function parseRelative(raw: string, parseQueryString: boolean): IParsedUrl {
  const [pathAndSearch, hashPart] = raw.split('#', 2)
  const [pathname, queryPart] = pathAndSearch.split('?', 2)
  const search = queryPart === undefined ? null : `?${queryPart}`
  const query =
    queryPart === undefined
      ? null
      : parseQueryString
        ? parseSearchParams(new URLSearchParams(queryPart))
        : queryPart

  return {
    hash: hashPart === undefined ? null : `#${hashPart}`,
    href: raw,
    path: pathAndSearch,
    pathname,
    query,
    search,
  }
}

export default {
  URL,
  URLSearchParams,
  fileURLToPath,
  format,
  parse,
  pathToFileURL,
}
