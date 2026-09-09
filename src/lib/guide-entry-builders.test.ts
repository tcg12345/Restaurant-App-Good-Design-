import { expect, it } from 'vitest';
import { entryFromRating, entryFromListRecipe, entryFromDbRecipe } from './guide-entry-builders';
it('captures the full photo set when adding a restaurant and does not seed hours', () => {
 const entry=entryFromRating({restaurantId:'place',name:'Juniper',cuisine:'French',price:'$$',image:'cover.jpg',photos:[{url:'one.jpg'},{url:'two.jpg'}],score:9} as any);
 expect(entry.photos).toEqual(['cover.jpg','one.jpg','two.jpg']);
 expect(entry.hours).toBeUndefined();
});
it('keeps every photo from either recipe source', () => {
 expect(entryFromListRecipe({id:'one',title:'Pasta',coverPhoto:'cover.jpg',photos:[{url:'one.jpg'},{url:'two.jpg'}]} as any).photos).toEqual(['cover.jpg','one.jpg','two.jpg']);
 expect(entryFromDbRecipe({id:'two',title:'Pasta',photos:['one.jpg','two.jpg','one.jpg']} as any).photos).toEqual(['one.jpg','two.jpg']);
});
