import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { Account } from '../../src/models/account'
import { AccountsStore } from '../../src/lib/stores'
import { InMemoryStore, AsyncInMemoryStore } from '../helpers/stores'

describe('AccountsStore', () => {
  let accountsStore: AccountsStore

  beforeEach(() => {
    accountsStore = new AccountsStore(
      new InMemoryStore(),
      new AsyncInMemoryStore()
    )
  })

  describe('adding a new user', () => {
    it('contains the added user', async () => {
      const newAccountLogin = 'joan'
      await accountsStore.addAccount(
        new Account(newAccountLogin, '', 'deadbeef', [], '', 1, '', 'free')
      )

      const users = await accountsStore.getAll()
      assert.equal(users[0].login, newAccountLogin)
    })
  })

  describe('Copilot OAuth credentials', () => {
    it('stores and retrieves credentials for the matching account', async () => {
      const account = new Account(
        'joan',
        'https://api.github.com',
        'webui-token',
        [],
        'avatar',
        1,
        'Joan',
        'free'
      )
      await accountsStore.addAccount(account)
      await accountsStore.setCopilotOAuthCredentials(account, {
        endpoint: account.endpoint,
        login: account.login,
        id: account.id,
        name: account.name,
        avatarURL: account.avatarURL,
        token: 'copilot-token',
      })

      const credentials =
        await accountsStore.getCopilotOAuthCredentialsForAccount(account)

      assert.equal(credentials?.token, 'copilot-token')
      assert.equal(credentials?.login, 'joan')
    })

    it('ignores credentials that belong to another account on the endpoint', async () => {
      const account = new Account(
        'joan',
        'https://api.github.com',
        'webui-token',
        [],
        'avatar',
        1,
        'Joan',
        'free'
      )
      const otherAccount = new Account(
        'mona',
        'https://api.github.com',
        'other-token',
        [],
        'avatar',
        2,
        'Mona',
        'free'
      )
      await accountsStore.addAccount(otherAccount)
      await accountsStore.setCopilotOAuthCredentials(otherAccount, {
        endpoint: otherAccount.endpoint,
        login: otherAccount.login,
        id: otherAccount.id,
        name: otherAccount.name,
        avatarURL: otherAccount.avatarURL,
        token: 'other-copilot-token',
      })

      const credentials =
        await accountsStore.getCopilotOAuthCredentialsForAccount(account)

      assert.equal(credentials, null)
    })
  })

  describe('loading persisted users', () => {
    it('migrates .ghe.com users still using /api/v3 to api. subdomain', async () => {
      const dataStore = new InMemoryStore()
      dataStore.setItem(
        'users',
        JSON.stringify([
          {
            login: 'joan',
            endpoint: 'https://whatever.ghe.com/api/v3',
            token: 'deadbeef',
            emails: [],
            avatarURL: '',
            id: 1,
            name: '',
            plan: 'free',
          },
        ])
      )
      accountsStore = new AccountsStore(dataStore, new AsyncInMemoryStore())

      const users = await accountsStore.getAll()
      assert.equal(users[0].login, 'joan')
      assert.equal(users[0].endpoint, 'https://api.whatever.ghe.com/')

      const persistedUsers = JSON.parse(dataStore.getItem('users'))
      assert.equal(persistedUsers[0].login, 'joan')
      assert.equal(persistedUsers[0].endpoint, 'https://api.whatever.ghe.com/')
    })

    it('does NOT migrate GHE users already using the api. subdomain', async () => {
      const dataStore = new InMemoryStore()
      dataStore.setItem(
        'users',
        JSON.stringify([
          {
            login: 'joan',
            endpoint: 'https://api.whatever.ghe.com/',
            token: 'deadbeef',
            emails: [],
            avatarURL: '',
            id: 1,
            name: '',
            plan: 'free',
          },
        ])
      )
      accountsStore = new AccountsStore(dataStore, new AsyncInMemoryStore())

      const users = await accountsStore.getAll()
      assert.equal(users[0].login, 'joan')
      assert.equal(users[0].endpoint, 'https://api.whatever.ghe.com/')

      const persistedUsers = JSON.parse(dataStore.getItem('users'))
      assert.equal(persistedUsers[0].login, 'joan')
      assert.equal(persistedUsers[0].endpoint, 'https://api.whatever.ghe.com/')
    })

    it('does NOT migrate GHES users still using /api/v3 to api. subdomain', async () => {
      const dataStore = new InMemoryStore()
      dataStore.setItem(
        'users',
        JSON.stringify([
          {
            login: 'joan',
            endpoint: 'https://my-company-repos.com/api/v3',
            token: 'deadbeef',
            emails: [],
            avatarURL: '',
            id: 1,
            name: '',
            plan: 'free',
          },
        ])
      )
      accountsStore = new AccountsStore(dataStore, new AsyncInMemoryStore())

      const users = await accountsStore.getAll()
      assert.equal(users[0].login, 'joan')
      assert.equal(users[0].endpoint, 'https://my-company-repos.com/api/v3')

      const persistedUsers = JSON.parse(dataStore.getItem('users'))
      assert.equal(persistedUsers[0].login, 'joan')
      assert.equal(
        persistedUsers[0].endpoint,
        'https://my-company-repos.com/api/v3'
      )
    })
  })
})
