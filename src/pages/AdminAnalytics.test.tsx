// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../lib/supabase',()=>({supabase:{rpc}}));
vi.mock('../lib/analytics',()=>({analyticsEnabled:true}));
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({})}));
vi.mock('recharts',()=>({ResponsiveContainer:()=>null,AreaChart:()=>null,Area:()=>null,XAxis:()=>null,YAxis:()=>null,Tooltip:()=>null,CartesianGrid:()=>null}));
import {AnalyticsDashboard} from './AdminAnalytics';
let root:Root,host:HTMLDivElement;
const report={overview:{},daily:[],retention:[],paths:[],restaurants:[{restaurant_id:'cottage',name:'The Cottage',opens:2,saves:1,unsaves:0,sources:[{data_source:'google_places',opens:1,saves:1},{data_source:'own_data',opens:1,saves:0}]}],users:[{actor:'visitor',views:1}]};
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);rpc.mockReset();rpc.mockResolvedValue({data:report,error:null});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function render(admin=true){await act(async()=>root.render(<MemoryRouter><AnalyticsDashboard isAdmin={admin} adminChecked={admin} authLoading={false}/></MemoryRouter>));}
async function click(text:string){const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent===text)!;expect(button).toBeTruthy();await act(async()=>button.click());}
it('shows expandable action counts by data source and sends the chosen ranking to the report',async()=>{
 await render();await click('Restaurants');
 expect(host.textContent).toContain('Data source by action');
 const details=host.querySelector('details')!;expect(details.textContent).toContain('Google Places');expect(details.textContent).toContain('Our data');
 expect(details.querySelector('table')!.tBodies[0].rows).toHaveLength(2);
 const select=host.querySelector<HTMLSelectElement>('[aria-label="Rank restaurants by"]')!;
 await act(async()=>{select.value='saves';select.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(rpc).toHaveBeenLastCalledWith('analytics_report',expect.objectContaining({restaurant_sort:'saves'}));
});
it('recovers from a timeline pagination connection error instead of staying busy',async()=>{
 await render();await click('Users');
 const events=Array.from({length:100},(_,i)=>({id:String(i),created_at:'2026-09-07T20:00:00Z',event:'page_view'}));
 rpc.mockResolvedValueOnce({data:events,error:null});
 await act(async()=>host.querySelector<HTMLButtonElement>('.analytics-row-link')!.click());
 rpc.mockRejectedValueOnce(new Error('offline'));await click('Load older activity');
 expect(host.querySelector('[role="alert"]')?.textContent).toContain('Connection interrupted');
 expect(Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Load older activity')?.disabled).toBe(false);
});
it('does not fetch an owner report for a regular user',async()=>{await render(false);expect(rpc).not.toHaveBeenCalled();expect(host.textContent).toContain('Page not found');});
