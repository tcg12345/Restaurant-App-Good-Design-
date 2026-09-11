import React from 'react';
import { useLocation } from 'react-router-dom';
import { useLists } from '../contexts/ListsContext';
import { useRecipes } from '../contexts/RecipesContext';
import { usePosts } from '../contexts/PostsContext';
import { useReels } from '../contexts/ReelsContext';
import { useGuideCreator } from '../contexts/GuideCreatorContext';
import { warmNavigation } from '../lib/navigation-warmup';
import { lazyEditor } from './LazyEditor';

const Rating = lazyEditor(() => import('./RatingFlow').then(m => ({ default: m.RatingFlow })));
const Recipe = lazyEditor(() => import('./AddRecipeModal').then(m => ({ default: m.AddRecipeModal })));
const Meal = lazyEditor(() => import('./AddHomeMealModal').then(m => ({ default: m.AddHomeMealModal })));
const Reel = lazyEditor(() => import('./AddReelModal').then(m => ({ default: m.AddReelModal })));
const Post = lazyEditor(() => import('./AddPostModal').then(m => ({ default: m.AddPostModal })));
const SavedRecipe = lazyEditor(() => import('./RecipeModal').then(m => ({ default: m.RecipeModal })));
const Guide = lazyEditor(() => import('./GuideCreatorSheet').then(m => ({ default: m.GuideCreatorSheet })));

export function DeferredEditors() {
  const lists = useLists();
  const recipes = useRecipes();
  const posts = usePosts();
  const reels = useReels();
  const guide = useGuideCreator();
  const { pathname } = useLocation();
  React.useEffect(() => {
    if (pathname !== '/create') return;
    // Prepare likely next actions without competing with initial navigation.
    return warmNavigation([Rating.preload, Meal.preload, Post.preload, Reel.preload, Guide.preload, Recipe.preload, SavedRecipe.preload], () => {});
  }, [pathname]);
  return <>
    <Rating active={lists.addRestaurantModalOpen} dismiss={lists.closeAddRestaurantModal} label="Rate a restaurant" componentProps={{}} />
    <Recipe active={lists.addRecipeModalOpen} dismiss={lists.closeAddRecipeModal} label="Recipe" componentProps={{}} />
    <Meal active={lists.homeMealModalOpen} dismiss={lists.closeHomeMealModal} label="Home meal" componentProps={{}} />
    <Reel active={reels.addReelModalOpen} dismiss={reels.closeAddReelModal} label="Reel" componentProps={{}} />
    <Post active={posts.addPostModalOpen} dismiss={posts.closeAddPostModal} label="Post" componentProps={{}} />
    <SavedRecipe active={recipes.recipeModalOpen} dismiss={recipes.closeRecipeModal} label="Recipe" componentProps={{}} />
    <Guide active={guide.isOpen} dismiss={guide.closeGuideCreator} label="Guide" componentProps={{ open: guide.isOpen, onClose: guide.closeGuideCreator, initialGuide: guide.initialGuide, seed: guide.seed }} />
  </>;
}
