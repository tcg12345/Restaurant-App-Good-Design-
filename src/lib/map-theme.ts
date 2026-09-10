/** Shared base cartography for locator maps in both app themes. */
export function mapStyle(dark: boolean): string {
  return `mapbox://styles/mapbox/${dark ? 'dark' : 'light'}-v11`;
}
