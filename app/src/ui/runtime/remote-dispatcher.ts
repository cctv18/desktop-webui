import { Foldout, FoldoutType } from '../../lib/app-state'
import { AppMenu } from '../../models/app-menu'
import { RemoteAppStore } from './remote-app-store'
import { RemoteRPCClient } from './remote-rpc'

const localNoopMethods = new Set(['appFocusedElementChanged'])

export function createRemoteDispatcher(
  rpc: RemoteRPCClient,
  appStore: RemoteAppStore
) {
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

        if (property === 'initializeAppFocusState') {
          return () => setAppFocusState(appStore, document.hasFocus())
        }

        if (property === 'setAppFocusState') {
          return (isFocused: boolean) => setAppFocusState(appStore, isFocused)
        }

        if (property === 'setAccessKeyHighlightState') {
          return (highlight: boolean) =>
            setAccessKeyHighlightState(appStore, highlight)
        }

        if (property === 'setAppMenuState') {
          return (update: (appMenu: AppMenu) => AppMenu) =>
            setAppMenuState(appStore, update)
        }

        if (property === 'showFoldout') {
          return (foldout: Foldout) =>
            foldout.type === FoldoutType.AppMenu
              ? setCurrentFoldout(appStore, foldout)
              : rpc.invoke(property, [foldout])
        }

        if (property === 'closeFoldout') {
          return (foldout: FoldoutType) =>
            foldout === FoldoutType.AppMenu
              ? closeCurrentFoldout(appStore, foldout)
              : rpc.invoke(property, [foldout])
        }

        if (
          property === 'requestBrowserAuthentication' ||
          property === 'requestBrowserAuthenticationToDotcom' ||
          property === 'beginBrowserBasedSignIn'
        ) {
          return (...params: ReadonlyArray<unknown>) => {
            const popup = window.open('about:blank', '_blank')
            return openReturnedURL(rpc.invoke(property, params), popup)
          }
        }

        if (localNoopMethods.has(property)) {
          return () => undefined
        }

        return (...params: ReadonlyArray<unknown>) => rpc.invoke(property, params)
      },
    }
  )
}

async function openReturnedURL(result: Promise<unknown>, popup: Window | null) {
  try {
    const value = await result

    if (typeof value === 'string' && value.length > 0) {
      if (popup !== null) {
        popup.location.href = value
      } else {
        window.open(value, '_blank', 'noopener')
      }
    } else {
      popup?.close()
    }

    return value
  } catch (error) {
    popup?.close()
    throw error
  }
}

function setAppFocusState(appStore: RemoteAppStore, appIsFocused: boolean) {
  appStore.updateState(state =>
    state.appIsFocused === appIsFocused ? state : { ...state, appIsFocused }
  )
  return Promise.resolve()
}

function setAccessKeyHighlightState(
  appStore: RemoteAppStore,
  highlightAccessKeys: boolean
) {
  appStore.updateState(state =>
    state.highlightAccessKeys === highlightAccessKeys
      ? state
      : { ...state, highlightAccessKeys }
  )
  return Promise.resolve()
}

function setAppMenuState(
  appStore: RemoteAppStore,
  update: (appMenu: AppMenu) => AppMenu
) {
  appStore.updateState(state => {
    if (state.appMenuState.length === 0 || typeof update !== 'function') {
      return state
    }

    const appMenu = AppMenu.fromMenu(state.appMenuState[0])
    ;(appMenu as any).openMenus = state.appMenuState

    return { ...state, appMenuState: update(appMenu).openMenus }
  })

  return Promise.resolve()
}

function setCurrentFoldout(appStore: RemoteAppStore, foldout: Foldout) {
  appStore.updateState(state =>
    state.currentFoldout === foldout ? state : { ...state, currentFoldout: foldout }
  )

  return Promise.resolve()
}

function closeCurrentFoldout(
  appStore: RemoteAppStore,
  foldoutType: FoldoutType
) {
  appStore.updateState(state =>
    state.currentFoldout?.type === foldoutType
      ? { ...state, currentFoldout: null }
      : state
  )

  return Promise.resolve()
}
