import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { CardMedia } from './CardMedia';

/**
 * The selection row used inside modal pickers (search popup, share-restaurant,
 * add-to-list flows). Always flat — modals are an immersive context regardless
 * of platform — and carries selection/added state the browsing cards don't.
 * Keep multi-select accumulation logic in the parent; this just reflects state.
 */
interface PickerRowProps {
  name: string;
  meta?: React.ReactNode;
  thumbnail?: string | null;
  /** Trailing content (score badge, custom control). Defaults to a check when selected. */
  right?: React.ReactNode;
  selected?: boolean;
  /** Already-added: greyed out + non-interactive look. */
  added?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}

export const PickerRow: React.FC<PickerRowProps> = ({
  name,
  meta,
  thumbnail,
  right,
  selected = false,
  added = false,
  disabled = false,
  onClick,
  className,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled || added}
    aria-pressed={selected}
    className={cn(
      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
      selected ? 'bg-primary/[0.06] ring-1 ring-primary/20' : 'hover:bg-on-surface/[0.04] active:bg-on-surface/[0.06]',
      added && 'opacity-50',
      className,
    )}
  >
    {thumbnail !== undefined && (
      <CardMedia
        src={thumbnail}
        alt={name}
        aspect="thumb"
        rounded="lg"
        className="h-11 w-11 flex-shrink-0"
        placeholderSize="sm"
      />
    )}
    <div className="min-w-0 flex-1">
      <h3 className="truncate font-serif text-[15px] font-bold leading-snug text-on-surface">{name}</h3>
      {meta && <div className="mt-0.5 truncate text-[12.5px] font-medium text-on-surface/55">{meta}</div>}
    </div>
    <div className="flex flex-shrink-0 items-center gap-2">
      {right}
      {selected && !right && (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white">
          <Check size={14} strokeWidth={3} />
        </span>
      )}
      {added && <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface/40">Added</span>}
    </div>
  </button>
);
