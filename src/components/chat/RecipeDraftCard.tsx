import { ChefHat, ChevronRight, Sparkles, CheckCircle2, Clock, Users } from 'lucide-react';
import type { HomeMeal } from '../../contexts/ListsContext';

interface RecipeDraftCardProps {
  draft: HomeMeal;
  publishedMealId: string | null;
  onOpen: () => void;
}

/** Compact in-chat preview of an AI-built recipe. Tapping opens the
 *  full preview sheet (where Publish / Edit / Delete live). Stays in
 *  the chat history forever — even after publish — as a record of
 *  what the AI authored. */
export function RecipeDraftCard({ draft, publishedMealId, onOpen }: RecipeDraftCardProps) {
  const isPublished = publishedMealId !== null;
  const cover = draft.coverPhoto || draft.photos?.[0] || '';
  const totalMin = (draft.prepTime || 0) + (draft.cookTime || 0);
  const courseLabel = draft.course?.[0] || '';
  const ingredientCount = draft.ingredients?.length || 0;
  const stepCount = (draft.stepDetails?.length || draft.steps?.length || 0);

  return (
    <button
      type="button"
      className={`lp-chat-card lp-chat-card-recipe-draft${isPublished ? ' is-published' : ''}`}
      onClick={onOpen}
    >
      <div className="lp-chat-card-recipe-draft-top">
        <div
          className="lp-chat-card-recipe-draft-cover"
          style={cover ? { backgroundImage: `url("${cover}")` } : undefined}
          aria-hidden="true"
        >
          {!cover && <ChefHat size={20} />}
        </div>
        <div className="lp-chat-card-recipe-draft-main">
          <div className="lp-chat-card-recipe-draft-eyebrow">
            {isPublished ? (
              <>
                <CheckCircle2 size={11} />
                <span>Published</span>
              </>
            ) : (
              <>
                <Sparkles size={11} />
                <span>AI draft · Tap to review</span>
              </>
            )}
          </div>
          <h4 className="lp-chat-card-recipe-draft-title">{draft.name}</h4>
          {draft.summary && (
            <div className="lp-chat-card-recipe-draft-summary">{draft.summary}</div>
          )}
        </div>
        <ChevronRight className="lp-chat-card-recipe-draft-chevron" />
      </div>

      {(draft.cuisine || courseLabel || totalMin > 0 || draft.servings) && (
        <div className="lp-chat-card-recipe-draft-chips">
          {draft.cuisine && (
            <span className="lp-chat-card-recipe-draft-chip">{draft.cuisine}</span>
          )}
          {courseLabel && (
            <span className="lp-chat-card-recipe-draft-chip">{courseLabel}</span>
          )}
          {totalMin > 0 && (
            <span className="lp-chat-card-recipe-draft-chip">
              <Clock size={10} />
              {totalMin} min
            </span>
          )}
          {draft.servings && (
            <span className="lp-chat-card-recipe-draft-chip">
              <Users size={10} />
              {draft.servings} {draft.servings === 1 ? 'serving' : 'servings'}
            </span>
          )}
        </div>
      )}

      {(ingredientCount > 0 || stepCount > 0) && (
        <div className="lp-chat-card-recipe-draft-meta">
          {ingredientCount > 0 && `${ingredientCount} ingredient${ingredientCount === 1 ? '' : 's'}`}
          {ingredientCount > 0 && stepCount > 0 && ' · '}
          {stepCount > 0 && `${stepCount} step${stepCount === 1 ? '' : 's'}`}
        </div>
      )}
    </button>
  );
}
