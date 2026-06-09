import * as Fs from 'fs'
import * as Path from 'path'

type Logger = Pick<IDesktopLogger, 'info'>

interface IGitEnvironmentOptions {
  readonly bundledGitDirectory: string
  readonly configuredGitDirectory?: string
  readonly configuredGitPath?: string
  readonly logger?: Logger
}

interface IGitEnvironmentResult {
  readonly gitDirectory: string
  readonly gitBinary: string
  readonly source: 'configured-directory' | 'configured-path' | 'bundled' | 'path'
}

export function configureGitEnvironment(
  options: IGitEnvironmentOptions
): IGitEnvironmentResult {
  const configuredDirectory =
    normalizeOptionalPath(options.configuredGitDirectory) ??
    normalizeOptionalPath(process.env.LOCAL_GIT_DIRECTORY)

  if (configuredDirectory !== null) {
    return applyGitDirectory(
      configuredDirectory,
      'configured-directory',
      options.logger
    )
  }

  const configuredGitPath = normalizeOptionalPath(options.configuredGitPath)
  if (configuredGitPath !== null) {
    const gitDirectory = inferGitDirectoryFromBinary(configuredGitPath)

    if (gitDirectory === null) {
      throw new Error(
        `Configured Git path '${configuredGitPath}' cannot be used by dugite. Provide the Git installation root with --git-directory instead.`
      )
    }

    return applyGitDirectory(gitDirectory, 'configured-path', options.logger)
  }

  if (isUsableGitDirectory(options.bundledGitDirectory)) {
    return applyGitDirectory(options.bundledGitDirectory, 'bundled', options.logger)
  }

  const gitFromPath = findGitOnPath()
  if (gitFromPath !== null) {
    const gitDirectory = inferGitDirectoryFromBinary(gitFromPath)

    if (gitDirectory !== null) {
      return applyGitDirectory(gitDirectory, 'path', options.logger)
    }
  }

  throw new Error(
    'GitDesk WebUI could not find a usable Git executable. Install Git on the server, add it to PATH, or start WebUI with --git-path /path/to/git or --git-directory /path/to/git/root.'
  )
}

function applyGitDirectory(
  gitDirectory: string,
  source: IGitEnvironmentResult['source'],
  logger?: Logger
): IGitEnvironmentResult {
  const resolvedDirectory = Path.resolve(gitDirectory)
  const gitBinary = resolveDugiteGitBinary(resolvedDirectory)

  if (!isExecutableFile(gitBinary)) {
    throw new Error(
      `Git directory '${resolvedDirectory}' is not usable because '${gitBinary}' was not found.`
    )
  }

  process.env.LOCAL_GIT_DIRECTORY = resolvedDirectory
  delete process.env.GIT_EXEC_PATH

  logger?.info(
    `GitDesk WebUI using Git from ${gitBinary} (${describeSource(source)})`
  )

  return { gitDirectory: resolvedDirectory, gitBinary, source }
}

function describeSource(source: IGitEnvironmentResult['source']) {
  switch (source) {
    case 'configured-directory':
      return 'configured Git directory'
    case 'configured-path':
      return 'configured Git path'
    case 'bundled':
      return 'bundled Git'
    case 'path':
      return 'system PATH'
  }
}

function normalizeOptionalPath(value: string | undefined) {
  if (value === undefined) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isUsableGitDirectory(directory: string) {
  return isExecutableFile(resolveDugiteGitBinary(directory))
}

function resolveDugiteGitBinary(directory: string) {
  return process.platform === 'win32'
    ? Path.join(directory, 'cmd', 'git.exe')
    : Path.join(directory, 'bin', 'git')
}

function inferGitDirectoryFromBinary(gitPath: string): string | null {
  const resolvedGitPath = Path.resolve(gitPath)
  const gitFileName = Path.basename(resolvedGitPath).toLowerCase()

  if (gitFileName !== 'git' && gitFileName !== 'git.exe') {
    return null
  }

  if (process.platform === 'win32') {
    return inferWindowsGitDirectory(resolvedGitPath)
  }

  const parent = Path.dirname(resolvedGitPath)
  if (Path.basename(parent) !== 'bin') {
    return null
  }

  return Path.dirname(parent)
}

function inferWindowsGitDirectory(gitPath: string) {
  const candidates = new Array<string>()
  let current = Path.dirname(gitPath)

  for (let i = 0; i < 4; i++) {
    const parent = Path.dirname(current)
    if (parent === current) {
      break
    }

    candidates.push(parent)
    current = parent
  }

  return candidates.find(isUsableGitDirectory) ?? null
}

function findGitOnPath(): string | null {
  const pathValue = process.env.PATH ?? process.env.Path ?? ''
  if (pathValue.length === 0) {
    return null
  }

  const names =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .filter(x => x.length > 0)
          .map(ext => `git${ext.toLowerCase()}`)
      : ['git']

  for (const directory of pathValue.split(Path.delimiter)) {
    if (directory.length === 0) {
      continue
    }

    for (const name of names) {
      const candidate = Path.join(directory, name)
      if (isExecutableFile(candidate)) {
        return candidate
      }
    }
  }

  return null
}

function isExecutableFile(path: string) {
  try {
    return Fs.statSync(path).isFile()
  } catch {
    return false
  }
}
