import type { NotificationPermission } from './native-notifications';
export type NotificationPermissionSource = 'onboarding' | 'settings' | 'app_open' | 'app_resume';
/** Never classify an unanswered prompt or temporary native error as a refusal. */
export function permissionOutcome(permission: NotificationPermission) {
  return permission === 'granted' ? 'allowed' : permission === 'prompt' ? 'not_asked' : permission;
}
