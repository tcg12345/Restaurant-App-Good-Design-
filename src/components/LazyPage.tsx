import React from 'react';

import { PageSkeleton, type PageSkeletonVariant } from './PageSkeleton';

function isMissingPageModule(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading (?:CSS )?chunk .* failed|error loading dynamically imported module/i.test(message);
}

export function retryPageLoad(error: unknown, retry: () => void, reload: () => void = () => window.location.reload()) {
  // Browsers cache failed module imports. Recreating React.lazy with the same
  // old hashed URL cannot recover a tab kept open across a deployment.
  if (isMissingPageModule(error)) reload();
  else retry();
}

class PageLoadBoundary extends React.Component {
  declare props: { children?: unknown; retry: () => void };
  state: { failed: boolean; error: unknown } = { failed: false, error: null };
  static getDerivedStateFromError(error: unknown) { return { failed: true, error }; }
  render() {
    if (this.state.failed) return <div role="alert" className="min-h-[60dvh] flex flex-col items-center justify-center gap-4 px-6 text-center text-on-surface">
      <p>Couldn't open this page.</p>
      <p className="text-sm text-on-surface/70">{isMissingPageModule(this.state.error) ? 'Reload the app to get the current page files.' : 'Check your connection and try again.'}</p>
      <button className="rounded-full bg-primary text-on-primary px-6 py-3 text-sm font-medium" onClick={() => retryPageLoad(this.state.error, this.props.retry)}>{isMissingPageModule(this.state.error) ? 'Reload app' : 'Try again'}</button>
    </div>;
    return this.props.children;
  }
}

/** Each route owns its loading/error state; navigation and retained pages stay mounted. */
export function lazyPage(load: () => Promise<{ default: React.ComponentType<any> }>, variant: PageSkeletonVariant = 'list') {
  let pending: ReturnType<typeof load> | undefined;
  let resolved: Awaited<ReturnType<typeof load>> | undefined;
  const preload = () => pending ??= load().then(module => {
    resolved = module;
    return module;
  }).catch(error => { pending = undefined; throw error; });
  const initial = React.lazy(preload);
  function LazyPage(props: any) {
    const [attempt, setAttempt] = React.useState(() => ({ Page: initial, id: 0 }));
    // A warmed module renders synchronously: React.lazy otherwise suspends for
    // one microtask even when import() has already resolved.
    const Page = resolved?.default ?? attempt.Page;
    return <PageLoadBoundary key={attempt.id} retry={() => setAttempt(prev => ({ Page: React.lazy(preload), id: prev.id + 1 }))}>
      <React.Suspense fallback={<PageSkeleton variant={variant} />}><Page {...props} /></React.Suspense>
    </PageLoadBoundary>;
  }
  return Object.assign(LazyPage, { preload });
}
