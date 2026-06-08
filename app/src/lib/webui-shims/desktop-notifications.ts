export type DesktopNotificationPermission =
  | 'granted'
  | 'denied'
  | 'default'
  | 'unknown'

export type NotificationCallback<T = unknown> = (
  event: unknown,
  action: string,
  userInfo?: T
) => void

export function supportsNotifications() {
  return typeof Notification !== 'undefined'
}

export function supportsNotificationsPermissionRequest() {
  return typeof Notification !== 'undefined'
}
