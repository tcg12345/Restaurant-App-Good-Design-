// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FeedNavigation } from './FeedNavigation';
import type { FeedFilter } from '../SocialFeed';
import type { FeedLens } from '../../lib/feed-discovery';
vi.mock('../../lib/glass-buttons',()=>({GlassButton:({label,onClick,children}:any)=><button aria-label={label} onClick={onClick}>{children}</button>}));
vi.mock('../shared-lists/SheetShell',()=>({SheetShell:({open,onClose,children,footer}:any)=>open?<div role="dialog"><button onClick={onClose}>Close</button>{children}{footer}</div>:null,SheetCta:({onClick,children}:any)=><button onClick={onClick}>{children}</button>}));
let host:HTMLDivElement,root:Root;
function Harness(){const [audience,setAudience]=useState<FeedFilter>('friends');const [lens,setLens]=useState<FeedLens>('latest');const route=useLocation();return <><FeedNavigation audience={audience} lens={lens} onAudienceChange={setAudience} onLensChange={setLens}/><output>{audience}|{lens}|{route.pathname}</output></>;}
beforeEach(async()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>setTimeout(cb,0));vi.stubGlobal('cancelAnimationFrame',clearTimeout);host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<MemoryRouter><Harness/></MemoryRouter>));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function click(label:string){const button=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent===label)!;await act(async()=>button.click());}
const value=()=>host.querySelector('output')!.textContent;
it('has one primary row with a working Reels destination',async()=>{expect(host.querySelectorAll('nav button')).toHaveLength(2);const link=host.querySelector<HTMLAnchorElement>('nav a')!;expect(link.textContent).toBe('Reels');await act(async()=>link.click());expect(value()).toBe('friends|latest|/reels');});
it('applies audience and ordering together, then preserves the feed order through Saved',async()=>{await click('Filter feed');await click('Verified');await click('Highly rated');expect(value()).toBe('friends|latest|/');await click('Show feed');expect(value()).toBe('experts|highlights|/');await click('Saved');expect(value()).toBe('experts|saved|/');await click('Feed');expect(value()).toBe('experts|highlights|/');});
it('cancels a draft without changing the feed',async()=>{await click('Filter feed');await click('Cooking');await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));expect(document.querySelector('[role="dialog"]')).toBeNull();expect(value()).toBe('friends|latest|/');});
it('keeps saved mode when changing audience, and prevents a meaningless cooking rating order',async()=>{await click('Saved');await click('Filter feed');await click('Cooking');expect(document.querySelector('[aria-label="Feed order"]')).toBeNull();await click('Show saved');expect(value()).toBe('recipes|saved|/');await click('Feed');await click('Filter feed');const rated=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Highly rated')!;expect(rated.disabled).toBe(true);});
