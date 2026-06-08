export type RemoteEventHandler = (event: {
  readonly type: string
  readonly payload: unknown
}) => void

export class RemoteRPCClient {
  public constructor(private readonly baseURL = '') {}

  public async invoke(method: string, params: ReadonlyArray<unknown> = []) {
    const response = await fetch(`${this.baseURL}/api/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ method, params }),
    })

    const payload = await response.json()

    if (!payload.ok) {
      const message = payload.error?.message ?? `Remote call '${method}' failed`
      throw new Error(message)
    }

    return payload.result
  }

  public async getState<T>(): Promise<T> {
    const response = await fetch(`${this.baseURL}/api/state`)
    return response.json()
  }

  public subscribe(handler: RemoteEventHandler) {
    const events = new EventSource(`${this.baseURL}/api/events`)

    events.onmessage = message => {
      handler(JSON.parse(message.data))
    }

    events.onerror = () => {
      log.warn('GitDesk WebUI event stream disconnected')
    }

    return {
      dispose: () => events.close(),
    }
  }
}
