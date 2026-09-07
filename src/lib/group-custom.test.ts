import { expect, it, vi } from 'vitest';
import { customAddPreflight, resolveCustomPlace } from '../../supabase/functions/group-swipe/custom';
const room = (extra = {}) => ({ source: 'custom', status: 'lobby', host: 'host', members: { host: {}, guest: {} }, allowGuestAdds: true, deck: [], ...extra });
it('preflights membership, room mode, contribution permission and limits before a paid lookup', () => {
  expect(()=>customAddPreflight(room(),'outsider','place1')).toThrow('not in this room');
  expect(()=>customAddPreflight(room({ source:'recommendations' }),'host','place1')).toThrow('before voting');
  expect(()=>customAddPreflight(room({ status:'swiping' }),'host','place1')).toThrow('before voting');
  expect(()=>customAddPreflight(room({ allowGuestAdds:false }),'guest','place1')).toThrow('Only the host');
  expect(()=>customAddPreflight(room({ deck:[{ id:'place1',addedBy:'guest' },{id:'place2',addedBy:'guest'}] }),'guest','place3')).toThrow('up to two');
  expect(customAddPreflight(room({ deck:[{id:'place1',addedBy:'guest'}] }),'guest','place1')).toBe('existing');
  expect(()=>customAddPreflight(room({ deck:Array.from({length:15},(_,i)=>({id:`full${i}`})) }),'host','place1')).toThrow('15 restaurants');
  expect(customAddPreflight(room(),'host','place1')).toBe('add');
});
it('resolves canonical restaurant facts, has no taste prediction, and never exposes a Places key', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id:'place1',displayName:{text:'A restaurant'},formattedAddress:'1 Main St',location:{latitude:40.7,longitude:-74},types:['restaurant'],primaryType:'italian_restaurant',businessStatus:'OPERATIONAL',priceLevel:'PRICE_LEVEL_MODERATE',rating:4.4,photos:[{name:'places/place1/photos/one',authorAttributions:[{displayName:'Photographer'}]}] }))).mockResolvedValueOnce(new Response(JSON.stringify({photoUri:'https://example.com/photo.jpg'})));
  const place=await resolveCustomPlace('place1',{lat:40.7,lng:-74},'secret-test-key',fetcher);
  expect(place).toMatchObject({id:'place1',name:'A restaurant',cuisine:'italian',fit:0,distance:0,priceLevel:2,photoUrl:'https://example.com/photo.jpg'});
  expect(JSON.stringify(place)).not.toContain('secret-test-key');
  expect(place.attributions).toEqual([{displayName:'Photographer'}]);
});
it('rejects nonrestaurants and closed places rather than inserting unchecked client facts', async () => {
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:'place1',displayName:{text:'Office'},types:['office'],businessStatus:'OPERATIONAL'})));
  await expect(resolveCustomPlace('place1',{lat:0,lng:0},'key',fetcher)).rejects.toThrow('restaurant');
});
