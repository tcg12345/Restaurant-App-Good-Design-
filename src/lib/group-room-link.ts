/** Strictly route room links; never let an external link choose an arbitrary app path. */
export function groupRoomPath(raw: string): string | null {
  try {
    const u = new URL(raw);
    const isApp =
      u.protocol === "com.tylergorin.restaurantapp:" && u.hostname === "decide";
    const isWeb =
      ["https:", "http:"].includes(u.protocol) && u.pathname === "/decide";
    if (!isApp && !isWeb) return null;
    const code = u.searchParams.get("code")?.toUpperCase();
    return code && /^[A-Z0-9]{8}$/.test(code) ? `/decide?code=${code}` : null;
  } catch {
    return null;
  }
}
