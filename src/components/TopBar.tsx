import React from 'react';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export const TopBar: React.FC<{ title?: string; rightAction?: React.ReactNode }> = ({ title = "Gourmet Canvas", rightAction }) => {
  const { pendingRequestCount } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 w-full px-6 py-4 flex items-center justify-between bg-surface/80 backdrop-blur-md z-40">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-serif italic text-xl">
          G
        </div>
        <h1 className="text-xl font-serif font-bold tracking-tight">{title}</h1>
      </div>
      <div className="flex items-center gap-2 text-on-surface/60">
        {rightAction}
        <button className="p-2 hover:bg-muted rounded-full transition-colors relative" onClick={() => navigate('/circle')}>
          <Bell size={20} />
          {pendingRequestCount > 0 && (
            <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-surface">
              {pendingRequestCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
};
