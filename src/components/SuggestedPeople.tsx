import React, { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2, UserPlus } from 'lucide-react';
import { cn } from '../lib/utils';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { avatarHue } from '../lib/avatar';
import { suggestionSubtitle } from '../lib/suggestions';
import { followPublicAccount, sendFriendRequest, type SuggestedProfile } from '../lib/supabase-community';

/**
 * "People to follow" — the rail a new account sees where its feed would
 * otherwise be a sentence and a dead end.
 *
 * Shaped like GuidesRail on purpose: same 22px radius, same snap-scroll
 * gutters, same heading/subtitle pair. A new user's home page should read as
 * one surface with two invitations on it, not as a feature that ran out of
 * content next to a feature that didn't.
 *
 * Following happens in the card. Sending someone to a profile to follow them
 * and then expecting them to navigate back is how a suggestion rail becomes
 * a rail nobody uses, so the button commits inline and settles into a
 * "Following" state in place.
 */

type FollowState = 'none' | 'pending' | 'following' | 'requested';

const PersonCard: React.FC<{
  profile: SuggestedProfile;
  state: FollowState;
  onFollow: (p: SuggestedProfile) => void;
}> = ({ profile, state, onFollow }) => {
  const name = profile.display_name || profile.username || 'Someone';
  const hue = avatarHue(profile.user_id);
  const busy = state === 'pending';
  const done = state === 'following' || state === 'requested';

  return (
    <div className="flex-none w-[148px] snap-start rounded-[22px] border border-on-surface/[0.09] bg-paper px-3.5 pt-4 pb-3.5 flex flex-col items-center text-center">
      <Link to={`/user/${profile.username || ''}`} className="active:opacity-75 transition-opacity">
        <Avatar
          src={profile.avatar_url}
          name={name}
          size={54}
          fallbackStyle={{ backgroundColor: `hsl(${hue} 52% 92%)`, color: `hsl(${hue} 45% 34%)` }}
        />
      </Link>
      <Link to={`/user/${profile.username || ''}`} className="mt-2.5 w-full active:opacity-75 transition-opacity">
        <span className="flex items-center justify-center gap-1 min-w-0">
          <span
            className="truncate font-serif text-on-surface"
            style={{ fontSize: '14px', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.02em' }}
          >
            {name}
          </span>
          {profile.is_verified && <VerifiedBadge size={12} className="flex-none" />}
        </span>
        <span className="mt-[3px] block truncate text-on-surface/45" style={{ fontSize: '11.5px', lineHeight: 1.2 }}>
          {suggestionSubtitle(profile)}
        </span>
      </Link>
      <button
        type="button"
        onClick={() => onFollow(profile)}
        disabled={busy || done}
        aria-label={done ? `Following ${name}` : `Follow ${name}`}
        className={cn(
          'mt-3 w-full h-8 rounded-full inline-flex items-center justify-center gap-1 transition-opacity active:opacity-80 disabled:opacity-100',
          done ? 'bg-on-surface/[0.06] text-on-surface/55' : 'bg-primary text-white',
        )}
        style={{ fontSize: '12px', fontWeight: 700 }}
      >
        {busy ? <Loader2 size={12} className="animate-spin" />
          : done ? <Check size={12} strokeWidth={2.6} />
          : <UserPlus size={12} strokeWidth={2.6} />}
        {state === 'requested' ? 'Requested' : done ? 'Following' : 'Follow'}
      </button>
    </div>
  );
};

export const SuggestedPeople: React.FC<{
  people: SuggestedProfile[];
  /** Null when signed out — following then routes through the sign-in gate. */
  userId: string | null;
  /** Called when a signed-out viewer tries to follow. */
  onRequireSignIn?: () => void;
  /** Fired after a follow lands, so the feed behind this rail can pick up
   *  the newly-followed person's content without a reload. */
  onFollowed?: () => void;
  loading?: boolean;
  /** Cards only, no section heading — for hosts (onboarding) that supply
   *  their own question-style header above the rail. */
  bare?: boolean;
}> = ({ people, userId, onRequireSignIn, onFollowed, loading, bare }) => {
  const [states, setStates] = useState<Record<string, FollowState>>({});

  const handleFollow = useCallback(async (p: SuggestedProfile) => {
    if (!userId) { onRequireSignIn?.(); return; }
    if (states[p.user_id] && states[p.user_id] !== 'none') return;
    setStates((prev) => ({ ...prev, [p.user_id]: 'pending' }));
    // Suggestions are public accounts by construction, so the follow lands
    // immediately. sendFriendRequest is the fallback for a profile that
    // flipped to private between the query and the tap — without it that
    // tap would silently do nothing.
    const ok = p.is_public
      ? await followPublicAccount(userId, p.user_id)
      : await sendFriendRequest(userId, p.user_id);
    setStates((prev) => ({
      ...prev,
      [p.user_id]: ok ? (p.is_public ? 'following' : 'requested') : 'none',
    }));
    // Only an accepted follow changes what the feed can show; a request to a
    // private account changes nothing until they approve it.
    if (ok && p.is_public) onFollowed?.();
  }, [userId, states, onRequireSignIn, onFollowed]);

  const header = bare ? null : (
    <div className="px-5">
      <h2 className="text-on-surface" style={{ fontSize: '18px', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.022em' }}>
        People to follow
      </h2>
      <p className="mt-1.5 text-on-surface/45" style={{ fontSize: '12.5px', lineHeight: 1.35 }}>
        Their ratings and posts land in your feed.
      </p>
    </div>
  );

  if (loading) {
    return (
      <section>
        {header}
        <div className={cn('flex gap-2.5 overflow-hidden px-5', !bare && 'mt-4')}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex-none w-[148px] h-[168px] rounded-[22px] bg-on-surface/[0.05] animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  if (people.length === 0) return null;

  return (
    <section>
      {header}
      <div className={cn('flex gap-2.5 overflow-x-auto no-scrollbar snap-x scroll-px-5 px-5', !bare && 'mt-4')}>
        {people.map((p) => (
          <PersonCard
            key={p.user_id}
            profile={p}
            state={states[p.user_id] ?? 'none'}
            onFollow={handleFollow}
          />
        ))}
      </div>
    </section>
  );
};
