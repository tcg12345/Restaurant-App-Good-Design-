import React, { useState } from 'react';
import { motion } from 'motion/react';
import { MapPin, Star, Users, ChefHat, Compass, ArrowRight, Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const features = [
  { icon: MapPin, label: 'Discover', desc: 'Find hidden gems and top restaurants near you' },
  { icon: Star, label: 'Curate', desc: 'Save favorites and build your personal collection' },
  { icon: Users, label: 'Connect', desc: 'Follow friends and see where they dine' },
  { icon: ChefHat, label: 'Experts', desc: 'Get recommendations from trusted tastemakers' },
];

export const SignIn: React.FC = () => {
  const { signIn, signUp } = useAuth();
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    if (isSignUpMode && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setSubmitting(true);

    if (isSignUpMode) {
      const { error: err } = await signUp(email, password);
      if (err) {
        setError(err);
      } else {
        setSuccess('Account created! Check your email to confirm, then sign in.');
        setIsSignUpMode(false);
        setPassword('');
        setConfirmPassword('');
      }
    } else {
      const { error: err } = await signIn(email, password);
      if (err) {
        setError(err);
      }
    }

    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <div className="relative flex-1 flex flex-col items-center justify-center px-6 py-12 overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-primary/5" />
          <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-secondary/5" />
          <div className="absolute top-1/3 right-1/4 w-48 h-48 rounded-full bg-accent/10" />
        </div>

        {/* Logo & title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="relative z-10 flex flex-col items-center text-center mb-8"
        >
          <div className="w-20 h-20 rounded-full bg-primary flex items-center justify-center text-white font-serif italic text-4xl shadow-lg shadow-primary/25 mb-6">
            G
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-bold tracking-tight text-on-surface mb-3">
            Gourmet Canvas
          </h1>
          <p className="text-lg text-on-surface/50 max-w-md font-light">
            Your personal guide to extraordinary dining experiences
          </p>
        </motion.div>

        {/* Feature cards */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' }}
          className="relative z-10 grid grid-cols-2 gap-3 w-full max-w-md mb-8"
        >
          {features.map((f, i) => (
            <motion.div
              key={f.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.3 + i * 0.1 }}
              className="bg-white/60 backdrop-blur-sm border border-black/5 rounded-2xl p-4 flex flex-col gap-2"
            >
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <f.icon size={20} className="text-primary" />
              </div>
              <p className="text-sm font-semibold text-on-surface">{f.label}</p>
              <p className="text-xs text-on-surface/50 leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Auth form */}
        <motion.form
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          onSubmit={handleSubmit}
          className="relative z-10 w-full max-w-md flex flex-col gap-3"
        >
          {/* Email input */}
          <div className="relative">
            <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/30" />
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-white/70 backdrop-blur-sm border border-black/5 text-on-surface placeholder:text-on-surface/30 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all text-sm"
              autoComplete="email"
            />
          </div>

          {/* Password input */}
          <div className="relative">
            <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/30" />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-11 pr-11 py-3.5 rounded-2xl bg-white/70 backdrop-blur-sm border border-black/5 text-on-surface placeholder:text-on-surface/30 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all text-sm"
              autoComplete={isSignUpMode ? 'new-password' : 'current-password'}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface/30 hover:text-on-surface/50 transition-colors"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {/* Confirm password (sign up only) */}
          {isSignUpMode && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="relative"
            >
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/30" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-white/70 backdrop-blur-sm border border-black/5 text-on-surface placeholder:text-on-surface/30 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all text-sm"
                autoComplete="new-password"
              />
            </motion.div>
          )}

          {/* Error message */}
          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-red-600 bg-red-50 px-4 py-2.5 rounded-xl"
            >
              {error}
            </motion.p>
          )}

          {/* Success message */}
          {success && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-green-700 bg-green-50 px-4 py-2.5 rounded-xl"
            >
              {success}
            </motion.p>
          )}

          {/* Submit button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={submitting}
            className="group flex items-center justify-center gap-3 bg-primary text-white px-8 py-4 rounded-2xl text-lg font-semibold shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-shadow cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <>
                {isSignUpMode ? 'Create Account' : 'Sign In'}
                <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </motion.button>

          {/* Toggle sign in / sign up */}
          <p className="text-center text-sm text-on-surface/40 mt-1">
            {isSignUpMode ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={() => {
                setIsSignUpMode(!isSignUpMode);
                setError('');
                setSuccess('');
              }}
              className="text-primary font-medium hover:underline cursor-pointer"
            >
              {isSignUpMode ? 'Sign In' : 'Sign Up'}
            </button>
          </p>
        </motion.form>

        {/* Explore compass */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.7 }}
          className="relative z-10 flex items-center gap-2 text-on-surface/30 mt-6"
        >
          <Compass size={16} />
          <span className="text-xs tracking-wider uppercase">Explore · Taste · Share</span>
        </motion.div>
      </div>
    </div>
  );
};
