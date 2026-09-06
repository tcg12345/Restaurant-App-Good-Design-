import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, AtSign, AlertTriangle, BadgeCheck, Camera, Check, ChevronRight, Globe,
  LifeBuoy, Loader2, Lock, LogOut, Mail, MapPin, Moon, Phone, Shield, Sparkles,
  SquarePen, Star, Sun, Trash2, Upload, UploadCloud, User, Utensils, X,
} from 'lucide-react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { saveProfile } from '../lib/supabase-community';
import { processPhoto } from '../lib/images';
import { Avatar } from '../components/Avatar';
import { deleteAccount, clearLocalAppData, addPhoneNumber, confirmPhoneChange } from '../lib/supabase-account';
import { geocodePlace } from '../components/HomeLocationBar';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { GlassButton } from '../lib/glass-buttons';
import { SearchField } from '../components/SearchField';
import { getMyLatestVerificationRequest, type VerificationRequest } from '../lib/supabase-verification';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { VerifiedStatusPicker } from '../components/VerifiedStatusPicker';
import { openExternalUrl, SUPPORT_URL, PRIVACY_URL, TERMS_URL } from '../lib/external-links';
import { canonicalShareUrl } from '../lib/native-share';
import { usePlan } from '../contexts/PlanContext';
import { usePaywall } from '../contexts/PaywallContext';
import { openManage, restoreNative, syncPlanWithServer } from '../lib/billing';
import { isNativeRuntime } from '../lib/native-oauth';
import { RotateCcw, Download, ExternalLink as ExternalLinkIcon, SlidersHorizontal, Vibrate, Play, Eye, Bell, FileText, ChevronLeft } from 'lucide-react';
import { ProTag } from '../components/pro/ProMark';
import { buildExportJson, buildRatingsCsv, downloadTextFile, exportStamp } from '../lib/export-data';
import { formatPhoneForDisplay, toE164 } from '../lib/phone';
import { usePageBack } from '../lib/usePageBack';
import { useDevicePreference } from '../lib/device-preferences';
import { homeHaptic } from '../lib/haptics';
import { resetHighlightHistory } from '../lib/home-highlights';
import { canOpenAppSettings, openAppSettings } from '../lib/native-settings';
import { useSocialDialog } from '../components/social/useSocialDialog';
import { pushOverlay } from '../lib/overlay-registry';
import { liftOverlayToTopLayer } from '../lib/useBottomSheet';
import './SettingsPage.css';
import pkg from '../../package.json';

/** Focused settings routes share one consistent navigation and form shell. */

const PAGE_TITLES = { edit: 'Edit profile', account: 'Account & security', email: 'Email address', phone: 'Phone number', password: 'Password', privacy: 'Privacy & permissions', appearance: 'Appearance & feedback', ratings: 'Rating preferences', home: 'Home & personalization', subscription: 'GoodEats Pro', data: 'Your data', support: 'Help & about', verification: 'Verification', delete: 'Delete account' } as const;
type SubPage = keyof typeof PAGE_TITLES;

/** Human names for the profile columns saveProfile may have to skip, so a
 *  partial save can tell the user exactly what didn't stick. */
const PROFILE_FIELD_LABELS: Record<string, string> = {
  home_city: 'home city', home_lat: 'home city', home_lng: 'home city',
  bio: 'bio', is_public: 'account visibility', avatar_url: 'profile photo',
};

/** One settings row: 38px icon tile, serif title over a muted sub, then a
 *  chevron (nav) or the switch (toggle). Flush on the ground — hairline
 *  dividers between neighbours, never boxes. */
const Row: React.FC<{
  icon: React.ReactNode;
  title: string;
  sub?: string;
  onPress: () => void;
  toggle?: boolean;
  on?: boolean;
  first?: boolean;
  disabled?: boolean;
  /** A Pro tag beside the title, when the row belongs to Pro. */
  tag?: React.ReactNode;
}> = ({ icon, title, sub, onPress, toggle, on, first, tag, disabled }) => (
  <div className={cn('settings-row', !first && 'border-t border-on-surface/[0.08]')}>
    <button
      type="button"
      onClick={() => { homeHaptic(); onPress(); }}
      disabled={disabled}
      role={toggle ? 'switch' : undefined}
      aria-checked={toggle ? on : undefined}
      className="w-full flex items-center gap-3.5 py-[13px] text-left active:opacity-60 transition-opacity"
    >
      <span
        className={cn(
          'flex-none w-[38px] h-[38px] rounded-[13px] flex items-center justify-center',
          toggle && on ? 'bg-primary/10 text-primary' : 'bg-on-surface/[0.055] text-on-surface',
        )}
      >
        {icon}
      </span>
      <span className="flex-1 min-w-0 block">
        <span className="block font-sans font-bold text-[14.5px] leading-tight tracking-[-0.015em] text-on-surface">{title}{tag && <span className="ml-2 inline-flex align-middle">{tag}</span>}</span>
        {sub && <span className="settings-row-detail">{sub}</span>}
      </span>
      {toggle ? (
        <span
          aria-hidden
          className={cn(
            'flex-none w-12 h-[29px] rounded-full flex items-center px-[3px] transition-colors duration-200',
            on ? 'bg-primary' : 'bg-on-surface/[0.16]',
          )}
        >
          <span
            className={cn(
              'w-[23px] h-[23px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.22)] transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
              on && 'translate-x-[19px]',
            )}
          />
        </span>
      ) : (
        <ChevronRight size={15} strokeWidth={2.2} className="flex-none text-on-surface/30" />
      )}
    </button>
  </div>
);

/** Uppercase micro-label + input in a bordered well — the sub-pages' field. */
const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/45 mb-2">{children}</p>
);

