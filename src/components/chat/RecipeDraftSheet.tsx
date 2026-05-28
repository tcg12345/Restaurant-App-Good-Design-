import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ChefHat, Clock, Users, Flame, Sparkles, Lightbulb, CalendarClock, Repeat, BookOpenCheck, CheckCircle2, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useSettings } from '../../contexts/SettingsContext';
import { useBottomSheet } from '../../lib/useBottomSheet';
import type { HomeMeal } from '../../contexts/ListsContext';

interface RecipeDraftSheetProps {
  open: boolean;
  draft: HomeMeal | null;
  publishedMealId: string | null;
  onClose: () => void;
  onPublish: (draft: HomeMeal) => void;
  onEdit: (draft: HomeMeal) => void;
  onDelete: () => void;
}

/** Full read-only preview of an AI-built recipe draft. Footer carries
 *  Publish (commits to homeMeals via createHomeMeal), Edit (opens the
 *  Advanced builder pre-filled), and Delete draft (removes the chat
 *  block). Phone uses a draggable bottom sheet; desktop renders a
 *  centered modal — mirrors AddFriendSheet. */
export const RecipeDraftSheet: React.FC<RecipeDraftSheetProps> = ({
  open,
  draft,
  publishedMealId,
  onClose,
  onPublish,
  onEdit,
  onDelete,
}) => {
  const { phoneMode } = useSettings();
  const { dragProps, startDrag } = useBottomSheet(open, onClose);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Reset the delete-confirm any time the sheet opens with a new draft.
  React.useEffect(() => {
    if (open) setConfirmingDelete(false);
  }, [open, draft?.id]);

  return (
    <AnimatePresence>
      {open && draft && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: phoneMode ? 0.18 : 0.16 }}
          className={cn(
            'fixed inset-0 z-[70]',
            phoneMode ? 'bg-black/40 backdrop-blur-sm' : 'bg-black/50 backdrop-blur-md',
            !phoneMode && 'flex items-start justify-center pt-[8vh] px-4',
          )}
          onClick={onClose}
        >
          <motion.div
            {...(phoneMode
              ? {
                  initial: { y: '100%' },
                  animate: { y: 0 },
                  exit: { y: '100%' },
                  transition: { type: 'spring' as const, damping: 28, stiffness: 300 },
                  ...dragProps,
                }
              : {
                  initial: { opacity: 0, scale: 0.96, y: -8 },
                  animate: { opacity: 1, scale: 1, y: 0 },
                  exit: { opacity: 0, scale: 0.97, y: -6 },
                  transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const },
                })}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'flex flex-col overflow-hidden bg-surface',
              phoneMode
                ? 'fixed bottom-0 left-0 right-0 rounded-t-3xl h-[92vh]'
                : 'w-full max-w-2xl rounded-3xl max-h-[84vh] shadow-[0_30px_80px_-16px_rgba(0,0,0,0.42)] ring-1 ring-on-surface/[0.06]',
            )}
          >
            {phoneMode && (
              <div
                className="flex justify-center pt-3 pb-1 flex-shrink-0 cursor-grab active:cursor-grabbing"
                onPointerDown={startDrag}
              >
                <div className="w-10 h-1 rounded-full bg-on-surface/15" />
              </div>
            )}

            <div className={cn(
              'flex items-center justify-between flex-shrink-0',
              phoneMode ? 'px-5 pt-2 pb-3' : 'px-6 pt-5 pb-3',
            )}>
              <div className="flex items-center gap-2 min-w-0">
                {publishedMealId ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-100/70 px-2 py-1 rounded-full">
                    <CheckCircle2 size={12} />
                    Published
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-on-surface/60 bg-on-surface/[0.06] px-2 py-1 rounded-full">
                    <Sparkles size={12} />
                    AI draft
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-on-surface/[0.05] flex items-center justify-center hover:bg-on-surface/[0.10] transition-colors"
                aria-label="Close"
              >
                <X size={15} className="text-on-surface/60" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-4">
              <h2 className="font-serif text-[26px] font-bold text-on-surface leading-tight">
                {draft.name}
              </h2>
              {draft.summary && (
                <p className="text-[14px] text-on-surface/70 mt-2 leading-relaxed">
                  {draft.summary}
                </p>
              )}

              <div className="flex flex-wrap gap-2 mt-4">
                {draft.cuisine && (
                  <Chip icon={<ChefHat size={12} />}>{draft.cuisine}</Chip>
                )}
                {draft.course?.map((c) => (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-full bg-on-surface/[0.05] text-on-surface/75"
                  >
                    {c}
                  </span>
                ))}
                {draft.difficulty && (
                  <Chip icon={<Flame size={12} />}>{draft.difficulty}</Chip>
                )}
                {(draft.prepTime ?? 0) + (draft.cookTime ?? 0) > 0 && (
                  <Chip icon={<Clock size={12} />}>
                    {`${(draft.prepTime || 0) + (draft.cookTime || 0)} min`}
                    {draft.prepTime && draft.cookTime
                      ? ` (${draft.prepTime} prep + ${draft.cookTime} cook)`
                      : ''}
                  </Chip>
                )}
                {draft.servings && (
                  <Chip icon={<Users size={12} />}>
                    {draft.yieldDescription || `${draft.servings} ${draft.servings === 1 ? 'serving' : 'servings'}`}
                  </Chip>
                )}
              </div>

              {draft.equipment && draft.equipment.length > 0 && (
                <Section title="Equipment">
                  <ul className="flex flex-wrap gap-2">
                    {draft.equipment.map((e) => (
                      <li
                        key={e}
                        className="text-[12px] px-2.5 py-1 rounded-full bg-on-surface/[0.05] text-on-surface/70"
                      >
                        {e}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section title="Ingredients">
                {draft.ingredientGroups && draft.ingredientGroups.length > 0 ? (
                  draft.ingredientGroups.map((g) => (
                    <div key={g.name} className="mb-4 last:mb-0">
                      {(draft.ingredientGroups!.length > 1 || g.name !== 'Ingredients') && (
                        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-on-surface/50 mb-2">
                          {g.name}
                        </h4>
                      )}
                      <ul className="space-y-1.5">
                        {g.ingredients.map((i, idx) => (
                          <li key={idx} className="text-[14px] text-on-surface/85 leading-relaxed">
                            <span className="font-medium text-on-surface">
                              {[i.amount, i.unit].filter(Boolean).join(' ')}
                            </span>{' '}
                            {i.name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                ) : (
                  <ul className="space-y-1.5">
                    {draft.ingredients?.map((i, idx) => (
                      <li key={idx} className="text-[14px] text-on-surface/85 leading-relaxed">
                        <span className="font-medium text-on-surface">
                          {[i.amount, i.unit].filter(Boolean).join(' ')}
                        </span>{' '}
                        {i.name}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Steps">
                <ol className="space-y-4">
                  {(draft.stepDetails && draft.stepDetails.length > 0
                    ? draft.stepDetails
                    : (draft.steps || []).map((s) => ({ body: s }))
                  ).map((s, idx) => (
                    <li key={idx} className="flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-on-surface/[0.08] flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[11px] font-bold text-on-surface/70">{idx + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          {s.title && (
                            <h4 className="text-[14px] font-semibold text-on-surface">{s.title}</h4>
                          )}
                          {typeof s.durationMin === 'number' && s.durationMin > 0 && (
                            <span className="text-[11px] text-on-surface/55 inline-flex items-center gap-1">
                              <Clock size={10} />
                              {s.durationMin} min
                            </span>
                          )}
                        </div>
                        <p className="text-[14px] text-on-surface/85 leading-relaxed mt-0.5">
                          {s.body}
                        </p>
                        {s.tip && (
                          <p className="text-[12px] text-on-surface/60 leading-relaxed mt-1.5 italic flex gap-1.5">
                            <Lightbulb size={12} className="flex-shrink-0 mt-0.5" />
                            <span>{s.tip}</span>
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </Section>

              {draft.notes && draft.notes.length > 0 && (
                <Section title="Notes">
                  <ul className="space-y-2">
                    {draft.notes.map((n, idx) => {
                      const meta = NOTE_META[n.type] ?? NOTE_META.general;
                      return (
                        <li
                          key={idx}
                          className={cn('flex gap-2.5 text-[13px] leading-relaxed p-3 rounded-2xl', meta.bg, meta.text)}
                        >
                          <meta.Icon size={14} className="flex-shrink-0 mt-0.5" />
                          <span>{n.text}</span>
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              )}

              {draft.tags && draft.tags.length > 0 && (
                <Section title="Tags">
                  <ul className="flex flex-wrap gap-2">
                    {draft.tags.map((t) => (
                      <li
                        key={t}
                        className="text-[12px] px-2.5 py-1 rounded-full bg-on-surface/[0.05] text-on-surface/70"
                      >
                        #{t}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </div>

            <div className={cn(
              'flex-shrink-0 border-t border-on-surface/[0.06]',
              phoneMode ? 'px-5 py-4' : 'px-6 py-4',
            )}>
              {confirmingDelete ? (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] text-on-surface/75">
                    Remove this draft from the chat? You'll lose the AI's version.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="flex-1 h-11 rounded-2xl bg-on-surface/[0.06] text-on-surface text-[14px] font-semibold hover:bg-on-surface/[0.10] transition-colors"
                      onClick={() => setConfirmingDelete(false)}
                    >
                      Keep draft
                    </button>
                    <button
                      type="button"
                      className="flex-1 h-11 rounded-2xl bg-red-600 text-white text-[14px] font-semibold hover:bg-red-700 transition-colors"
                      onClick={() => {
                        setConfirmingDelete(false);
                        onDelete();
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Delete draft"
                    className="w-11 h-11 rounded-2xl bg-on-surface/[0.05] text-on-surface/60 flex items-center justify-center hover:bg-on-surface/[0.10] transition-colors"
                    onClick={() => setConfirmingDelete(true)}
                  >
                    <Trash2 size={16} />
                  </button>
                  <button
                    type="button"
                    className="flex-1 h-11 rounded-2xl bg-on-surface/[0.06] text-on-surface text-[14px] font-semibold hover:bg-on-surface/[0.10] transition-colors"
                    onClick={() => onEdit(draft)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'flex-[1.5] h-11 rounded-2xl text-[14px] font-semibold transition-colors inline-flex items-center justify-center gap-1.5',
                      publishedMealId
                        ? 'bg-emerald-600 text-white cursor-default'
                        : 'bg-on-surface text-surface hover:bg-on-surface/90',
                    )}
                    disabled={publishedMealId !== null}
                    onClick={() => onPublish(draft)}
                  >
                    {publishedMealId ? (
                      <>
                        <CheckCircle2 size={15} />
                        Published
                      </>
                    ) : (
                      'Publish to my cookbook'
                    )}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="font-serif text-[15px] font-bold text-on-surface/85 mb-3">{title}</h3>
      {children}
    </section>
  );
}

function Chip({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-full bg-on-surface/[0.05] text-on-surface/75">
      {icon}
      {children}
    </span>
  );
}

const NOTE_META: Record<string, { Icon: typeof Lightbulb; bg: string; text: string }> = {
  tip: { Icon: Lightbulb, bg: 'bg-amber-50', text: 'text-amber-900' },
  makeAhead: { Icon: CalendarClock, bg: 'bg-sky-50', text: 'text-sky-900' },
  substitution: { Icon: Repeat, bg: 'bg-violet-50', text: 'text-violet-900' },
  general: { Icon: BookOpenCheck, bg: 'bg-on-surface/[0.04]', text: 'text-on-surface/80' },
};
