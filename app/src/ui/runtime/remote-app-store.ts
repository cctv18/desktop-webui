import { Emitter, Disposable } from 'event-kit'
import {
  IAppState,
  IMultiCommitOperationState,
  SelectionType,
} from '../../lib/app-state'
import { Banner, BannerType } from '../../models/banner'
import {
  ConfirmAbortProgressStep,
  MultiCommitOperationStepKind,
} from '../../models/multi-commit-operation'
import { Popup, PopupType } from '../../models/popup'
import { Repository } from '../../models/repository'
import { RemoteRPCClient } from './remote-rpc'

interface IMultiCommitProgressAbortConfirmation {
  readonly repository: Repository
  readonly popup: Popup
  readonly operationState: IMultiCommitOperationState
  readonly completedOperationCount: number | null
}

export class RemoteAppStore {
  private readonly emitter = new Emitter()
  private readonly localPopupIDs = new Set<number>()
  private localPopupCounter = 0
  private localPopups: ReadonlyArray<Popup> = []
  private remoteState: IAppState
  private multiCommitProgressAbortConfirmation:
    | IMultiCommitProgressAbortConfirmation
    | null = null

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

  public beginMultiCommitProgressAbortConfirmation(repository: Repository) {
    const operationState = this.getSelectedMultiCommitOperationState(
      this.state,
      repository
    )

    if (operationState === null) {
      return
    }

    const popup =
      this.findMultiCommitOperationPopup(this.state, repository) ??
      ({
        id: --this.localPopupCounter,
        type: PopupType.MultiCommitOperation,
        repository,
      } as Popup)

    this.multiCommitProgressAbortConfirmation = {
      repository,
      popup,
      operationState: {
        ...operationState,
        step: getConfirmAbortProgressStep(null),
      },
      completedOperationCount: null,
    }

    this.emitState()
  }

  public clearMultiCommitProgressAbortConfirmation(repository?: Repository) {
    if (
      this.multiCommitProgressAbortConfirmation === null ||
      (repository !== undefined &&
        !repositoriesAreEqual(
          this.multiCommitProgressAbortConfirmation.repository,
          repository
        ))
    ) {
      return
    }

    this.multiCommitProgressAbortConfirmation = null
    this.emitState()
  }

  public loadEmoji() {
    return this.rpc.invoke('appStore.loadEmoji')
  }

  private emitState() {
    this.state = this.applyLocalPopups(
      this.applyMultiCommitProgressAbortConfirmation(this.remoteState)
    )
    this.emitter.emit('did-update', this.state)
  }

  private applyMultiCommitProgressAbortConfirmation(
    state: IAppState
  ): IAppState {
    const confirmation = this.multiCommitProgressAbortConfirmation

    if (confirmation === null) {
      return state
    }

    const selectedState = state.selectedState
    if (
      selectedState === null ||
      selectedState.type !== SelectionType.Repository ||
      !repositoriesAreEqual(selectedState.repository, confirmation.repository)
    ) {
      return state
    }

    const remoteOperationState = selectedState.state.multiCommitOperationState

    if (
      remoteOperationState?.step.kind === MultiCommitOperationStepKind.ChooseBranch
    ) {
      this.multiCommitProgressAbortConfirmation = null
      return state
    }

    const completedUndoAction = getCompletedMultiCommitOperationUndoAction(
      state.currentBanner,
      confirmation.repository
    )
    const completedOperationCount =
      completedUndoAction?.commitsCount ??
      confirmation.completedOperationCount ??
      null
    const operationStateSource =
      remoteOperationState ?? completedUndoAction?.operationState

    if (operationStateSource === undefined || operationStateSource === null) {
      return state
    }

    const operationState: IMultiCommitOperationState = {
      ...operationStateSource,
      step: getConfirmAbortProgressStep(completedOperationCount),
    }

    this.multiCommitProgressAbortConfirmation = {
      ...confirmation,
      operationState,
      completedOperationCount,
    }

    const selectedStateWithConfirmation = {
      ...selectedState,
      state: {
        ...selectedState.state,
        multiCommitOperationState: operationState,
      },
    }

    const popup =
      this.findMultiCommitOperationPopup(state, confirmation.repository) ??
      confirmation.popup
    const allPopups = this.ensurePopup(state.allPopups, popup)

    return {
      ...state,
      selectedState: selectedStateWithConfirmation,
      allPopups,
      currentPopup: allPopups.at(-1) ?? null,
      errorCount: allPopups.filter(p => p.type === PopupType.Error).length,
    }
  }

