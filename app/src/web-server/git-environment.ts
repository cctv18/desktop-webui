import * as Fs from 'fs'
import * as Path from 'path'
import { execFileSync } from 'child_process'

type Logger = Pick<IDesktopLogger, 'info'>

interface IGitEnvironmentOptions {
  readonly bundledGitDirectory: string
  readonly configuredDataDirectory?: string
  readonly configuredGitConfigGlobal?: string
  readonly configuredGitDirectory?: string
  readonly configuredGitExecPath?: string
  readonly configuredGitPath?: string
  readonly logger?: Logger
}

interface IGitEnvironmentResult {
  readonly gitDirectory: string
  readonly gitExecPath: string | null
  readonly gitBinary: string
  readonly source:
    | 'configured-directory'
    | 'configured-path'
    | 'bundled'
    | 'path'
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
      options.configuredDataDirectory,
      options.configuredGitConfigGlobal,
      options.configuredGitExecPath,
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

    return applyGitDirectory(
      gitDirectory,
      options.configuredDataDirectory,
      options.configuredGitConfigGlobal,
      options.configuredGitExecPath,
      'configured-path',
      options.logger
    )
  }

  if (isUsableGitDirectory(options.bundledGitDirectory)) {
    return applyGitDirectory(
      options.bundledGitDirectory,
      options.configuredDataDirectory,
      options.configuredGitConfigGlobal,
      options.configuredGitExecPath,
      'bundled',
      options.logger
    )
  }

  const gitFromPath = findGitOnPath()
  if (gitFromPath !== null) {
    const gitDirectory = inferGitDirectoryFromBinary(gitFromPath)

    if (gitDirectory !== null) {
      return applyGitDirectory(
        gitDirectory,
        options.configuredDataDirectory,
        options.configuredGitConfigGlobal,
        options.configuredGitExecPath,
        'path',
        options.logger
      )
    }
  }

  throw new Error(
    'GitDesk WebUI could not find a usable Git executable. Install Git on the server, add it to PATH, or start WebUI with --git-path /path/to/git or --git-directory /path/to/git/root.'
  )
}

function applyGitDirectory(
  gitDirectory: string,
  configuredDataDirectory: string | undefined,
  configuredGitConfigGlobal: string | undefined,
  configuredGitExecPath: string | undefined,
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

  const gitExecPath =
    normalizeOptionalPath(configuredGitExecPath) ??
    detectGitExecPath(gitBinary, resolvedDirectory)
  const gitConfigGlobal = resolveGitConfigGlobal(
    configuredGitConfigGlobal,
    configuredDataDirectory
  )

  process.env.LOCAL_GIT_DIRECTORY = resolvedDirectory
  if (gitExecPath !== null) {
    process.env.GIT_EXEC_PATH = gitExecPath
  } else {
    delete process.env.GIT_EXEC_PATH
  }
  process.env.GIT_CONFIG_GLOBAL = gitConfigGlobal

  logger?.info(
    `GitDesk WebUI using Git from ${gitBinary} (${describeSource(source)})`
  )
  if (gitExecPath !== null) {
    logger?.info(`GitDesk WebUI using Git exec path ${gitExecPath}`)
  }
  logger?.info(`GitDesk WebUI using isolated Git config ${gitConfigGlobal}`)

  return { gitDirectory: resolvedDirectory, gitExecPath, gitBinary, source }
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

function resolveGitConfigGlobal(
  configuredGitConfigGlobal: string | undefined,
  configuredDataDirectory: string | undefined
) {
  const configured = normalizeOptionalPath(configuredGitConfigGlobal)
  const path =
    configured ??
    Path.join(resolveDataDirectory(configuredDataDirectory), 'gitconfig')
  const resolved = Path.resolve(path)
  Fs.mkdirSync(Path.dirname(resolved), { recursive: true, mode: 0o700 })
  return resolved
}

function resolveDataDirectory(configuredDataDirectory: string | undefined) {
  const configured =
    normalizeOptionalPath(configuredDataDirectory) ??
    normalizeOptionalPath(process.env.GITDESK_WEBUI_DATA_DIR) ??
    normalizeOptionalPath(getArgValue('--data-dir')) ??
    Path.join(process.cwd(), '.gitdesk-webui')

  const resolved = Path.resolve(configured)
  Fs.mkdirSync(resolved, { recursive: true, mode: 0o700 })
  return resolved
}

function getArgValue(name: string) {
  const index = process.argv.indexOf(name)

  if (index < 0) {
    return undefined
  }

  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : undefined
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

function detectGitExecPath(gitBinary: string, gitDirectory: string) {
  try {
    const output = execFileSync(gitBinary, ['--exec-path'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim()

    if (output.length > 0 && isDirectory(output)) {
      return Path.resolve(output)
    }
  } catch {
    // Fall back to the common layouts below.
  }

  const candidates = [
    Path.join(gitDirectory, 'libexec', 'git-core'),
    Path.join(gitDirectory, 'lib', 'git-core'),
    Path.join(gitDirectory, 'mingw64', 'libexec', 'git-core'),
    Path.join(gitDirectory, 'mingw32', 'libexec', 'git-core'),
  ]

  return candidates.find(isDirectory) ?? null
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

function isDirectory(path: string) {
  try {
    return Fs.statSync(path).isDirectory()
  } catch {
    return false
  }
}