const fieldBox = 'flex items-center gap-2.5 rounded-2xl border border-on-surface/[0.14] bg-on-surface/[0.035] px-4 py-[13px]';
const fieldInput = 'flex-1 min-w-0 bg-transparent outline-none text-[15px] font-semibold text-on-surface placeholder:text-on-surface/30';
const inkPill = 'flex-none rounded-full bg-on-surface text-surface px-4 py-[13px] text-[13px] font-bold transition-opacity disabled:opacity-40';

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const routePage = location.pathname.split('/')[2];
  const page: SubPage | null = routePage && routePage in PAGE_TITLES ? routePage as SubPage : null;
  const back = usePageBack(page ? '/settings' : '/profile');
  const [haptics, setHaptics] = useDevicePreference('haptics');
  const [homeAutoplay, setHomeAutoplay] = useDevicePreference('homeAutoplay');
  const [shareRatings, setShareRatings] = useDevicePreference('shareRatings');
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [resetHome, setResetHome] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const { profile, user, signOut, refreshProfile, isAdmin } = useAuth();
  const listsCtx = useLists();
  const { darkMode, toggleDarkMode, twoDecimalScores, toggleTwoDecimalScores } = useSettings();
  const plan = usePlan();
  const { showToast } = useToast();
  const { openPaywall, requirePro } = usePaywall();
  const proLocked = plan.checked && !plan.isPro;

  // Export (Pro): the web build downloads a file; the native shell has no
  // file writer, so it opens the web app's Settings instead.
  const exportData = (kind: 'json' | 'csv') => {
    const run = () => {
      if (isNativeRuntime()) {
        openExternalUrl(canonicalShareUrl('/settings'));
        return;
      }
      const ok = kind === 'json'
        ? downloadTextFile(`goodeats-export-${exportStamp()}.json`, buildExportJson(listsCtx), 'application/json')
        : downloadTextFile(`goodeats-ratings-${exportStamp()}.csv`, buildRatingsCsv(listsCtx.ratings), 'text/csv');
      showToast(ok ? 'Export ready' : 'Couldn’t start the download', ok ? { subtitle: kind === 'json' ? 'Everything, as JSON.' : 'Your ratings, as a spreadsheet.', variant: 'success' } : { subtitle: 'Try again from a desktop browser.' });
    };
    if (!requirePro('export', { onUnlocked: run })) return;
    run();
  };
  const restorePurchases = async () => {
    if (restoreBusy) return;
    setRestoreBusy(true);
    try {
    const res = await restoreNative();
    if (res.ok) { await syncPlanWithServer(); await plan.refresh(); }
    if (!res.ok) { if (!res.cancelled) showToast("Couldn't restore", { subtitle: res.message }); return; }
    showToast(res.entitlement.active ? 'Welcome back to Pro' : 'No purchases to restore');
    } catch { showToast('Could not restore purchases', { subtitle: 'Please try again.' }); } finally { setRestoreBusy(false); }
  };

  useEffect(() => { if (routePage && !(routePage in PAGE_TITLES)) navigate('/settings', { replace: true }); }, [routePage, navigate]);
  const go = (target: SubPage) => navigate(`/settings/${target}`);
  const [query, setQuery] = useState('');

  // ── Edit profile ─────────────────────────────────────────────────
  const [editName, setEditName] = useState(profile?.display_name || '');
  const [editUsername, setEditUsername] = useState(profile?.username || '');
  const [editBio, setEditBio] = useState(profile?.bio || '');
  const [editHomeCity, setEditHomeCity] = useState(profile?.home_city || '');
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editSuccess, setEditSuccess] = useState(false);
  // Profile photo. `editAvatar` holds the URL that will be saved — the
  // upload runs on pick (so the user sees the real image, not a local
  // preview that might fail later), and Save just writes the URL.
  const [editAvatar, setEditAvatar] = useState<string | null>(profile?.avatar_url ?? null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const resetEditFields = () => {
    setEditName(profile?.display_name || '');
    setEditUsername(profile?.username || '');
    setEditBio(profile?.bio || '');
    setEditHomeCity(profile?.home_city || '');
    setEditAvatar(profile?.avatar_url ?? null);
    setEditError('');
    setEditSuccess(false);
  };
  const editDirty =
    editName !== (profile?.display_name || '') ||
    editUsername !== (profile?.username || '') ||
    editBio !== (profile?.bio || '') ||
    editHomeCity !== (profile?.home_city || '') ||
    editAvatar !== (profile?.avatar_url ?? null);

  const handlePickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setAvatarBusy(true);
    setEditError('');
    try {
      // 512px square-ish at a higher quality than feed photos: an avatar is
      // rendered small almost everywhere, but it's also the one image that
      // gets blown up to 84px+ on a profile header.
      const url = await processPhoto(file, { maxDim: 512, quality: 0.8 });
      setEditAvatar(url);
    } catch {
      setEditError("That image couldn't be read. Try another photo.");
    }
    setAvatarBusy(false);
  };

  // The Profile page's Edit button deep-links straight to the sub-page.
  const consumedState = useRef(false);
  useEffect(() => {
    if (consumedState.current) return;
    consumedState.current = true;
    const wanted = (location.state as { page?: SubPage } | null)?.page;
    if (wanted === 'edit' || wanted === 'account') navigate(`/settings/${wanted}`, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (page === 'edit') resetEditFields();
    setAccountMsg(''); setAccountError(''); setNewPassword(''); setNewEmail(''); setPhoneCode(''); setPhoneSent(false); setConfirmDelete(false);
  }, [page, profile?.user_id]);

  const handleSaveProfile = async () => {
    if (!user?.id || editSaving || avatarBusy) return;
    if (!editName.trim() || !editUsername.trim()) {
      setEditError('Name and username are required');
      return;
    }
    if (editUsername.length < 3) {
      setEditError('Username must be at least 3 characters');
      return;
    }
    setEditSaving(true);
    setEditError('');
    try {
    // Resolve the typed home-city to coords on save so location-based
    // queries don't have to forward-geocode every profile at read time.
    // Only changed-or-new entries hit Mapbox; a cleared field resets coords.
    const homeCityTrim = editHomeCity.trim();
    const previousCity = profile?.home_city || '';
    let homeBase: { homeCity?: string | null; homeLat?: number | null; homeLng?: number | null } | undefined;
    if (homeCityTrim !== previousCity) {
      if (!homeCityTrim) {
        homeBase = { homeCity: null, homeLat: null, homeLng: null };
      } else {
        const geo = await geocodePlace(homeCityTrim);
        homeBase = {
          homeCity: geo?.label || homeCityTrim,
          homeLat: geo?.lat ?? null,
          homeLng: geo?.lng ?? null,
        };
      }
    }
    const result = await saveProfile(user.id, editName.trim(), editUsername.trim(), editBio.trim(), undefined, homeBase, editAvatar);
    if (result.success) {
      // saveProfile drops a column this database doesn't know rather than
      // failing the whole write. The row saved, but those fields didn't —
      // say so instead of flashing a success tick over a partial save.
      const lost = [...new Set((result.droppedColumns ?? []).map((c) => PROFILE_FIELD_LABELS[c] ?? c))];
      await refreshProfile();
      if (lost.length) {
        setEditError(`Saved — but your ${lost.join(' and ')} couldn't be stored. Please try again later.`);
      } else {
        setEditSuccess(true);
        showToast('Profile updated');
      }
    } else {
      setEditError(result.error || 'Failed to save');
    }
    } catch { setEditError('Couldn’t save your profile. Please try again.'); }
    finally { setEditSaving(false); }
  };

  // ── Account ──────────────────────────────────────────────────────
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [accountMsg, setAccountMsg] = useState('');
  const [accountError, setAccountError] = useState('');
  /* Phone is the only account field here that needs a two-step confirm —
     email and password are fire-and-forget one-shots. `phoneSent` is what
     swaps the row from "send me a code" to "type the code". */
  const [newPhone, setNewPhone] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneSent, setPhoneSent] = useState(false);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const handleUpdateEmail = async () => {
    if (!newEmail.trim() || accountBusy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) { setAccountError('Enter a valid email address'); return; }
    setAccountBusy(true);
    setAccountMsg('');
    setAccountError('');
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() }).catch(() => ({ error: { message: 'Could not update your email. Try again.' } }));
    setAccountBusy(false);
    if (error) setAccountError(error.message);
    else setAccountMsg('Check your new email for a confirmation link');
  };

  const handleSendPhoneCode = async () => {
    if (phoneBusy) return;
    setAccountMsg('');
    setAccountError('');
    // Normalize before anything leaves the client: an unparseable number
    // would spend a send against the project's SMS rate limit on a number
    // that can never receive it.
    const e164 = toE164(newPhone);
    if (!e164) {
      setAccountError('Enter a valid phone number');
      return;
    }
    setPhoneBusy(true);
    const { ok, error } = await addPhoneNumber(e164).catch(() => ({ ok: false, error: 'Could not send the code. Try again.' }));
    setPhoneBusy(false);
    if (!ok) { setAccountError(error ?? 'Could not send the code'); return; }
    setPhoneSent(true);
    setAccountMsg(`We texted a 6-digit code to ${formatPhoneForDisplay(e164)}`);
  };

  const handleConfirmPhone = async () => {
    if (phoneBusy) return;
    setAccountMsg('');
    setAccountError('');
    const e164 = toE164(newPhone);
    if (!e164 || phoneCode.length !== 6) return;
    setPhoneBusy(true);
    const { ok, error } = await confirmPhoneChange(e164, phoneCode).catch(() => ({ ok: false, error: 'Could not verify that code. Try again.' }));
    setPhoneBusy(false);
    if (!ok) { setAccountError(error ?? 'Could not verify that code'); return; }
    setPhoneSent(false);
    setPhoneCode('');
    setNewPhone('');
    setAccountMsg('Phone number verified');
  };

  const handleUpdatePassword = async () => {
    if (accountBusy) return;
    if (newPassword.length < 6) {
      setAccountError('Password must be at least 6 characters');
      return;
    }
    setAccountMsg('');
    setAccountError('');
    setAccountBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword }).catch(() => ({ error: { message: 'Could not update your password. Try again.' } }));
    setAccountBusy(false);
    if (error) setAccountError(error.message);
    else {
      setAccountMsg('Password updated successfully');
      setNewPassword('');
    }
  };

  // Permanently delete the account + every piece of server-side data
  // (delete-account Edge Function), then wipe the device's local app data.
  // In-app deletion is an App Store requirement (Review Guideline 5.1.1(v)).
  const handleDeleteAccount = async () => {
    if (deletingAccount) return;
    setDeletingAccount(true);
    setAccountMsg('');
    setAccountError('');
    const result = await deleteAccount();
    if (!result.ok) {
      setDeletingAccount(false);
      setConfirmDelete(false);
      setAccountError(result.error || 'Could not delete the account. Please try again.');
      return;
    }
    clearLocalAppData();
    // Hard reload so provider state (still holding the deleted account's
    // data in memory) is torn down too — the sign-out clean-slate pattern.
    window.location.reload();
  };

  // Latest verification request — drives the Account page's Verification
  // block (none/denied → apply · pending → under review · verified → status).
  const [verifReq, setVerifReq] = useState<VerificationRequest | null>(null);
  useEffect(() => {
    if (user?.id && !profile?.is_verified) {
      void getMyLatestVerificationRequest(user.id).then(setVerifReq);
    }
  }, [user?.id, profile?.is_verified]);

  const togglePrivate = async () => {
    if (!user?.id || !profile) return;
    // The DB trigger enforces this too — the toggle just explains
    // instead of silently snapping back.
    if (profile.is_verified) return;
    const newVal = !profile.is_public;
    if (privacyBusy) return;
    setPrivacyBusy(true);
    try {
      const result = await saveProfile(user.id, profile.display_name, profile.username, profile.bio, newVal);
      if (!result.success || result.droppedColumns?.includes('is_public')) { showToast('Could not change privacy', { subtitle: 'Please try again.' }); return; }
      await refreshProfile();
    } finally { setPrivacyBusy(false); }
  };

  const username = profile?.username || 'username';
  const displayName = profile?.display_name || 'Your Name';
  const pendingUploads = listsCtx.pendingPhotoUploadCount;

  // "Signed in as" meta — the provider the session actually came from,
  // plus when the account was created.
  const providerLabel = useMemo(() => {
    const p = (user?.app_metadata as { provider?: string } | undefined)?.provider;
    if (p === 'apple') return 'Apple ID';
    if (p === 'google') return 'Google';
    if (p === 'phone') return 'Phone & password';
    return 'Email & password';
  }, [user]);
  const joinedLabel = useMemo(() => {
    if (!user?.created_at) return '';
    const d = new Date(user.created_at);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }, [user?.created_at]);


  type SettingLink = { page: SubPage; title: string; sub: string; icon: React.ReactNode; group: string; keywords?: string };
  const links: SettingLink[] = [
    { page: 'account', title: 'Account & security', sub: 'Email, phone and password', icon: <Lock size={19} />, group: 'Your account' },
    { page: 'privacy', title: 'Privacy & permissions', sub: profile?.is_public ? 'Public profile' : 'Private profile', icon: <Shield size={19} />, group: 'Your account', keywords: 'private public visibility contacts location photos' },
    { page: 'appearance', title: 'Appearance & feedback', sub: darkMode ? 'Dark' : 'Light', icon: <Sun size={19} />, group: 'Your experience', keywords: 'dark light theme haptics vibration' },
    { page: 'ratings', title: 'Rating preferences', sub: 'Scores and sharing', icon: <Star size={19} />, group: 'Your experience', keywords: 'precise decimals default circle' },
    { page: 'home', title: 'Home & personalization', sub: 'Make it feel like you', icon: <SlidersHorizontal size={19} />, group: 'Your experience', keywords: 'carousel autoplay rotate reset algorithm' },
    { page: 'subscription', title: 'GoodEats Pro', sub: plan.subscribed ? 'Your membership' : 'Plan and purchases', icon: <Sparkles size={19} />, group: 'More from GoodEats' },
    { page: 'data', title: 'Your data', sub: 'Import, export and photo uploads', icon: <Download size={19} />, group: 'More from GoodEats' },
    { page: 'support', title: 'Help & about', sub: 'Support and app information', icon: <LifeBuoy size={19} />, group: 'More from GoodEats', keywords: 'terms policy version legal' },
  ];
  const searchable = [...links,
    { page: 'edit' as const, title: 'Edit profile', sub: 'Name, username, bio and city', icon: <User size={19} />, group: 'Your account' },
    ...(['email', 'phone', 'password', 'verification', 'delete'] as const).map(p => ({ page: p, title: PAGE_TITLES[p], sub: 'Account & security', icon: <Lock size={19} />, group: 'Your account' })),
  ];
  const q = query.trim().toLowerCase();
  const visible = q ? searchable.filter(l => `${l.title} ${l.sub} ${'keywords' in l ? l.keywords : ''}`.toLowerCase().includes(q)) : links;
  const group = (title: string, content: React.ReactNode, note?: string) => <section className="settings-section"><h2>{title}</h2><div className="settings-group">{content}</div>{note && <p className="settings-note">{note}</p>}</section>;
  const link = (target: SubPage, icon: React.ReactNode, title = PAGE_TITLES[target], sub?: string) => <Row icon={icon} title={title} sub={sub} onPress={() => go(target)} />;
  const subTitle = page ? PAGE_TITLES[page] : 'Settings';
  const closeDelete = () => { if (!deletingAccount) setConfirmDelete(false); };
  const confirmRef = useSocialDialog(confirmDelete || confirmSignOut || resetHome, () => { closeDelete(); setConfirmSignOut(false); setResetHome(false); });

  const confirmOpen = confirmDelete || confirmSignOut || resetHome;
  useEffect(() => {
    if (!confirmOpen) return;
    const release = pushOverlay();
    liftOverlayToTopLayer(confirmRef.current?.parentElement ?? null);
    return release;
  }, [confirmOpen]);

  return <MotionConfig reducedMotion="user"><div className="settings-design">
    <header className="settings-header">
      <GlassButton id="settings-back" symbol="chevron.left" label={page ? 'Back' : 'Close settings'} onClick={back} suspended={confirmDelete || confirmSignOut || resetHome} className="settings-back"><ChevronLeft size={22} /></GlassButton>
      {page ? <h1>{subTitle}</h1> : <span className="settings-header-wordmark">GoodEats</span>}
    </header>
    <main className="settings-scroll" key={page || 'root'}>
      <div className="settings-content">
      {!page && <>
        <h1 className="settings-title">Settings</h1>
        <SearchField value={query} onChange={setQuery} placeholder="Search settings" aria-label="Search settings" />
        {!q && <button className="settings-identity" onClick={() => go('edit')}><Avatar src={profile?.avatar_url} name={displayName} size={54} /><span><strong>{displayName}</strong><small>@{username}</small></span><ChevronRight size={18} /></button>}
        {[...new Set(visible.map(l => l.group))].map(title => group(title, visible.filter(l => l.group === title).map(l => <Row key={l.page} icon={l.icon} title={l.title} sub={l.sub} onPress={() => go(l.page)} />)))}
        {q && !visible.length && <div className="settings-empty"><SlidersHorizontal size={30} /><h2>No matching settings</h2><p>Try “password”, “sharing” or “appearance”.</p><button onClick={() => setQuery('')}>Clear search</button></div>}
        {!q && <><button className="settings-signout" onClick={() => setConfirmSignOut(true)}><LogOut size={17} />Sign out</button><p className="settings-version">GoodEats · {pkg.version}</p></>}
      </>}
      {page === 'account' && <>
        <div className="settings-account-info"><User size={24} /><strong>{user?.email || (user?.phone ? formatPhoneForDisplay(user.phone) : displayName)}</strong><span>{providerLabel}{joinedLabel ? ` · Joined ${joinedLabel}` : ''}</span></div>
        {group('Sign-in details', <>{link('email', <Mail size={19} />, 'Email address', user?.email || 'Add an email')}{link('phone', <Phone size={19} />, 'Phone number', user?.phone ? formatPhoneForDisplay(user.phone) : 'Add a phone number')}{link('password', <Lock size={19} />)}</>)}
        {group('Your profile', <>{link('edit', <User size={19} />)}{link('verification', <BadgeCheck size={19} />, 'Verification', profile?.is_verified ? 'Verified' : verifReq?.status === 'pending' ? 'Under review' : 'For chefs, critics and creators')}</>)}
        {group('Account management', <><Row icon={<Eye size={19} />} title="Your activity" sub="Review your recent activity" onPress={() => navigate('/activity')} />{link('data', <Download size={19} />)}{link('delete', <Trash2 size={19} />)}</>)}
      </>}
      {page === 'email' && <div className="settings-form"><p className="settings-intro">{user?.email ? `Current email: ${user.email}` : 'Add an email to your account.'}</p>                <div>
                  <FieldLabel>Change email</FieldLabel>
                  <div className="flex items-center gap-2.5">
                    <div className={cn(fieldBox, 'flex-1 min-w-0')}>
                      <Mail size={16} strokeWidth={1.9} className="flex-none text-on-surface/40" />
                      <input
                        type="email"
                        aria-label="New email" value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="New email"
                        className={cn(fieldInput, 'text-[14.5px]')}
                      />
                    </div>
                    <button type="button" onClick={handleUpdateEmail} disabled={!newEmail.trim() || accountBusy} className={inkPill}>
                      Update
                    </button>
                  </div>
                </div>

<p className="settings-note">We’ll send a link to confirm the change.</p></div>}
      {page === 'phone' && <div className="settings-form">                <div>
                  <FieldLabel>{user?.phone ? 'Change phone number' : 'Add phone number'}</FieldLabel>
                  <div className="flex items-center gap-2.5">
                    <div className={cn(fieldBox, 'flex-1 min-w-0')}>
                      <Phone size={16} strokeWidth={1.9} className="flex-none text-on-surface/40" />
                      <input
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        aria-label="Phone number" value={newPhone}
                        onChange={(e) => setNewPhone(e.target.value)}
                        placeholder={user?.phone ? formatPhoneForDisplay(user.phone) : '(555) 123-4567'}
                        disabled={phoneSent}
                        className={cn(fieldInput, 'text-[14.5px]')}
                      />
                    </div>
                    {!phoneSent && (
                      <button
                        type="button"
                        onClick={handleSendPhoneCode}
                        disabled={!newPhone.trim() || phoneBusy}
                        className={inkPill}
                      >
                        {phoneBusy ? 'Sending…' : 'Send code'}
                      </button>
                    )}
                  </div>
                  {phoneSent && (
                    <div className="mt-2.5 flex items-center gap-2.5">
                      <div className={cn(fieldBox, 'flex-1 min-w-0')}>
                        <Lock size={16} strokeWidth={1.9} className="flex-none text-on-surface/40" />
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          aria-label="Verification code" value={phoneCode}
                          onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="6-digit code"
                          autoFocus
                          className={cn(fieldInput, 'text-[14.5px]')}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleConfirmPhone}
                        disabled={phoneCode.length !== 6 || phoneBusy}
                        className={inkPill}
                      >
                        {phoneBusy ? 'Verifying…' : 'Verify'}
                      </button>
                    </div>
                  )}
                  <p className="mt-2 text-[11.5px] text-on-surface/45">
                    Lets friends who have your number find you, and gives you a second way to sign in.
                  </p>
                </div>

