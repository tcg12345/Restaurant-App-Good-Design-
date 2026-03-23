import React from 'react';
import { Bell, Settings, Search } from 'lucide-react';

export const TopBar: React.FC<{ title?: string }> = ({ title = "Gourmet Canvas" }) => {
  return (
    <header className="sticky top-0 w-full px-6 py-4 flex items-center justify-between bg-surface/80 backdrop-blur-md z-40">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-serif italic text-xl">
          G
        </div>
        <h1 className="text-xl font-serif font-bold tracking-tight">{title}</h1>
      </div>
      <div className="flex items-center gap-4 text-on-surface/60">
        <button className="p-2 hover:bg-muted rounded-full transition-colors">
          <Search size={20} />
        </button>
        <button className="p-2 hover:bg-muted rounded-full transition-colors relative">
          <Bell size={20} />
          <span className="absolute top-2 right-2 w-2 h-2 bg-primary rounded-full border-2 border-surface"></span>
        </button>
      </div>
    </header>
  );
};
