import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { GlassButton } from '../lib/glass-buttons';

/**
 * Back, on native Liquid Glass, held off the status bar by the safe area.
 * For pages with no header bar (TopListPage, TasteProfilePage): rendered
 * in its own layer so it stays above the condensed strip that fades in
 * underneath it, in the same 860px column the page content uses.
 */
export const FloatingBack: React.FC<{ id: string; onBack: () => void }> = ({ id, onBack }) => (
  <div className="pointer-events-none absolute inset-x-0 top-0 z-10 mx-auto w-full max-w-[860px] px-4 pt-safe-3">
    <div className="flex h-11 items-center">
      <GlassButton
        id={id}
        symbol="arrow.left"
        label="Back"
        onClick={onBack}
        className="hit-44 pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full text-on-surface/80 transition-transform active:scale-95"
      >
        <ArrowLeft size={18} />
      </GlassButton>
    </div>
  </div>
);
