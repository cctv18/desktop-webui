import { getHTMLURL } from './api'
import { Account } from '../models/account'
import { Buffer } from 'buffer'

type AccountProvider = () => Promise<ReadonlyArray<Account>>

let accountProvider: AccountProvider | null = null

export function setWebUIGitCredentialAccountProvider(
  provider: AccountProvider
) {
  accountProvider = provider
}

export async function getWebUIGitCredentialEnvironment(
  remoteUrl: string
): Promise<Record<string, string | undefined>> {
  if (__PROCESS_KIND__ !== 'web-server') {
    return {}
  }

  const parameters = ['credential.helper=']
  const account = await findAccountForRemoteURL(remoteUrl)

  if (account !== null && account.token.length > 0) {
    const origin = new URL(remoteUrl).origin
    const credential = Buffer.from(
      `${account.login}:${account.token}`
    ).toString('base64')
    parameters.push(
      `http.${origin}/.extraheader=Authorization: Basic ${credential}`
    )
  }

  return {
    GIT_CONFIG_PARAMETERS: appendGitConfigParameters(
      process.env.GIT_CONFIG_PARAMETERS ?? '',
      parameters
    ),
  }
}

async function findAccountForRemoteURL(
  remoteUrl: string
): Promise<Account | null> {
  if (accountProvider === null) {
    return null
  }

  let parsedRemote: URL
  try {
    parsedRemote = new URL(remoteUrl)
  } catch {
    return null
  }

  if (parsedRemote.protocol !== 'https:') {
    return null
  }

  const accounts = await accountProvider()
  return (
    accounts.find(account => {
      try {
        return (
          new URL(getHTMLURL(account.endpoint)).origin === parsedRemote.origin
        )
      } catch {
        return false
      }
    }) ?? null
  )
}

function appendGitConfigParameters(
  existing: string,
  parameters: ReadonlyArray<string>
) {
  const additions = parameters.map(quoteGitConfigParameter).join(' ')
  return existing.length > 0 ? `${existing} ${additions}` : additions
}

function quoteGitConfigParameter(parameter: string) {
  if (parameter.includes("'")) {
    throw new Error(`Unsupported Git config parameter value: ${parameter}`)
  }

  return `'${parameter}'`
}
