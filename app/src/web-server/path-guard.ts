import { realpath, stat } from 'fs/promises'
import * as Path from 'path'

export class PathGuard {
  private readonly roots: ReadonlyArray<string>

  public constructor(roots: ReadonlyArray<string>) {
    this.roots = roots.map(root => Path.resolve(root))
  }

  public get allowedRoots() {
    return this.roots
  }

  public async assertAllowed(path: string) {
    if (!Path.isAbsolute(path)) {
      throw new Error(`Path '${path}' must be absolute`)
    }

    const resolved = await this.resolveExistingOrParent(path)

    if (!this.roots.some(root => isWithinRoot(resolved, root))) {
      throw new Error(
        `Path '${path}' is outside the configured GitDesk allowed roots`
      )
    }
  }

  private async resolveExistingOrParent(path: string): Promise<string> {
    try {
      await stat(path)
      return await realpath(path)
    } catch {
      const parent = Path.dirname(path)
      if (parent === path) {
        return Path.resolve(path)
      }

      return Path.join(await this.resolveExistingOrParent(parent), Path.basename(path))
    }
  }
}

function isWithinRoot(path: string, root: string) {
  const relative = Path.relative(root, path)
  return relative === '' || (!relative.startsWith('..') && !Path.isAbsolute(relative))
}

export function parseAllowedRoots(raw: string | undefined, cwd: string) {
  if (raw === undefined || raw.trim().length === 0) {
    return [cwd]
  }

  const roots = raw
    .split(Path.delimiter)
    .map(x => x.trim())
    .filter(x => x.length > 0)

  return roots.length > 0 ? roots : [cwd]
}
