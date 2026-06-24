interface ICopilotConflictResolutionRetryOptions {
  readonly maxAttempts?: number
  readonly shouldRetry?: (error: Error, attempt: number) => boolean
  readonly onRetry?: (error: Error, attempt: number) => void
}

/**
 * Runs a Copilot conflict-resolution step with one retry by default. The caller
 * decides which errors are retryable so user-initiated aborts can fail fast.
 */
export async function runCopilotConflictResolutionWithRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: ICopilotConflictResolutionRetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 2
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation(attempt)
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e))
      lastError = error

      if (
        attempt >= maxAttempts ||
        options.shouldRetry?.(error, attempt) === false
      ) {
        throw error
      }

      options.onRetry?.(error, attempt)
    }
  }

  throw lastError ?? new Error('Copilot conflict resolution failed')
}
