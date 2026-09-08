/** Origin of the restaurant record, independent of storage location or billing.
 * A cached Google record remains google_places. Own catalog adapters should
 * explicitly register own_data; combined base records can register mixed.
 * Missing evidence stays unknown, including events recorded before this field.
 */
export type RestaurantDataSource = 'google_places' | 'own_data' | 'mixed' | 'unknown';
export interface RestaurantProvenance { dataSource?: RestaurantDataSource }
const sources = new Map<string, RestaurantDataSource>();
export function restaurantDataSource(id: string, explicit?: unknown): RestaurantDataSource {
  if (explicit === 'google_places' || explicit === 'own_data' || explicit === 'mixed') return explicit;
  return sources.get(id) || (id.startsWith('michelin:') ? 'own_data' : 'unknown');
}
export function rememberRestaurantSource(id: string, source?: unknown) {
  const resolved = restaurantDataSource(id, source);
  if (resolved !== 'unknown') {
    sources.delete(id);
    sources.set(id, resolved);
    if (sources.size > 2000) sources.delete(sources.keys().next().value!);
  }
  return resolved;
}
