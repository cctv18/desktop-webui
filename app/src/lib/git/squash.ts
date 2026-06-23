import { appendFile, rm, writeFile } from 'fs/promises'
import { getCommits, revRange } from '.'
import { Commit } from '../../models/commit'
import { MultiCommitOperationKind } from '../../models/multi-commit-operation'
import { IMultiCommitOperationProgress } from '../../models/progress'
import { Repository } from '../../models/repository'
import { getTempFilePath } from '../file-system'
import {
  continueRebase,
  continueRebaseWithEmptyCommit,
  rebaseInteractive,
  RebaseInteractiveOptions,
  RebaseResult,
} from './rebase'
import { getStatus } from './status'
import {
  AppFileStatusKind,
  WorkingDirectoryFileChange,
} from '../../models/status'

export function hasOutstandingRebaseConflicts(
  files: ReadonlyArray<WorkingDirectoryFileChange>
): boolean {
  return files.some(f => f.status.kind === AppFileStatusKind.Conflicted)
}

export function isEmptyCommitRebaseStop(error: unknown): boolean {
  const result = (error as { result?: { stdout?: unknown; stderr?: unknown } })
    .result
  const message = error instanceof Error ? error.message : ''
  const output = [result?.stdout, result?.stderr, message]
    .filter(value => value !== undefined && value !== null)
    .map(value => String(value))
    .join('\n')

  const normalizedOutput = output.toLowerCase()

  const hasEmptyCommitHint =
    output.includes('--allow-empty') &&
    (normalizedOutput.includes('empty commit') ||
      normalizedOutput.includes('would make') ||
      normalizedOutput.includes('it empty') ||
      output.includes('空提交'))

  const hasRebaseContinueHint =
    output.includes('rebase --continue') ||
    output.includes('变基操作正在进行') ||
    output.includes('interactive rebase')

  return hasEmptyCommitHint && hasRebaseContinueHint
}

function isResolvedRebaseContinueStop(error: unknown): boolean {
  const result = (error as { result?: { stdout?: unknown; stderr?: unknown } })
    .result
  const message = error instanceof Error ? error.message : ''
  const output = [result?.stdout, result?.stderr, message]
    .filter(value => value !== undefined && value !== null)
    .map(value => String(value))
    .join('\n')

  return (
    output.includes('all conflicts fixed') &&
    output.includes('rebase --continue')
  )
}

async function continueAutomaticallyResolvedSquashRebase(
  repository: Repository,
  result: RebaseResult,
  opts: RebaseInteractiveOptions
): Promise<RebaseResult> {
  let nextResult = result
  const maxAutomaticContinues = (opts.commits?.length ?? 1) + 1

  for (
    let attempt = 0;
    nextResult === RebaseResult.ConflictsEncountered &&
    attempt < maxAutomaticContinues;
    attempt++
  ) {
    const status = await getStatus(repository, false)

    if (status === null) {
      return nextResult
    }

    if (hasOutstandingRebaseConflicts(status.workingDirectory.files)) {
      return nextResult
    }

    log.info(
      '[squash] rebase stopped after all conflicts were resolved; continuing automatically'
    )

    nextResult = await continueRebase(
      repository,
      status.workingDirectory.files,
      new Map(),
      {
        ...opts,
        action: 'continue automatically resolved squash rebase',
      }
    )
  }

  return nextResult
}

async function continueEmptySquashRebase(
  repository: Repository,
  commitMessagePath: string | undefined,
  opts: RebaseInteractiveOptions
): Promise<RebaseResult> {
  const maxEmptyContinues = (opts.commits?.length ?? 1) + 1

  for (let attempt = 0; attempt < maxEmptyContinues; attempt++) {
    try {
      return await continueRebaseWithEmptyCommit(
        repository,
        commitMessagePath,
        {
          ...opts,
          action: 'continue empty squash rebase',
        }
      )
    } catch (e) {
      if (!isEmptyCommitRebaseStop(e)) {
        throw e
      }

      log.info(
        '[squash] accepting another empty squashed commit during rebase'
      )
    }
  }

  log.warn('[squash] reached the empty squashed commit continuation limit')
  return RebaseResult.Error
}

/**
 * Squashes provided commits by calling interactive rebase.
 *
 * Goal is to replay the commits in order from oldest to newest to reduce
 * conflicts with toSquash commits placed in the log at the location of the
 * squashOnto commit.
 *
 * Example: A user's history from oldest to newest is A, B, C, D, E and they
 * want to squash A and E (toSquash) onto C. Our goal:  B, A-C-E, D. Thus,
 * maintaining that A came before C and E came after C, placed in history at the
 * the squashOnto of C.
 *
 * Also means if the last 2 commits in history are A, B, whether user squashes A
 * onto B or B onto A. It will always perform based on log history, thus, B onto
 * A.
 *
 * @param toSquash - commits to squash onto another commit and does not contain the squashOnto commit
 * @param squashOnto  - commit to squash the `toSquash` commits onto
 * @param lastRetainedCommitRef - sha of commit before commits in squash or null
 * if commit to be squash is the root (first in history) of the branch
 * @param commitMessage - the first line of the string provided will be the
 * summary and rest the body (similar to commit implementation)
 */
