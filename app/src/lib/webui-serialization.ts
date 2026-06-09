import { Account } from '../models/account'
import { Branch } from '../models/branch'
import { CloningRepository } from '../models/cloning-repository'
import { Commit } from '../models/commit'
import { CommitIdentity } from '../models/commit-identity'
import {
  DiffHunk,
  DiffHunkHeader,
  DiffLine,
  DiffSelection,
} from '../models/diff'
import { GitHubRepository } from '../models/github-repository'
import { Image as DesktopImage } from '../models/diff/image'
import { Owner } from '../models/owner'
import { PullRequest, PullRequestRef } from '../models/pull-request'
import { Repository } from '../models/repository'
import {
  RepoRuleEnforced,
  RepoRulesInfo,
  RepoRulesMetadataFailure,
  RepoRulesMetadataFailures,
  RepoRulesMetadataRules,
} from '../models/repo-rules'
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

type ReviveContext = {
  readonly accounts: Map<string, Account>
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
  return reviveValue(value, { accounts: new Map() }) as T
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

  if (value instanceof DiffLine) {
    return tag('DiffLine', {
      text: value.text,
      type: value.type,
      originalLineNumber: value.originalLineNumber,
      oldLineNumber: value.oldLineNumber,
      newLineNumber: value.newLineNumber,
      noTrailingNewLine: value.noTrailingNewLine,
    })
  }

  if (value instanceof DiffHunk) {
    return tag('DiffHunk', {
      header: serializeValue(value.header, seen),
      lines: serializeValue(value.lines, seen),
      unifiedDiffStart: value.unifiedDiffStart,
      unifiedDiffEnd: value.unifiedDiffEnd,
      expansionType: value.expansionType,
    })
  }

  if (value instanceof DiffHunkHeader) {
    return tag('DiffHunkHeader', {
      oldStartLine: value.oldStartLine,
      oldLineCount: value.oldLineCount,
      newStartLine: value.newStartLine,
      newLineCount: value.newLineCount,
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

  if (value instanceof RepoRulesInfo) {
    return tag('RepoRulesInfo', {
      basicCommitWarning: value.basicCommitWarning,
      creationRestricted: value.creationRestricted,
      signedCommitsRequired: value.signedCommitsRequired,
      pullRequestRequired: value.pullRequestRequired,
      commitMessagePatterns: serializeValue(value.commitMessagePatterns, seen),
      commitAuthorEmailPatterns: serializeValue(
        value.commitAuthorEmailPatterns,
        seen
      ),
      committerEmailPatterns: serializeValue(
        value.committerEmailPatterns,
        seen
      ),
      branchNamePatterns: serializeValue(value.branchNamePatterns, seen),
    })
  }

  if (value instanceof RepoRulesMetadataRules) {
    return tag('RepoRulesMetadataRules', {
      rules: value.getRules().map(rule => ({
        enforced: rule.enforced,
        humanDescription: rule.humanDescription,
        rulesetId: rule.rulesetId,
      })),
    })
  }

  if (value instanceof RepoRulesMetadataFailures) {
    return tag('RepoRulesMetadataFailures', {
      failed: serializeValue(value.failed, seen),
      bypassed: serializeValue(value.bypassed, seen),
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

function reviveValue(value: unknown, context: ReviveContext): unknown {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(item => reviveValue(item, context))
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
            ([key, entryValue]) => [
              reviveValue(key, context),
              reviveValue(entryValue, context),
            ]
          )
        )
      case 'Set':
        return new Set(
          ((value.values as ReadonlyArray<unknown>) ?? []).map(item =>
            reviveValue(item, context)
          )
        )
      case 'ArrayBuffer':
        return arrayBufferFromBase64((value.data as string) ?? '')
      case 'TypedArray': {
        const bytes = bytesFromBase64((value.data as string) ?? '')
        if (value.name === 'Buffer') {
          const bufferCtor = (globalThis as any).Buffer
          return bufferCtor ? bufferCtor.from(bytes) : bytes
        }

        return bytes
      }
      case 'Account':
        return reviveAccount(value, context)
      case 'Branch':
        return new Branch(
          reviveString(value.name),
          reviveNullableString(value.upstream),
          reviveValue(value.tip, context) as any,
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
          reviveValue(value.author, context) as CommitIdentity,
          reviveValue(value.committer, context) as CommitIdentity,
          reviveValue(value.parentSHAs, context) as ReadonlyArray<string>,
          reviveValue(value.trailers, context) as any,
          reviveValue(value.tags, context) as ReadonlyArray<string>
        )
      case 'CommitIdentity':
        return new CommitIdentity(
          reviveString(value.name),
          reviveString(value.email),
          reviveValue(value.date, context) as Date,
          reviveNumber(value.tzOffset)
        )
      case 'CommittedFileChange':
        return new CommittedFileChange(
          reviveString(value.path),
          reviveValue(value.status, context) as any,
          reviveString(value.commitish),
          reviveString(value.parentCommitish)
        )
      case 'DiffSelection':
        return reviveDiffSelection(value)
      case 'DiffLine':
        return new DiffLine(
          reviveString(value.text),
          reviveNumber(value.type),
          reviveNullableNumber(value.originalLineNumber),
          reviveNullableNumber(value.oldLineNumber),
          reviveNullableNumber(value.newLineNumber),
          Boolean(value.noTrailingNewLine)
        )
      case 'DiffHunk':
        return new DiffHunk(
          reviveValue(value.header, context) as DiffHunkHeader,
          reviveValue(value.lines, context) as ReadonlyArray<DiffLine>,
          reviveNumber(value.unifiedDiffStart),
          reviveNumber(value.unifiedDiffEnd),
          value.expansionType as any
        )
      case 'DiffHunkHeader':
        return new DiffHunkHeader(
          reviveNumber(value.oldStartLine),
          reviveNumber(value.oldLineCount),
          reviveNumber(value.newStartLine),
          reviveNumber(value.newLineCount)
        )
      case 'Error': {
        const error = new Error(reviveString(value.message))
        error.name = reviveString(value.name) || 'Error'
        error.stack = value.stack as string | undefined
        return error
      }
      case 'GitHubRepository':
        return new GitHubRepository(
          reviveString(value.name),
          reviveValue(value.owner, context) as Owner,
          reviveNumber(value.dbID),
          value.isPrivate as any,
          value.htmlURL as any,
          value.cloneURL as any,
          value.issuesEnabled as any,
          value.isArchived as any,
          value.permissions as any,
          reviveValue(value.parent, context) as GitHubRepository | null
        )
      case 'Image':
        return new DesktopImage(
          (reviveValue(value.rawContents, context) as ArrayBufferLike) ??
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
          reviveValue(value.created, context) as Date,
          reviveString(value.title),
          reviveNumber(value.pullRequestNumber),
          reviveValue(value.head, context) as PullRequestRef,
          reviveValue(value.base, context) as PullRequestRef,
          reviveString(value.author),
          Boolean(value.draft),
          reviveString(value.body)
        )
      case 'PullRequestRef':
        return new PullRequestRef(
          reviveString(value.ref),
          reviveString(value.sha),
          reviveValue(value.gitHubRepository, context) as GitHubRepository
        )
      case 'Repository':
        return new Repository(
          reviveString(value.path),
          reviveNumber(value.id),
          reviveValue(value.gitHubRepository, context) as GitHubRepository | null,
          Boolean(value.missing),
          value.alias === null ? null : reviveString(value.alias),
          reviveValue(value.workflowPreferences, context) as any,
          Boolean(value.isTutorialRepository),
          value.gitDir === undefined
            ? undefined
            : reviveString(value.gitDir)
        )
      case 'RepoRulesInfo':
        return reviveRepoRulesInfo(value, context)
      case 'RepoRulesMetadataRules':
        return reviveRepoRulesMetadataRules(value, context)
      case 'RepoRulesMetadataFailures':
        return reviveRepoRulesMetadataFailures(value, context)
      case 'WorkingDirectoryFileChange':
        return new WorkingDirectoryFileChange(
          reviveString(value.path),
          reviveValue(value.status, context) as any,
          reviveValue(value.selection, context) as DiffSelection
        )
      case 'WorkingDirectoryStatus':
        return new (WorkingDirectoryStatus as any)(
          reviveValue(value.files, context) as ReadonlyArray<WorkingDirectoryFileChange>,
          value.includeAll as boolean | null
        )
    }
  }

  const result: Record<string, unknown> = {}

  for (const key of Object.keys(value)) {
    result[key] = reviveValue((value as any)[key], context)
  }

  return result
}

function reviveAccount(value: SerializedObject, context: ReviveContext) {
  const login = reviveString(value.login)
  const endpoint = reviveString(value.endpoint)
  const id = reviveNumber(value.id)
  const key = `${endpoint}\0${id}\0${login}`
  const existing = context.accounts.get(key)

  if (existing !== undefined) {
    return existing
  }

  const account = new Account(
    login,
    endpoint,
    '',
    reviveValue(value.emails, context) as any,
    reviveString(value.avatarURL),
    id,
    reviveString(value.name),
    value.plan as any,
    value.copilotEndpoint as any,
    value.isCopilotDesktopEnabled as any,
    reviveValue(value.features, context) as any
  )

  context.accounts.set(key, account)
  return account
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

function reviveRepoRulesInfo(
  value: SerializedObject,
  context: ReviveContext
): RepoRulesInfo {
  const info = new RepoRulesInfo()
  info.basicCommitWarning = reviveRepoRuleEnforced(value.basicCommitWarning)
  info.creationRestricted = reviveRepoRuleEnforced(value.creationRestricted)
  info.signedCommitsRequired = reviveRepoRuleEnforced(
    value.signedCommitsRequired
  )
  info.pullRequestRequired = reviveRepoRuleEnforced(value.pullRequestRequired)
  info.commitMessagePatterns = reviveRepoRulesMetadataRulesField(
    value.commitMessagePatterns,
    context
  )
  info.commitAuthorEmailPatterns = reviveRepoRulesMetadataRulesField(
    value.commitAuthorEmailPatterns,
    context
  )
  info.committerEmailPatterns = reviveRepoRulesMetadataRulesField(
    value.committerEmailPatterns,
    context
  )
  info.branchNamePatterns = reviveRepoRulesMetadataRulesField(
    value.branchNamePatterns,
    context
  )
  return info
}

function reviveRepoRulesMetadataRulesField(
  value: unknown,
  context: ReviveContext
): RepoRulesMetadataRules {
  const revived = reviveValue(value, context)
  return revived instanceof RepoRulesMetadataRules
    ? revived
    : new RepoRulesMetadataRules()
}

function reviveRepoRulesMetadataRules(
  value: SerializedObject,
  context: ReviveContext
): RepoRulesMetadataRules {
  const metadataRules = new RepoRulesMetadataRules()
  const rules = reviveValue(value.rules, context)

  if (Array.isArray(rules)) {
    for (const rule of rules) {
      if (rule !== null && typeof rule === 'object') {
        const revivedRule = rule as Record<string, unknown>
        metadataRules.push({
          enforced: reviveRepoRuleEnforced(revivedRule.enforced),
          humanDescription: reviveString(revivedRule.humanDescription),
          matcher: () => true,
          rulesetId: reviveNumber(revivedRule.rulesetId),
        })
      }
    }
  }

  return metadataRules
}

function reviveRepoRulesMetadataFailures(
  value: SerializedObject,
  context: ReviveContext
): RepoRulesMetadataFailures {
  const failures = new RepoRulesMetadataFailures()
  failures.failed = reviveRepoRulesMetadataFailureList(
    reviveValue(value.failed, context)
  )
  failures.bypassed = reviveRepoRulesMetadataFailureList(
    reviveValue(value.bypassed, context)
  )
  return failures
}

function reviveRepoRulesMetadataFailureList(
  value: unknown
): RepoRulesMetadataFailure[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is Record<string, unknown> => {
      return item !== null && typeof item === 'object'
    })
    .map(item => ({
      description: reviveString(item.description),
      rulesetId: reviveNumber(item.rulesetId),
    }))
}

function reviveRepoRuleEnforced(value: unknown): RepoRuleEnforced {
  return value === 'bypass' ? 'bypass' : value === true
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

function reviveNullableNumber(value: unknown): number | null {
  return value === null ? null : reviveNumber(value)
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
