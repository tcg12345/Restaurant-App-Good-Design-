import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Bookmark, CalendarDays, Star, Utensils, ChefHat, Compass } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCalendar } from '../contexts/CalendarContext';
import { useLists } from '../contexts/ListsContext';
import { useAuth } from '../contexts/AuthContext';
import { useRecipes } from '../contexts/RecipesContext';
import { homeHaptic } from '../lib/haptics';
import { homeCardChoices, homeCardForSession, type NextMeal } from '../lib/home-next-meal';
import { getHomeRestaurantPhoto, type HomeRestaurantPhoto } from '../lib/home-restaurant-photo';
import './HomeNextMeal.css';

export function NextMealCard({ meal, onOpen, viewerId = 'guest' }: { meal: NextMeal; onOpen: (href: string) => void; viewerId?: string }) {
  const [photo, setPhoto] = useState<HomeRestaurantPhoto | null>(null);
  const [loaded, setLoaded] = useState('');
  const [failed, setFailed] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    setPhoto(null); setLoaded(''); setFailed([]);
    if (meal.restaurant) void getHomeRestaurantPhoto(meal.restaurant, viewerId).then(result => { if (!cancelled) setPhoto(result); });
    return () => { cancelled = true; };
  }, [meal, viewerId]);
  const image = photo?.url && !failed.includes(photo.url) ? photo.url : meal.image && !failed.includes(meal.image) ? meal.image : undefined;
  const credited = photo?.google && loaded === photo.url && image === photo.url;
  const Icon = meal.kind === 'plan' ? CalendarDays : meal.kind === 'favorite' ? Star : meal.kind === 'recipe' ? ChefHat : meal.kind === 'discover' ? Compass : Bookmark;
  const ArtIcon = meal.kind === 'starter' || meal.kind === 'favorite' ? Star : meal.kind === 'recipe' || meal.kind === 'discover' ? ChefHat : Utensils;
  const label = { plan: 'Coming up', saved: 'From your wishlist', favorite: 'An old favorite', recipe: 'In your kitchen', discover: 'A little inspiration', empty: 'Your next meal', starter: '' }[meal.kind];
  const date = meal.date ? new Date(meal.date) : null;
  return <div className="home-next-meal-shell"><button className={`home-next-meal is-${meal.kind}`} onClick={() => { homeHaptic(); onOpen(meal.href); }} aria-label={[meal.title, meal.detail, meal.action].filter(Boolean).join('. ')}>
    <span className="home-next-meal-copy">
      {meal.kind !== 'starter' && <span className="home-next-meal-label"><Icon size={12} strokeWidth={1.8} />{label}</span>}
      <strong className="home-next-meal-title">{meal.title}</strong>
      {meal.detail && <span className="home-next-meal-detail">{meal.detail}</span>}
      <span className="home-next-meal-action">{meal.action}<ArrowUpRight size={14} /></span>
    </span>
    <span className="home-next-meal-art" aria-hidden="true">
      {date && !image ? <span className="home-next-meal-date"><span>{date.toLocaleDateString([], { month: 'short' })}</span><strong>{date.getDate()}</strong><small>{date.toLocaleDateString([], { weekday: 'long' })}</small></span>
        : <><ArtIcon className="home-next-meal-placeholder" size={29} strokeWidth={1.2} />{image && <img key={image} src={image} alt="" onLoad={() => setLoaded(image)} onError={() => setFailed(previous => [...previous, image])} />}</>}
    </span>
  </button>{credited && <div className="home-next-meal-credit"><span translate="no">Google Maps</span>{photo.google!.authors.map((author, index) => {
    const uri = author.uri?.startsWith('//') ? `https:${author.uri}` : author.uri;
    return <React.Fragment key={index}><span aria-hidden="true">·</span>{uri?.startsWith('https://') ? <a href={uri} target="_blank" rel="noopener noreferrer">{author.name}</a> : <span>{author.name}</span>}</React.Fragment>;
  })}</div>}</div>;
}

export function HomeNextMeal({ city, now }: { city: string; now: Date }) {
  const { plans, loading: plansLoading, error: plansError } = useCalendar();
  const { user } = useAuth();
  const { wishlist, ratings, homeMeals, lists, cloudSyncReady } = useLists();
  const { myRecipes, cloudSyncReady: recipesReady } = useRecipes();
  // Wait for the account's data before treating an empty cache as a new user.
  const showGettingStarted = !!user && cloudSyncReady && recipesReady && !plansLoading && !plansError &&
    !homeMeals.length && !myRecipes.length && !lists.some((list) =>
      list.restaurantIds.length || list.wishlistIds.length || list.recipes?.length);
  const navigate = useNavigate();
  const ready = !user || (cloudSyncReady && recipesReady && !plansLoading);
  // Do not freeze a loading fallback into the entire launch's selection.
  if (!ready) return <div className="home-next-meal-loading" aria-label="Loading your home card" role="status" />;
  const recipes = myRecipes.map(recipe => ({ title: recipe.title, href: `/recipe/${recipe.userId}/${recipe.id}`, image: recipe.photos[0], detail: [recipe.cuisine, (recipe.prepTimeMinutes || 0) + (recipe.cookTimeMinutes || 0) ? `${(recipe.prepTimeMinutes || 0) + (recipe.cookTimeMinutes || 0)} min` : ''].filter(Boolean).join(' · ') }));
  for (const list of lists) for (const recipe of list.recipes || []) recipes.push({ title: recipe.title, href: `/recipe/${recipe.sourceAuthorId || user?.id}/${recipe.sourceMealId || recipe.id}`, image: recipe.coverPhoto, detail: recipe.cuisine });
  const meal = homeCardForSession(user?.id || 'guest', user ? homeCardChoices(plans, wishlist, ratings, recipes, city, now, showGettingStarted) : homeCardChoices([], [], [], [], city, now, false));
  return <NextMealCard meal={meal} viewerId={user?.id || 'guest'} onOpen={(href) => navigate(href, meal.kind === 'starter' ? { state: { mode: 'rate' } } : undefined)} />;
}
