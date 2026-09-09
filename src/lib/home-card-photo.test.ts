import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./keys', () => ({ GOOGLE_PLACES_KEY: 'test-only' }));
import { getHomeCardPhoto } from './home-card-photo';
afterEach(() => vi.unstubAllGlobals());
it('requests only photos, chooses a sharp suitable crop, preserves credit, and reuses the displayed result', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({photos:[
    {name:'places/ChIJone/photos/panorama',widthPx:4000,heightPx:300},
    {name:'places/ChIJone/photos/square',widthPx:1200,heightPx:1200,authorAttributions:[{displayName:'Alex',uri:'https://maps.google.com/contrib/alex'}]},
  ]})}).mockResolvedValueOnce({ok:true,json:async()=>({photoUri:'https://lh3.googleusercontent.com/example'})});
  vi.stubGlobal('fetch', fetcher);
  const place={id:'ChIJone',name:'Place',address:'New York'};
  const first=getHomeCardPhoto(place);
  expect(getHomeCardPhoto(place)).toBe(first);
  expect(await first).toEqual({url:'https://lh3.googleusercontent.com/example',authors:[{name:'Alex',uri:'https://maps.google.com/contrib/alex'}]});
  expect(fetcher.mock.calls[0][1].headers['X-Goog-FieldMask']).toBe('photos');
  expect(fetcher.mock.calls[1][0]).toContain('/photos/square/media');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('does not substitute a different restaurant for an imported place', async () => {
  const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({places:[{displayName:{text:'Wrong restaurant'},photos:[]}]})});
  vi.stubGlobal('fetch',fetcher);
  expect(await getHomeCardPhoto({id:'import-one',name:'Torrisi',address:'New York'})).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('handles API failures without breaking the card', async () => {
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
  expect(await getHomeCardPhoto({id:'ChIJoffline',name:'Place',address:''})).toBeNull();
});
it('avoids a name-only guess when an imported place has no location', async () => {
  const fetcher=vi.fn(); vi.stubGlobal('fetch',fetcher);
  expect(await getHomeCardPhoto({id:'local-unknown',name:'Cafe',address:''})).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
