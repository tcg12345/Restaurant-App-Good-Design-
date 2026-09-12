export const SCREENING_CONSENT_VERSION = '2026-09-12-screening';
export const COMMUNITY_CONTENT_CHANGED = 'goodeats-community-content-changed';
const key = (userId:string) => `goodeats-screening-consent:${userId}`;
export function remembersScreeningConsent(userId:string):boolean {
 try {return localStorage.getItem(key(userId))===SCREENING_CONSENT_VERSION;}catch{return false;}
}
export function rememberScreeningConsent(userId:string,allowed:boolean):void {
 try {if(allowed)localStorage.setItem(key(userId),SCREENING_CONSENT_VERSION);else localStorage.removeItem(key(userId));}catch{/* asks again next time */}
}
// Only successful writes to potential shared-content tables wake the status
// query. Personal data is never included in the event or sent to a provider.
const TABLES=new Set(['user_profiles','user_app_data','community_ratings','community_photos','posts','post_items','reels','recipes','guides','activity_comments','post_comments','reel_comments','recipe_reviews','recipe_comments','expert_recommendations']);
export function isCommunityWrite(url:string,method:string):boolean {
 if(!['POST','PATCH','DELETE'].includes(method.toUpperCase()))return false;
 try {const parts=new URL(url).pathname.split('/');return parts[1]==='rest'&&parts[2]==='v1'&&TABLES.has(parts[3]);}catch{return false;}
}
