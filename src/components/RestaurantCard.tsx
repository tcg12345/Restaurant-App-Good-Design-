// Back-compat shim. The restaurant card moved into the unified card kit
// (src/components/cards). Existing imports of `RestaurantCard` / `ScoreBadge`
// from this path keep working; new code should import from './cards'.
export {
  RestaurantCard,
  type RestaurantCardProps,
  type RestaurantCardVariant,
} from './cards/RestaurantCard';
export { ScoreBadge } from './ScoreBadge';
