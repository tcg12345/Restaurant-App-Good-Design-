import React from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/**
 * Location-specific landing page. Reached from the home-feed "View all"
 * button next to the Dining-In dropdown. Intentionally blank for now — the
 * location is parsed out of the URL so the real content can be built on
 * top of these params without wiring being changed again.
 */
export const LocationPage: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const label = params.get('label') || 'Location';
  // lat / lng are read here so future content can anchor on them without a
  // second round of plumbing.
  void params.get('lat');
  void params.get('lng');

  return (
    <div className="min-h-screen bg-surface">
      <div className="px-4 pt-5 pb-8">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-4 p-1 -ml-1 text-on-surface/50 hover:text-on-surface transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={22} />
        </button>
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface/40">
          Dining in
        </p>
        <h1 className="mt-1 font-serif font-bold text-3xl text-on-surface leading-tight">
          {label}
        </h1>
      </div>
    </div>
  );
};
