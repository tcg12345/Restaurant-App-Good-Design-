/**
 * Tab-root routes that stay mounted across navigation (keep-alive). Returning
 * to one shows the same live instance with scroll + state intact, so they
 * neither remount/reload nor need scroll restoration (they keep their own
 * scroll). Shared by App (which renders them) and ScrollRestoration (which
 * skips them).
 */
export const KEEP_ALIVE_PATHS = ['/', '/search/main', '/pantry', '/profile'];

export const isKeepAlivePath = (path: string): boolean => KEEP_ALIVE_PATHS.includes(path);
