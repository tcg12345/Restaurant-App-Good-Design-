import React, { useEffect, useRef } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { MessageCircle, Users } from 'lucide-react';
import { useGlassSegments } from '../../lib/glass-buttons';

type Section = 'messages' | 'friends';
export function SocialHubTabs({ id, section, onSelect, suspended, unreadCount, pendingRequestCount }: {
  id: string; section: Section; onSelect: (section: Section) => void;
  suspended: boolean; unreadCount: number; pendingRequestCount: number;
}) {
  const items = [
    { key: 'messages', title: 'Messages', symbol: 'bubble.left', Icon: MessageCircle, count: unreadCount },
    { key: 'friends', title: 'Friends', symbol: 'person.2', Icon: Users, count: pendingRequestCount },
  ] as const;
  const glass = useGlassSegments({ id: 'social-hub-tabs', suspended, items: items.map(item => ({
    id: item.key, symbol: item.symbol, title: item.title,
    label: `${item.title}${item.count > 0 ? `, ${item.count} ${item.key === 'friends' ? 'pending requests' : 'unread messages'}` : ''}`,
    badge: item.count > 0 ? (item.count > 99 ? '99+' : String(item.count)) : undefined,
    badgeTone: item.key === 'friends' ? 'danger' : 'primary',
    active: section === item.key, onClick: () => { if (!suspended) onSelect(item.key); },
  })) });
  const reduced = useReducedMotion();
  const progress = useMotionValue(section === 'friends' ? 1 : 0);
  const x = useTransform(progress, value => `${value * 100}%`);
  const animation = useRef<ReturnType<typeof animate> | null>(null);
  const drag = useRef<{ id: number; x: number; start: number; width: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  function settle(value: number) {
    animation.current?.stop();
    // Reduced motion is synchronous; even a zero-duration animation queues a
    // frame that can overwrite a second drag started immediately afterward.
    if (reduced) { animation.current = null; progress.set(value); return; }
    animation.current = animate(progress, value, { type: 'spring', stiffness: 440, damping: 36 });
  }
  useEffect(() => {
    drag.current = null;
    if (glass.active) { animation.current?.stop(); progress.set(section === 'friends' ? 1 : 0); }
    else settle(section === 'friends' ? 1 : 0);
    return () => animation.current?.stop();
  }, [section, suspended, reduced, glass.active]);
  return <div ref={glass.ref} className={`social-hub-tabs ${glass.active ? 'is-native' : 'glass-control'}`}
    role="tablist" aria-label="Friends and messages" aria-hidden={glass.active || undefined}
    onPointerDown={e => {
      if (glass.active || suspended || !e.isPrimary || e.button !== 0) return;
      suppressClick.current = false;
      animation.current?.stop();
      drag.current = { id: e.pointerId, x: e.clientX, start: progress.get(), width: Math.max(1, (e.currentTarget.getBoundingClientRect().width - 8) / 2), moved: false };
    }}
    onPointerMove={e => {
      const gesture = drag.current;
      if (!gesture || gesture.id !== e.pointerId) return;
      const dx = e.clientX - gesture.x;
      if (!gesture.moved && Math.abs(dx) < 4) return;
      gesture.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      progress.set(Math.max(0, Math.min(1, gesture.start + dx / gesture.width)));
    }}
    onPointerUp={e => {
      const gesture = drag.current;
      if (!gesture || gesture.id !== e.pointerId) return;
      drag.current = null;
      if (!gesture.moved) { settle(section === 'friends' ? 1 : 0); return; }
      suppressClick.current = true;
      const releasedProgress = gesture.start + (e.clientX - gesture.x) / gesture.width;
      const next = releasedProgress >= .5 ? 'friends' : 'messages';
      settle(next === 'friends' ? 1 : 0);
      if (!suspended) onSelect(next);
    }}
    onPointerCancel={() => { drag.current = null; settle(section === 'friends' ? 1 : 0); }}
    onLostPointerCapture={() => { if (drag.current) { drag.current = null; settle(section === 'friends' ? 1 : 0); } }}
    onClickCapture={e => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); suppressClick.current = false; } }}>
    <motion.span aria-hidden="true" className="social-hub-tab-selected" style={{ x }} />
    {items.map(({ key, title, Icon, count }, index) => <button type="button" key={key} id={`${id}-${key}`} role="tab"
      aria-selected={section === key} aria-controls={`${id}-panel`} tabIndex={!glass.active && section === key ? 0 : -1}
      disabled={suspended} onClick={() => onSelect(key)} onKeyDown={e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        suppressClick.current = false;
        const next = e.key === 'Home' ? 'messages' : e.key === 'End' ? 'friends' : index === 0 ? 'friends' : 'messages';
        onSelect(next); document.getElementById(`${id}-${next}`)?.focus();
      }}><span className="social-hub-tab-label"><Icon size={17} />{title}{count > 0 && <span className={`social-hub-badge ${key === 'friends' ? 'requests' : ''}`} aria-label={`${count} ${key === 'friends' ? 'pending requests' : 'unread messages'}`}>{count > 99 ? '99+' : count}</span>}</span></button>)}
  </div>;
}
