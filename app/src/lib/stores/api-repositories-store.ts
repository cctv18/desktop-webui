import { BaseStore } from './base-store'
import { AccountsStore } from './accounts-store'
import { IAPIRepository, API, getHTMLURL } from '../api'
import { Account, accountEquals } from '../../models/account'
import { merge } from '../merge'

function accountEndpointKey(account: Account) {
  try {
    return new URL(getHTMLURL(account.endpoint)).origin
  } catch {
    return account.endpoint
  }
}

function accountMatchesRepositoryState(x: Account, y: Account) {
  if (accountEquals(x, y)) {
    return true
  }

  if (accountEndpointKey(x) !== accountEndpointKey(y)) {
    return false
  }

  return (
    (x.id > 0 && x.id === y.id) || (x.login !== '' && x.login === y.login)
  )
}

const MaxRepositoryLoadRetries = __PROCESS_KIND__ === 'web-server' ? 2 : 0
const RepositoryLoadRetryDelayMs = 1500
const RepositoryLoadRequestTimeoutMs =
  __PROCESS_KIND__ === 'web-server' ? 30_000 : 0

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }

  const value = error as {
    readonly code?: unknown
    readonly cause?: { readonly code?: unknown }
  }
  const code = value.code ?? value.cause?.code

  return typeof code === 'string' ? code : undefined
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : `${error}`
}

function isTransientRepositoryLoadError(error: unknown): boolean {
  const code = getErrorCode(error)

  if (
    code === 'EPIPE' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_SOCKET'
  ) {
    return true
  }

  const message = getErrorMessage(error).toLowerCase()
  return (
    message.includes('fetch failed') ||
    message.includes('aborted') ||
    message.includes('socket') ||
    message.includes('timed out')
  )
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function withRepositoryLoadTimeout<T>(
  promise: Promise<T>,
  description: string
): Promise<T> {
  if (RepositoryLoadRequestTimeoutMs <= 0) {
    return promise
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `${description} timed out after ${RepositoryLoadRequestTimeoutMs}ms`
          )
        ),
      RepositoryLoadRequestTimeoutMs
    )

    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/**
 * Attempt to look up an existing account in the account state map based on
 * endpoint plus user id, falling back to endpoint plus login for WebUI account
 * instances restored across the server/client boundary.
 *
 * The purpose of this method is to ensure that we're using the
 * most recent Account instance during our asynchronous refresh
 * operations. While we're refreshing the list of repositories
 * that a user has explicit permissions to access it's possible
 * that the accounts store will emit updated account instances
 * (for example updating the user real name, or the list of
 * email addresses associated with an account) and in order to
 * guarantee reference equality with the accounts emitted by
 * the accounts store we need to ensure we're in sync.
 *
 * If no match is found the provided account is returned.
 */
function resolveAccount(
  account: Account,
  accountState: ReadonlyMap<Account, IAccountRepositories>
) {
  // The set uses reference equality so if we find our
  // account instance in the set there's no need to look
  // any further.
  if (accountState.has(account)) {
    return account
  }

  // If we can't find our account instance in the set one
  // of two things have happened. Either the account has
  // been removed (by the user explicitly signing out) or
  // the accounts store has refreshed the account details
  // from the API and as such the reference equality no
  // longer holds. In the latter case we attempt to
  // find the updated account instance by comparing it to the provided account.
  for (const existingAccount of accountState.keys()) {
    if (accountMatchesRepositoryState(existingAccount, account)) {
      return existingAccount
    }
  }

  // If we can't find a matching account it's likely
  // that it's the first time we're loading the list
  // of repositories for this account so we return
  // whatever was provided to us such that it may be
  // inserted into the set as a new entry.
  return account
}

/**
 * An interface describing the current state of
 * repositories that a particular account has explicit
 * permissions to access and whether or not the list of
 * repositories is being loaded or refreshed.
 *
 * This main purpose of this interface is to describe
 * the state necessary to render a list of cloneable
 * repositories.
 */
export interface IAccountRepositories {
  /**
   * The list of repositories that a particular account
   * has explicit permissions to access.
   */
  readonly repositories: ReadonlyArray<IAPIRepository>

