let measuringPerf = false
let markID = 0

interface IMeasureOptions {
  readonly suppressSuccessfulCommandLogging?: boolean
}

/** Start capturing git performance measurements. */
export function start() {
  measuringPerf = true
}

/** Stop capturing git performance measurements. */
export function stop() {
  measuringPerf = false
}

/** Measure an async git operation. */
export async function measure<T>(
  cmd: string,
  fn: () => Promise<T>,
  options: IMeasureOptions = {}
): Promise<T> {
  const id = ++markID

  const startTime = performance && performance.now ? performance.now() : null
  let result: T | undefined = undefined
  let threw = true

  markBegin(id, cmd)
  try {
    result = await fn()
    threw = false
    return result
  } finally {
    if (startTime && shouldLogMeasurement(result, threw, options)) {
      const rawTime = performance.now() - startTime
      if (__DEV__ || rawTime > 1000) {
        const timeInSeconds = (rawTime / 1000).toFixed(3)
        log.info(`Executing ${cmd} (took ${timeInSeconds}s)`)
      }
    }

    markEnd(id, cmd)
  }
}

function shouldLogMeasurement<T>(
  result: T | undefined,
  threw: boolean,
  options: IMeasureOptions
) {
  if (!options.suppressSuccessfulCommandLogging) {
    return true
  }

  if (threw) {
    return true
  }

  if (hasNonZeroExitCode(result)) {
    return true
  }

  return false
}

function hasNonZeroExitCode(value: unknown) {
  return (
    value !== null &&
    typeof value === 'object' &&
    'exitCode' in value &&
    typeof value.exitCode === 'number' &&
    value.exitCode !== 0
  )
}

/** Mark the beginning of a git operation. */
function markBegin(id: number, cmd: string) {
  if (!measuringPerf) {
    return
  }

  const markName = `${id}::${cmd}`
  performance.mark(markName)
}

/** Mark the end of a git operation. */
function markEnd(id: number, cmd: string) {
  if (!measuringPerf) {
    return
  }

  const markName = `${id}::${cmd}`
  const measurementName = cmd
  performance.measure(measurementName, markName)

  performance.clearMarks(markName)
  performance.clearMeasures(measurementName)
}
