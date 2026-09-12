import { supabase } from './supabase';
import { resetMediaAccess } from './media-access-scope';
export interface SafetyTarget { kind: string; id: string; authorId: string; }
export const REPORT_REASONS = { harassment:'Harassment or bullying', hate:'Hateful content', sexual:'Sexual content', violence:'Violence or threats', spam:'Spam or misleading content', privacy:'Privacy or personal information', other:'Something else' } as const;
export async function reportContent(target:SafetyTarget,reason:string,details:string) {
 const { error } = await supabase.rpc('report_content',{p_kind:target.kind,p_id:target.id,p_reason:reason,p_details:details}); if(error) throw error;
}
export async function setUserBlock(id:string,blocked:boolean) {
 const {error}=await supabase.rpc('set_user_block',{target:id,blocked}); if(error) throw error;
 resetMediaAccess();
 // Discard only fetched screen snapshots, never the user's unsynced edits or login.
 try { for(const key of Object.keys(localStorage)) if(key.startsWith('goodeats-view-cache:')) localStorage.removeItem(key); } catch {}
}
export function safetyError(error:unknown) { return error && typeof error==='object' && 'message' in error ? String(error.message) : 'Something went wrong. Please try again.'; }
