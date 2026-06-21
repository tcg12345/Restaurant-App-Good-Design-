import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';

/**
 * The eyebrow + serif title block used above every card section. Composes the
 * existing `.section-eyebrow` / `.section-title` utilities so the type stays in
 * one place. Optional "See all" action and a short description — only rendered
 * when the caller already has one (we don't invent new navigation).
 */
interface SectionHeaderProps {
  eyebrow?: string;
  title: React.ReactNode;
  description?: string;
  action?: { label: string; to?: string; onClick?: () => void };
  className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({ eyebrow, title, description, action, className }) => {
  const actionCls =
    'flex-shrink-0 text-[13px] font-semibold text-on-surface/55 transition-colors hover:text-primary';
  return (
    <div className={cn('mb-4', className)}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <div className="section-eyebrow mb-1">{eyebrow}</div>}
          <h2 className="section-title">{title}</h2>
        </div>
        {action &&
          (action.to ? (
            <Link to={action.to} className={actionCls}>
              {action.label}
            </Link>
          ) : (
            <button type="button" onClick={action.onClick} className={actionCls}>
              {action.label}
            </button>
          ))}
      </div>
      {description && (
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-snug text-on-surface/55">{description}</p>
      )}
    </div>
  );
};
