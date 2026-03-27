import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Lock, UserCircle, Loader2, UserPlus, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getProfileByUsername, getFollowCounts, canViewProfile, getFriends, sendFriendRequest, followPublicAccount, type UserProfile as UserProfileType } from '../lib/supabase-community';

export const UserProfile: React.FC = () => {
  const { username } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [profile, setProfile] = useState<UserProfileType | null>(null);
  const [loading, setLoading] = useState(true);
  const [canView, setCanView] = useState(false);
  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followSent, setFollowSent] = useState(false);

  useEffect(() => {
    if (!username) return;
    (async () => {
      setLoading(true);
      const p = await getProfileByUsername(username);
      setProfile(p);

      if (p && userId) {
        const [viewable, counts, friends] = await Promise.all([
          canViewProfile(userId, p),
          getFollowCounts(p.user_id),
          getFriends(userId),
        ]);
        setCanView(viewable);
        setFollowers(counts.followers);
        setFollowing(counts.following);
        setIsFollowing(friends.some((f) => f.friend_id === p.user_id));
      } else if (p?.is_public) {
        setCanView(true);
        const counts = await getFollowCounts(p.user_id);
        setFollowers(counts.followers);
        setFollowing(counts.following);
      }
      setLoading(false);
    })();
  }, [username, userId]);

  const handleFollow = async () => {
    if (!userId || !profile) return;
    if (profile.is_public) {
      const ok = await followPublicAccount(userId, profile.user_id);
      if (ok) { setIsFollowing(true); setFollowers((f) => f + 1); }
    } else {
      const ok = await sendFriendRequest(userId, profile.user_id);
      if (ok) setFollowSent(true);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-surface">
        <header className="sticky top-0 px-4 py-3 bg-surface/95 backdrop-blur-sm z-10 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-on-surface/50 hover:text-on-surface"><ArrowLeft size={20} /></button>
          <h1 className="font-serif font-bold text-lg">User Not Found</h1>
        </header>
        <div className="text-center py-16">
          <UserCircle size={48} className="mx-auto text-on-surface/15 mb-3" />
          <p className="text-sm text-on-surface/40">This user doesn't exist</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface pb-32">
      <header className="sticky top-0 px-4 py-3 bg-surface/95 backdrop-blur-sm z-10 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-on-surface/50 hover:text-on-surface"><ArrowLeft size={20} /></button>
        <h1 className="font-serif font-bold text-lg">@{profile.username}</h1>
      </header>

      <div className="px-3">
        {/* Profile header */}
        <section className="flex flex-col items-center mb-6 pt-4">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            <span className="text-3xl font-serif font-bold text-primary">{profile.display_name.charAt(0).toUpperCase()}</span>
          </div>
          <h2 className="text-xl font-serif font-bold">{profile.display_name}</h2>
          <p className="text-sm text-on-surface/40">@{profile.username}</p>
          {!profile.is_public && (
            <div className="flex items-center gap-1 mt-1 text-on-surface/30">
              <Lock size={11} />
              <span className="text-[10px] font-medium">Private Account</span>
            </div>
          )}
          {profile.bio && canView && <p className="text-xs text-on-surface/50 text-center mt-2 max-w-[250px]">{profile.bio}</p>}

          {/* Followers / Following */}
          {canView && (
            <div className="flex gap-5 mt-3">
              <div className="text-center">
                <p className="text-sm font-bold text-on-surface">{followers}</p>
                <p className="text-[10px] text-on-surface/40">Followers</p>
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-on-surface">{following}</p>
                <p className="text-[10px] text-on-surface/40">Following</p>
              </div>
            </div>
          )}

          {/* Follow button */}
          {userId && userId !== profile.user_id && (
            <div className="mt-3">
              {isFollowing ? (
                <span className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-on-surface/5 border border-on-surface/10 text-xs font-semibold text-on-surface/50">
                  <Check size={13} /> Following
                </span>
              ) : followSent ? (
                <span className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-on-surface/5 border border-on-surface/10 text-xs font-semibold text-on-surface/50">
                  Request Sent
                </span>
              ) : (
                <button onClick={handleFollow}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-primary text-white text-xs font-semibold">
                  <UserPlus size={13} /> {profile.is_public ? 'Follow' : 'Send Request'}
                </button>
              )}
            </div>
          )}
        </section>

        {/* Content — only visible if canView */}
        {canView ? (
          <section className="text-center py-12">
            <p className="text-sm text-on-surface/30">Profile content coming soon</p>
          </section>
        ) : (
          <section className="text-center py-16">
            <Lock size={32} className="mx-auto text-on-surface/15 mb-3" />
            <p className="text-sm font-medium text-on-surface/40">This account is private</p>
            <p className="text-xs text-on-surface/30 mt-1">Follow this user to see their profile</p>
          </section>
        )}
      </div>
    </div>
  );
};
