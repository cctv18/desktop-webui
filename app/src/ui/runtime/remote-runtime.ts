import { FoldoutType, IAppState } from '../../lib/app-state'
import { RemoteAppStore } from './remote-app-store'
import { createRemoteDispatcher } from './remote-dispatcher'
import { RemoteRPCClient } from './remote-rpc'
import { getDefaultAppMenu } from '../platform/electron-web-shim'
import {
  RemoteMethodStore,
  RemoteRepositoryStateCache,
} from './remote-stores'

export async function createRemoteRuntime() {
  const rpc = new RemoteRPCClient()
  const initialState = await rpc.getState<IAppState>()
  const initialStateWithMenu = withWebMenuState(initialState)
  const appStore = new RemoteAppStore(initialStateWithMenu, rpc)
  const repositoryStateManager = new RemoteRepositoryStateCache(() =>
    appStore.getState()
  )

  rpc.subscribe(event => {
    if (event.type === 'state') {
      const state = event.payload as IAppState
      appStore.setState(withWebMenuState(state, appStore.getState()))
    }
  })

  return {
    dispatcher: createRemoteDispatcher(rpc, appStore),
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

function withWebMenuState(state: IAppState, currentState?: IAppState) {
  const fallbackMenuState =
    state.appMenuState.length === 0
      ? [getDefaultAppMenu()]
      : state.appMenuState

  if (currentState?.currentFoldout?.type === FoldoutType.AppMenu) {
    return {
      ...state,
      currentFoldout: currentState.currentFoldout,
      appMenuState: currentState.appMenuState,
    }
  }

  return state.appMenuState === fallbackMenuState
    ? state
    : { ...state, appMenuState: fallbackMenuState }
}
