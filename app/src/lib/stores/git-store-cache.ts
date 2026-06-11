import { GitStore } from './git-store'
import { Repository } from '../../models/repository'
import { IAppShell } from '../app-shell'
import { IStatsStore } from '../stats'

export class GitStoreCache {
  /** GitStores keyed by their local repository identity. */
  private readonly gitStores = new Map<string, GitStore>()

  public constructor(
    private readonly shell: IAppShell,
    private readonly statsStore: IStatsStore,
    private readonly onGitStoreUpdated: (
      repository: Repository,
      gitStore: GitStore
    ) => void,
    private readonly onDidError: (error: Error) => void
  ) {}

  public remove(repository: Repository) {
    const key = this.getKey(repository)
    if (this.gitStores.has(key)) {
      this.gitStores.delete(key)
    }
  }

  public get(repository: Repository): GitStore {
    const key = this.getKey(repository)
    let gitStore = this.gitStores.get(key)
    if (gitStore === undefined) {
      gitStore = new GitStore(repository, this.shell, this.statsStore)
      gitStore.onDidUpdate(() => this.onGitStoreUpdated(repository, gitStore!))
      gitStore.onDidError(error => this.onDidError(error))

      this.gitStores.set(key, gitStore)
    }

    return gitStore
  }

  private getKey(repository: Repository) {
    return `${repository.id}:${repository.path}:${repository.gitDir ?? ''}`
  }
}
