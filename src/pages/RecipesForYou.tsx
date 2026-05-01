import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChefHat } from 'lucide-react';

// Placeholder page reached from the "View all" affordance on the Home page's
// "Recipes For You" row. The full layout (filters, paginated list, source
// breakdown, etc.) is intentionally left as a stub to be built out later.
export const RecipesForYou: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-surface">
      <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm border-b border-primary/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 hover:bg-primary/5 rounded-full transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 text-primary" />
          </button>
          <ChefHat size={20} className="text-emerald-600" />
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-serif font-semibold text-primary">Recipes For You</h1>
            <p className="text-xs text-on-surface/40">Personalized picks from friends, experts, and the community</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-6 flex flex-col items-center justify-center text-center min-h-[60vh]">
        <ChefHat size={40} className="text-on-surface/20 mb-3" />
        <p className="text-sm font-semibold text-on-surface/40 mb-1">Coming soon</p>
        <p className="text-xs text-on-surface/30 max-w-[280px]">
          The full recipe recommendations page is in progress. For now, browse picks from the
          Home page's <span className="italic">Recipes For You</span> row.
        </p>
      </div>
    </div>
  );
};
