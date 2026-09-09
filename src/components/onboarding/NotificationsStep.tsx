import React, { useRef, useState } from 'react';
import { Bell, CalendarDays, Check, MessageCircle, Sparkles } from 'lucide-react';
import { usePushNotifications } from '../../contexts/PushNotificationsContext';
import type { NotificationPermission } from '../../lib/native-notifications';
import * as OB from './OnboardingKit';
import './NotificationsStep.css';

type Props = {
  step: number;
  total: number;
  onBack: () => void;
  onDone: () => void | Promise<void>;
  finishing?: boolean;
  finishError?: string;
  onSkip?: () => void;
};

export function NotificationsStep(props: Props) {
  const notifications = usePushNotifications();
  return <NotificationsOnboardingPage {...props} onSkip={notifications.skipPermission}
    notifications={{ ...notifications, enable: () => notifications.enable('onboarding') }} />;
}

/** The preview uses this view with fictional state; only the connected step
 * above can request system permission or save an account preference. */
export function NotificationsOnboardingPage({ step, total, onBack, onDone, onSkip, finishing = false, finishError, notifications }: Props & {
  notifications: {
    native: boolean; permission: NotificationPermission;
    preferences: { enabled: boolean }; loading: boolean; busy: boolean; error: string;
    enable: () => Promise<void>;
  };
}) {
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState('');
  const inFlight = useRef(false);
  const { native, permission, preferences, loading, busy, error, enable } = notifications;
  const enabled = preferences.enabled && ['granted', 'provisional'].includes(permission);
  const denied = permission === 'denied';
  const unavailable = !native || permission === 'unavailable';
  const working = requesting || busy || finishing;
  const canEnable = !enabled && !denied && !unavailable;
  const request = async () => {
    if (inFlight.current || working || loading) return;
    inFlight.current = true; setRequesting(true); setRequestError('');
    try { await enable(); }
    catch { setRequestError('Couldn’t enable notifications. Try again, or set them up later.'); }
    finally { inFlight.current = false; setRequesting(false); }
  };

  return <OB.OnboardingScreen contentKey="notifications"
    header={<OB.ProgressHeader step={step} total={total} label="Notifications" onBack={() => { if (!working) onBack(); }} />}
    footer={<>
      {(finishError || requestError || error) && <OB.ErrorRow>{finishError || requestError || error}</OB.ErrorRow>}
      {canEnable ? <>
        <OB.PrimaryButton onClick={() => void request()} loading={requesting || busy} disabled={loading || finishing} trailing="none">Enable notifications</OB.PrimaryButton>
        <OB.GhostButton onClick={() => { onSkip?.(); void onDone(); }} disabled={working}>Not now</OB.GhostButton>
      </> : <OB.PrimaryButton onClick={() => void onDone()} loading={finishing} disabled={working && !finishing}>Start exploring</OB.PrimaryButton>}
    </>}>
    <div className="ob-notifications">
      <OB.Reveal className="ob-notification-art">
        <div className="ob-notification-halo" aria-hidden="true">
          <span className="ob-notification-bell">{enabled ? <Check size={38} strokeWidth={1.7} /> : <Bell size={38} strokeWidth={1.7} />}</span>
        </div>
        <div className="ob-notification-preview" aria-hidden="true">
          <span className="ob-notification-app"><OB.BrandMark size={29} /></span>
          <span><small>GoodEats <span>now</span></small><strong>A good meal is coming up.</strong><p>Your next plan is just around the corner.</p></span>
        </div>
      </OB.Reveal>
      <OB.Reveal i={1}>
        <OB.Title>{enabled ? 'You’re in the loop.' : 'Good things.\nRight on time.'}</OB.Title>
        <OB.Subtitle>{enabled ? 'Your notification preferences are saved. You can fine-tune them anytime in Settings.' : 'A little heads-up for the plans and people that make your day.'}</OB.Subtitle>
      </OB.Reveal>
      <OB.Reveal i={2}>
        <ul className="ob-notification-benefits">
          <li><CalendarDays aria-hidden="true" size={21} /><span><strong>Your next meal</strong><small>A reminder before dining out or cooking.</small></span></li>
          <li><MessageCircle aria-hidden="true" size={21} /><span><strong>Your people</strong><small>Messages, friend requests, and shared finds.</small></span></li>
          <li><Sparkles aria-hidden="true" size={21} /><span><strong>A little look back</strong><small>Your food recaps and important account updates.</small></span></li>
        </ul>
      </OB.Reveal>
      <p className="ob-notification-note" role="status">{denied
        ? 'No problem. You can allow notifications later in iPhone Settings → Notifications → GoodEats.'
        : unavailable ? 'Push notifications are available in the GoodEats iPhone app.'
        : enabled ? 'You’re in control of what comes through.'
        : 'Choose what you hear about in Settings. Message previews stay private by default.'}</p>
    </div>
  </OB.OnboardingScreen>;
}
