import React, { useState, useRef, useEffect } from 'react';
import { Bell, Settings, Smartphone, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';

export const TopBar: React.FC<{ title?: string }> = ({ title = "Gourmet Canvas" }) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { phoneMode, togglePhoneMode } = useSettings();
  const { signOut } = useAuth();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    if (settingsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [settingsOpen]);

  return (
    <header className="sticky top-0 w-full px-6 py-4 flex items-center justify-between bg-surface/80 backdrop-blur-md z-40">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-serif italic text-xl">
          G
        </div>
        <h1 className="text-xl font-serif font-bold tracking-tight">{title}</h1>
      </div>
      <div className="flex items-center gap-4 text-on-surface/60">
        <div className="relative" ref={dropdownRef}>
          <button
            className="p-2 hover:bg-muted rounded-full transition-colors"
            onClick={() => setSettingsOpen((prev) => !prev)}
          >
            <Settings size={20} />
          </button>
          <AnimatePresence>
            {settingsOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -4 }}
                transition={{ type: 'spring', damping: 24, stiffness: 400, mass: 0.5 }}
                className="absolute right-0 top-full mt-2 w-56 bg-surface rounded-2xl shadow-xl border border-black/5 overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-black/5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-on-surface/40">Settings</p>
                </div>
                <div className="p-2">
                  <button
                    onClick={togglePhoneMode}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted transition-colors cursor-pointer"
                  >
                    <Smartphone size={18} className="text-on-surface/50" />
                    <span className="flex-1 text-sm text-on-surface/80 text-left">Phone View</span>
                    <div
                      className={`w-10 h-6 rounded-full relative transition-colors duration-200 ${
                        phoneMode ? 'bg-primary' : 'bg-on-surface/15'
                      }`}
                    >
                      <motion.div
                        className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md"
                        animate={{ left: phoneMode ? '1.125rem' : '0.125rem' }}
                        transition={{ type: 'spring', damping: 20, stiffness: 350 }}
                      />
                    </div>
                  </button>
                  <div className="border-t border-black/5 mt-1 pt-1">
                    <button
                      onClick={() => {
                        setSettingsOpen(false);
                        void signOut();
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-red-50 transition-colors cursor-pointer"
                    >
                      <LogOut size={18} className="text-red-500/70" />
                      <span className="flex-1 text-sm text-red-600/80 text-left">Sign Out</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <button className="p-2 hover:bg-muted rounded-full transition-colors relative">
          <Bell size={20} />
          <span className="absolute top-2 right-2 w-2 h-2 bg-primary rounded-full border-2 border-surface"></span>
        </button>
      </div>
    </header>
  );
};
