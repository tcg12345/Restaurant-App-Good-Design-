import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, AtSign, AlertTriangle, BadgeCheck, Camera, Check, ChevronRight, Globe,
  LifeBuoy, Loader2, Lock, LogOut, Mail, MapPin, Moon, Phone, Shield, Sparkles,
  SquarePen, Star, Sun, Trash2, Upload, UploadCloud, User, Utensils, X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
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
import { openExternalUrl, SUPPORT_URL, PRIVACY_URL } from '../lib/external-links';
import { canonicalShareUrl } from '../lib/native-share';
import { usePlan } from '../contexts/PlanContext';
import { usePaywall } from '../contexts/PaywallContext';
import { openManage, restoreNative, syncPlanWithServer } from '../lib/billing';
import { isNativeRuntime } from '../lib/native-oauth';
import { RotateCcw, Download, ExternalLink as ExternalLinkIcon } from 'lucide-react';
import { ProTag } from '../components/pro/ProMark';
import { buildExportJson, buildRatingsCsv, downloadTextFile, exportStamp } from '../lib/export-data';
import { formatPhoneForDisplay, toE164 } from '../lib/phone';
import pkg from '../../package.json';

/**
 * /settings — a real screen, not a sheet.
 *
 * Settings used to be a bottom sheet stacked over the Profile page, with
 * its sub-pages cross-fading inside the sheet. Now it is a full page with
 * its own serif title and a search field that filters every row, and the
 * two owned sub-pages (Edit profile, Account) push in from the right the
 * way iOS does — the base screen sinking back under them. Rows sit flush
 * on the ground and divide on hairlines; the icons and the type carry the
 * structure. Back, close and every floating control is real liquid glass.
 */

