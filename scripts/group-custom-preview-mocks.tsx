export { useSignInModal, useHomeLocation, HomeLocationBar, ShareDialog, supabaseConfigured, supabase, RestaurantPanel } from './group-info-preview-mocks';
export const useAuth=()=>({user:{id:location.search.includes('guest')?'guest':'preview'}});
