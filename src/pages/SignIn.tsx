import React from 'react';
import { motion } from 'motion/react';
import { MapPin, Star, Users, ChefHat, Compass, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const features = [
  { icon: MapPin, label: 'Discover', desc: 'Find hidden gems and top restaurants near you' },
  { icon: Star, label: 'Curate', desc: 'Save favorites and build your personal collection' },
  { icon: Users, label: 'Connect', desc: 'Follow friends and see where they dine' },
  { icon: ChefHat, label: 'Experts', desc: 'Get recommendations from trusted tastemakers' },
];

export const SignIn: React.FC = () => {
  const { signIn } = useAuth();

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Hero section */}
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
          className="relative z-10 flex flex-col items-center text-center mb-10"
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
          className="relative z-10 grid grid-cols-2 gap-3 w-full max-w-md mb-10"
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

        {/* Explore compass */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="relative z-10 flex items-center gap-2 text-on-surface/30 mb-8"
        >
          <Compass size={16} />
          <span className="text-xs tracking-wider uppercase">Explore · Taste · Share</span>
        </motion.div>

        {/* Sign in button */}
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.7, ease: 'easeOut' }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={signIn}
          className="relative z-10 group flex items-center gap-3 bg-primary text-white px-8 py-4 rounded-2xl text-lg font-semibold shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-shadow cursor-pointer"
        >
          Sign In
          <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
        </motion.button>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 }}
          className="relative z-10 mt-4 text-xs text-on-surface/30"
        >
          No account needed — jump right in
        </motion.p>
      </div>
    </div>
  );
};
