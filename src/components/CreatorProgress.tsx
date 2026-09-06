import React from 'react';
import { Check } from 'lucide-react';

/** Named steps make the editor's structure visible and allow quick revisions. */
export function CreatorProgress({ labels, current, onSelect, canSelect = () => true }: {
  labels: string[]; current: number; onSelect: (index: number) => void; canSelect?: (index: number) => boolean;
}) {
  return <nav className="creator-progress" aria-label="Creation steps">
    {labels.map((label, index) => <button key={label} type="button" onClick={() => onSelect(index)}
      aria-label={label} disabled={!canSelect(index)} aria-current={current === index ? 'step' : undefined}
      className={index === current ? 'is-current' : index < current ? 'is-done' : ''}>
      <span className="creator-progress-number">{index < current ? <Check size={13} /> : index + 1}</span>
      <span>{label}</span>
    </button>)}
  </nav>;
}
