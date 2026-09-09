import type { Reel } from '../contexts/ReelsContext';

export function playableReels(reels: Reel[]): Reel[] {
  return reels.filter(reel => reel.muxStatus !== 'processing' && reel.muxStatus !== 'errored' &&
    (!!reel.videoUrl || !!reel.muxPlaybackId));
}

/** Only use viewer-authorized context data; audience and saved filters still
 * apply when a reel is mixed into an otherwise written/photo feed. */
export function selectHomeFeedReels(reels: Reel[], options: {
  audience: 'friends' | 'experts' | 'recipes'; lens: 'latest' | 'highlights' | 'saved';
  friendIds: Set<string>; userId?: string; community: boolean;
}): Reel[] {
  if (options.lens === 'highlights') return [];
  return playableReels(reels).filter(reel => {
    if (options.lens === 'saved' && !reel.saved) return false;
    if (options.audience === 'experts') return reel.isExpert;
    if (options.audience === 'recipes') return reel.kind === 'recipe';
    return options.community ? reel.isPublic : reel.authorId === options.userId || options.friendIds.has(reel.authorId);
  }).sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
}

export function insertReelRows<T>(rows: T[], reels: Reel[]): (T | { kind: 'reel'; reel: Reel })[] {
  const result: (T | { kind: 'reel'; reel: Reel })[] = [...rows];
  reels.forEach((reel, index) => result.splice(Math.min(2 + index * 5, result.length), 0, { kind: 'reel', reel }));
  return result;
}
