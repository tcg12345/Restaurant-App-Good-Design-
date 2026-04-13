import React from 'react';
import { ArrowLeft, Heart, MessageCircle } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useChat } from '../contexts/ChatContext';

interface TopBarProps {
  title?: string;
  rightAction?: React.ReactNode;
  showBackButton?: boolean;
  onBack?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ title = "Gourmet Canvas", rightAction, showBackButton = false, onBack }) => {
  const { pendingRequestCount } = useAuth();
  const { unreadCount } = useChat();
  const navigate = useNavigate();
  const location = useLocation();

  const isCirclePage = location.pathname === '/circle';

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate('/');
    }
  };

  return (
    <header className="sticky top-0 w-full px-6 py-4 flex items-center justify-between bg-surface/80 backdrop-blur-md z-40">
      <div className="flex items-center gap-3">
        {showBackButton ? (
          <button
            onClick={handleBack}
            className="w-10 h-10 rounded-full bg-on-surface/5 hover:bg-on-surface/10 flex items-center justify-center text-on-surface/70 transition-colors"
            aria-label="Back to Explore"
          >
            <ArrowLeft size={20} />
          </button>
        ) : (
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-serif italic text-xl">
            G
          </div>
        )}
        <h1 className="text-xl font-serif font-bold tracking-tight">{title}</h1>
      </div>
      <div className="flex items-center gap-2 text-on-surface/60">
        {rightAction}
        <button className="p-2 hover:bg-muted rounded-full transition-colors relative" onClick={() => navigate('/messages')}>
          <MessageCircle size={20} />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 bg-primary text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-surface">
              {unreadCount}
            </span>
          )}
        </button>
        {!isCirclePage && (
          <button
            className="p-2 hover:bg-muted rounded-full transition-colors relative"
            onClick={() => navigate('/circle')}
            aria-label="Your Circle"
          >
            <Heart size={20} />
            {pendingRequestCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-surface">
                {pendingRequestCount}
              </span>
            )}
          </button>
        )}
      </div>
    </header>
  );
};
