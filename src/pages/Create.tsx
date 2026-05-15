import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Star, FileText, Film, ChefHat, UtensilsCrossed, ChevronRight } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useLists } from '../contexts/ListsContext';
import { useReels } from '../contexts/ReelsContext';
import { usePosts } from '../contexts/PostsContext';
import { cn } from '../lib/utils';

interface CreateOption {
  label: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
}

export const Create: React.FC = () => {
  const navigate = useNavigate();
  const { phoneMode } = useSettings();
  const { lists, openHomeMealModal, openAddRecipeModal } = useLists();
  const { openAddReelModal } = useReels();
  const { openAddPostModal } = usePosts();

  const close = () => navigate('/');

  const goRateRestaurant = () => {
    // Restaurant rating needs a place selected first; SearchMain is the
    // existing entry point for "find a restaurant, then rate it".
    navigate('/search/main');
  };

  const goAddRecipe = () => {
    // Recipes live inside home-cooking lists. Pick the first one if any,
    // otherwise drop the user on Pantry where they can create a list.
    const homeCookingList = lists.find((l) => l.type === 'home-cooking');
    if (homeCookingList) {
      openAddRecipeModal(homeCookingList.id);
    } else {
      navigate('/pantry');
    }
  };

  const options: CreateOption[] = [
    {
      label: 'Rate a Restaurant',
      description: 'Score a place you visited',
      icon: <Star size={20} />,
      onClick: goRateRestaurant,
    },
    {
      label: 'Share a Post',
      description: 'Write about a meal',
      icon: <FileText size={20} />,
      onClick: openAddPostModal,
    },
    {
      label: 'Share a Reel',
      description: 'Upload a short food video',
      icon: <Film size={20} />,
      onClick: () => openAddReelModal(),
    },
    {
      label: 'Log a Home Meal',
      description: 'Record something you cooked',
      icon: <UtensilsCrossed size={20} />,
      onClick: () => openHomeMealModal(),
    },
    {
      label: 'Add a Recipe',
      description: 'Save a recipe to your cookbook',
      icon: <ChefHat size={20} />,
      onClick: goAddRecipe,
    },
  ];

  return (
    <div className="min-h-screen bg-surface text-on-surface flex flex-col">
      <header className="sticky top-0 w-full px-4 py-4 grid grid-cols-[1fr_auto_1fr] items-center bg-surface/70 backdrop-blur-md z-40">
        <div className="flex items-center justify-start">
          <button
            onClick={close}
            className="w-10 h-10 rounded-full bg-on-surface/5 hover:bg-on-surface/10 flex items-center justify-center text-on-surface/70 transition-colors"
            aria-label="Back to Discover"
          >
            <ArrowLeft size={20} />
          </button>
        </div>
        <h1 className="text-base font-serif font-bold tracking-tight">Create</h1>
        <div />
      </header>

      <main className={cn('flex-1 w-full', phoneMode ? 'px-3 pt-3 pb-10' : 'px-6 pt-4 pb-10 max-w-2xl mx-auto')}>
        <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-3">
          What would you like to add?
        </p>
        <ul className="flex flex-col gap-2">
          {options.map((opt) => (
            <li key={opt.label}>
              <button
                type="button"
                onClick={opt.onClick}
                className="w-full flex items-center gap-4 rounded-2xl bg-white border border-on-surface/[0.07] px-4 py-3.5 text-left transition-all hover:border-on-surface/15 hover:shadow-[0_4px_14px_-6px_rgba(0,0,0,0.08)] active:scale-[0.99]"
              >
                <span className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  {opt.icon}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-serif font-bold text-[16px] leading-tight text-on-surface">
                    {opt.label}
                  </span>
                  <span className="block text-[12.5px] text-on-surface/55 mt-0.5">
                    {opt.description}
                  </span>
                </span>
                <ChevronRight size={18} className="text-on-surface/30 flex-shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
};
