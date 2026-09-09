import { expect, it } from 'vitest';
import type { Reel } from '../contexts/ReelsContext';
import { playableReels, selectHomeFeedReels, insertReelRows } from './home-reels';
const reel = (id: string, props: Partial<Reel> = {}) => ({ id, videoUrl: 'authorized-video', authorId: id, kind: 'restaurant', isPublic: true, createdAt: 1, ...props }) as Reel;
const options = { audience: 'friends' as const, lens: 'latest' as const, friendIds: new Set(['friend']), userId: 'me', community: false };
it('keeps circle reels within the selected audience, including your own', () => {
  expect(selectHomeFeedReels([reel('stranger'), reel('friend', {isPublic:false}), reel('me')], options).map(r=>r.id)).toEqual(['friend','me']);
});
it('only uses public reels for the clearly labeled community fallback', () => {
  expect(selectHomeFeedReels([reel('public'),reel('private',{isPublic:false})], {...options,community:true}).map(r=>r.id)).toEqual(['public']);
});
it('respects cooking, verified, and saved filters without inventing ratings', () => {
  const items = [reel('chef',{kind:'recipe',isExpert:true,saved:true}),reel('friend')];
  expect(selectHomeFeedReels(items,{...options,audience:'recipes'}).map(r=>r.id)).toEqual(['chef']);
  expect(selectHomeFeedReels(items,{...options,audience:'experts',lens:'saved'}).map(r=>r.id)).toEqual(['chef']);
  expect(selectHomeFeedReels(items,{...options,lens:'saved'})).toEqual([]);
  expect(selectHomeFeedReels(items,{...options,lens:'highlights'})).toEqual([]);
});
it('excludes unfinished/failed uploads and media without a playable source', () => {
  expect(playableReels([reel('ready'),reel('pending',{muxStatus:'processing'}),reel('failed',{muxStatus:'errored'}),reel('empty',{videoUrl:undefined})]).map(r=>r.id)).toEqual(['ready']);
});
it('spaces reels between posts without reordering or mutating the existing feed', () => {
  const posts = [1,2,3,4,5,6,7,8]; const result = insertReelRows(posts,[reel('a'),reel('b')]);
  expect(result[2]).toMatchObject({kind:'reel',reel:{id:'a'}});
  expect(result[7]).toMatchObject({kind:'reel',reel:{id:'b'}});
  expect(result.filter(r=>typeof r === 'number')).toEqual(posts);
  expect(posts).toHaveLength(8);
  expect(insertReelRows([], [reel('a')])).toHaveLength(1);
});
