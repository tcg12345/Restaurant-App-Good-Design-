import React from 'react';
import { motion } from 'motion/react';
import { MapPin, Star, Users, ChefHat, Compass, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const features = [
  {
    icon: MapPin,
    label: 'Map your favorite places',
    desc: 'Pin the spots worth remembering and build your own personal food atlas.',
  },
  {
    icon: Star,
    label: 'Rate on your own terms',
    desc: 'Score food, service, and vibe on a 10-point scale that belongs to you.',
  },
  {
    icon: Users,
    label: 'Follow people you trust',
    desc: 'See where friends and tastemakers actually eat — no algorithmic guesswork.',
  },
  {
    icon: ChefHat,
    label: 'Cook restaurant-quality meals',
    desc: 'Save recipes, plan dinners, and share the dishes you made at home.',
  },
];

export const SignIn: React.FC = () => {
  const navigate = useNavigate();

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

        {/* Feature blocks — editorial, content-first (no card wrappers) */}
        <div className="relative z-10 flex flex-col gap-8 w-full max-w-md mb-12">
          {features.map((f, i) => (
            <motion.div
              key={f.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 + i * 0.1, ease: 'easeOut' }}
            >
              <div className="flex items-start gap-3 mb-1.5">
                <f.icon size={20} className="text-primary flex-shrink-0 mt-[9px]" strokeWidth={2.25} />
                <h3 className="font-serif font-bold text-[26px] text-on-surface leading-tight tracking-tight">
                  {f.label}
                </h3>
              </div>
              <p className="text-base text-on-surface/55 leading-relaxed font-light">
                {f.desc}
              </p>
            </motion.div>
          ))}
        </div>

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

        {/* Get Started button */}
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.7, ease: 'easeOut' }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate('/auth')}
          className="relative z-10 group flex items-center gap-3 bg-primary text-white px-8 py-4 rounded-2xl text-lg font-semibold shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-shadow cursor-pointer"
        >
          Get Started
          <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
        </motion.button>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 }}
          className="relative z-10 mt-4 text-xs text-on-surface/30"
        >
          Sign in or create an account
        </motion.p>
      </div>
    </div>
  );
};
