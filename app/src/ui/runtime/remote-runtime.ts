import { IAppState } from '../../lib/app-state'
import { RemoteAppStore } from './remote-app-store'
import { createRemoteDispatcher } from './remote-dispatcher'
import { RemoteRPCClient } from './remote-rpc'
import {
  RemoteMethodStore,
  RemoteRepositoryStateCache,
} from './remote-stores'

export async function createRemoteRuntime() {
  const rpc = new RemoteRPCClient()
  const initialState = await rpc.getState<IAppState>()
  const appStore = new RemoteAppStore(initialState, rpc)
  const repositoryStateManager = new RemoteRepositoryStateCache(() =>
    appStore.getState()
  )

  rpc.subscribe(event => {
    if (event.type === 'state') {
      appStore.setState(event.payload as IAppState)
    }
  })

  return {
    dispatcher: createRemoteDispatcher(rpc),
    appStore,
    repositoryStateManager,
    issuesStore: new RemoteMethodStore(rpc, 'issuesStore'),
    gitHubUserStore: new RemoteMethodStore(rpc, 'gitHubUserStore'),
    aheadBehindStore: new RemoteMethodStore(rpc, 'aheadBehindStore'),
    notificationsDebugStore: new RemoteMethodStore(
      rpc,
      'notificationsDebugStore'
    ),
  }
}
