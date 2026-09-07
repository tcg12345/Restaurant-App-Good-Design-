import { Link } from 'react-router-dom';
import { usePageBack } from '../lib/usePageBack';
export function NotFoundPage() {
  const back = usePageBack('/');
  return <main className="min-h-[100dvh] bg-surface text-on-surface flex flex-col items-start justify-center gap-5 px-7">
    <h1 className="text-3xl font-semibold tracking-tight">This page isn't here.</h1>
    <p className="text-on-surface/60">The link may have changed. Let's get you back.</p>
    <button className="min-h-11 rounded-full bg-primary text-on-primary px-6" onClick={back}>Go back</button>
    <Link className="min-h-11 flex items-center text-primary" to="/" replace>Go to Home</Link>
  </main>;
}
