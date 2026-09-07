// Preview-only local room state. No real account, database or provider calls.
export { normalizeGroupPreferences, swipeVote, tiedPlaces, GroupError } from '../src/lib/group-swipe.ts';
const userId=location.search.includes('guest')?'guest':'preview';
export let room:any={id:'preview-custom-room',code:'CUSTOM01',host:'preview',source:'custom',allowGuestAdds:true,shortlistVersion:0,status:'lobby',round:1,location:{label:'New York',lat:40.7,lng:-74},count:0,radius:5000,members:{preview:{name:'You',ready:false,votes:{},vetoUsed:false},guest:{name:'Sam',ready:true,votes:{},vetoUsed:false}},deck:[],results:[],vetoed:[]};
const changed=()=>{room.shortlistVersion++;room.count=room.deck.length;Object.values(room.members).forEach((m:any)=>m.ready=false);};
export const choices=[{id:'preview-cote',name:'COTE Flatiron',cuisine:'Korean, Steakhouse',address:'16 W 22nd St, New York, NY 10010',lat:40.7411,lng:-73.9913,types:['restaurant'],photoUrl:'/images/onboarding/contemporary-dining.jpg',priceLevel:4,rating:4.6,distance:1250,fit:0,reason:'Picked by your group'},{id:'preview-jungsik',name:'Jungsik',cuisine:'Korean, Contemporary',address:'2 Harrison St, New York, NY 10013',lat:40.7189,lng:-74.0091,types:['restaurant'],photoUrl:'/images/onboarding/contemporary-dining.jpg',priceLevel:4,rating:4.6,distance:1250,fit:0,reason:'Picked by your group'}];
if(location.search.includes('filled')||location.search.includes('guest'))room.deck=choices.map(p=>({...p,addedBy:'preview'}));
if(location.search.includes('hostonly'))room.allowGuestAdds=false;
room.count=room.deck.length;
export async function groupAction(action:string,payload:any={}){
 if(action==='list')return [];
 if(action==='create'){room={...room,...payload,deck:[],count:0};}
 if(action==='custom_add'){const p=choices.find(p=>p.id===payload.placeId);if(p&&!room.deck.some((x:any)=>x.id===p.id)){room.deck.push({...p,addedBy:userId});changed();}}
 if(action==='custom_remove'){room.deck=room.deck.filter((p:any)=>p.id!==payload.place);changed();}
 if(action==='custom_settings'){room.allowGuestAdds=payload.allowGuestAdds;changed();}
 if(action==='custom_ready')room.members[userId].ready=true;
 if(action==='start')room.status='swiping';
 return structuredClone(room);
}
export async function groupPlaceSummary(){return {summary:'A restaurant selected by your group.'};}
