import { describe, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => ({ order: vi.fn() }));
vi.mock('./supabase', () => ({ supabaseConfigured:true, supabase:{from:()=>({select:()=>({eq:()=>query})})} }));
import { getUserRecipes } from './supabase-recipes';

describe('recipe hydration for immutable reviews', () => {
  it('distinguishes a genuinely empty cookbook from a failed request', async () => {
    query.order.mockResolvedValueOnce({data:[],error:null});
    await expect(getUserRecipes('owner',true)).resolves.toEqual([]);
    const error={message:'Connection unavailable'};
    query.order.mockResolvedValueOnce({data:null,error});
    await expect(getUserRecipes('owner',true)).rejects.toEqual(error);
  });
  it('propagates network failures to the archive readiness guard', async () => {
    query.order.mockRejectedValueOnce(new Error('Network offline'));
    await expect(getUserRecipes('owner',true)).rejects.toThrow('Network offline');
  });
});