{phoneSent && <button className="settings-text-button" disabled={phoneBusy} onClick={() => { setPhoneSent(false); setPhoneCode(''); setAccountMsg(''); }}>Use a different number</button>}</div>}
      {page === 'password' && <div className="settings-form">                <div>
                  <FieldLabel>Change password</FieldLabel>
                  <div className="flex items-center gap-2.5">
                    <div className={cn(fieldBox, 'flex-1 min-w-0')}>
                      <Lock size={16} strokeWidth={1.9} className="flex-none text-on-surface/40" />
                      <input
                        type="password" autoComplete="new-password"
                        aria-label="New password" value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="New password (min 6)"
                        className={cn(fieldInput, 'text-[14.5px]')}
                      />
                    </div>
                    <button type="button" onClick={handleUpdatePassword} disabled={newPassword.length < 6 || accountBusy} className={inkPill}>
                      Update
                    </button>
                  </div>
                  <p className={cn('mt-2 text-[11.5px]', newPassword.length >= 6 ? 'text-score-high-ink font-semibold' : 'text-on-surface/45')}>
                    {newPassword.length === 0
                      ? 'At least 6 characters'
                      : newPassword.length >= 6 ? 'Minimum length met' : `${6 - newPassword.length} more character${6 - newPassword.length === 1 ? '' : 's'}`}
                  </p>
                </div>

</div>}
      {page === 'verification' && <div className="settings-form">                <div className="border-t border-on-surface/[0.10] pt-5">
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/45">Verification</p>
                  {profile?.is_verified ? (
                    <div className="mt-3 flex flex-col gap-2.5">
                      <p className="flex items-center gap-2 text-[14px] font-semibold text-on-surface">
                        <VerifiedBadge size={15} /> You're verified
                      </p>
                      <p className="text-[11.5px] text-on-surface/50 -mt-0.5">Your public status line, shown on your profile:</p>
                      <VerifiedStatusPicker
                        userId={user?.id || ''}
                        initialValue={profile?.verified_status}
                        saveLabel="Save status"
                        onSaved={() => { void refreshProfile(); setAccountMsg('Status updated'); }}
                      />
                    </div>
                  ) : verifReq?.status === 'pending' ? (
                    <div className="mt-3 rounded-2xl bg-on-surface/[0.04] px-4 py-3.5 flex items-center gap-3">
                      <VerifiedBadge size={16} />
                      <span className="min-w-0 block">
                        <span className="block text-[14px] font-semibold text-on-surface">Application under review</span>
                        <span className="block mt-1 text-[11.5px] text-on-surface/50">We'll let you know as soon as it's decided.</span>
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => navigate('/verify/apply')}
                      className="mt-3 w-full flex items-center gap-3 rounded-[18px] border border-primary/[0.22] bg-primary/[0.06] px-4 py-3.5 text-left active:bg-primary/[0.11] transition-colors"
                    >
                      <span className="flex-none w-[34px] h-[34px] rounded-full bg-primary text-on-primary flex items-center justify-center">
                        <BadgeCheck size={17} strokeWidth={2} />
                      </span>
                      <span className="flex-1 min-w-0 block">
                        <span className="block font-sans font-bold text-[14.5px] tracking-[-0.015em] text-primary">Request a verified badge</span>
                        <span className="block mt-1 text-[12px] text-on-surface/50">For chefs, critics and creators</span>
                      </span>
                      <ChevronRight size={15} strokeWidth={2.2} className="flex-none text-primary/50" />
                    </button>
                  )}
                </div>

