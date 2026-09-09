/** Fictional, local-only data. No account or messaging service is connected. */
export const ratings = [
  { restaurantId: 'preview-1', name: 'Juniper House', cuisine: 'Contemporary', price: '$$$', city: 'New York', score: 9.2, image: '/images/onboarding/contemporary-dining.jpg' },
  { restaurantId: 'preview-2', name: 'The Sunday Table', cuisine: 'Italian', price: '$$', city: 'Brooklyn', score: 8.7, image: '' },
  { restaurantId: 'preview-3', name: 'A very lovely restaurant with a longer name', cuisine: 'French', price: '$$$$', city: 'New York', score: 9.4, image: '/images/onboarding/contemporary-dining.jpg' },
  { restaurantId: 'preview-4', name: 'Little Garden', cuisine: 'Seasonal', price: '$$', city: 'Brooklyn', score: 8.9, image: '' },
];
export const useLists = () => ({ ratings, homeMeals: [{ id: 'recipe-1', name: 'Sunday tomato pasta', prepTime: 10, cookTime: 20, difficulty: 'Easy', ingredients: ['Tomatoes', 'Pasta'], tags: ['Italian'] }] });
export const useAuth = () => ({ user: { id: 'preview' } });
export const useSettings = () => ({ phoneMode: true });
export const searchPlacesByText = async () => [];
export const priceLevelToString = () => '$$';
export const getCuisineLabel = () => 'Contemporary';
export const loadLastSelectedLocation = () => ({ lat: 40.7, lng: -74 });
export const getAllPublicHomeMeals = async () => [];
export const getProfilesByIds = async () => ({});
export const getMealCoverUrl = () => '';
export const useGlassField = () => ({ active: false, ref: undefined });
