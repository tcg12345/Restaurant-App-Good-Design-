import {afterEach,expect,it,vi} from 'vitest';
vi.mock('./analytics',()=>({track:vi.fn(),trackRestaurant:vi.fn(),analyticsEnabled:false}));
import {getPlaceDetails} from './places';
import {michelinToPlaceResult, type MichelinInfo} from './michelin';
import {restaurantDataSource,rememberRestaurantSource} from './restaurant-provenance';
afterEach(()=>vi.unstubAllGlobals());
it('keeps Google provenance when a details revisit is served without a new API call',async()=>{
 const fetch=vi.fn(async()=>new Response(JSON.stringify({id:'provenance-cache-test',displayName:{text:'Test restaurant'}})));
 vi.stubGlobal('fetch',fetch);
 const first=await getPlaceDetails('provenance-cache-test');const cached=await getPlaceDetails('provenance-cache-test');
 expect(first.dataSource).toBe('google_places');expect(cached.dataSource).toBe('google_places');
 expect(fetch).toHaveBeenCalledTimes(1);expect(restaurantDataSource(cached.id)).toBe('google_places');
});
it('labels the bundled catalog and supports future own records without assuming unknown IDs are local',()=>{
 const own=michelinToPlaceResult({name:'Catalog restaurant',lat:1,lng:2,city:'City',country:'Country',priceTier:2,cuisine:'French'} as MichelinInfo);
 expect(own.dataSource).toBe('own_data');expect(restaurantDataSource(own.id)).toBe('own_data');
 rememberRestaurantSource('future-catalog-restaurant','own_data');expect(restaurantDataSource('future-catalog-restaurant')).toBe('own_data');
 expect(restaurantDataSource('old-record-without-provenance')).toBe('unknown');
});
