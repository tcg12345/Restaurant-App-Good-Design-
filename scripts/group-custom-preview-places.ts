export * from '../src/lib/places.ts';
import {choices} from './group-custom-preview-service';
export async function searchPlacesByText(query:string){return choices.filter(p=>p.name.toLowerCase().includes(query.toLowerCase()));}
