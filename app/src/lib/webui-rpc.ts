import { reviveFromWeb, serializeForWeb } from './webui-serialization'

export async function invokeWebUIRPC<T>(
  method: string,
  params: ReadonlyArray<unknown>
): Promise<T> {
  const response = await fetch('/api/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ method, params: serializeForWeb(params) }),
  })

  const payload = reviveFromWeb<any>(await response.json())

  if (!payload.ok) {
    throw new Error(payload.error?.message ?? `WebUI RPC '${method}' failed`)
  }

  return payload.result as T
}
