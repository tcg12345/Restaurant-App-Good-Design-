import { ChefHat, ChevronRight, Sparkles, CheckCircle2 } from 'lucide-react';
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
  const chips: string[] = [];
  if (draft.cuisine) chips.push(draft.cuisine);
  if (courseLabel) chips.push(courseLabel);
  if (totalMin > 0) chips.push(`${totalMin} min`);
  if (draft.servings) chips.push(`${draft.servings} ${draft.servings === 1 ? 'serving' : 'servings'}`);

  return (
    <button
      type="button"
      className={`lp-chat-card lp-chat-card-recipe-draft${isPublished ? ' is-published' : ''}`}
      onClick={onOpen}
    >
      <div
        className="lp-chat-card-recipe-cover lp-chat-card-recipe-draft-cover"
        style={cover ? { backgroundImage: `url("${cover}")` } : undefined}
        aria-hidden="true"
      >
        {!cover && <ChefHat size={20} />}
      </div>
      <div className="lp-chat-card-info">
        <div className="lp-chat-card-recipe-draft-eyebrow">
          {isPublished ? (
            <>
              <CheckCircle2 size={12} />
              <span>Published</span>
            </>
          ) : (
            <>
              <Sparkles size={12} />
              <span>AI draft · Tap to review</span>
            </>
          )}
        </div>
        <h4>{draft.name}</h4>
        {draft.summary && <p className="lp-chat-card-recipe-draft-summary">{draft.summary}</p>}
        {chips.length > 0 && (
          <p className="lp-chat-card-recipe-draft-chips">
            {chips.map((c, i) => (
              <span key={c}>
                {i > 0 && <span className="dot">·</span>}
                <span>{c}</span>
              </span>
            ))}
          </p>
        )}
        {(ingredientCount > 0 || stepCount > 0) && (
          <p className="lp-chat-card-byline">
            {ingredientCount > 0 && `${ingredientCount} ingredient${ingredientCount === 1 ? '' : 's'}`}
            {ingredientCount > 0 && stepCount > 0 && ' · '}
            {stepCount > 0 && `${stepCount} step${stepCount === 1 ? '' : 's'}`}
          </p>
        )}
      </div>
      <ChevronRight />
    </button>
  );
}
