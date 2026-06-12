import { Emitter, Disposable } from 'event-kit'
import { IAppState } from '../../lib/app-state'
import { Popup, PopupType } from '../../models/popup'
import { RemoteRPCClient } from './remote-rpc'

export class RemoteAppStore {
  private readonly emitter = new Emitter()
  private readonly localPopupIDs = new Set<number>()
  private localPopupCounter = 0
  private localPopups: ReadonlyArray<Popup> = []
  private remoteState: IAppState

  public constructor(
    private state: IAppState,
    private readonly rpc: RemoteRPCClient
  ) {
    this.remoteState = state
  }

  public getState() {
    return this.state
  }

  public setState(state: IAppState) {
    this.remoteState = state
    this.emitState()
  }

  public updateState(update: (state: IAppState) => IAppState) {
    this.remoteState = update(this.remoteState)
    this.emitState()
  }

  public onDidUpdate(fn: (state: IAppState) => void): Disposable {
    return this.emitter.on('did-update', fn)
  }

  public onDidError(fn: (error: Error) => void): Disposable {
    return this.emitter.on('did-error', fn)
  }

  public emitError(error: Error) {
    this.emitter.emit('did-error', error)
  }

  public showLocalPopup(popup: Popup) {
    if (
      popup.type !== PopupType.Error &&
      this.localPopups.some(p => p.type === popup.type)
    ) {
      return
    }

    const id = popup.id ?? --this.localPopupCounter
    const localPopup = { ...popup, id }

    this.localPopupIDs.add(id)
    this.localPopups = this.insertPopupBeforeErrors(localPopup)
    this.emitState()
  }

  public closeLocalPopup(popupType?: PopupType): boolean {
    const currentPopup = this.state.currentPopup
    let didClose = false

    if (popupType === undefined) {
      if (
        currentPopup?.id !== undefined &&
        this.localPopupIDs.has(currentPopup.id)
      ) {
        this.localPopups = this.localPopups.filter(
          popup => popup.id !== currentPopup.id
        )
        this.localPopupIDs.delete(currentPopup.id)
        didClose = true
      }
    } else {
      const remainingPopups = this.localPopups.filter(popup => {
        const shouldClose = popup.type === popupType
        if (shouldClose && popup.id !== undefined) {
          this.localPopupIDs.delete(popup.id)
        }

        return !shouldClose
      })

      didClose = remainingPopups.length !== this.localPopups.length
      this.localPopups = remainingPopups
    }

    if (didClose) {
      this.emitState()
    }

    return didClose
  }

  public closeLocalPopupById(popupId: number): boolean {
    if (!this.localPopupIDs.has(popupId)) {
      return false
    }

    this.localPopups = this.localPopups.filter(popup => popup.id !== popupId)
    this.localPopupIDs.delete(popupId)
    this.emitState()
    return true
  }

  public loadEmoji() {
    return this.rpc.invoke('appStore.loadEmoji')
  }

  private emitState() {
    this.state = this.applyLocalPopups(this.remoteState)
    this.emitter.emit('did-update', this.state)
  }

  private applyLocalPopups(state: IAppState): IAppState {
    if (this.localPopups.length === 0) {
      return state
    }

    const remotePopups = state.allPopups.filter(
      popup => popup.id === undefined || !this.localPopupIDs.has(popup.id)
    )

    const allPopups = this.mergePopupStacks(remotePopups, this.localPopups)

    return {
      ...state,
      allPopups,
      currentPopup: allPopups.at(-1) ?? null,
      errorCount: allPopups.filter(popup => popup.type === PopupType.Error)
        .length,
    }
  }

  private insertPopupBeforeErrors(popup: Popup): ReadonlyArray<Popup> {
    return this.mergePopupStacks(this.localPopups, [popup])
  }

  private mergePopupStacks(
    first: ReadonlyArray<Popup>,
    second: ReadonlyArray<Popup>
  ): ReadonlyArray<Popup> {
    const nonErrorPopups = [...first, ...second].filter(
      popup => popup.type !== PopupType.Error
    )
    const errorPopups = [...first, ...second].filter(
      popup => popup.type === PopupType.Error
    )

    return [...nonErrorPopups, ...errorPopups]
  }
}
