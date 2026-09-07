import { describe, expect, it } from 'vitest';
import { activityDay, availableReviewPeriods, buildReview, eligibleAutoReview, periodContaining, previousPeriod, readReviewArchive, reviewEvents, type ReviewInput } from './in-review';
import { reviewStories } from './review-stories';
import type { RestaurantRating, HomeMeal, LocalVisitRecord } from '../contexts/ListsContext';
import type { Recipe } from './supabase-recipes';
import type { TasteBenchmarks } from './taste-insights';
const now=new Date('2026-09-07T12:00:00');
const rating=(id:string,date:string,patch:Partial<RestaurantRating>={}):RestaurantRating=>({restaurantId:id,name:id,image:'',cuisine:'Italian',price:'$$',address:'New York, NY',score:8,notes:'',visitDate:date,wouldReturn:true,tags:[],photos:[],listIds:[],friendIds:[],createdAt:now.getTime(),...patch});
const input=(ratings:RestaurantRating[]=[],patch:Partial<ReviewInput>={}):ReviewInput=>({ratings,meals:[],recipes:[],wishlist:[],history:{},scoresUnlocked:true,...patch});
const week=previousPeriod('week',now);
describe('review calendar boundaries',()=>{
  it('uses a Monday week and rolls across years',()=>{expect(periodContaining('week',new Date('2026-01-01T12:00:00')).start).toBe('2025-12-29');expect(week.start).toBe('2026-08-31');expect(week.end).toBe('2026-09-07');});
  it('handles leap months and completed annual periods',()=>{expect(periodContaining('month',new Date('2024-02-29T12:00:00')).end).toBe('2024-03-01');expect(previousPeriod('year',now).start).toBe('2025-01-01');});
  it('does not turn old imports, invalid dates, or future visits into this week',()=>{expect(activityDay('2026-02-30',now.getTime())).toBeNull();const data=input([rating('old','2020-02-01'),rating('future','2027-01-01')]);expect(buildReview(week,data,undefined,null,now).visits).toBe(0);expect(availableReviewPeriods(data,now).some(p=>p.start.startsWith('2027'))).toBe(false);});
  it('never creates current unfinished or entirely empty periods',()=>{expect(availableReviewPeriods(input(),now)).toEqual([]);expect(availableReviewPeriods(input([rating('today','2026-09-07')]),now)).toEqual([]);});
  it('includes both boundaries exactly once',()=>{const r=buildReview(week,input([rating('start',week.start),rating('end',week.end)]),undefined,null,now);expect(r.places).toBe(1);});
});
describe('review facts',()=>{
  it('deduplicates the active visit against history while retaining revisits',()=>{const current=rating('a','2026-09-03');const old=(date:string):LocalVisitRecord=>({id:date,restaurantId:'a',visit_date:date,created_at:date+'T12:00:00Z',score:7,would_return:true,notes:'',tags:[],photos:[],friend_ids:[]});const data=input([current],{history:{a:[old('2026-09-03'),old('2026-09-01')]}});expect(reviewEvents(data)).toHaveLength(2);const r=buildReview(week,data,undefined,null,now);expect(r.visits).toBe(2);expect(r.places).toBe(1);});
  it('counts meals separately and excludes linked recipe copies',()=>{const r=buildReview(week,input([],{meals:[{id:'meal',name:'Pasta',date:'2026-09-01',score:9,createdAt:now.getTime()} as HomeMeal],recipes:[{id:'linked',linkedMealId:'meal',createdAt:'2026-09-01T12:00:00Z'} as Recipe,{id:'new',title:'Soup',linkedMealId:null,createdAt:'2026-09-02T12:00:00Z'} as Recipe]}),undefined,null,now);expect(r.meals).toBe(1);expect(r.recipes).toBe(1);});
  it('recognizes new cuisines using earlier history and counts a cuisine once per place',()=>{const data=input([rating('old','2026-08-01'),rating('a','2026-09-01',{cuisine:'Italian, Italian'}),rating('b','2026-09-02',{cuisine:'Thai'})]);const r=buildReview(week,data,undefined,null,now);expect(r.newCuisines).toEqual(['Thai']);expect(r.cuisines.find(c=>c.name==='Italian')?.count).toBe(1);});
  it('respects score locks and excludes slider grades',()=>{const data=input([rating('slider','2026-09-02',{score:10,ratingMethod:'slider'}),rating('a','2026-09-01')],{scoresUnlocked:false});const r=buildReview(week,data,undefined,null,now);expect(r.favorite?.name).toBe('a');expect(r.favorite?.score).toBeNull();expect(r.avgScore).toBeNull();});
  it('withholds small-cohort comparisons and labels valid ones as all-time',()=>{const data=input([rating('a','2026-09-01')]);const b={rankedUsers:19,platformAvgScore:7.2,gradingPercentile:.4,breadthPercentile:.8,distinctivePercentile:.9} as TasteBenchmarks;expect(buildReview(week,data,undefined,b,now).community).toBeNull();const r=buildReview(week,data,undefined,{...b,rankedUsers:20},now);expect(r.community?.breadth).toBe(80);expect(reviewStories(r).find(s=>s.id==='community')?.detail).toContain('all-time');});
  it('makes annual stories more detailed, with a separate Pro breakdown',()=>{const data=input([rating('a','2025-06-01')]);const year=buildReview(previousPeriod('year',now),data,undefined,null,now);expect(year.timeline).toHaveLength(12);expect(reviewStories(year).some(s=>s.id==='depth'&&s.pro)).toBe(true);expect(reviewStories(buildReview(week,data,undefined,null,now)).some(s=>s.id==='depth')).toBe(false);});
});
describe('review archive and automatic reveal',()=>{
  it('prioritizes the annual reveal and never repeats a seen review',()=>{const date=new Date('2026-01-01T12:00:00');const data=input([rating('a','2025-12-27')]);const year=buildReview(previousPeriod('year',date),data),month=buildReview(previousPeriod('month',date),data);expect(eligibleAutoReview([month,year],[],date)?.period.kind).toBe('year');expect(eligibleAutoReview([month,year],[year.period.id],date)?.period.kind).toBe('month');expect(eligibleAutoReview([year],[year.period.id],date)).toBeUndefined();});
  it('never reveals another account’s archived data',()=>{const r=buildReview(week,input());expect(readReviewArchive({version:1,ownerId:'a',reviews:[r]},'b').reviews).toEqual([]);});
  it('preserves an opt-out and round-trips a complete saved snapshot',()=>{const r=buildReview(week,input([rating('a','2026-09-01')]),undefined,null,now);const a=readReviewArchive(JSON.parse(JSON.stringify({version:1,ownerId:'a',reviews:[r],seen:[r.period.id],autoReveal:false})),'a');expect(a.reviews[0]).toEqual(r);expect(a.autoReveal).toBe(false);expect(a.seen).toEqual([r.period.id]);});
});

import { mergeReviewArchives } from './in-review';
describe('cross-device review persistence',()=>{
  it('unions stories and seen state, keeping the first immutable snapshot',()=>{
    const early=buildReview(week,input([rating('a','2026-09-01')]),undefined,null,now);
    const later={...early,visits:9,generatedAt:'2026-09-08T12:00:00Z'};
    const month=buildReview(previousPeriod('month',now),input());
    const result=mergeReviewArchives({version:1,ownerId:'a',reviews:[early],seen:[early.period.id],autoReveal:false,preferenceUpdatedAt:20},{version:1,ownerId:'a',reviews:[later,month],seen:[],autoReveal:true,preferenceUpdatedAt:10},'a');
    expect(result.reviews).toHaveLength(2);expect(result.reviews.find(r=>r.period.id===early.period.id)?.visits).toBe(1);expect(result.seen).toContain(early.period.id);expect(result.autoReveal).toBe(false);
  });
});
