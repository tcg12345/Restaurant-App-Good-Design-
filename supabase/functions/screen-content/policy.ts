export type ScreeningJob = {kind:string;content_id:string;revision:string;user_id:string;snapshot:Record<string,unknown>;lease_id:string};
export class ManualReview extends Error {}
export function photoObject(reference:string, origin:string, owner:string): {bucket:string;path:string}|null {
  let url:URL;try {url=new URL(reference);} catch {return null;}
  if(url.origin!==origin)return null;
  const match=url.pathname.match(/^\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/(photos|avatars|post-media|reels-videos)\/(.+)$/);
  if(!match)return null;
  let path:string;try{path=decodeURIComponent(match[2]);}catch{return null;}
  if(path.split('/').some(p=>p==='..'||p==='.'||!p)||path.includes('\\'))return null;
  if(!path.startsWith(owner+'/')&&!(match[1]==='avatars'&&path.startsWith('restaurant-photos/'+owner+'/')))return null;
  return {bucket:match[1],path};
}
export function screeningInput(snapshot:Record<string,unknown>):{text:string;photos:string[]} {
 const text:string[]=[];const photos=new Set<string>();let nodes=0;
 const walk=(value:unknown,key='')=>{
  if(++nodes>5000)throw new ManualReview('large_content');
  if(typeof value==='string'){
   if(!value.trim())return;
   if(/^https?:\/\//i.test(value)) {
    if(/photo|image|avatar|cover|url/i.test(key)||/\.(png|jpe?g|webp|gif|heic|avif)(?:\?|$)/i.test(value))photos.add(value);
    else text.push(value.replace(/[?#].*$/,''));
   } else if(/photo|image|avatar|cover|^url$/i.test(key)&&!/^media_path$|^video_path$/.test(key))throw new ManualReview('unsupported_media_reference');
   else if(!/^(mux_|media_path|video_path|post_id|recipe_id|rating_id|reel_id)/.test(key))text.push(value);
  }else if(Array.isArray(value))value.forEach(v=>walk(v,key));else if(value&&typeof value==='object')Object.entries(value).forEach(([k,v])=>walk(v,k));
 };walk(snapshot);
 const joined=text.join('\n');if(joined.length>24000||photos.size>40)throw new ManualReview('large_content');
 return {text:joined,photos:[...photos]};
}
export function needsPrivacyReview(text:string):boolean {
 // Hold possible personal contact details and obvious spam for a person.
 return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)||/\b(?:doxx?|home address|kill yourself|guaranteed profit|send (?:me )?(?:money|bitcoin))\b/i.test(text);
}
export function moderationFlagged(body:unknown):boolean {
 if(!body||typeof body!=='object'||!('results' in body)||!Array.isArray(body.results)||!body.results.length)throw new Error('invalid_provider_response');
 return body.results.some((r:unknown)=>{
  if(!r||typeof r!=='object'||!('flagged' in r)||typeof r.flagged!=='boolean')throw new Error('invalid_provider_result');
  return r.flagged;
 });
}
export function frameTimes(duration:number):number[] {
 if(!Number.isFinite(duration)||duration<=0||duration>61)throw new ManualReview('unsupported_video_duration');
 const count=Math.max(1,Math.ceil(duration/5));
 return Array.from({length:count},(_,i)=>Math.min(duration-0.05,(i+0.5)*duration/count));
}
