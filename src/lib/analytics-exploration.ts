export type ExplorationPage = {page:string;views:number;visitors:number;active_ms:number;timed_visits:number;avg_active_ms:number|null;median_active_ms:number|null;brief_visits:number;long_visits:number;entries:number;last_stops:number;repeat_visitors:number};
export type ExplorationVisitor = {actor:string;username?:string;display_name?:string;user_id?:string;views?:number};
export type ExplorationReport = {
 generated_at:string;actor:string|null;days:number;
 summary:{visitors:number;visits:number;active_ms:number;pages:number;timed_visits:number};
 session_summary:{sessions:number;median_pages:number|null;median_active_ms:number|null;single_page_sessions:number};
 pages:ExplorationPage[];baseline:{page:string;views:number;visitors:number;avg_active_ms:number|null}[];
 transitions:{source:string;destination:string;transitions:number;visitors:number}[];
 rhythm:{weekday:number;hour:number;visits:number}[];
 sessions:{actor:string;session_id:string;platform:string;started_at:string;views:number;pages:number;active_ms:number;steps:{id:string;page:string;occurred_at:string;active_ms:number;segments:number}[]}[];
 unmatched_segments:number;
};
// Main destinations, not every dynamic URL, settings subpage or access-gated flow.
export const EXPLORATION_PAGES = [
 ['home','Home','Discover'],['search','Discover','Discover'],['search_main','Restaurant search','Discover'],
 ['map','Restaurant map','Discover'],['location','City explorer','Discover'],['location_map','City map','Discover'],
 ['restaurant_detail','Restaurant details','Discover'],['pantry','Lists & wishlist','Organize'],
 ['profile','My profile','Organize'],['profile_taste','Taste profile','Organize'],['activity','Activity','Organize'],
 ['reels','Reels','Connect'],['circle','Circle','Connect'],['messages','Messages','Connect'],['user_detail','Other profiles','Connect'],
 ['decide','Decide together','Connect'],['recipes-for-you','Recipe ideas','Create'],['recipe_detail','Recipe details','Create'],
 ['guides','Guides','Create'],['guides_detail','Guide details','Create'],['create','Create','Create'],['settings','Settings','Account'],['pro','Membership','Account'],
] as const;
export function explorationPageName(page:string) {
 return EXPLORATION_PAGES.find(([key])=>key===page)?.[1] || page.replace(/[_-]/g,' ').replace(/^./,c=>c.toUpperCase());
}
export function visitorName(v:ExplorationVisitor) {return v.username?`@${v.username}`:v.display_name||`${v.user_id?'Account':'Guest'} · ${v.actor.slice(0,8)}`;}
export function explorationDuration(ms:number|null|undefined) {
 if(ms==null)return 'Not measured';
 if(ms===0)return '0s';
 if(ms<1000)return '<1s';
 const seconds=Math.round(ms/1000);
 if(seconds<60)return `${seconds}s`;
 if(seconds<3600)return `${Math.floor(seconds/60)}m${seconds%60?` ${seconds%60}s`:''}`;
 return `${Math.floor(seconds/3600)}h ${Math.floor((seconds%3600)/60)}m`;
}
export function overlookedPages(pages:ExplorationPage[]) {return EXPLORATION_PAGES.filter(([key])=>!pages.some(p=>p.page===key&&p.views>0));}
export function compareAttention(person:number|null,baseline:number|null|undefined) {
 if(person==null||baseline==null||baseline<=0)return 'Comparison unavailable';
 const change=Math.round(100*(person/baseline-1));
 return Math.abs(change)<1?'Same as all-user average':`${Math.abs(change)}% ${change>0?'longer':'shorter'} than all-user average`;
}
