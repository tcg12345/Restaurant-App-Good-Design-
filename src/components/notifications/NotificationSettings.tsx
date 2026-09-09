import React, { useState } from 'react';
import { Bell, BellRing, ChevronRight, Clock3, ExternalLink, Eye, MessageCircle, Sparkles, Users } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePushNotifications } from '../../contexts/PushNotificationsContext';
import { useNotifications } from '../../contexts/NotificationsContext';
import { NOTIFICATION_CATEGORIES, safeNotificationPath } from '../../lib/notification-policy';
import { notificationDestination, notificationSummary } from '../../lib/supabase-notifications';
import { openAppSettings } from '../../lib/native-settings';
import './NotificationSettings.css';

const Toggle: React.FC<{ title: string; detail?: string; checked: boolean; disabled?: boolean; onChange: () => void }> = ({ title, detail, checked, disabled, onChange }) => {
  return <button className="notification-setting" role="switch" aria-checked={checked} disabled={disabled} onClick={onChange}>
    <span><strong>{title}</strong>{detail && <small>{detail}</small>}</span><span className="notification-toggle" aria-hidden="true"><i /></span>
  </button>;
}
export function NotificationSettings() {
  const { preferences: prefs, permission, native, loading, busy, error, registered, update, enable, refresh, test } = usePushNotifications();
  const { notifications, unreadCount, actors, loading: activityLoading, markRead, markAllRead } = useNotifications();
  const location = useLocation();
  const [tab, setTab] = useState<'preferences' | 'activity'>(() => new URLSearchParams(location.search).get('view') === 'activity' ? 'activity' : 'preferences');
  const [tested, setTested] = useState(false);
  const navigate = useNavigate();
  const allowed = permission === 'granted' || permission === 'provisional';
  const status = !native ? 'Available on iPhone' : permission === 'denied' ? 'Turn on in iPhone Settings' : prefs.enabled && allowed ? 'You’re in the loop' : 'A little heads-up';
  return <div className="notification-settings">
    <div className="notification-view-tabs" role="tablist" aria-label="Notifications">
      <button role="tab" aria-selected={tab === 'preferences'} onClick={() => setTab('preferences')}>Preferences</button>
      <button role="tab" aria-selected={tab === 'activity'} onClick={() => setTab('activity')}>Activity{unreadCount > 0 && <span>{Math.min(unreadCount, 99)}</span>}</button>
    </div>
    {tab === 'preferences' ? <>
      <section className="notification-hero">
        <span className="notification-hero-icon"><BellRing size={27} strokeWidth={1.5} /></span>
        <h2>{status}</h2>
        <p>{!native ? 'Choose what matters here, then enable notifications in the GoodEats iPhone app.' : permission === 'denied' ? 'Allow notifications for GoodEats, then come back here to choose what you receive.' : prefs.enabled && allowed ? 'Plans, people, and the good things you don’t want to miss.' : 'Stay close to your plans and your people. You choose what gets your attention.'}</p>
        {native && (permission === 'denied' ? <button className="settings-primary" onClick={() => void openAppSettings()}>Open iPhone Settings <ExternalLink size={15} /></button> : !prefs.enabled || !allowed ? <button className="settings-primary" disabled={busy || loading} onClick={() => void enable()}>Enable notifications</button> : <span className="notification-connected"><i />{registered ? 'This iPhone is registered' : 'Meal reminders enabled'}</span>)}
      </section>
      {error && <div className="notification-error" role="alert">{error}<button onClick={() => void refresh()}>Retry</button></div>}
      {loading ? <p className="settings-note" role="status">Loading your preferences…</p> : <>
        <section className="notification-section"><h3>Your notifications</h3>
          <div className="notification-group">
            <Toggle title="Allow notifications" detail="Pause alerts without changing your choices below" checked={prefs.enabled} disabled={busy} onChange={() => void (native && !prefs.enabled ? enable() : update({ enabled: !prefs.enabled }))} />
          </div>
          <div className="notification-group">{NOTIFICATION_CATEGORIES.map(category => <Toggle key={category.key} title={category.title} detail={category.description} checked={prefs.categories[category.key]} disabled={busy} onChange={() => void update({ categories: { ...prefs.categories, [category.key]: !prefs.categories[category.key] } })} />)}</div>
        </section>
        <section className="notification-section"><h3><Clock3 size={15} /> Timing</h3><div className="notification-group">
          <label className="notification-setting"><span><strong>Before a meal</strong><small>Applies to dining out and cooking plans</small></span><select aria-label="Meal reminder timing" value={prefs.reminder_minutes} disabled={busy} onChange={e => void update({ reminder_minutes: Number(e.target.value) })}>{[[0,'At the start'],[15,'15 minutes'],[30,'30 minutes'],[60,'1 hour'],[120,'2 hours'],[1440,'1 day']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <Toggle title="Quiet hours" detail="Save social updates for later; skip meal reminders during this time" checked={prefs.quiet_enabled} disabled={busy} onChange={() => void update({ quiet_enabled: !prefs.quiet_enabled })} />
          {prefs.quiet_enabled && <div className="notification-quiet"><label>From<input type="time" aria-label="Quiet hours start" value={prefs.quiet_start} disabled={busy} onChange={e => { if (e.target.value) void update({ quiet_start: e.target.value }); }} /></label><span>—</span><label>Until<input type="time" aria-label="Quiet hours end" value={prefs.quiet_end} disabled={busy} onChange={e => { if (e.target.value) void update({ quiet_end: e.target.value }); }} /></label></div>}
        </div><p className="settings-note">After-visit reminders arrive an hour after a restaurant plan ends. Cancelled plans and visits you’ve rated are skipped. {prefs.quiet_enabled && `Quiet hours use ${prefs.timezone.replaceAll('_', ' ')}.`}</p></section>
        <section className="notification-section"><h3><Eye size={15} /> Privacy & sound</h3><div className="notification-group">
          <Toggle title="Show previews" detail="Include names, message text and meal details in alerts" checked={prefs.previews} disabled={busy} onChange={() => void update({ previews: !prefs.previews })} />
          <Toggle title="Notification sounds" checked={prefs.sound} disabled={busy} onChange={() => void update({ sound: !prefs.sound })} />
        </div><p className="settings-note">iPhone Focus, Scheduled Summary, and Lock Screen settings also control how alerts appear.</p></section>
        {native && allowed && prefs.enabled && <button className="notification-test" onClick={() => { void test(); setTested(true); }}><Bell size={17} />{tested ? 'Send another test in 5 seconds' : 'Send a test notification'}<ChevronRight size={16} /></button>}
      </>}
    </> : <section className="notification-activity" aria-label="Recent activity">
      <div className="notification-activity-heading"><h2>Latest updates</h2>{unreadCount > 0 && <button onClick={markAllRead}>Mark all read</button>}</div>
      {activityLoading && !notifications.length ? <p role="status">Loading your activity…</p> : !notifications.length ? <div className="notification-empty"><Bell size={30} strokeWidth={1.4} /><h3>All caught up</h3><p>Updates from your friends and GoodEats will appear here.</p></div> : notifications.map(n => <button key={n.id} className="notification-activity-row" onClick={() => { markRead([n.id]); navigate(safeNotificationPath(notificationDestination(n)) ?? '/settings/notifications'); }}>
        <span className="notification-activity-icon">{n.kind === 'message' ? <MessageCircle size={20} /> : n.kind.startsWith('friend') ? <Users size={20} /> : <Sparkles size={20} />}</span>
        <span><strong>{n.title || (n.kind === 'like' ? 'A little appreciation' : n.kind === 'comment' ? 'A new comment' : 'GoodEats')}</strong><small>{notificationSummary(n, actors[n.actorId]?.display_name)}</small><time>{new Date(n.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} · {new Date(n.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></span>
        {!n.readAt && <i className="notification-unread" aria-label="Unread" />}
      </button>)}
    </section>}
  </div>;
}
