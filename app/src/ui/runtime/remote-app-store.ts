import { Emitter, Disposable } from 'event-kit'
import { IAppState } from '../../lib/app-state'
import { RemoteRPCClient } from './remote-rpc'

export class RemoteAppStore {
  private readonly emitter = new Emitter()

  public constructor(
    private state: IAppState,
    private readonly rpc: RemoteRPCClient
  ) {}

  public getState() {
    return this.state
  }

  public setState(state: IAppState) {
    this.state = state
    this.emitter.emit('did-update', state)
  }

  public updateState(update: (state: IAppState) => IAppState) {
    this.setState(update(this.state))
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

  public loadEmoji() {
    return this.rpc.invoke('appStore.loadEmoji')
  }
}
