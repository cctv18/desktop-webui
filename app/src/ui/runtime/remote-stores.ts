import { Emitter, Disposable } from 'event-kit'
import { IAppState, IRepositoryState, SelectionType } from '../../lib/app-state'
import { getInitialRepositoryState } from '../../lib/stores/repository-state-cache'
import { Repository } from '../../models/repository'
import { RemoteRPCClient } from './remote-rpc'

export class RemoteRepositoryStateCache {
  private readonly repositoryStates = new Map<number, IRepositoryState>()

  public constructor(private readonly getState: () => IAppState) {}

  public get(repository: Repository): IRepositoryState {
    const selectedState = this.getState().selectedState

    if (
      selectedState !== null &&
      selectedState.type === SelectionType.Repository &&
      selectedState.repository.id === repository.id
    ) {
      this.repositoryStates.set(repository.id, selectedState.state)
      return selectedState.state
    }

    const cachedState = this.repositoryStates.get(repository.id)
    return cachedState ?? getInitialRepositoryState()
  }
}

export class RemoteMethodStore {
  private readonly emitter = new Emitter()

  public constructor(
    private readonly rpc: RemoteRPCClient,
    private readonly prefix: string
  ) {
    return new Proxy(this, {
      get: (target, property, receiver) => {
        if (property in target) {
          return Reflect.get(target, property, receiver)
        }

        if (typeof property !== 'string') {
          return undefined
        }

        return (...params: ReadonlyArray<unknown>) =>
          this.rpc.invoke(`${this.prefix}.${property}`, params)
      },
    })
  }

  public onDidUpdate(fn: (...args: ReadonlyArray<unknown>) => void): Disposable {
    return this.emitter.on('did-update', fn)
  }

  public onDidError(fn: (error: Error) => void): Disposable {
    return this.emitter.on('did-error', fn)
  }
}
