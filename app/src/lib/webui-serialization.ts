import { Account } from '../models/account'
import { Branch } from '../models/branch'
import { CloningRepository } from '../models/cloning-repository'
import { Commit } from '../models/commit'
import { CommitIdentity } from '../models/commit-identity'
import { DiffSelection } from '../models/diff'
import { GitHubRepository } from '../models/github-repository'
import { Image as DesktopImage } from '../models/diff/image'
import { Owner } from '../models/owner'
import { PullRequest, PullRequestRef } from '../models/pull-request'
import { Repository } from '../models/repository'
import {
  CommittedFileChange,
  WorkingDirectoryFileChange,
  WorkingDirectoryStatus,
} from '../models/status'

const WebTypeKey = '__gitdeskWebType'

type SerializedObject = {
  readonly [WebTypeKey]: string
  readonly [key: string]: unknown
}

/**
 * Convert Desktop runtime values into JSON-safe payloads while preserving the
 * model identity needed by the existing React UI after transport.
 */
export function serializeForWeb<T>(value: T): unknown {
  return serializeValue(value, new WeakSet<object>())
}

/**
 * Rebuild JSON payloads from the WebUI transport back into Desktop model
 * instances and native containers.
 */
export function reviveFromWeb<T = unknown>(value: unknown): T {
  return reviveValue(value) as T
}

function serializeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null) {
    return null
  }

  if (value === undefined) {
    return tag('Undefined')
  }

  if (typeof value === 'function') {
    return tag('Function')
  }

  if (typeof value !== 'object') {
    return value
  }

  if (value instanceof Date) {
    return tag('Date', { value: value.toISOString() })
  }

  if (value instanceof Map) {
    return tag('Map', {
      entries: Array.from(value.entries()).map(([key, entryValue]) => [
        serializeValue(key, seen),
        serializeValue(entryValue, seen),
      ]),
    })
  }

  if (value instanceof Set) {
    return tag('Set', {
      values: Array.from(value.values()).map(item => serializeValue(item, seen)),
    })
  }

  if (isArrayBufferLike(value)) {
    return tag('ArrayBuffer', {
      data: base64FromBytes(new Uint8Array(value as ArrayBufferLike)),
    })
  }

  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView
    return tag('TypedArray', {
      name: view.constructor.name,
      data: base64FromBytes(
        new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
      ),
    })
  }

  if (value instanceof Account) {
    return serializeAccount(value)
  }

  if (value instanceof Branch) {
    return tag('Branch', {
      name: value.name,
      upstream: value.upstream,
      tip: serializeValue(value.tip, seen),
      type: value.type,
      ref: value.ref,
    })
  }

  if (value instanceof CloningRepository) {
    return tag('CloningRepository', {
      id: value.id,
      path: value.path,
      url: value.url,
    })
  }

  if (value instanceof Commit) {
    return tag('Commit', {
      sha: value.sha,
      shortSha: value.shortSha,
      summary: value.summary,
      body: value.body,
      author: serializeValue(value.author, seen),
      committer: serializeValue(value.committer, seen),
      parentSHAs: serializeValue(value.parentSHAs, seen),
      trailers: serializeValue(value.trailers, seen),
      tags: serializeValue(value.tags, seen),
    })
  }

  if (value instanceof CommitIdentity) {
    return tag('CommitIdentity', {
      name: value.name,
      email: value.email,
      date: serializeValue(value.date, seen),
      tzOffset: value.tzOffset,
    })
  }

  if (value instanceof CommittedFileChange) {
    return tag('CommittedFileChange', {
      path: value.path,
      status: serializeValue(value.status, seen),
      commitish: value.commitish,
      parentCommitish: value.parentCommitish,
    })
  }

  if (value instanceof DesktopImage) {
    return tag('Image', {
      rawContents: serializeValue(value.rawContents, seen),
      contents: value.contents,
      mediaType: value.mediaType,
      bytes: value.bytes,
    })
  }

  if (value instanceof DiffSelection) {
    const raw = value as any
    return tag('DiffSelection', {
      defaultSelectionType: raw.defaultSelectionType,
      divergingLines:
        raw.divergingLines instanceof Set
          ? Array.from(raw.divergingLines.values())
          : null,
      selectableLines:
        raw.selectableLines instanceof Set
          ? Array.from(raw.selectableLines.values())
          : null,
    })
  }

  if (value instanceof GitHubRepository) {
    return tag('GitHubRepository', {
      name: value.name,
      owner: serializeValue(value.owner, seen),
      dbID: value.dbID,
      isPrivate: value.isPrivate,
      htmlURL: value.htmlURL,
      cloneURL: value.cloneURL,
      issuesEnabled: value.issuesEnabled,
      isArchived: value.isArchived,
      permissions: value.permissions,
      parent: serializeValue(value.parent, seen),
    })
  }

  if (value instanceof Owner) {
    return tag('Owner', {
      login: value.login,
      endpoint: value.endpoint,
      id: value.id,
      type: value.type,
    })
  }

  if (value instanceof PullRequest) {
    return tag('PullRequest', {
      created: serializeValue(value.created, seen),
      title: value.title,
      pullRequestNumber: value.pullRequestNumber,
      head: serializeValue(value.head, seen),
      base: serializeValue(value.base, seen),
      author: value.author,
      draft: value.draft,
      body: value.body,
    })
  }

  if (value instanceof PullRequestRef) {
    return tag('PullRequestRef', {
      ref: value.ref,
      sha: value.sha,
      gitHubRepository: serializeValue(value.gitHubRepository, seen),
    })
  }

  if (value instanceof Repository) {
    return tag('Repository', {
      path: value.path,
      id: value.id,
      gitHubRepository: serializeValue(value.gitHubRepository, seen),
      missing: value.missing,
      alias: value.alias,
      workflowPreferences: serializeValue(value.workflowPreferences, seen),
      isTutorialRepository: value.isTutorialRepository,
      gitDir: value.gitDir,
    })
  }

  if (value instanceof WorkingDirectoryFileChange) {
    return tag('WorkingDirectoryFileChange', {
      path: value.path,
      status: serializeValue(value.status, seen),
      selection: serializeValue(value.selection, seen),
    })
  }

  if (value instanceof WorkingDirectoryStatus) {
    return tag('WorkingDirectoryStatus', {
      files: serializeValue(value.files, seen),
      includeAll: value.includeAll,
    })
  }

  if (value instanceof Error) {
    return tag('Error', {
      name: value.name,
      message: value.message,
      stack: value.stack,
    })
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return tag('Circular')
    }

    seen.add(value)
    const result = value.map(item => serializeValue(item, seen))
    seen.delete(value)
    return result
  }

  if (seen.has(value)) {
    return tag('Circular')
  }

  seen.add(value)
  const result: Record<string, unknown> = {}

  for (const key of Object.keys(value)) {
    result[key] = serializeValue((value as any)[key], seen)
  }

  seen.delete(value)
  return result
}

function reviveValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(reviveValue)
  }

  if (isTagged(value)) {
    switch (value[WebTypeKey]) {
      case 'Undefined':
        return undefined
      case 'Function':
        return () => undefined
      case 'Circular':
        return null
      case 'Date':
        return new Date(value.value as string)
      case 'Map':
        return new Map(
          ((value.entries as ReadonlyArray<ReadonlyArray<unknown>>) ?? []).map(
            ([key, entryValue]) => [reviveValue(key), reviveValue(entryValue)]
          )
        )
      case 'Set':
        return new Set(
          ((value.values as ReadonlyArray<unknown>) ?? []).map(reviveValue)
        )
      case 'ArrayBuffer':
        return arrayBufferFromBase64((value.data as string) ?? '')
      case 'TypedArray':
        return bytesFromBase64((value.data as string) ?? '')
      case 'Account':
        return new Account(
          reviveString(value.login),
          reviveString(value.endpoint),
          '',
          reviveValue(value.emails) as any,
          reviveString(value.avatarURL),
          reviveNumber(value.id),
          reviveString(value.name),
          value.plan as any,
          value.copilotEndpoint as any,
          value.isCopilotDesktopEnabled as any,
          reviveValue(value.features) as any
        )
      case 'Branch':
        return new Branch(
          reviveString(value.name),
          reviveNullableString(value.upstream),
          reviveValue(value.tip) as any,
          reviveNumber(value.type),
          reviveString(value.ref)
        )
      case 'CloningRepository': {
        const repository = new CloningRepository(
          reviveString(value.path),
          reviveString(value.url)
        )
        ;(repository as any).id = reviveNumber(value.id)
        return repository
      }
      case 'Commit':
        return new Commit(
          reviveString(value.sha),
          reviveString(value.shortSha),
          reviveString(value.summary),
          reviveString(value.body),
          reviveValue(value.author) as CommitIdentity,
          reviveValue(value.committer) as CommitIdentity,
          reviveValue(value.parentSHAs) as ReadonlyArray<string>,
          reviveValue(value.trailers) as any,
          reviveValue(value.tags) as ReadonlyArray<string>
        )
      case 'CommitIdentity':
        return new CommitIdentity(
          reviveString(value.name),
          reviveString(value.email),
          reviveValue(value.date) as Date,
          reviveNumber(value.tzOffset)
        )
      case 'CommittedFileChange':
        return new CommittedFileChange(
          reviveString(value.path),
          reviveValue(value.status) as any,
          reviveString(value.commitish),
          reviveString(value.parentCommitish)
        )
      case 'DiffSelection':
        return reviveDiffSelection(value)
      case 'Error': {
        const error = new Error(reviveString(value.message))
        error.name = reviveString(value.name) || 'Error'
        error.stack = value.stack as string | undefined
        return error
      }
      case 'GitHubRepository':
        return new GitHubRepository(
          reviveString(value.name),
          reviveValue(value.owner) as Owner,
          reviveNumber(value.dbID),
          value.isPrivate as any,
          value.htmlURL as any,
          value.cloneURL as any,
          value.issuesEnabled as any,
          value.isArchived as any,
          value.permissions as any,
          reviveValue(value.parent) as GitHubRepository | null
        )
      case 'Image':
        return new DesktopImage(
          (reviveValue(value.rawContents) as ArrayBufferLike) ??
            new ArrayBuffer(0),
          reviveString(value.contents),
          reviveString(value.mediaType),
          reviveNumber(value.bytes)
        )
      case 'Owner':
        return new Owner(
          reviveString(value.login),
          reviveString(value.endpoint),
          reviveNumber(value.id),
          value.type as any
        )
      case 'PullRequest':
        return new PullRequest(
          reviveValue(value.created) as Date,
          reviveString(value.title),
          reviveNumber(value.pullRequestNumber),
          reviveValue(value.head) as PullRequestRef,
          reviveValue(value.base) as PullRequestRef,
          reviveString(value.author),
          Boolean(value.draft),
          reviveString(value.body)
        )
      case 'PullRequestRef':
        return new PullRequestRef(
          reviveString(value.ref),
          reviveString(value.sha),
          reviveValue(value.gitHubRepository) as GitHubRepository
        )
      case 'Repository':
        return new Repository(
          reviveString(value.path),
          reviveNumber(value.id),
          reviveValue(value.gitHubRepository) as GitHubRepository | null,
          Boolean(value.missing),
          value.alias === null ? null : reviveString(value.alias),
          reviveValue(value.workflowPreferences) as any,
          Boolean(value.isTutorialRepository),
          value.gitDir === undefined
            ? undefined
            : reviveString(value.gitDir)
        )
      case 'WorkingDirectoryFileChange':
        return new WorkingDirectoryFileChange(
          reviveString(value.path),
          reviveValue(value.status) as any,
          reviveValue(value.selection) as DiffSelection
        )
      case 'WorkingDirectoryStatus':
        return new (WorkingDirectoryStatus as any)(
          reviveValue(value.files) as ReadonlyArray<WorkingDirectoryFileChange>,
          value.includeAll as boolean | null
        )
    }
  }

  const result: Record<string, unknown> = {}

  for (const key of Object.keys(value)) {
    result[key] = reviveValue((value as any)[key])
  }

  return result
}

