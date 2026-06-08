export function parseCommandLineArgv(commandLine: string): string[] {
  const args = new Array<string>()
  let current = ''
  let inQuotes = false
  let backslashes = 0

  const flushBackslashes = () => {
    if (backslashes > 0) {
      current += '\\'.repeat(backslashes)
      backslashes = 0
    }
  }

  for (const char of commandLine) {
    if (char === '\\') {
      backslashes++
      continue
    }

    if (char === '"') {
      current += '\\'.repeat(Math.floor(backslashes / 2))

      if (backslashes % 2 === 0) {
        inQuotes = !inQuotes
      } else {
        current += '"'
      }

      backslashes = 0
      continue
    }

    flushBackslashes()

    if (!inQuotes && /\s/.test(char)) {
      if (current.length > 0) {
        args.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  flushBackslashes()

  if (current.length > 0) {
    args.push(current)
  }

  return args
}
