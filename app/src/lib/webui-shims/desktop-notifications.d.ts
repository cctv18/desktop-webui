declare module 'desktop-notifications' {
  export type DesktopNotificationPermission = 'default' | 'granted' | 'denied'
  export type DesktopNotificationEvent = 'click'

  export interface INotificationOptions {
    readonly toastActivatorClsid?: string
  }

  export type NotificationCallback<
    T extends Record<string, any> = Record<string, any>
  > = (event: DesktopNotificationEvent, id: string, userInfo: T) => void

  export function initializeNotifications(
    options: INotificationOptions
  ): void
  export function terminateNotifications(): void
  export function onNotificationEvent<
    T extends Record<string, any> = Record<string, any>
  >(callback: NotificationCallback<T> | null): void
  export function supportsNotifications(): boolean
  export function supportsNotificationsPermissionRequest(): boolean
  export function getNotificationSettingsUrl(): string | null
  export function getNotificationsPermission(): Promise<DesktopNotificationPermission>
  export function requestNotificationsPermission(): Promise<boolean>
  export function showNotification<T extends Record<string, any>>(
    title: string,
    body: string,
    userInfo?: T
  ): Promise<string | null>
  export function closeNotification(id: string): void
}

declare module 'desktop-notifications/dist/notification-callback' {
  export {
    DesktopNotificationEvent,
    NotificationCallback,
    onNotificationEvent,
  } from 'desktop-notifications'
}
