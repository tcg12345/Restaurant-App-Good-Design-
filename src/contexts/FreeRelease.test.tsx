// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
vi.mock('../lib/supabase',()=>({supabase:{},supabaseConfigured:true}));
vi.mock('../lib/billing',()=>({configureBilling:vi.fn(),onCustomerInfo:vi.fn()}));
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({user:null})}));
vi.mock('../contexts/SettingsContext',()=>({useSettings:()=>{throw new Error('Paid plan provider must stay dormant');}}));
vi.mock('../components/pro/ProSheet',()=>({ProSheet:()=>{throw new Error('A free release must never mount the purchase sheet');}}));
vi.mock('../lib/billing-events',()=>({logBillingEvent:vi.fn()}));
import {PlanProvider,usePlan} from './PlanContext';
import {PaywallProvider,usePaywall} from './PaywallContext';
import {ProTag} from '../components/pro/ProMark';
import {configureBilling} from '../lib/billing';
import {logBillingEvent} from '../lib/billing-events';
it('unlocks features immediately without fetching a plan, showing badges, or opening a paywall',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 let paywall:ReturnType<typeof usePaywall>;
 function Screen(){const plan=usePlan();paywall=usePaywall();return <><span>{JSON.stringify({checked:plan.checked,isPro:plan.isPro,subscribed:plan.subscribed,gatesEnabled:plan.gatesEnabled})}</span><ProTag/></>;}
 try {
  await act(async()=>root.render(<PlanProvider><PaywallProvider><Screen/></PaywallProvider></PlanProvider>));
  expect(host.textContent).toBe(JSON.stringify({checked:true,isPro:true,subscribed:false,gatesEnabled:false}));
  expect(paywall!.requirePro('nutrition')).toBe(true);
  await act(async()=>paywall!.openPaywall('settings'));
  expect(paywall!.isOpen).toBe(false);
  expect(paywall!.handleAiError('nutrition',{code:'quota'})).toBe(false);
  expect(configureBilling).not.toHaveBeenCalled();expect(logBillingEvent).not.toHaveBeenCalled();
 }finally{await act(async()=>root.unmount());host.remove();}
});