export async function squash(
  repository: Repository,
  toSquash: ReadonlyArray<Commit>,
  squashOnto: Commit,
  lastRetainedCommitRef: string | null,
  commitMessage: string,
  progressCallback?: (progress: IMultiCommitOperationProgress) => void
): Promise<RebaseResult> {
  let messagePath, todoPath
  let result: RebaseResult

  try {
    if (toSquash.length === 0) {
      throw new Error('[squash] No commits provided to squash.')
    }

    const toSquashShas = new Set(toSquash.map(c => c.sha))
    if (toSquashShas.has(squashOnto.sha)) {
      throw new Error(
        '[squash] The commits to squash cannot contain the commit to squash onto.'
      )
    }

    const commits = await getCommits(
      repository,
      lastRetainedCommitRef === null
        ? undefined
        : revRange(lastRetainedCommitRef, 'HEAD')
    )

    if (commits.length === 0) {
      throw new Error(
        '[squash] Could not find commits in log for last retained commit ref.'
      )
    }

    todoPath = await getTempFilePath('squashTodo')
    let foundSquashOntoCommitInLog = false
    const toReplayAtSquash = []
    const toReplayAfterSquash = []
    // Traversed in reverse so we do oldest to newest (replay commits)
    for (let i = commits.length - 1; i >= 0; i--) {
      const commit = commits[i]
      if (toSquashShas.has(commit.sha)) {
        // If it is toSquash commit and we have found the squashOnto commit, we
        // can go ahead and squash them (as we will hold any picks till after)
        if (foundSquashOntoCommitInLog) {
          await appendFile(todoPath, `squash ${commit.sha} ${commit.summary}\n`)
        } else {
          // However, if we have not found the squashOnto commit yet we want to
          // keep track of them in the order of the log. Thus, we use a new
          // `toReplayAtSquash` array and not trust that what was sent is in the
          // order of the log.
          toReplayAtSquash.push(commit)
        }

        continue
      }

      // If it's the squashOnto commit, replay to the toSquash in the order they
      // appeared on the log to reduce potential conflicts.
      if (commit.sha === squashOnto.sha) {
        foundSquashOntoCommitInLog = true
        toReplayAtSquash.push(commit)

        for (let j = 0; j < toReplayAtSquash.length; j++) {
          const action = j === 0 ? 'pick' : 'squash'
          await appendFile(
            todoPath,
            `${action} ${toReplayAtSquash[j].sha} ${toReplayAtSquash[j].summary}\n`
          )
        }

        continue
      }

      // We can't just replay a pick in case there is a commit from the toSquash
      // commits further up in history that need to be replayed with the
      // squashes. Thus, we will keep track of these and replay after traversing
      // the remainder of the log.
      if (foundSquashOntoCommitInLog) {
        toReplayAfterSquash.push(commit)
        continue
      }

      // If it is not one toSquash nor the squashOnto and have not found the
      // squashOnto commit, we simply record it is an unchanged pick (before the
      // squash)
      await appendFile(todoPath, `pick ${commit.sha} ${commit.summary}\n`)
    }

    if (toReplayAfterSquash.length > 0) {
      for (let i = 0; i < toReplayAfterSquash.length; i++) {
        await appendFile(
          todoPath,
          `pick ${toReplayAfterSquash[i].sha} ${toReplayAfterSquash[i].summary}\n`
        )
      }
    }

    if (!foundSquashOntoCommitInLog) {
      throw new Error(
        '[squash] The commit to squash onto was not in the log. Continuing would result in dropping the commits in the toSquash array.'
      )
    }

    if (commitMessage.trim() !== '') {
      messagePath = await getTempFilePath('squashCommitMessage')
      await writeFile(messagePath, commitMessage)
    }

    // if no commit message provided, accept default editor
    const gitEditor =
      messagePath !== undefined ? `cat "${messagePath}" >` : undefined

    const rebaseOptions = {
      action: MultiCommitOperationKind.Squash,
      gitEditor,
      progressCallback,
      commits: [...toSquash, squashOnto],
    }

    try {
      result = await rebaseInteractive(
        repository,
        todoPath,
        lastRetainedCommitRef,
        rebaseOptions
      )
      result = await continueAutomaticallyResolvedSquashRebase(
        repository,
        result,
        rebaseOptions
      )
    } catch (e) {
      if (isResolvedRebaseContinueStop(e) && !isEmptyCommitRebaseStop(e)) {
        result = await continueAutomaticallyResolvedSquashRebase(
          repository,
          RebaseResult.ConflictsEncountered,
          rebaseOptions
        )
      } else if (!isEmptyCommitRebaseStop(e)) {
        throw e
      } else {
        log.info('[squash] accepting empty squashed commit during rebase')
        result = await continueEmptySquashRebase(
          repository,
          messagePath,
          rebaseOptions
        )
        result = await continueAutomaticallyResolvedSquashRebase(
          repository,
          result,
          rebaseOptions
        )
      }
    }
  } catch (e) {
    log.error(e)
    return RebaseResult.Error
  } finally {
    if (todoPath !== undefined) {
      await rm(todoPath, { recursive: true, force: true })
    }

    if (messagePath !== undefined) {
      await rm(messagePath, { recursive: true, force: true })
    }
  }

  return result
}
