export type DesktopNotificationPermission =
  | 'granted'
  | 'denied'
  | 'default'

export type DesktopNotificationEvent = 'click'

export interface INotificationOptions {
  readonly toastActivatorClsid?: string
}

export type NotificationCallback<
  T extends Record<string, any> = Record<string, any>
> = (
  event: DesktopNotificationEvent,
  id: string,
  userInfo: T
) => void

let notificationCallback: NotificationCallback | null = null
let notificationId = 0

export function initializeNotifications(_options: INotificationOptions) {}

export function terminateNotifications() {
  notificationCallback = null
}

export function onNotificationEvent<
  T extends Record<string, any> = Record<string, any>
>(callback: NotificationCallback<T> | null) {
  notificationCallback = callback as NotificationCallback | null
}

export function supportsNotifications() {
  return typeof Notification !== 'undefined'
}

export function supportsNotificationsPermissionRequest() {
  return typeof Notification !== 'undefined'
}

export function getNotificationSettingsUrl() {
  return null
}

export async function getNotificationsPermission(): Promise<DesktopNotificationPermission> {
  if (typeof Notification === 'undefined') {
    return 'denied'
  }

  return Notification.permission
}

export async function requestNotificationsPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') {
    return false
  }

  return (await Notification.requestPermission()) === 'granted'
}

export async function showNotification<T extends Record<string, any>>(
  title: string,
  body: string,
  userInfo?: T
): Promise<string | null> {
  if (typeof Notification === 'undefined') {
    return null
  }

  if (Notification.permission !== 'granted') {
    return null
  }

  const id = `webui-notification-${++notificationId}`
  const notification = new Notification(title, { body })

  notification.onclick = () => {
    if (userInfo !== undefined) {
      notificationCallback?.('click', id, userInfo)
    }
  }

  return id
}

export function closeNotification(_id: string) {}