type SubPage = 'edit' | 'account';

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
  sub: string;
  onPress: () => void;
  toggle?: boolean;
  on?: boolean;
  first?: boolean;
  /** A Pro tag beside the title, when the row belongs to Pro. */
  tag?: React.ReactNode;
}> = ({ icon, title, sub, onPress, toggle, on, first, tag }) => (
  <div className={cn(!first && 'border-t border-on-surface/[0.08]')}>
    <button
      type="button"
      onClick={onPress}
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
        <span className="block font-serif font-bold text-[14.5px] leading-tight tracking-[-0.015em] text-on-surface">{title}{tag && <span className="ml-2 inline-flex align-middle">{tag}</span>}</span>
        <span className="block mt-1 text-[12px] leading-snug text-on-surface/50">{sub}</span>
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
    const res = await restoreNative();
    if (res.ok) { await syncPlanWithServer(); await plan.refresh(); }
    if (!res.ok) { if (!res.cancelled) showToast("Couldn't restore", { subtitle: res.message }); return; }
    showToast(res.entitlement.active ? 'Welcome back to Pro' : 'No purchases to restore');
  };

  // ── Push-in sub-page ─────────────────────────────────────────────
  // `subPage` keeps the content mounted through the slide-out; `subOpen`
  // drives the transform. Same two-layer push the Friends page uses.
  const [subPage, setSubPage] = useState<SubPage | null>(null);
  const [subOpen, setSubOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const go = (p: SubPage) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (p === 'edit') resetEditFields();
    if (p === 'account') { setAccountMsg(''); setAccountError(''); setConfirmDelete(false); }
    setSubPage(p);
    setSubOpen(true);
  };
  const back = () => {
    setSubOpen(false);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setSubPage(null), 420);
  };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

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
    if (wanted === 'edit' || wanted === 'account') go(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveProfile = async () => {
    if (!user?.id) return;
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
        setTimeout(() => back(), 700);
      }
    } else {
      setEditError(result.error || 'Failed to save');
    }
    setEditSaving(false);
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
    if (!newEmail.trim()) return;
    setAccountMsg('');
    setAccountError('');
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    if (error) setAccountError(error.message);
    else setAccountMsg('Check your new email for a confirmation link');
  };

  const handleSendPhoneCode = async () => {
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
    const { ok, error } = await addPhoneNumber(e164);
    setPhoneBusy(false);
    if (!ok) { setAccountError(error ?? 'Could not send the code'); return; }
    setPhoneSent(true);
    setAccountMsg(`We texted a 6-digit code to ${formatPhoneForDisplay(e164)}`);
  };

  const handleConfirmPhone = async () => {
    setAccountMsg('');
    setAccountError('');
    const e164 = toE164(newPhone);
    if (!e164 || phoneCode.length !== 6) return;
    setPhoneBusy(true);
    const { ok, error } = await confirmPhoneChange(e164, phoneCode);
    setPhoneBusy(false);
    if (!ok) { setAccountError(error ?? 'Could not verify that code'); return; }
    setPhoneSent(false);
    setPhoneCode('');
    setNewPhone('');
    setAccountMsg('Phone number verified');
  };

  const handleUpdatePassword = async () => {
    if (newPassword.length < 6) {
      setAccountError('Password must be at least 6 characters');
      return;
    }
    setAccountMsg('');
    setAccountError('');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
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
    await saveProfile(user.id, profile.display_name, profile.username, profile.bio, newVal);
    await refreshProfile();
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

  // ── Main-page sections, filterable by the search field ───────────
  type RowSpec = { icon: React.ReactNode; title: string; sub: string; press: () => void; toggle?: boolean; on?: boolean; tag?: React.ReactNode };
  const sections = useMemo<{ label: string; rows: RowSpec[] }[]>(() => {
    const raw: ({ label: string; rows: RowSpec[] } | null)[] = [
      {
        label: 'Profile',
        rows: [
          { icon: <Sparkles size={17} strokeWidth={1.9} />, title: 'Your activity', sub: 'Saves, likes and comments', press: () => navigate('/activity') },
          { icon: <SquarePen size={17} strokeWidth={1.9} />, title: 'Edit profile', sub: 'Name, username, bio, home city', press: () => go('edit') },
          { icon: <Lock size={17} strokeWidth={1.9} />, title: 'Account', sub: 'Email, password, delete account', press: () => go('account') },
        ],
      },
      {
        label: 'Preferences',
        rows: [
          {
            icon: profile?.is_public ? <Globe size={17} strokeWidth={1.9} /> : <Lock size={17} strokeWidth={1.9} />,
            title: 'Private account',
            sub: profile?.is_verified
              ? 'Verified accounts are always public'
              : profile?.is_public ? 'Anyone can see your profile' : 'Only approved followers',
            toggle: true,
            on: !profile?.is_public,
            press: () => { void togglePrivate(); },
          },
          {
            icon: darkMode ? <Moon size={17} strokeWidth={1.9} /> : <Sun size={17} strokeWidth={1.9} />,
            title: 'Dark mode',
            sub: darkMode ? 'On — dark surface' : 'Off — light surface',
            toggle: true,
            on: darkMode,
            press: toggleDarkMode,
          },
          {
            icon: <Star size={17} strokeWidth={1.9} />,
            title: 'Precise scores',
            sub: proLocked
              ? 'Two decimals on every score — 8.37, not 8.4'
              : twoDecimalScores
                ? 'Showing two decimals — 8.37, not 8.4'
                : 'Scores round to one decimal — rankings stay exact underneath',
            toggle: true,
            on: !proLocked && twoDecimalScores,
            press: proLocked
              ? () => openPaywall('gate:precise-scores', 'precise-scores', { onUnlocked: () => { if (!twoDecimalScores) toggleTwoDecimalScores(); } })
              : toggleTwoDecimalScores,
            tag: proLocked ? <ProTag /> : undefined,
          },
        ],
      },
      isAdmin ? {
        label: 'Admin',
        rows: [
          { icon: <BadgeCheck size={17} strokeWidth={1.9} />, title: 'Verification requests', sub: 'Review and approve applications', press: () => navigate('/admin/verification') },
          { icon: <Utensils size={17} strokeWidth={1.9} />, title: 'Cuisine suggestions', sub: 'Approve proposed cuisine edits', press: () => navigate('/admin/cuisine') },
        ],
      } : null,
      pendingUploads > 0 ? {
        label: 'Sync',
        rows: [
          {
            icon: <UploadCloud size={17} strokeWidth={1.9} />,
            title: `${pendingUploads} photo${pendingUploads === 1 ? '' : 's'} waiting to upload`,
            sub: 'Kept on this device until back online — tap to retry now',
            press: listsCtx.retryPendingPhotoUploads,
          },
        ],
      } : null,
      // ── GoodEats Pro ── one section; the rows say what state you're in
      // before what you can do about it. Hidden until the plan answer is
      // in (so nobody sees "Upgrade" flash before "You're on Pro"), and
      // hidden entirely until launch flips the gates on — nothing to sell
      // before then, unless the person already holds Pro.
      plan.checked && (plan.gatesEnabled || plan.subscribed) ? {
        label: 'GoodEats Pro',
        rows: [
          plan.subscribed
            ? { icon: <Sparkles size={17} strokeWidth={1.9} />, title: 'GoodEats Pro', sub: plan.source === 'grant'
                ? (plan.grantUntil ? `On the house until ${new Date(plan.grantUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : 'On the house')
                : plan.proUntil
                  ? `${plan.willRenew === false ? 'Ends' : 'Renews'} ${new Date(plan.proUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                  : 'Yours for good', press: () => navigate('/pro') }
            : { icon: <Sparkles size={17} strokeWidth={1.9} />, title: 'Upgrade to Pro', sub: 'Deeper taste profile, unlimited AI', press: () => openPaywall('settings') },
          ...(plan.subscribed && plan.source !== 'grant'
            ? [{ icon: <ExternalLinkIcon size={17} strokeWidth={1.9} />, title: 'Manage subscription', sub: plan.source && plan.source.startsWith('stripe') ? 'Billing portal' : 'App Store', press: () => { void openManage(plan.source); } }]
            : []),
          ...(isNativeRuntime()
            ? [{ icon: <RotateCcw size={17} strokeWidth={1.9} />, title: 'Restore purchases', sub: 'Bought Pro on another device?', press: () => { void restorePurchases(); } }]
            : []),
          ...(plan.earlyAccess
            ? [{ icon: <Sparkles size={17} strokeWidth={1.9} />, title: 'Early access', sub: 'New features reach you first', press: () => navigate('/pro') }]
            : []),
        ],
      } : null,
      {
        label: 'Data',
        rows: [
          { icon: <Upload size={17} strokeWidth={1.9} />, title: 'Import restaurants', sub: 'Bring lists over — screenshots or a file', press: () => navigate('/import') },
          { icon: <Download size={17} strokeWidth={1.9} />, title: 'Export everything', sub: isNativeRuntime() ? 'Ratings, lists, trips and recipes as a file — from the web app' : 'Ratings, lists, trips and recipes as JSON', press: () => exportData('json'), tag: proLocked ? <ProTag /> : undefined },
          { icon: <Download size={17} strokeWidth={1.9} />, title: 'Export ratings', sub: isNativeRuntime() ? 'A spreadsheet of every rating — from the web app' : 'A spreadsheet (CSV) of every rating', press: () => exportData('csv'), tag: proLocked ? <ProTag /> : undefined },
        ],
      },
      {
        label: 'About',
        rows: [
          { icon: <Shield size={17} strokeWidth={1.9} />, title: 'Privacy', sub: 'How your data is collected and used', press: () => openExternalUrl(PRIVACY_URL) },
          { icon: <LifeBuoy size={17} strokeWidth={1.9} />, title: 'Support', sub: 'Get help or contact us', press: () => openExternalUrl(SUPPORT_URL) },
        ],
      },
    ];
    const q = query.trim().toLowerCase();
    return raw
      .filter((s): s is { label: string; rows: RowSpec[] } => s !== null)
      .map((s) => ({ ...s, rows: q ? s.rows.filter((r) => `${r.title} ${r.sub}`.toLowerCase().includes(q)) : s.rows }))
      .filter((s) => s.rows.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, profile?.is_public, profile?.is_verified, darkMode, twoDecimalScores, isAdmin, pendingUploads, plan.checked, plan.gatesEnabled, plan.subscribed, plan.source, plan.proUntil, plan.willRenew, plan.grantUntil, plan.isPro, plan.earlyAccess, proLocked]);

  const subTitle = subPage === 'edit' ? 'Edit profile' : 'Account';

  return (
    <div className="relative flex flex-col h-[100dvh] bg-surface overflow-hidden">

      {/* ── Base layer: the settings list ── */}
      <div
        className={cn(
          'flex-1 min-h-0 flex flex-col transition-[transform,opacity] duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)]',
          subOpen && 'translate-x-[-20%] scale-[0.975] opacity-45 pointer-events-none',
        )}
        aria-hidden={subOpen || undefined}
      >
        <div className="flex-none px-5 pt-safe-4 w-full max-w-[640px] mx-auto">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h1 className="font-serif font-bold text-[31px] leading-[1.05] tracking-[-0.03em] text-on-surface">Settings</h1>
              <p className="mt-1.5 text-[13px] text-on-surface/50">@{username} · search or scroll</p>
            </div>
            <GlassButton
              id="settings-close"
              symbol="xmark"
              label="Close settings"
              onClick={() => navigate(-1)}
              className="hit-44 flex-none w-10 h-10 -mr-1 rounded-full flex items-center justify-center text-on-surface bg-on-surface/[0.05] active:scale-95 transition-transform"
            >
              <X size={17} />
            </GlassButton>
          </div>
          <div className="mt-4">
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search settings"
              aria-label="Search settings"
              glassId="settings-search"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-5 w-full max-w-[640px] mx-auto">
            {sections.map((sec) => (
              <section key={sec.label} className="pt-6">
                <h2 className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/40">{sec.label}</h2>
                <div className="mt-1">
                  {sec.rows.map((r, i) => (
                    <Row key={r.title} first={i === 0} icon={r.icon} title={r.title} sub={r.sub} onPress={r.press} toggle={r.toggle} on={r.on} tag={r.tag} />
                  ))}
                </div>
              </section>
            ))}

            {sections.length === 0 && (
              <div className="pt-11">
                <p className="font-serif font-bold text-[17px] tracking-[-0.02em] text-on-surface">Nothing called “{query.trim()}”</p>
                <p className="mt-2 text-[13px] text-on-surface/50">Try “profile”, “private” or “import”.</p>
              </div>
            )}

            <div className="mt-7 border-t border-on-surface/[0.12]" />
            <button
              type="button"
              onClick={() => { navigate('/'); void signOut(); }}
              className="mt-[18px] w-full flex items-center justify-center gap-2 rounded-full border border-primary/[0.28] bg-primary/[0.07] text-primary py-3.5 text-[13.5px] font-bold active:bg-primary/[0.13] transition-colors"
            >
              <LogOut size={15} strokeWidth={2} />
              Sign out
            </button>
            <p className="pt-[18px] pb-safe-6 text-[11.5px] text-on-surface/40">Version {pkg.version}</p>
          </div>
        </div>
      </div>

      {/* ── Sub layer: Edit profile / Account push in from the right ── */}
      <div
        className={cn(
          'absolute inset-0 z-20 bg-surface flex flex-col transition-transform duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)] shadow-[-18px_0_40px_rgba(0,0,0,0.10)]',
          subOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none',
        )}
        aria-hidden={!subOpen || undefined}
      >
        <div className="flex-none border-b border-on-surface/[0.08]">
          <div className="px-5 pt-safe-4 pb-3.5 w-full max-w-[640px] mx-auto flex items-center gap-3">
            <GlassButton
              id="settings-back"
              symbol="chevron.left"
              label="Back to settings"
              onClick={back}
              className="hit-44 flex-none w-10 h-10 -ml-1 rounded-full flex items-center justify-center text-on-surface bg-on-surface/[0.05] active:scale-95 transition-transform"
            >
              <ArrowLeft size={18} />
            </GlassButton>
            <h2 className="flex-1 min-w-0 font-serif font-bold text-[19px] leading-tight tracking-[-0.025em] text-on-surface truncate">{subTitle}</h2>
            <GlassButton
              id="settings-sub-close"
              symbol="xmark"
              label="Close settings"
              onClick={() => navigate(-1)}
              className="hit-44 flex-none w-10 h-10 -mr-1 rounded-full flex items-center justify-center text-on-surface bg-on-surface/[0.05] active:scale-95 transition-transform"
            >
              <X size={16} />
            </GlassButton>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-5 pt-5 pb-safe-6 w-full max-w-[640px] mx-auto">

            {subPage === 'edit' && (
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
                    <p className="font-serif font-bold text-[15px] tracking-[-0.02em] text-on-surface truncate">{displayName}</p>
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
                      value={editName}
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
                      value={editUsername}
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
                      value={editBio}
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
                      value={editHomeCity}
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
                  disabled={editSaving || !editDirty}
                  className={cn(
                    'w-full rounded-full py-4 text-[14px] font-bold text-white transition-colors',
                    editDirty ? 'bg-primary active:opacity-85' : 'bg-on-surface/30',
                    editSaving && 'opacity-60',
                  )}
                >
                  {editSaving ? 'Saving…' : editDirty ? 'Save changes' : 'Everything saved'}
                </button>
              </div>
            )}

            {subPage === 'account' && (
              <div className="flex flex-col gap-6">
                <div className="rounded-[18px] bg-on-surface/[0.05] px-4 py-4">
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/45">Signed in as</p>
                  {/* A phone-signup account has no email at all, so this
                      would render an empty line. Whichever identifier the
                      account actually has is the one that answers "signed
                      in as". */}
                  <p className="mt-2 text-[15px] font-semibold text-on-surface break-all">
                    {user?.email || (user?.phone ? formatPhoneForDisplay(user.phone) : '')}
                  </p>
                  <p className="mt-1.5 text-[11.5px] text-on-surface/50">{providerLabel}{joinedLabel ? ` · joined ${joinedLabel}` : ''}</p>
                </div>

                <div>
                  <FieldLabel>Change email</FieldLabel>
                  <div className="flex items-center gap-2.5">
                    <div className={cn(fieldBox, 'flex-1 min-w-0')}>
                      <Mail size={16} strokeWidth={1.9} className="flex-none text-on-surface/40" />
                      <input
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="New email"
                        className={cn(fieldInput, 'text-[14.5px]')}
                      />
                    </div>
                    <button type="button" onClick={handleUpdateEmail} disabled={!newEmail.trim()} className={inkPill}>
                      Update
                    </button>
                  </div>
                </div>

                {/* The only two-step field on this screen: a number isn't
                    attached until the texted code confirms it. Unverified
                    would defeat the point — this number is how friends
                    find you once contact syncing is on, so anyone could
                    claim someone else's. */}
                <div>
                  <FieldLabel>{user?.phone ? 'Change phone number' : 'Add phone number'}</FieldLabel>
                  <div className="flex items-center gap-2.5">
                    <div className={cn(fieldBox, 'flex-1 min-w-0')}>
                      <Phone size={16} strokeWidth={1.9} className="flex-none text-on-surface/40" />
                      <input
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        value={newPhone}
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
                          value={phoneCode}
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

                <div>
                  <FieldLabel>Change password</FieldLabel>
                  <div className="flex items-center gap-2.5">
                    <div className={cn(fieldBox, 'flex-1 min-w-0')}>
                      <Lock size={16} strokeWidth={1.9} className="flex-none text-on-surface/40" />
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="New password (min 6)"
                        className={cn(fieldInput, 'text-[14.5px]')}
                      />
                    </div>
                    <button type="button" onClick={handleUpdatePassword} disabled={newPassword.length < 6} className={inkPill}>
                      Update
                    </button>
                  </div>
                  <p className={cn('mt-2 text-[11.5px]', newPassword.length >= 6 ? 'text-score-high-ink font-semibold' : 'text-on-surface/45')}>
                    {newPassword.length === 0
                      ? 'At least 6 characters'
                      : newPassword.length >= 6 ? 'Strong enough' : `${6 - newPassword.length} more character${6 - newPassword.length === 1 ? '' : 's'}`}
                  </p>
                </div>

                {accountMsg && (
                  <p className="flex items-start gap-1.5 text-[12.5px] font-semibold text-score-high-ink">
                    <Check size={14} className="flex-none mt-px" /> {accountMsg}
                  </p>
                )}
                {accountError && (
                  <p className="flex items-start gap-1.5 text-[12.5px] font-semibold text-red-500">
                    <AlertTriangle size={14} className="flex-none mt-px" /> {accountError}
                  </p>
                )}

                <div className="border-t border-on-surface/[0.10] pt-5">
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
                        <span className="block font-serif font-bold text-[14.5px] tracking-[-0.015em] text-primary">Request a verified badge</span>
                        <span className="block mt-1 text-[12px] text-on-surface/50">For chefs, critics and creators</span>
                      </span>
                      <ChevronRight size={15} strokeWidth={2.2} className="flex-none text-primary/50" />
                    </button>
                  )}
                </div>

                <div className="border-t border-on-surface/[0.10] pt-5 flex flex-col gap-2.5">
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/45">Danger zone</p>
                  <p className="text-[12.5px] leading-relaxed text-on-surface/50">
                    Deleting removes your profile, ratings, recipes, posts, guides and photos. It can't be undone.
                  </p>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="self-start flex items-center gap-2 rounded-full border border-red-500/30 text-red-500 px-4 py-3 text-[13px] font-bold active:bg-red-500/[0.07] transition-colors"
                  >
                    <Trash2 size={15} strokeWidth={1.9} />
                    Delete account
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Delete-account confirm ── */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[70] flex items-end p-4 pb-safe-6 bg-black/40 backdrop-blur-[3px]"
            onClick={() => { if (!deletingAccount) setConfirmDelete(false); }}
          >
            <motion.div
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[560px] mx-auto rounded-[26px] bg-surface border border-on-surface/[0.08] shadow-[0_20px_50px_rgba(0,0,0,0.28)] p-5"
            >
              <h3 className="font-serif font-bold text-[20px] leading-tight tracking-[-0.03em] text-on-surface">Delete your account?</h3>
              <p className="mt-2.5 text-[13px] leading-relaxed text-on-surface/60">
                This permanently deletes your account and everything in it — profile, ratings, recipes,
                posts, reels, guides, photos and friends. There is no way to recover it.
              </p>
              <div className="mt-[18px] flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deletingAccount}
                  className="flex-1 rounded-full border border-on-surface/20 text-on-surface py-3.5 text-[13.5px] font-bold active:bg-on-surface/[0.06] transition-colors disabled:opacity-50"
                >
                  Keep it
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  disabled={deletingAccount}
                  className="flex-1 rounded-full bg-red-600 text-white py-3.5 text-[13.5px] font-bold active:opacity-85 transition-opacity disabled:opacity-70 flex items-center justify-center gap-1.5"
                >
                  {deletingAccount ? (<><Loader2 size={13} className="animate-spin" /> Deleting…</>) : 'Delete forever'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
