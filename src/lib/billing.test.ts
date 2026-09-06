import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ native: true, configure: vi.fn(), eligibility: vi.fn(), offerings: vi.fn(), purchase: vi.fn(), login: vi.fn() }));
vi.mock('./native-oauth', () => ({ isNativeRuntime: () => mocks.native }));
vi.mock('./api-base', () => ({ apiUrl: (s: string) => '/'+s, apiHeaders: async () => ({}) }));
vi.mock('./external-links', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@revenuecat/purchases-capacitor', () => ({
  LOG_LEVEL: { DEBUG: 'debug', WARN: 'warn' }, INTRO_ELIGIBILITY_STATUS: { INTRO_ELIGIBILITY_STATUS_ELIGIBLE: 2 },
  Purchases: { setLogLevel: vi.fn(), configure: mocks.configure, logIn: mocks.login, getOfferings: mocks.offerings, checkTrialOrIntroductoryPriceEligibility: mocks.eligibility, purchasePackage: mocks.purchase },
}));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.stubEnv('VITE_REVENUECAT_IOS_KEY', 'test-key'); mocks.native = true;
  mocks.configure.mockResolvedValue(undefined); mocks.login.mockResolvedValue(undefined);
  mocks.offerings.mockResolvedValue({ current: { annual: { product: { identifier:'annual', price:29.99, priceString:'$29.99', currencyCode:'USD', introPrice:{price:0, periodNumberOfUnits:7, periodUnit:'DAY'} } } } });
});
describe('billing reliability', () => {
  it('waits for configuration and configures only once for concurrent callers', async () => {
    let ready!: () => void; mocks.configure.mockImplementation(() => new Promise<void>(r => { ready = r; }));
    const billing = await import('./billing');
    const first = billing.configureBilling('user'); const second = billing.configureBilling('user');
    const offers = billing.getNativeOffers();
    await vi.waitFor(() => expect(mocks.configure).toHaveBeenCalledTimes(1));
    expect(mocks.offerings).not.toHaveBeenCalled(); ready();
    await Promise.all([first, second, offers]); expect(mocks.configure).toHaveBeenCalledTimes(1);
  });
  it('does not treat a failed account switch as ready to purchase', async () => {
    const billing = await import('./billing'); await billing.configureBilling('first');
    mocks.login.mockRejectedValue(new Error('offline')); await billing.configureBilling('second');
    expect(billing.billingReadyFor('second')).toBe(false);
  });
  it.each([0,1,2,3])('shows a trial only when eligibility is confirmed (%s)', async status => {
    mocks.eligibility.mockResolvedValue({ annual: { status } });
    const billing = await import('./billing'); await billing.configureBilling('user');
    expect((await billing.getNativeOffers())[0].trialDays).toBe(status === 2 ? 7 : 0);
  });
  it('loads prices without a trial promise when eligibility fails', async () => {
    mocks.eligibility.mockRejectedValue(new Error('offline'));
    const billing = await import('./billing'); await billing.configureBilling('user');
    expect((await billing.getNativeOffers())[0]).toMatchObject({priceLine:'$29.99 / year',trialDays:0});
  });
  it('does not turn an unconfirmed purchase into an active entitlement', async () => {
    mocks.purchase.mockResolvedValue({customerInfo:{entitlements:{active:{}}}});
    const billing = await import('./billing');
    expect((await billing.purchaseNative({} as never)).entitlement.active).toBe(false);
  });
  it('handles a store cancellation quietly', async () => {
    mocks.purchase.mockRejectedValue({userCancelled:true});
    const billing = await import('./billing');
    expect(await billing.purchaseNative({} as never)).toMatchObject({ok:false,cancelled:true,message:''});
  });
  it('reports a blocked popup before starting checkout', async () => {
    mocks.native=false; vi.stubGlobal('window',{open:vi.fn(() => null)}); const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    const billing = await import('./billing');
    expect((await billing.startWebCheckout('annual')).ok).toBe(false);expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();
  });
  it('opens checkout synchronously and closes its tab on a server failure', async () => {
    mocks.native=false;const close=vi.fn();const open=vi.fn(() => ({opener:{},close,location:{replace:vi.fn()}}));
    vi.stubGlobal('window',{open,location:{origin:'https://example.test'}});
    vi.stubGlobal('fetch',vi.fn(async () => {expect(open).toHaveBeenCalledTimes(1);return {ok:false,json:async()=>({error:'Unavailable'})};}));
    const billing = await import('./billing');expect((await billing.startWebCheckout('annual')).ok).toBe(false);expect(close).toHaveBeenCalledTimes(1);vi.unstubAllGlobals();
  });
});
