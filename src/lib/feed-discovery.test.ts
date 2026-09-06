import { describe, it, expect } from 'vitest';
import { selectFeedEntries, feedDishPreview } from './feed-discovery';
import type { FeedEntry } from './feedEntry';
const entry = (key: string, score?: number, time = 1): FeedEntry => ({key, kind:'rating', authorId:'a', sortTime:time, score, caption:'', tags:[], media:[], source:{}});
describe('feed discovery', () => {
  it('ranks real high ratings, excludes self scores, and breaks ties by recency', () => {
    const rows = [entry('low',7.9),entry('old',9,1),entry('new',9,2),entry('none'),{...entry('slider',10),selfScored:true}];
    expect(selectFeedEntries(rows,'highlights',()=>false).map(e=>e.key)).toEqual(['new','old']);
    expect(rows.map(e=>e.key)).toEqual(['low','old','new','none','slider']);
  });
  it('saved mode uses live saved state without changing the original stream', () => {
    const rows=[entry('a'),entry('b')];
    expect(selectFeedEntries(rows,'saved',e=>e.key==='b')).toEqual([rows[1]]);
    expect(selectFeedEntries(rows,'latest',()=>false)).toBe(rows);
  });
  it('only previews named dishes and limits any author to two', () => {
    const rows=Array.from({length:5},(_,i)=>({...entry(String(i)),media:[{kind:'photo' as const,url:'photo'+i,caption:i===0?'':`Dish ${i}`}]}));
    rows[4].authorId='b';
    expect(feedDishPreview(rows).map(d=>d.key)).toEqual(['1','2','4']);
  });
});