  /**
   * Whether or not the list of repositories is currently
   * being loaded for the first time or refreshed.
   */
  readonly loading: boolean
}

/**
 * A store responsible for providing lists of repositories
 * that the currently signed in user(s) have explicit access
 * to. It's primary purpose is to serve state required for
 * the application to present a list of cloneable repositories
 * for a particular user.
 */
export class ApiRepositoriesStore extends BaseStore {
  /**
   * The main internal state of the store. Note that
   * all state in this store should be treated as immutable such
   * that consumers can use reference equality to determine whether
   * state has actually changed or not.
   */
  private accountState: ReadonlyMap<Account, IAccountRepositories> = new Map<
    Account,
    IAccountRepositories
  >()

  public constructor(accountsStore: AccountsStore) {
    super()
    accountsStore.onDidUpdate(this.onAccountsChanged)
  }

  /**
   * Called whenever the accounts store emits an update which
   * usually means that a new account was added or an account
   * was removed due to sign out but it could also mean that
   * the account data has been updated. It's crucial that
   * the ApiRepositories store match (through reference
   * equality) the accounts in the accounts store and this
   * method therefore attempts to merge its internal state
   * with the new accounts.
   */
  private onAccountsChanged = (accounts: ReadonlyArray<Account>) => {
    const newState = new Map<Account, IAccountRepositories>()
    const accountsToLoad = new Array<Account>()

    for (const account of accounts) {
      let foundExistingState = false

      for (const [key, value] of this.accountState.entries()) {
        // Check to see whether the accounts store only emitted an
        // updated Account for the same login and endpoint meaning
        // that we don't need to discard our cached data.
        if (accountMatchesRepositoryState(key, account)) {
          newState.set(account, value)
          foundExistingState = true
          break
        }
      }

      if (!foundExistingState) {
        accountsToLoad.push(account)
      }
    }

    this.accountState = newState
    this.emitUpdate()

    for (const account of accountsToLoad) {
      void this.loadRepositories(account)
    }
  }

  private updateAccount<K extends keyof IAccountRepositories>(
    account: Account,
    repositories: Pick<IAccountRepositories, K>
  ) {
    const newState = new Map<Account, IAccountRepositories>(this.accountState)

    // The account instance might have changed between the refresh and
    // the update so we'll need to look it up by endpoint and user id.
    // If we can't find it we're likely being asked to insert info for
    // an account for the first time.
    const newOrExistingAccount = resolveAccount(account, newState)
    const existingRepositories = newState.get(newOrExistingAccount)

    const newRepositories =
      existingRepositories === undefined
        ? merge({ loading: false, repositories: [] }, repositories)
        : merge(existingRepositories, repositories)

    newState.set(newOrExistingAccount, newRepositories)

    this.accountState = newState
    this.emitUpdate()
  }

  private getAccountState(account: Account) {
    return this.accountState.get(resolveAccount(account, this.accountState))
  }

