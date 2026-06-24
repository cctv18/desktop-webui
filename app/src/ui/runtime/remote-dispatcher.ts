import { Foldout, FoldoutType } from '../../lib/app-state'
import { AppMenu, ExecutableMenuItem } from '../../models/app-menu'
import { MultiCommitOperationStepKind } from '../../models/multi-commit-operation'
import { Popup, PopupType } from '../../models/popup'
import { Repository } from '../../models/repository'
import {
  executeMenuItem,
  executeMenuItemById,
} from '../main-process-proxy'
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
          return () => setAppFocusState(appStore, document.hasFocus(), rpc)
        }

        if (property === 'setAppFocusState') {
          return (isFocused: boolean) =>
            setAppFocusState(appStore, isFocused, rpc)
        }

        if (property === 'openInBrowser') {
          return (url: string) => {
            return Promise.resolve(openURLInNewTab(url))
          }
        }

        if (property === 'setAccessKeyHighlightState') {
          return (highlight: boolean) =>
            setAccessKeyHighlightState(appStore, highlight)
        }

        if (property === 'setAppMenuState') {
          return (update: (appMenu: AppMenu) => AppMenu) =>
            setAppMenuState(appStore, update)
        }

        if (property === 'showPopup') {
          return (popup: Popup) => {
            if (containsFunction(popup)) {
              appStore.showLocalPopup(popup)
              return Promise.resolve()
            }

            return rpc.invoke(property, [popup])
          }
        }

        if (property === 'closePopup') {
          return (popupType?: PopupType) => {
            if (
              popupType === undefined ||
              popupType === PopupType.MultiCommitOperation
            ) {
              appStore.clearMultiCommitProgressAbortConfirmation()
            }

            return appStore.closeLocalPopup(popupType)
              ? Promise.resolve()
              : rpc.invoke(property, popupType === undefined ? [] : [popupType])
          }
        }

        if (property === 'closePopupById') {
          return (popupId: number) =>
            appStore.closeLocalPopupById(popupId)
              ? Promise.resolve()
              : rpc.invoke(property, [popupId])
        }

        if (property === 'setMultiCommitOperationStep') {
          return (repository: Repository, step: { kind?: unknown }) => {
            if (
              step.kind === MultiCommitOperationStepKind.ConfirmAbortProgress
            ) {
              appStore.beginMultiCommitProgressAbortConfirmation(repository)
            } else {
              appStore.clearMultiCommitProgressAbortConfirmation(repository)
            }

            return rpc.invoke(property, [repository, step])
          }
        }

        if (property === 'initializeMultiCommitOperation') {
          return (repository: Repository, ...params: ReadonlyArray<unknown>) => {
            appStore.clearMultiCommitProgressAbortConfirmation(repository)
            return rpc.invoke(property, [repository, ...params])
          }
        }

        if (property === 'endMultiCommitOperation') {
          return (repository: Repository) => {
            appStore.clearMultiCommitProgressAbortConfirmation(repository)
            return rpc.invoke(property, [repository])
          }
        }

        if (property === 'executeMenuItem') {
          return (item: ExecutableMenuItem) => {
            executeMenuItem(item)
            return Promise.resolve()
          }
        }

        if (property === 'executeMenuItemById') {
          return (id: string) => {
            executeMenuItemById(id)
            return Promise.resolve()
          }
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

function openURLInNewTab(url: string): boolean {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  anchor.style.display = 'none'

  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  return true
}

function containsFunction(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value === 'function') {
    return true
  }

  if (value === null || typeof value !== 'object') {
    return false
  }

  if (seen.has(value)) {
    return false
  }

  seen.add(value)

  if (Array.isArray(value)) {
    return value.some(item => containsFunction(item, seen))
  }

  return Object.keys(value).some(key =>
    containsFunction((value as any)[key], seen)
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

function setAppFocusState(
  appStore: RemoteAppStore,
  appIsFocused: boolean,
  rpc?: RemoteRPCClient
) {
  appStore.updateState(state =>
    state.appIsFocused === appIsFocused ? state : { ...state, appIsFocused }
  )
  return rpc?.invoke('setAppFocusState', [appIsFocused]) ?? Promise.resolve()
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
