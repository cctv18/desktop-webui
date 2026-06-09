import { access } from 'fs/promises'
import constant from 'lodash/constant'
import { reviveFromWeb, serializeForWeb } from './webui-serialization'

/**
 * Returns a value indicating whether or not the provided path exists (as in
 * whether it's visible to the current process or not).
 */
export const pathExists = (path: string) =>
  __PROCESS_KIND__ === 'web'
    ? remotePathExists(path)
    : access(path).then(constant(true), constant(false))

async function remotePathExists(path: string) {
  try {
    const response = await fetch('/api/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'filesystem.pathExists',
        params: serializeForWeb([path]),
      }),
    })

    if (!response.ok) {
      return false
    }

    const payload = reviveFromWeb<any>(await response.json())
    return payload.ok ? Boolean(payload.result) : false
  } catch {
    return false
  }
}