  /**
   * Request that the store loads the list of repositories that
   * the provided account has explicit permissions to access.
   */
  public async loadRepositories(
    account: Account,
    retryAttempt = 0
  ): Promise<void> {
    const currentState = this.getAccountState(account)

    if (currentState?.loading && retryAttempt === 0) {
      log.info(
        `[ApiRepositoriesStore] repository list refresh for ${account.login} is already in progress`
      )
      return
    }

    log.info(
      `[ApiRepositoriesStore] loading repositories for ${account.login} from ${account.friendlyEndpoint}`
    )

    this.updateAccount(account, { loading: true })

    // We don't want to throw away the existing list of repositories if we're
    // refreshing the list of repositories but we'll need to keep track of
    // whether any repositories got deleted on the host so that we can remove
    // them from our local state. We start out by adding all the repositories
    // that we've seen up until this point to a map and then we'll remove them
    // one by one as we load the fresh list from the API. Any repositories
    // remaining in the map once we're done loading we can assume have been
    // deleted on the host.
    const missing = new Map<string, IAPIRepository>()
    const repositories = new Map<string, IAPIRepository>()
    let receivedRepositoryPage = false

    currentState?.repositories.forEach(r => {
      missing.set(r.clone_url, r)
      repositories.set(r.clone_url, r)
    })

    const addPage = (page: ReadonlyArray<IAPIRepository>) => {
      receivedRepositoryPage = true
      page.forEach(r => {
        repositories.set(r.clone_url, r)
        missing.delete(r.clone_url)
      })
      log.info(
        `[ApiRepositoriesStore] loaded ${page.length} repositories for ${account.login}; total ${repositories.size}`
      )
      this.updateAccount(account, { repositories: [...repositories.values()] })
    }

    const api = API.fromAccount(resolveAccount(account, this.accountState))

    try {
      const loadByAffiliation = async () => {
        const affiliations = [
          'owner',
          'collaborator',
          'organization_member',
        ] as const

        let loadedAny = false

        for (const affiliation of affiliations) {
          const countBefore = repositories.size

          try {
            await withRepositoryLoadTimeout(
              api.streamUserRepositories(addPage, affiliation),
              `Repository listing for ${account.login} (${affiliation})`
            )
            loadedAny = loadedAny || repositories.size > countBefore
          } catch (error) {
            const loadError =
              error instanceof Error
                ? error
                : new Error(
                    `Failed loading ${affiliation} repositories for ${account.login}`
                  )
            log.warn(
              `Failed loading ${affiliation} repositories for ${account.login}`,
              loadError
            )
          }
        }

        return loadedAny
      }

      let primaryError: Error | null = null

      // The vast majority of users have few repositories and no org affiliations.
      // We'll start by making one request to load all repositories available to
      // the user regardless of affiliation and only if that request isn't enough
      // to load all repositories will we divvy up the requests and load
      // repositories by owner and collaborator+org affiliation separately. This
      // way we can avoid making unnecessary requests to the API for the majority
      // of users while still improving the user experience for those users who
      // have access to a lot of repositories and orgs.
      try {
        await withRepositoryLoadTimeout(
          api.streamUserRepositories(addPage, undefined, {
            async continue() {
              // If the continue callback is called we know that the first
              // request wasn't enough to load all repositories.
              await loadByAffiliation()

              // Don't load more than one page in the initial stream request.
              return false
            },
          }),
          `Primary repository listing for ${account.login}`
        )
      } catch (error) {
        primaryError =
          error instanceof Error
            ? error
            : new Error(`Failed loading repositories for ${account.login}`)

        log.warn(
          `Primary repository listing failed for ${account.login}; trying affiliation fallback`,
          primaryError
        )

        await loadByAffiliation()
      }

      if (primaryError === null && repositories.size === 0) {
        await loadByAffiliation()
      }

      if (
        primaryError !== null &&
        (!receivedRepositoryPage || repositories.size === 0)
      ) {
        throw primaryError
      }

      if (receivedRepositoryPage && missing.size) {
        missing.forEach((_, clone_url) => repositories.delete(clone_url))
        this.updateAccount(account, {
          repositories: [...repositories.values()],
        })
      }
    } catch (error) {
      const loadError =
        error instanceof Error
          ? error
          : new Error(`Failed loading repositories for ${account.login}`)

      if (
        retryAttempt < MaxRepositoryLoadRetries &&
        repositories.size === 0 &&
        isTransientRepositoryLoadError(loadError)
      ) {
        log.warn(
          `[ApiRepositoriesStore] retrying repository list refresh for ${account.login} after transient failure (${retryAttempt + 1}/${MaxRepositoryLoadRetries})`,
          loadError
        )
        await delay(RepositoryLoadRetryDelayMs)
        return await this.loadRepositories(account, retryAttempt + 1)
      }

      log.error(`Failed loading repositories for ${account.login}`, loadError)
      this.emitError(loadError)
    } finally {
      log.info(
        `[ApiRepositoriesStore] finished loading repositories for ${account.login}; received=${receivedRepositoryPage}; total=${repositories.size}`
      )
      this.updateAccount(account, { loading: false })
    }
  }

  public getState(): ReadonlyMap<Account, IAccountRepositories> {
    return this.accountState
  }
}
