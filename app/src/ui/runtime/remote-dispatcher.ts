import { RemoteRPCClient } from './remote-rpc'

const localNoopMethods = new Set([
  'initializeAppFocusState',
  'setAppFocusState',
  'setAccessKeyHighlightState',
  'appFocusedElementChanged',
])

export function createRemoteDispatcher(rpc: RemoteRPCClient) {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'incrementMetric') {
          return () => undefined
        }

        if (typeof property !== 'string') {
          return undefined
        }

        if (localNoopMethods.has(property)) {
          return () => undefined
        }

        return (...params: ReadonlyArray<unknown>) => rpc.invoke(property, params)
      },
    }
  )
}
