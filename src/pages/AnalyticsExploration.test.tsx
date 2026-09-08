// @vitest-environment jsdom
import React,{act,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {ExplorationReport,ExplorationVisitor} from '../lib/analytics-exploration';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../lib/supabase',()=>({supabase:{rpc}}));
import {AnalyticsExploration} from './AnalyticsExploration';
const visitor={actor:'visitor-a',username:'taylor',user_id:'visitor-a'};
const report:ExplorationReport={generated_at:'2026-09-07T20:00:00Z',days:30,actor:null,summary:{visitors:2,visits:3,active_ms:120000,pages:2,timed_visits:2},session_summary:{sessions:2,median_pages:1.5,median_active_ms:60000,single_page_sessions:1},pages:[{page:'restaurant_detail',views:2,visitors:2,active_ms:120000,timed_visits:2,avg_active_ms:60000,median_active_ms:60000,brief_visits:0,long_visits:2,entries:0,last_stops:2,repeat_visitors:0},{page:'search_main',views:1,visitors:1,active_ms:0,timed_visits:0,avg_active_ms:null,median_active_ms:null,brief_visits:0,long_visits:0,entries:1,last_stops:0,repeat_visitors:0}],baseline:[{page:'restaurant_detail',views:2,visitors:2,avg_active_ms:30000}],transitions:[{source:'search_main',destination:'restaurant_detail',transitions:1,visitors:1}],rhythm:[{weekday:0,hour:12,visits:3}],sessions:[{actor:'visitor-a',session_id:'session',platform:'web',started_at:'2026-09-07T20:00:00Z',views:2,pages:2,active_ms:60000,steps:[{id:'s1',page:'search_main',occurred_at:'2026-09-07T20:00:00Z',active_ms:0,segments:0},{id:'s2',page:'restaurant_detail',occurred_at:'2026-09-07T20:01:00Z',active_ms:60000,segments:4}]}],unmatched_segments:0};
let host:HTMLDivElement,root:Root;
function Harness(){const [person,setPerson]=useState<ExplorationVisitor|null>(null);return <AnalyticsExploration days={30} platform="web" refresh={0} visitor={person} onVisitorChange={setPerson}/>;}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();rpc.mockReset();rpc.mockImplementation(async(name:string)=>({data:name==='analytics_exploration'?report:[visitor],error:null}));host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
async function render(){await act(async()=>root.render(<Harness/>));await act(async()=>{await vi.runOnlyPendingTimersAsync();});}
async function selectPerson(value:string){await act(async()=>{const select=host.querySelector<HTMLSelectElement>('[aria-label="Exploration visitor"]')!;select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));});}
it('renders attention, overlooked destinations, navigation, rhythm and ordered session stops',async()=>{
 await render();expect(host.textContent).toContain('Where attention goes.');expect(host.querySelectorAll('.exp-page-row')).toHaveLength(2);
 expect(host.querySelector('.exp-unvisited')?.textContent).toContain('Messages');expect(host.querySelector('.exp-unvisited')?.textContent).not.toContain('Restaurant details');
 expect(host.querySelectorAll('.exp-heat-cell')).toHaveLength(168);expect(host.querySelector('.exp-flow')?.textContent).toContain('Restaurant search');
 expect(host.querySelectorAll('.exp-journeys li')).toHaveLength(2);expect(host.querySelector('.exp-journeys li')?.textContent).toContain('Not measured');
});
it('filters by a specific person and compares their attention with the all-user baseline',async()=>{
 await render();await selectPerson(visitor.actor);
 expect(rpc).toHaveBeenCalledWith('analytics_exploration',{days:30,platform_filter:'web',actor_id:visitor.actor});
 expect(host.querySelector('.exp-scope-badge')?.textContent).toContain('@taylor');expect(host.querySelector('.exp-flow-center')?.textContent).toContain('100% longer than all-user average');
 await selectPerson('');expect(host.querySelector('.exp-scope-badge')?.textContent).toContain('All visitors');
});
it('lets the owner navigate to a page through a transition',async()=>{
 await render();await act(async()=>host.querySelector<HTMLButtonElement>('.exp-flow-grid button')!.click());
 expect(host.querySelector('.exp-flow-center h4')?.textContent).toBe('Restaurant search');
 expect(host.querySelector('.exp-flow-center')?.textContent).toContain('Not measured');
});
it('debounces visitor search and retries report errors',async()=>{
 rpc.mockImplementationOnce(async()=>({data:null,error:{message:'temporarily unavailable'}}));await render();expect(host.querySelector('[role="alert"]')?.textContent).toContain('temporarily unavailable');
 await act(async()=>host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());expect(host.querySelector('.exp-attention')).not.toBeNull();
 const input=host.querySelector<HTMLInputElement>('[aria-label="Find a visitor"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Taylor');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>{await vi.advanceTimersByTimeAsync(260);});
 expect(rpc).toHaveBeenCalledWith('analytics_exploration_visitors',{days:30,platform_filter:'web',search_query:'Taylor'});
});
it('discards a late response after changing audience',async()=>{
 await render();let resolve!:(v:any)=>void;
 rpc.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await selectPerson(visitor.actor);await selectPerson('');
 await act(async()=>resolve({data:{...report,summary:{...report.summary,visitors:999}},error:null}));
 expect(host.querySelector('.exp-stats')?.textContent).not.toContain('999');expect(host.querySelector('.exp-scope-badge')?.textContent).toContain('All visitors');
});
it('does not call unvisited destinations avoidance when there is no data',async()=>{
 rpc.mockImplementation(async(name:string)=>({data:name==='analytics_exploration'?{...report,summary:{...report.summary,visits:0},pages:[]}:[],error:null}));
 await render();expect(host.textContent).toContain('No recorded journeys here yet.');expect(host.querySelector('.exp-unvisited')).toBeNull();
});
