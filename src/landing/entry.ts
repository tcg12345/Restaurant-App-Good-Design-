/** Select the marketing surface before loading the authenticated app bundle. */
export function resolveEntry(url: URL, native: boolean, standalone: boolean, webAppChosen: boolean) {
  if (native || standalone) return { surface: 'app' as const, remember: false };
  if (url.pathname === '/app' || url.pathname === '/login') {
    return {
      surface: 'app' as const,
      remember: true,
      replace: url.pathname === '/login' ? `/auth?login=1${url.search ? `&${url.search.slice(1)}` : ''}${url.hash}` : `/${url.search}${url.hash}`,
    };
  }
  // Never intercept OAuth, email verification, password recovery or shared links.
  const authReturn = ['code', 'token_hash', 'error', 'error_description'].some(key => url.searchParams.has(key))
    || /(?:access_token|refresh_token|error|type=recovery)=?/.test(url.hash);
  if (authReturn) return { surface: 'app' as const, remember: true };
  if (['/welcome', '/download'].includes(url.pathname)) return { surface: 'landing' as const, remember: false };
  if (url.pathname !== '/' || webAppChosen) return { surface: 'app' as const, remember: true };
  return { surface: 'landing' as const, remember: false };
}

export function storeLink(value: string | undefined, platform: 'apple' | 'android'): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    const hosts = platform === 'apple' ? ['apps.apple.com', 'testflight.apple.com'] : ['play.google.com'];
    return url.protocol === 'https:' && hosts.includes(url.hostname) ? url.href : null;
  } catch { return null; }
}
