import { Repository } from '../../models/repository'
import { RetryAction, RetryActionType } from '../../models/retry-actions'

export function getPullRetryAction(repository: Repository): RetryAction {
  return {
    type: RetryActionType.Pull,
    repository,
  }
}