function serializeAccount(account: Account) {
  return tag('Account', {
    login: account.login,
    endpoint: account.endpoint,
    token: '',
    emails: serializeValue(account.emails, new WeakSet<object>()),
    avatarURL: account.avatarURL,
    id: account.id,
    name: account.name,
    plan: account.plan,
    copilotEndpoint: account.copilotEndpoint,
    isCopilotDesktopEnabled: account.isCopilotDesktopEnabled,
    features: serializeValue(account.features, new WeakSet<object>()),
  })
}

function reviveDiffSelection(value: SerializedObject): DiffSelection {
  const selection = Object.create(DiffSelection.prototype)
  Object.assign(selection, {
    defaultSelectionType: value.defaultSelectionType,
    divergingLines: Array.isArray(value.divergingLines)
      ? new Set(value.divergingLines as ReadonlyArray<number>)
      : null,
    selectableLines: Array.isArray(value.selectableLines)
      ? new Set(value.selectableLines as ReadonlyArray<number>)
      : null,
  })
  return selection
}

function tag(type: string, value: Record<string, unknown> = {}) {
  return { [WebTypeKey]: type, ...value }
}

function isTagged(value: object): value is SerializedObject {
  return (
    Object.prototype.hasOwnProperty.call(value, WebTypeKey) &&
    typeof (value as any)[WebTypeKey] === 'string'
  )
}

function reviveString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function reviveNullableString(value: unknown): string | null {
  return value === null ? null : reviveString(value)
}

function reviveNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

function isArrayBufferLike(value: object): boolean {
  return (
    value instanceof ArrayBuffer ||
    Object.prototype.toString.call(value) === '[object SharedArrayBuffer]'
  )
}

function base64FromBytes(bytes: Uint8Array): string {
  const bufferCtor = (globalThis as any).Buffer
  if (bufferCtor) {
    return bufferCtor.from(bytes).toString('base64')
  }

  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }

  return btoa(binary)
}

function bytesFromBase64(value: string): Uint8Array {
  const bufferCtor = (globalThis as any).Buffer
  if (bufferCtor) {
    return new Uint8Array(bufferCtor.from(value, 'base64'))
  }

  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

function arrayBufferFromBase64(value: string): ArrayBuffer {
  const bytes = bytesFromBase64(value)
  const buffer = new ArrayBuffer(bytes.length)
  new Uint8Array(buffer).set(bytes)
  return buffer
}
