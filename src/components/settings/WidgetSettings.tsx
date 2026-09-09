import React from 'react';
import { Bookmark, CalendarDays, LayoutGrid, MessageCircle, Sparkles, Trophy } from 'lucide-react';
import './WidgetSettings.css';

const widgets = [
  { title: 'Upcoming Meals', icon: CalendarDays, detail: 'Your next restaurant reservation or recipe night. Larger sizes show more of what’s ahead.', sizes: 'Small · Medium · Large · Lock Screen' },
  { title: 'Taste Profile', icon: Sparkles, detail: 'Your taste tier, points, and progress toward the next level. The wider version adds your exploration stats and community rank when available.', sizes: 'Small · Medium · Lock Screen' },
  { title: 'Your Circle', icon: MessageCircle, detail: 'Unread messages and friend requests at a glance. Tap to catch up.', sizes: 'Small · Medium' },
  { title: 'Saved for Later', icon: Bookmark, detail: 'A new daily pick from restaurants you’ve saved. A little inspiration for your next plan.', sizes: 'Small · Medium' },
  { title: 'Top Tables', icon: Trophy, detail: 'Your personal restaurant podium. Changes as you rate and discover new favorites.', sizes: 'Small · Medium' },
];
export function WidgetSettings() {
  return <div className="widget-settings">
    <div className="widget-settings-intro"><LayoutGrid size={28} strokeWidth={1.5} /><h2>A little GoodEats,<br />right at home.</h2><p>Your plans, taste, and circle. Pick what you’d like to keep close.</p></div>
    <section className="widget-install" aria-labelledby="widget-install-title"><h3 id="widget-install-title">Add a widget on iPhone</h3><ol><li>Touch and hold an empty area on your Home Screen.</li><li>Tap <strong>Edit → Add Widget</strong>, then search for <strong>GoodEats</strong>.</li><li>Choose a widget and size, then tap <strong>Add Widget</strong>.</li></ol><p>For Lock Screen widgets, touch and hold your Lock Screen, choose Customize, then tap the widget area.</p></section>
    <div className="widget-options">{widgets.map(({ title, icon: Icon, detail, sizes }) => <section key={title}><span className="widget-option-icon"><Icon size={21} strokeWidth={1.6} /></span><div><h3>{title}</h3><p>{detail}</p><small>{sizes}</small></div></section>)}</div>
    <p className="widget-settings-note">Open GoodEats after signing in to fill your widgets. They refresh when the app syncs, and meal plans advance on a schedule. iOS controls refresh timing. Messages are shown as counts only; private conversations and reservation details stay in the app.</p>
  </div>;
}
