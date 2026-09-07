export { normalizeGroupPreferences, swipeVote, tiedPlaces, GroupError } from '../src/lib/group-swipe.ts';
export const room = { id:'preview-room',code:'PREVIEW1',host:'preview',status:'swiping',round:1,location:{label:'New York',lat:40.7,lng:-74},count:5,radius:5000,members:{preview:{name:'You',ready:true,votes:{},vetoUsed:false}},deck:[{id:'test-cote',name:'COTE Flatiron',cuisine:'Korean, Steakhouse',address:'16 W 22nd St, New York, NY 10010',lat:40.7411,lng:-73.9913,photoUrl:'/images/onboarding/contemporary-dining.jpg',priceLevel:4,rating:4.6,fit:92,reason:'Matches everyone’s mood',distance:1250}],results:[],vetoed:[]};
export async function groupAction(action: string) { return action==='list' ? [] : room; }
export async function groupPlaceSummary() { await new Promise(r=>setTimeout(r,1800)); return {summary:'Korean barbecue meets an American steakhouse, with beef cooked at the table. It’s a dining format built around sharing.'}; }
if (location.search.includes('rank')) {
  room.deck.push({...room.deck[0],id:'test-jungsik',name:'Jungsik',address:'2 Harrison St, New York, NY 10013',lat:40.7189,lng:-74.0091,cuisine:'Korean, Contemporary'});
  Object.assign(room.members.preview, {votes:{'test-cote':'yes','test-jungsik':'yes'},ranking:{ordered:['test-cote'],remaining:['test-jungsik'],lo:0,hi:1,comparisons:0,done:false}});
}
