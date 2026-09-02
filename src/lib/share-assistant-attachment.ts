import type { SharePayload } from '../contexts/ChatContext';
import type { AssistantAttachment } from '../contexts/AssistantContext';

/**
 * Turns whatever is sitting in the share sheet into an `AssistantAttachment`
 * for its "Ask AI" action — the same pin-and-open mechanism
 * RestaurantDetailMobile and RecipePage already use for their own "ask about
 * this" buttons (see useAskAssistantAbout in contexts/AssistantContext.tsx).
 *
 * The digest here is necessarily shallower than those two pages' own: they
 * build theirs from a live detail page that also knows the VIEWER's own
 * rating, notes, and visit history for that specific place. A `SharePayload`
 * is just the snapshot the sender attached to the message — real facts, but
 * only what already rode along on the card, not a fresh fetch.
 */
export function buildAssistantAttachment(payload: SharePayload | null): AssistantAttachment | null {
  if (!payload) return null;

  if (payload.sharedRestaurant) {
    const r = payload.sharedRestaurant;
    const details: string[] = [];
    if (r.cuisine) details.push(`Cuisine: ${r.cuisine}`);
    if (r.price) details.push(`Price: ${r.price}`);
    if (r.address) details.push(`Address: ${r.address}`);
    if (r.isReview && r.score !== undefined) {
      details.push(`Shared as a review — scored ${r.score.toFixed(1)}/10.`);
      if (r.notes?.trim()) details.push(`Review notes: ${r.notes.trim()}`);
      if (r.tags?.length) details.push(`Tags: ${r.tags.join(', ')}`);
    } else {
      details.push('Shared without a rating attached.');
    }
    return {
      kind: 'restaurant',
      id: r.restaurantId,
      name: r.name,
      subtitle: [r.cuisine, r.price].filter(Boolean).join(' · '),
      details,
    };
  }

  if (payload.sharedRecipe) {
    const r = payload.sharedRecipe;
    const details: string[] = [];
    details.push(`Recipe by ${r.authorName}.`);
    if (r.description) details.push(`Description: ${r.description}`);
    if (r.tags?.length) details.push(`Tags: ${r.tags.join(', ')}`);
    if (r.totalTime) details.push(`Total time: ${r.totalTime} min`);
    if (r.difficulty) details.push(`Difficulty: ${r.difficulty}`);
    if (r.ingredientCount) details.push(`${r.ingredientCount} ingredients`);
    if (r.stepCount) details.push(`${r.stepCount} steps`);
    return {
      kind: 'recipe',
      id: r.mealId,
      name: r.name,
      subtitle: r.totalTime ? `${r.totalTime} min` : undefined,
      details,
    };
  }

  if (payload.sharedReel) {
    const r = payload.sharedReel;
    const details: string[] = [];
    details.push(`Reel by @${r.authorUsername}${r.isExpert ? ' (verified)' : ''}.`);
    if (r.caption) details.push(`Caption: ${r.caption}`);
    if (r.attachedTitle) details.push(`About: ${r.attachedTitle}${r.attachedSubtitle ? ` — ${r.attachedSubtitle}` : ''}`);
    return {
      kind: 'reel',
      id: r.reelId,
      name: r.attachedTitle || `@${r.authorUsername}'s reel`,
      subtitle: `@${r.authorUsername}`,
      details,
    };
  }

  if (payload.sharedPost) {
    const p = payload.sharedPost;
    const details: string[] = [];
    details.push(`Post by @${p.authorUsername}${p.isExpert ? ' (verified)' : ''}.`);
    if (p.caption) details.push(`Caption: ${p.caption}`);
    if (p.locationLabel) details.push(`Location: ${p.locationLabel}`);
    details.push(`${p.itemCount} item${p.itemCount === 1 ? '' : 's'}.`);
    // What's actually IN the post — without this, "what is this post
    // about" has nothing to answer from but the count.
    if (p.items?.length) {
      p.items.forEach((it, i) => {
        const bits: string[] = [];
        if (it.name) bits.push(it.name);
        if (it.caption) bits.push(it.caption);
        const desc = bits.length > 0 ? bits.join(' — ') : (it.kind === 'video' ? 'a video, no caption' : 'a photo, no caption');
        details.push(`  Item ${i + 1} (${it.kind}): ${desc}`);
      });
    }
    return {
      kind: 'post',
      id: p.postId,
      name: `@${p.authorUsername}'s post`,
      subtitle: p.locationLabel || undefined,
      details,
    };
  }

  if (payload.sharedGuide) {
    const g = payload.sharedGuide;
    const details: string[] = [];
    if (g.authorName) details.push(`Guide by ${g.authorName}.`);
    details.push(`Type: ${g.type === 'recipes' ? 'recipe guide' : 'restaurant guide'}.`);
    details.push(`${g.entryCount} ${g.type === 'recipes' ? 'recipes' : 'spots'}.`);
    if (g.avgScore !== null) details.push(`Average score: ${g.avgScore.toFixed(1)}/10.`);
    return {
      kind: 'guide',
      id: g.guideId,
      name: g.title,
      subtitle: g.subtitle || undefined,
      details,
    };
  }

  return null;
}
