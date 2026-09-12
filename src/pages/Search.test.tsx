// @vitest-environment jsdom
import React, {act, useLayoutEffect} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {MemoryRouter, useNavigate, useLocation} from 'react-router-dom';
import {afterEach, expect, it, vi} from 'vitest';
vi.mock('../contexts/SettingsContext',()=>({useSettings:()=>({phoneMode:true})}));
vi.mock('../contexts/ListsContext',()=>({useLists:()=>({openHomeMealModal:vi.fn()})}));
vi.mock('../contexts/HomeLocationContext',()=>({useHomeLocation:()=>({location:{label:'New York, NY',lat:40,lng:-74}})}));
vi.mock('../components/HomeLocationBar',()=>({isExactAddress:()=>false}));
vi.mock('../lib/keys',()=>({MAPBOX_TOKEN:''}));
vi.mock('../lib/usePageBack',()=>({usePageBack:()=>vi.fn()}));
vi.mock('../lib/search-takeover',()=>({setSearchTakeoverOpen:vi.fn()}));
vi.mock('../lib/glass-buttons',()=>({useGlassButtonsActive:()=>false,useGlassSegments:()=>({active:false,ref:null}),GlassButton:({label,onClick,children}:any)=><button aria-label={label} onClick={onClick}>{children}</button>}));
vi.mock('../components/SearchField',()=>({searchFieldChipWidth:()=>120,SearchField:({readOnly,onPress,value,onChange,inputRef,...props}:any)=><input ref={inputRef} aria-label={props['aria-label']} readOnly={readOnly} value={value} onClick={()=>onPress?.()} onChange={e=>onChange(e.target.value)}/>}));
vi.mock('./SearchMain',()=>({SearchMain:({query}:any)=><div data-testid="results">Results: {query}</div>}));
vi.mock('./Discover',()=>({Discover:()=> <div>Map</div>}));
vi.mock('./RecipesForYou',()=>({RecipesForYou:()=>null}));
vi.mock('../components/PullToRefresh',()=>({PullToRefresh:()=>null}));
vi.mock('motion/react',()=>({useReducedMotion:()=>true,AnimatePresence:({children}:any)=>children,motion:{div:({children,initial,animate,exit,transition,...props}:any)=><div {...props}>{children}</div>}}));
import {Search} from './Search';
import {RetainedTabLocation} from '../components/RetainedTabLocation';
let root:Root, host:HTMLDivElement;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
function Preview({paint}: {paint: (open:boolean)=>void}) {
  const route=useLocation(), navigate=useNavigate();
  useLayoutEffect(()=>{paint(!!document.querySelector('[data-testid=results]'));});
  return <><button onClick={()=>navigate('/search',{state:{openTakeover:true,navigationPresentation:'tab'}})}>Home search</button><button onClick={()=>navigate('/')}>Home</button>
    <RetainedTabLocation path="/search" active={route.pathname==='/search'}><Search/></RetainedTabLocation></>;
}
async function mount(entry:any){host=document.createElement('div');document.body.append(host);root=createRoot(host);const paint=vi.fn();await act(async()=>root.render(<MemoryRouter initialEntries={[entry]}><Preview paint={paint}/></MemoryRouter>));return paint;}
async function click(label:string){await act(async()=>{const b=[...host.querySelectorAll('button')].find(b=>b.textContent===label||b.getAttribute('aria-label')===label);b!.click();});}
it('opens directly in real search with its shared location control on a cold entry',async()=>{
 const paint=await mount({pathname:'/search',state:{openTakeover:true}});
 expect(paint.mock.calls[0]).toEqual([true]);
 expect(host.querySelector('[aria-label="Searching near New York — change location"]')).not.toBeNull();
 expect(host.querySelector<HTMLInputElement>('[aria-label="Search"]')!.readOnly).toBe(false);
 await click('Close search');expect(host.querySelector('[data-testid=results]')).toBeNull();
});
it('opens the retained Search page and consumes each Home request only once',async()=>{
 await mount('/');
 await click('Home search');expect(host.querySelector('[data-testid=results]')).not.toBeNull();
 await click('Close search');expect(host.querySelector('[data-testid=results]')).toBeNull();
 await click('Home');await click('Home search');expect(host.querySelector('[data-testid=results]')).not.toBeNull();
});
