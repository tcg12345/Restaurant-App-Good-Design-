import {createClient} from 'npm:@supabase/supabase-js@2.100.0';
import {muxApiAuth,muxSigningConfig,signPlaybackToken} from '../_shared/mux.ts';
import {getOwnedMuxAsset} from '../_shared/mux-ownership.ts';
import {frameTimes,ManualReview,moderationFlagged,needsPrivacyReview,photoObject,screeningInput,type ScreeningJob} from './policy.ts';

const url=Deno.env.get('SUPABASE_URL')!;
const db=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
async function imageData(blob:Blob):Promise<string>{
 if(!/^image\/(jpeg|png|webp|gif)$/.test(blob.type)||blob.size>10*1024*1024||!blob.size)throw new ManualReview('unsupported_image');
 const bytes=new Uint8Array(await blob.arrayBuffer());let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return `data:${blob.type};base64,${btoa(raw)}`;
}
async function ownPhoto(bucket:string,path:string,owner:string):Promise<string>{
 if(path.split('/').some(p=>!p||p==='..'||p==='.')||path.includes('\\'))throw new ManualReview('invalid_media_path');
 if(!path.startsWith(owner+'/' )&&!(bucket==='avatars'&&path.startsWith('restaurant-photos/'+owner+'/')))throw new ManualReview('external_media');
 const endpoint=`${url}/storage/v1/object/authenticated/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
 const response=await fetch(endpoint,{headers:{Authorization:`Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`},redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('media_unavailable');
 if(Number(response.headers.get('content-length'))>10*1024*1024)throw new ManualReview('large_image');
 const reader=response.body?.getReader();if(!reader)throw new Error('media_unavailable');const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>10*1024*1024)throw new ManualReview('large_image');chunks.push(part.value);}}finally{await reader.cancel();}
 return imageData(new Blob(chunks,{type:response.headers.get('content-type')?.split(';')[0]||''}));
}
async function screen(job:ScreeningJob,key:string):Promise<{result:string;reason:string}> {
 const input=screeningInput(job.snapshot);if(needsPrivacyReview(input.text))return {result:'flagged',reason:'privacy_or_spam'};
 const images:string[]=[];let totalImageBytes=0;const addImage=(image:string)=>{totalImageBytes+=image.length;if(totalImageBytes>16*1024*1024)throw new ManualReview('large_media_set');images.push(image);};
 for(const photo of input.photos){
  // Never fetch caller-controlled URLs, follow redirects, or transmit URL tokens.
  if(job.kind==='reels'&&photo===job.snapshot.video_url)continue;
  const object=photoObject(photo,new URL(url).origin,job.user_id);
  if(!object)throw new ManualReview('external_media');
  addImage(await ownPhoto(object.bucket,object.path,job.user_id));
 }
 const isVideo=job.kind==='reels'||job.snapshot.media_type==='video';
 const mediaPath=job.snapshot.media_path;
 if(!isVideo&&typeof mediaPath==='string'&&mediaPath)addImage(await ownPhoto('post-media',mediaPath,job.user_id));
 let audioNeedsReview=false;
 if(isVideo){
  // Resolve trusted provider ownership; a client-supplied playback ID is not proof.
  const table=job.kind==='reels'?'reels':'post_items';
  const {data:row,error}=await db.from(table).select('mux_asset_id,mux_playback_id').eq('id',job.content_id).single();
  if(error)throw new Error('video_unavailable');
  if(!row?.mux_asset_id||!row.mux_playback_id)throw new Error('video_processing');
  const auth=muxApiAuth(),cfg=muxSigningConfig();if(!auth||!cfg)throw new Error('mux_configuration');
  const asset=await getOwnedMuxAsset(auth,row.mux_asset_id,job.user_id,job.content_id,job.kind==='reels');
  if(!asset||!asset.playback_ids?.some(p=>p.id===row.mux_playback_id&&p.policy==='signed'))throw new ManualReview('unverified_video');
  const metadata=asset as typeof asset & {duration?:number;tracks?:Array<{type:string}>};
  // Moderation accepts text/images, not audio. Keep videos with audio in manual
  // review after visual screening instead of silently treating audio as checked.
  audioNeedsReview=!Array.isArray(metadata.tracks)||metadata.tracks.some(t=>t.type==='audio');
  for(const time of frameTimes(Number(metadata.duration))){
   const token=await signPlaybackToken(cfg,row.mux_playback_id,'t',Math.floor(Date.now()/1000)+300,{time,width:640});
   const response=await fetch(`https://image.mux.com/${encodeURIComponent(row.mux_playback_id)}/thumbnail.jpg?token=${token}`,{redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw new Error('video_frame_unavailable');addImage(await imageData(await response.blob()));
  }
 }
 if(!input.text.trim()&&!images.length)return {result:'passed',reason:'empty_shared_text'};
 for(let i=0;i<Math.max(1,images.length);i+=4){
  const content:Array<Record<string,unknown>>=[];
  if(input.text.trim())content.push({type:'text',text:input.text});
  images.slice(i,i+4).forEach(image=>content.push({type:'image_url',image_url:{url:image}}));
  const response=await fetch('https://api.openai.com/v1/moderations',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'omni-moderation-latest',input:content}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('provider_unavailable');
  if(moderationFlagged(await response.json()))return {result:'flagged',reason:'provider_flagged'};
 }
 return audioNeedsReview?{result:'unsupported',reason:'video_audio_review'}:{result:'passed',reason:'automated_checks_passed'};
}
Deno.serve(async request=>{
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 const secret=request.headers.get('x-screening-secret');if(!secret||secret.length>200)return reply({error:'Unauthorized'},401);
 const key=Deno.env.get('OPENAI_API_KEY');if(!key)return reply({error:'Screening unavailable'},503);
 const claimed=await db.rpc('claim_content_screening',{p_secret:secret,p_limit:2});
 if(claimed.error)return reply({error:'Unauthorized or unavailable'},401);
 const results=await Promise.all((claimed.data as ScreeningJob[]||[]).map(async job=>{
  let outcome:{result:string;reason:string};try{outcome=await screen(job,key);}catch(error){outcome=error instanceof ManualReview?{result:'unsupported',reason:error.message}:{result:'retry',reason:'temporary_screening_error'};}
  const finished=await db.rpc('finish_content_screening',{p_kind:job.kind,p_id:job.content_id,p_revision:job.revision,p_lease:job.lease_id,p_result:outcome.result,p_reason:outcome.reason});
  return finished.error?'deferred':outcome.result;
 }));
 return reply({processed:results.length,results});
});
