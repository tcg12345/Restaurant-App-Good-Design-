// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach, afterEach, expect, it, vi} from 'vitest';
const api=vi.hoisted(()=>({friends:vi.fn(),ratings:vi.fn(),meals:vi.fn(),profiles:vi.fn(),likes:vi.fn(),counts:vi.fn(),posts:vi.fn(),suggestions:vi.fn(),mounts:vi.fn(),nav:vi.fn()}));
vi.mock('../lib/supabase',()=>({supabaseConfigured:false,supabaseUrl:'https://test.invalid',supabase:{auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}));
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({user:{id:'viewer'}})}));
vi.mock('../contexts/ReelsContext',()=>({useReels:()=>({reels:[]})}));
vi.mock('../contexts/PostsContext',()=>({usePosts:()=>({})}));
vi.mock('../contexts/ListsContext',()=>({useLists:()=>({homeMeals:[],isWishlisted:()=>false})}));
vi.mock('../contexts/SettingsContext',()=>({useSettings:()=>({phoneMode:true,setHideBottomNav:api.nav})}));
vi.mock('../contexts/SignInModalContext',()=>({useSignInModal:()=>({requireSignIn:vi.fn()})}));
vi.mock('../lib/supabase-community',async original=>({...await original<any>(),getFriends:api.friends,getFriendActivity:api.ratings,getFriendsPublicHomeMeals:api.meals,getProfilesByIds:api.profiles,getLikesForRatings:api.likes,getCommentCounts:api.counts,getSuggestedProfiles:api.suggestions}));
vi.mock('../lib/supabase-posts',()=>({listPosts:api.posts}));
vi.mock('./RatingStripCard',()=>({ratingStripGridClass:()=>'',RatingStripCard:({place,likeCount}:any)=>{React.useEffect(()=>{api.mounts();},[]);return <div data-rating>{place}: {likeCount}</div>;}}));
vi.mock('./HomeReels',()=>({FeedReelCard:()=>null}));
vi.mock('./ShareDialog',()=>({ShareDialog:()=>null}));
vi.mock('./RecipeCommentThread',()=>({RecipeCommentThread:()=>null}));
vi.mock('./SuggestedPeople',()=>({SuggestedPeople:({profiles,people}:any)=><div>{JSON.stringify(profiles??people)}</div>}));
import {SocialFeed} from './SocialFeed';
function deferred<T>() {let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
let host:HTMLDivElement,root:Root;
const rating={id:'r1',user_id:'friend',restaurant_id:'place',restaurant_name:'Ready restaurant',score:9,notes:'',cuisine:'Italian',price:'$$',address:'New York',visit_date:'2026-09-12',tags:[],would_return:true,friend_ids:[],lat:null,lng:null,photo_url:'',created_at:'2026-09-12T12:00:00Z',updated_at:'2026-09-12T12:00:00Z'};
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 api.friends.mockResolvedValue([{friend_id:'friend'}]);api.ratings.mockResolvedValue([rating]);api.meals.mockResolvedValue([]);api.profiles.mockResolvedValue({friend:{id:'friend',username:'friend',display_name:'Friend'}});api.posts.mockResolvedValue([]);api.likes.mockResolvedValue({likes:{},userLiked:new Set()});api.counts.mockResolvedValue({});api.suggestions.mockResolvedValue([]);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function mount(){await act(async()=>root.render(<MemoryRouter><SocialFeed feedOnly/></MemoryRouter>));}
it('shows ratings while post media and engagement metadata are still pending',async()=>{
 const posts=deferred<any[]>(),likes=deferred<any>();api.posts.mockReturnValue(posts.promise);api.likes.mockReturnValue(likes.promise);
 await mount();expect(host.textContent).toContain('Ready restaurant');expect(api.suggestions).not.toHaveBeenCalled();
 const card=host.querySelector('[data-rating]');expect(api.mounts).toHaveBeenCalledTimes(1);
 await act(async()=>likes.resolve({likes:{r1:4},userLiked:new Set()}));
 expect(host.querySelector('[data-rating]')).toBe(card);expect(host.textContent).toContain('Ready restaurant: 4');expect(api.mounts).toHaveBeenCalledTimes(1);
 await act(async()=>posts.resolve([]));expect(host.querySelector('[data-rating]')).toBe(card);
});
it('does not declare the feed empty while a content source is still pending',async()=>{
 api.ratings.mockResolvedValue([]);const posts=deferred<any[]>();api.posts.mockReturnValue(posts.promise);
 await mount();expect(api.suggestions).not.toHaveBeenCalled();
 api.posts.mockResolvedValue([]);await act(async()=>posts.resolve([]));expect(api.suggestions).toHaveBeenCalledTimes(1);
});
