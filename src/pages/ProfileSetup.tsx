import React, { useState } from 'react';
import { motion } from 'motion/react';
import { User, AtSign, ArrowRight, Loader2, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { saveProfile } from '../lib/supabase-community';

export const ProfileSetup: React.FC = () => {
  const { user, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!displayName.trim()) { setError('Please enter your name'); return; }
    if (!username.trim()) { setError('Please choose a username'); return; }
    if (username.length < 3) { setError('Username must be at least 3 characters'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) { setError('Username can only contain letters, numbers, and underscores'); return; }

    if (!user?.id) return;
    setSubmitting(true);

    const result = await saveProfile(user.id, displayName.trim(), username.trim());
    if (result.success) {
      await refreshProfile();
    } else {
      setError(result.error || 'Something went wrong');
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-6 py-12">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-primary/5" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-secondary/5" />
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="relative z-10 flex flex-col items-center text-center mb-8">
        <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center text-white font-serif italic text-3xl shadow-lg shadow-primary/25 mb-5">G</div>
        <h1 className="text-3xl font-serif font-bold tracking-tight text-on-surface mb-2">Set Up Your Profile</h1>
        <p className="text-sm text-on-surface/50 max-w-sm">Choose a display name and username so friends can find you</p>
      </motion.div>

      <motion.form initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        onSubmit={handleSubmit} className="relative z-10 w-full max-w-sm flex flex-col gap-3">

        <div className="relative">
          <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/30" />
          <input type="text" placeholder="Your name (e.g. Tyler)" value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-white/70 backdrop-blur-sm border border-black/5 text-on-surface placeholder:text-on-surface/30 focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm" />
        </div>

        <div className="relative">
          <AtSign size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/30" />
          <input type="text" placeholder="Username (e.g. tyler_eats)" value={username}
            onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
            className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-white/70 backdrop-blur-sm border border-black/5 text-on-surface placeholder:text-on-surface/30 focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm"
            autoCapitalize="off" autoCorrect="off" />
        </div>

        {username && (
          <p className="text-xs text-on-surface/40 px-1">Your username will be: <span className="font-semibold text-primary">@{username.toLowerCase()}</span></p>
        )}

        {error && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-xl">{error}</motion.p>
        )}

        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          type="submit" disabled={submitting}
          className="group flex items-center justify-center gap-3 bg-primary text-white px-8 py-4 rounded-2xl text-lg font-semibold shadow-lg shadow-primary/25 mt-1 disabled:opacity-60">
          {submitting ? <Loader2 size={20} className="animate-spin" /> : (
            <>Continue <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" /></>
          )}
        </motion.button>
      </motion.form>
    </div>
  );
};
