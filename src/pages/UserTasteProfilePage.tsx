/**
 * Someone else's taste profile: /user/:username/taste
 *
 * The same reading as /profile/taste, in the third person and without
 * the leaderboard tab — a person's board position is a fact about them,
 * their board is not. Built from what community_ratings lets the viewer
 * see (public account or an accepted follow; RLS enforces it, this page
 * just says so politely when there is nothing to show).
 *
 * The rank comes from the points board, and if the viewer is ranked too,
 * the masthead says how close the two palates are (get_taste_twins).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useHeaderFade } from '../lib/useHeaderFade';
import { useMichelinIndexReady } from '../lib/useMichelinMatch';
import {
  canViewProfile, getProfileByUsername, getUserPhotos, getUserRatings,
  type CommunityPhoto, type CommunityRating, type UserProfile,
} from '../lib/supabase-community';
import { getTasteLeaderboard, getTasteMyRanks, getTasteTwins } from '../lib/supabase-taste';
import { buildTasteStateFromCommunity } from '../lib/taste-state';
import { FloatingBack } from '../components/FloatingBack';
import { TasteBody, TasteChrome, TasteMasthead, voiceFor } from './TasteProfilePage';

const PAGE_BOTTOM = 'calc(env(safe-area-inset-bottom, 0px) + 104px)';

const firstName = (p: UserProfile | null): string =>
  (p?.display_name || p?.username || 'They').trim().split(/\s+/)[0];

export const UserTasteProfilePage: React.FC = () => {
  const { username = '' } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { phoneMode, twoDecimalScores } = useSettings();
  const fade = useHeaderFade({ enabled: phoneMode, windowScroll: true });
  const michelinReady = useMichelinIndexReady();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [canView, setCanView] = useState<boolean | null>(null);
  const [rows, setRows] = useState<CommunityRating[] | null>(null);
  const [photos, setPhotos] = useState<CommunityPhoto[]>([]);
  const [rank, setRank] = useState<{ rank: number; ranked: number } | null>(null);
  const [match, setMatch] = useState<{ similarity: number; shared: string[] } | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await getProfileByUsername(decodeURIComponent(username));
      if (cancelled) return;
      if (!p) { setNotFound(true); return; }
      setProfile(p);
      const viewable = user?.id === p.user_id || await canViewProfile(user?.id ?? '', p);
      if (cancelled) return;
      setCanView(viewable);
      if (!viewable) { setRows([]); return; }
      const [r, ph] = await Promise.all([getUserRatings(p.user_id), getUserPhotos(p.user_id)]);
      if (cancelled) return;
      setRows(r);
      setPhotos(ph);
      // Board position and palate match are best-effort extras.
      if (user?.id) {
        void Promise.all([getTasteLeaderboard(100, 'points'), getTasteMyRanks(), getTasteTwins(100)]).then(([board, mine, twins]) => {
          if (cancelled) return;
          const row = board?.find((b) => b.userId === p.user_id);
          if (row) setRank({ rank: row.rank, ranked: mine?.rankedUsers ?? board?.length ?? 0 });
          const twin = twins?.find((b) => b.userId === p.user_id);
          if (twin && twin.similarity != null) setMatch({ similarity: twin.similarity, shared: twin.sharedCuisines ?? [] });
        });
      }
    })();
    return () => { cancelled = true; };
  }, [username, user?.id]);

  const name = firstName(profile);
  const state = useMemo(
    () => (rows ? buildTasteStateFromCommunity({ rows, photos, profile, michelinReady, name }) : null),
    [rows, photos, profile, michelinReady, name],
  );

  const back = () => navigate(`/user/${encodeURIComponent(username)}`);
  const displayName = profile?.display_name || profile?.username || 'Taste profile';

  if (notFound || canView === false) {
    return (
      <div className="min-h-screen bg-surface">
        <FloatingBack id="user-taste-back" onBack={back} />
        <div className="mx-auto w-full max-w-[860px] px-5 text-center" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 76px)' }}>
          <span className="mx-auto mt-10 flex h-14 w-14 items-center justify-center rounded-2xl bg-on-surface/[0.05]">
            <Lock size={24} className="text-on-surface/25" />
          </span>
          <h1 className="mt-4 font-serif text-[22px] font-bold text-on-surface">
            {notFound ? "This person isn't here" : 'This palate is private'}
          </h1>
          <p className="mx-auto mt-1.5 max-w-[340px] text-[13.5px] text-on-surface/50">
            {notFound
              ? 'The account was removed, or the link is wrong.'
              : `Only people ${displayName} follows back can see their taste profile.`}
          </p>
        </div>
      </div>
    );
  }

  if (!state || !profile) {
    return (
      <div className="min-h-screen bg-surface">
        <FloatingBack id="user-taste-back" onBack={back} />
        <p className="mx-auto w-full max-w-[860px] px-5 text-[13.5px] text-on-surface/45" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 76px)' }}>
          Reading {displayName}'s palate…
        </p>
      </div>
    );
  }

  const rankLine = rank ? `#${rank.rank} of ${rank.ranked} on GoodEats` : null;
  const matchLine = match
    ? `${Math.round(match.similarity * 100)}% match with your palate${match.shared.length ? ` · shares ${match.shared.slice(0, 2).join(', ')}` : ''}`
    : null;

  return (
    <div className="min-h-screen bg-surface">
      <TasteChrome fade={fade} title={`${displayName} · Taste`} right={`${state.points.total} pts`} onBack={back} backId="user-taste-back" />
      <div className="mx-auto w-full max-w-[860px] px-5" style={{ paddingBottom: PAGE_BOTTOM }}>
        <TasteMasthead
          fade={fade}
          phoneMode={phoneMode}
          eyebrow={`${displayName} · Taste profile`}
          standing={state.standing}
          points={state.points}
          rankLine={rankLine}
          extraLine={matchLine}
        />
        <div className="mt-2" />
        <TasteBody
          v={voiceFor(name)}
          insights={state.insights}
          points={state.points}
          bench={null}
          ratingCount={state.ratingCount}
          twoDecimals={twoDecimalScores}
        />
      </div>
    </div>
  );
};