</div>}
                  {page === 'edit' && (
              <div className="flex flex-col gap-5">
                <div className="flex items-center gap-4">
                  {/* The avatar IS the button — tapping the photo to change
                      it is what every other app trains, so a separate
                      "change photo" control beside it would be redundant
                      chrome. The camera chip marks it as editable. */}
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={avatarBusy}
                    aria-label={editAvatar ? 'Change profile photo' : 'Add a profile photo'}
                    className="relative flex-none rounded-full active:scale-95 transition-transform disabled:opacity-60"
                  >
                    <Avatar
                      src={editAvatar}
                      name={displayName || 'G'}
                      size={64}
                      letterSize={25}
                    />
                    <span className="absolute -bottom-0.5 -right-0.5 w-[26px] h-[26px] rounded-full bg-primary text-on-primary ring-[3px] ring-surface flex items-center justify-center">
                      {avatarBusy ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} strokeWidth={2.2} />}
                    </span>
                  </button>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { void handlePickAvatar(e.target.files?.[0]); e.target.value = ''; }}
                  />
                  <div className="min-w-0">
                    <p className="font-sans font-bold text-[15px] tracking-[-0.02em] text-on-surface truncate">{displayName}</p>
                    <p className="mt-1 text-[12px] text-on-surface/50 truncate">@{username}</p>
                    <div className="mt-1.5 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => avatarInputRef.current?.click()}
                        disabled={avatarBusy}
                        className="text-[12.5px] font-semibold text-primary active:opacity-70 transition-opacity disabled:opacity-50"
                      >
                        {avatarBusy ? 'Uploading…' : editAvatar ? 'Change photo' : 'Add photo'}
                      </button>
                      {editAvatar && !avatarBusy && (
                        <button
                          type="button"
                          onClick={() => setEditAvatar(null)}
                          className="text-[12.5px] font-semibold text-on-surface/45 active:opacity-70 transition-opacity"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <FieldLabel>Display name</FieldLabel>
                  <div className={fieldBox}>
                    <User size={16} strokeWidth={1.9} className="flex-none text-on-surface/40" />
                    <input
                      type="text"
                      aria-label="Display name" value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Your name"
                      className={fieldInput}
                    />
                  </div>
                </div>

                <div>
                  <FieldLabel>Username</FieldLabel>
                  <div className={fieldBox}>
                    <AtSign size={16} strokeWidth={1.9} className="flex-none text-on-surface/40" />
                    <input
                      type="text"
                      aria-label="Username" value={editUsername}
                      onChange={(e) => setEditUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                      placeholder="username"
                      autoCapitalize="off"
                      className={fieldInput}
                    />
                    {editUsername !== (profile?.username || '') && editUsername.length > 0 && (
                      <span className={cn('flex-none text-[11.5px] font-bold', editUsername.length >= 3 ? 'text-score-high-ink' : 'text-primary')}>
                        {editUsername.length >= 3 ? 'Looks good' : 'Too short'}
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <FieldLabel>Bio</FieldLabel>
                  <div className="rounded-2xl border border-on-surface/[0.14] bg-on-surface/[0.035] px-4 py-[13px]">
                    <textarea
                      aria-label="Bio" value={editBio}
                      onChange={(e) => setEditBio(e.target.value)}
                      rows={4}
                      maxLength={150}
                      placeholder="A line about how you eat"
                      className="w-full bg-transparent outline-none resize-none text-[14px] leading-relaxed text-on-surface placeholder:text-on-surface/30"
                    />
                  </div>
                  <p className={cn('mt-1.5 text-right text-[11.5px] tabular-nums', editBio.length > 135 ? 'text-primary font-semibold' : 'text-on-surface/40')}>
                    {editBio.length}/150
                  </p>
                </div>

                <div>
                  <FieldLabel>
                    Home city
                    {profile?.is_verified && <span className="ml-1.5 text-primary normal-case tracking-normal">· recommended for verified users</span>}
                  </FieldLabel>
                  <div className={fieldBox}>
                    <MapPin size={16} strokeWidth={1.9} className="flex-none text-on-surface/40" />
                    <input
                      type="text"
                      aria-label="Home city" value={editHomeCity}
                      onChange={(e) => setEditHomeCity(e.target.value)}
                      placeholder="e.g. Westport, CT"
                      autoCapitalize="words"
                      autoCorrect="off"
                      className={fieldInput}
                    />
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed text-on-surface/50">
                    Shown on your profile and used to surface you to people exploring your area.
                  </p>
                </div>

                {editError && <p className="text-[13px] text-red-500">{editError}</p>}
                {editSuccess && (
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-score-high-ink">
                    <Check size={14} /> Saved
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={editSaving || avatarBusy || !editDirty}
                  className={cn(
                    'w-full rounded-full py-4 text-[14px] font-bold text-on-primary transition-colors',
                    editDirty ? 'bg-primary active:opacity-85' : 'bg-on-surface/30',
                    editSaving && 'opacity-60',
                  )}
                >
                  {editSaving ? 'Saving…' : editDirty ? 'Save changes' : 'Everything saved'}
                </button>
              </div>
            )}


      {page === 'privacy' && <>
        {group('Who can see you', <Row icon={<Shield size={19} />} title="Private account" sub={profile?.is_verified ? 'Verified profiles are public' : profile?.is_public ? 'Anyone can view your profile' : 'Only approved followers can view your profile'} toggle on={!profile?.is_public} disabled={privacyBusy || !!profile?.is_verified} onPress={() => void togglePrivate()} />)}
        {group('Permissions', <>{canOpenAppSettings() ? <Row icon={<SlidersHorizontal size={19} />} title="Device permissions" sub="Photos, contacts, location and notifications" onPress={() => void openAppSettings()} /> : <div className="settings-explainer">Manage camera, photos, location and notification permissions in your browser’s site settings.</div>}</>)}
        {group('Your information', <Row icon={<Shield size={19} />} title="Privacy policy" onPress={() => void openExternalUrl(PRIVACY_URL)} />)}
      </>}
      {page === 'appearance' && <>
        <section className="settings-section"><h2>Appearance</h2><div className="settings-theme-options" role="group" aria-label="Color theme">{[false,true].map(dark => <button key={String(dark)} aria-pressed={darkMode === dark} onClick={() => { if (darkMode !== dark) toggleDarkMode(); }}><span className={`settings-theme-preview ${dark ? 'is-dark' : ''}`}><i /><i /><i /></span><span>{dark ? <Moon size={16} /> : <Sun size={16} />}{dark ? 'Dark' : 'Light'}{darkMode === dark && <Check size={17} />}</span></button>)}</div></section>
        {group('Interaction', <Row icon={<Vibrate size={19} />} title="Button haptics" sub="Subtle feedback when you tap and swipe" toggle on={haptics} onPress={() => setHaptics(!haptics)} />, 'Device preferences stay on this device. System Reduce Motion is respected where supported.')}
      </>}
      {page === 'ratings' && <>
        {group('Score display', <Row icon={<Star size={19} />} title="Precise scores" sub="Show 8.37 instead of 8.4" toggle on={!proLocked && twoDecimalScores} tag={proLocked ? <ProTag /> : undefined} onPress={proLocked ? () => openPaywall('gate:precise-scores', 'precise-scores', { onUnlocked: () => { if (!twoDecimalScores) toggleTwoDecimalScores(); } }) : toggleTwoDecimalScores} />, 'Display precision doesn’t change your rankings.')}
        {group('When you rate', <Row icon={<Globe size={19} />} title="Share to your circle by default" sub="You can change this for each rating" toggle on={shareRatings} onPress={() => setShareRatings(!shareRatings)} />, 'Applies to new rating sessions on this device. Existing activity stays as it is.')}
      </>}
      {page === 'home' && <>
        {group('Ideas for you', <><Row icon={<Play size={19} />} title="Rotate Home cards automatically" sub="Turn off to browse cards at your own pace" toggle on={homeAutoplay} onPress={() => setHomeAutoplay(!homeAutoplay)} /><Row icon={<RotateCcw size={19} />} title="Reset card personalization" sub="Clear recent views and taps on this device" onPress={() => setResetHome(true)} /></>, 'Home still uses your ratings, saved places, recipes and circle to choose relevant ideas.')}
        {group('Your taste', <Row icon={<Sparkles size={19} />} title="Taste profile" sub="See what shapes your recommendations" onPress={() => navigate('/profile/taste')} />)}
      </>}
      {page === 'subscription' && <>
        <div className="settings-pro"><Sparkles size={30} /><h2>GoodEats Pro</h2><p>{!plan.checked ? 'Checking your plan…' : plan.subscribed ? plan.source === 'grant' ? 'Your complimentary membership' : 'Your membership is active' : 'More ways to find your next favorite.'}</p>{plan.proUntil && <small>{plan.willRenew === false ? 'Ends' : 'Renews'} {new Date(plan.proUntil).toLocaleDateString()}</small>}<button className="settings-primary" disabled={!plan.checked} onClick={() => navigate('/pro')}>{plan.subscribed ? 'Explore your benefits' : 'Explore Pro'}</button></div>
        {group('Purchases', <>{plan.subscribed && plan.source !== 'grant' && <Row icon={<ExternalLinkIcon size={19} />} title="Manage subscription" sub={plan.source?.startsWith('stripe') ? 'Billing portal' : 'App Store'} onPress={() => void openManage(plan.source)} />}{isNativeRuntime() ? <Row icon={<RotateCcw size={19} />} title={restoreBusy ? 'Restoring…' : 'Restore purchases'} disabled={restoreBusy} onPress={() => void restorePurchases()} /> : <p className="settings-explainer">For an App Store purchase, restore from GoodEats on your iPhone.</p>}</>)}
      </>}
      {page === 'data' && <>
        {group('Bring your lists', <Row icon={<Upload size={19} />} title="Import restaurants" sub="From screenshots or a file" onPress={() => navigate('/import')} />)}
        {group('Take a copy', <><Row icon={<Download size={19} />} title="Export everything" sub="Ratings, lists, trips and recipes · JSON" tag={proLocked ? <ProTag /> : undefined} onPress={() => exportData('json')} /><Row icon={<Download size={19} />} title="Export ratings" sub="Ready for a spreadsheet · CSV" tag={proLocked ? <ProTag /> : undefined} onPress={() => exportData('csv')} /></>, isNativeRuntime() ? 'Exports open in the web app.' : undefined)}
        {group('Photo uploads', pendingUploads > 0 ? <Row icon={<UploadCloud size={19} />} title={`${pendingUploads} waiting to upload`} sub="Your photos are kept on this device" onPress={listsCtx.retryPendingPhotoUploads} /> : <div className="settings-explainer settings-upload-status"><Check size={20} />No photos waiting to upload</div>)}
      </>}
      {page === 'support' && <>
        {group('Here to help', <Row icon={<LifeBuoy size={19} />} title="Contact support" sub="Get help or share feedback" onPress={() => void openExternalUrl(SUPPORT_URL)} />)}
        <section className="settings-section"><h2>Quick answers</h2><div className="settings-group settings-faq"><details><summary>Where are my scores?</summary><p>Numeric scores unlock after 10 rated restaurants. Before then, you’ll see your ranking.</p></details><details><summary>How do I manage permissions?</summary><p>On iPhone, open Settings and find GoodEats. In a browser, open this site’s permission settings.</p></details><details><summary>How do I restore Pro?</summary><p>Open GoodEats Pro in Settings on your iPhone, then choose Restore purchases using the Apple account that purchased it.</p></details></div></section>
        {group('About GoodEats', <><Row icon={<Shield size={19} />} title="Privacy policy" onPress={() => void openExternalUrl(PRIVACY_URL)} /><Row icon={<FileText size={19} />} title="Terms of service" onPress={() => void openExternalUrl(TERMS_URL)} /><div className="settings-version-row"><span>Version</span><span>{pkg.version}</span></div></>)}
        {isAdmin && group('Administration', <><Row icon={<BadgeCheck size={19} />} title="Verification requests" onPress={() => navigate('/admin/verification')} /><Row icon={<Utensils size={19} />} title="Cuisine suggestions" onPress={() => navigate('/admin/cuisine')} /></>)}
      </>}
      {page === 'delete' && <div className="settings-delete"><span><Trash2 size={28} /></span><h2>Delete your account</h2><p>This permanently removes your profile, ratings, recipes, posts, guides, photos and friends. It can’t be undone.</p><button className="settings-primary settings-danger" onClick={() => setConfirmDelete(true)}>Delete account</button><button className="settings-text-button" onClick={back}>Keep my account</button></div>}
      {page && accountMsg && <p className="settings-feedback" role="status"><Check size={16} />{accountMsg}</p>}
      {page && accountError && <p className="settings-feedback is-error" role="alert"><AlertTriangle size={16} />{accountError}</p>}
      </div>
    </main>
    <AnimatePresence>{(confirmDelete || confirmSignOut || resetHome) && <motion.div className="settings-confirm-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { if (!deletingAccount) { setConfirmDelete(false); setConfirmSignOut(false); setResetHome(false); } }}><motion.div ref={confirmRef} role="dialog" aria-modal="true" aria-label={confirmDelete ? 'Delete your account?' : confirmSignOut ? 'Sign out?' : 'Reset card personalization?'} className="settings-confirm" initial={{ y: 24 }} animate={{ y: 0 }} exit={{ y: 24 }} onClick={e => e.stopPropagation()}><h2>{confirmDelete ? 'Delete your account?' : confirmSignOut ? 'Sign out?' : 'Reset card personalization?'}</h2><p>{confirmDelete ? 'This is permanent. Your account and everything in it will be deleted.' : confirmSignOut ? 'You can sign back in whenever you’re ready.' : 'Clear recent card views and taps on this device. Your ratings, saves and recipes are kept.'}</p><div><button disabled={deletingAccount} onClick={() => { setConfirmDelete(false); setConfirmSignOut(false); setResetHome(false); }}>Cancel</button><button className={confirmDelete ? 'settings-danger' : ''} disabled={deletingAccount} onClick={() => { if (confirmDelete) void handleDeleteAccount(); else if (confirmSignOut) { setConfirmSignOut(false); void signOut(); navigate('/'); } else if (user) { resetHighlightHistory(user.id); setResetHome(false); showToast('Home personalization reset'); } }}>{confirmDelete ? deletingAccount ? 'Deleting…' : 'Delete forever' : confirmSignOut ? 'Sign out' : 'Reset'}</button></div></motion.div></motion.div>}</AnimatePresence>
  </div></MotionConfig>;
};
