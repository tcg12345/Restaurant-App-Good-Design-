// @vitest-environment jsdom
import React,{act,useState} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
vi.mock('./LinkedRecipesEditor',()=>({LinkedRecipesEditor:()=>null}));
import {StepIngredients} from './StepIngredients';
let host:HTMLDivElement,root:Root,latest:any;
function Harness(){
 const [state,setState]=useState<any>({ingredientGroups:[{name:'Ingredients',ingredients:[{name:'water',amount:'1',unit:''}]}]});latest=state;
 return <StepIngredients state={state} dispatch={(action:any)=>{if(action.type==='UPDATE_INGREDIENT')setState({...state,ingredientGroups:[{name:'Ingredients',ingredients:[action.ingredient]}]});}}/>;
}
beforeEach(async()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<Harness/>));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function typeUnit(value:string){const input=host.querySelector<HTMLInputElement>('[aria-label="Unit"]')!;await act(async()=>input.focus());await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});return input;}
it('preserves and normalizes a typed unit when moving to the ingredient field',async()=>{
 const input=await typeUnit('cup');await act(async()=>host.querySelector<HTMLInputElement>('[aria-label="Ingredient"]')!.focus());expect(latest.ingredientGroups[0].ingredients[0].unit).toBe('cups');expect(input.value).toBe('cups');expect(host.querySelector('.rcx-ing-unit-pop')).toBeNull();
});
it('keeps a selected unit and supports clearing it',async()=>{
 const input=await typeUnit('t');const tsp=[...host.querySelectorAll('button')].find(b=>b.textContent==='tsp')!;await act(async()=>tsp.click());await act(async()=>input.blur());expect(latest.ingredientGroups[0].ingredients[0].unit).toBe('tsp');
 await typeUnit('');await act(async()=>input.blur());expect(latest.ingredientGroups[0].ingredients[0].unit).toBe('');
});