  private applyLocalPopups(state: IAppState): IAppState {
    if (this.localPopups.length === 0) {
      return state
    }

    const remotePopups = state.allPopups.filter(
      popup => popup.id === undefined || !this.localPopupIDs.has(popup.id)
    )

    const allPopups = this.prioritizeRemoteMultiCommitPopup(
      this.mergePopupStacks(remotePopups, this.localPopups),
      remotePopups
    )

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

  private ensurePopup(
    popups: ReadonlyArray<Popup>,
    popup: Popup
  ): ReadonlyArray<Popup> {
    const existing = popups.find(p => p === popup || p.id === popup.id)

    if (existing !== undefined) {
      return this.prioritizeRemoteMultiCommitPopup(popups, [existing])
    }

    return this.prioritizeRemoteMultiCommitPopup(
      this.mergePopupStacks(popups, [popup]),
      [popup]
    )
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

  private prioritizeRemoteMultiCommitPopup(
    popups: ReadonlyArray<Popup>,
    remotePopups: ReadonlyArray<Popup>
  ): ReadonlyArray<Popup> {
    const remoteMultiCommitPopup = remotePopups.find(
      popup => popup.type === PopupType.MultiCommitOperation
    )

    if (remoteMultiCommitPopup === undefined) {
      return popups
    }

    const remaining = popups.filter(popup => popup !== remoteMultiCommitPopup)
    const nonErrorPopups = remaining.filter(
      popup => popup.type !== PopupType.Error
    )
    const errorPopups = remaining.filter(
      popup => popup.type === PopupType.Error
    )

    return [...nonErrorPopups, remoteMultiCommitPopup, ...errorPopups]
  }

  private getSelectedMultiCommitOperationState(
    state: IAppState,
    repository: Repository
  ): IMultiCommitOperationState | null {
    const selectedState = state.selectedState

    if (
      selectedState === null ||
      selectedState.type !== SelectionType.Repository ||
      !repositoriesAreEqual(selectedState.repository, repository)
    ) {
      return null
    }

    return selectedState.state.multiCommitOperationState
  }

  private findMultiCommitOperationPopup(
    state: IAppState,
    repository: Repository
  ): Popup | null {
    return (
      state.allPopups.find(
        popup =>
          popup.type === PopupType.MultiCommitOperation &&
          repositoriesAreEqual(popup.repository, repository)
      ) ?? null
    )
  }
}

function getCompletedMultiCommitOperationUndoAction(
  banner: Banner | null | undefined,
  repository: Repository
) {
  if (
    banner == null ||
    (banner.type !== BannerType.SuccessfulCherryPick &&
      banner.type !== BannerType.SuccessfulSquash &&
      banner.type !== BannerType.SuccessfulReorder) ||
    banner.undoAction === undefined ||
    !repositoriesAreEqual(banner.undoAction.repository, repository)
  ) {
    return null
  }

  return banner.undoAction
}

function getConfirmAbortProgressStep(
  completedOperationCount: number | null
): ConfirmAbortProgressStep {
  return {
    kind: MultiCommitOperationStepKind.ConfirmAbortProgress,
    ...(completedOperationCount !== null
      ? { completedOperation: { count: completedOperationCount } }
      : {}),
  }
}

function repositoriesAreEqual(a: Repository, b: Repository): boolean {
  return a.id === b.id || a.path === b.path
}
