import React from 'react';
import { ArrowLeft, Heart, MessageCircle } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useChat } from '../contexts/ChatContext';

interface TopBarProps {
  title?: string;
  rightAction?: React.ReactNode;
  /** Optional custom button rendered on the left, replacing the default
   *  logo / back-button slot. When provided alongside `centerLogo`, the
   *  header reads as: [leftAction] · [G logo] · [right actions]. */
  leftAction?: React.ReactNode;
  /** When true, the logo (with no title text) is pinned to the centre
   *  of the header instead of sitting on the left with the title.
   *  Used by the mobile Discover header to make room for the Create
   *  shortcut on the left. */
  centerLogo?: boolean;
  showBackButton?: boolean;
  onBack?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ title = "Gourmet Canvas", rightAction, leftAction, centerLogo = false, showBackButton = false, onBack }) => {
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

  const logo = (
    <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-serif italic text-xl">
      G
    </div>
  );

  const backButton = (
    <button
      onClick={handleBack}
      className="w-10 h-10 rounded-full bg-on-surface/5 hover:bg-on-surface/10 flex items-center justify-center text-on-surface/70 transition-colors"
      aria-label="Back to Explore"
    >
      <ArrowLeft size={20} />
    </button>
  );

  const rightCluster = (
    <div className="flex items-center gap-2 text-on-surface/60">
      {rightAction}
      <button className="p-2 hover:bg-muted rounded-full transition-colors relative" onClick={() => navigate('/messages')}>
        <MessageCircle size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[20px] h-5 px-1.5 bg-primary text-white text-[12px] font-bold rounded-full flex items-center justify-center border-2 border-surface">
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
            <span className="absolute -top-0.5 -right-0.5 min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[12px] font-bold rounded-full flex items-center justify-center border-2 border-surface">
              {pendingRequestCount}
            </span>
          )}
        </button>
      )}
    </div>
  );

  // Three-column layout when the logo is pinned to centre so the title
  // doesn't sit awkwardly next to the leftAction.
  if (centerLogo) {
    return (
      <header className="sticky top-0 w-full px-4 py-4 grid grid-cols-[1fr_auto_1fr] items-center bg-surface/70 backdrop-blur-md z-40">
        <div className="flex items-center justify-start">
          {leftAction ?? (showBackButton ? backButton : null)}
        </div>
        <div className="flex items-center justify-center">{logo}</div>
        <div className="flex items-center justify-end">{rightCluster}</div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 w-full px-6 py-4 flex items-center justify-between bg-surface/70 backdrop-blur-md z-40">
      <div className="flex items-center gap-3">
        {leftAction ?? (showBackButton ? backButton : logo)}
        <h1 className="text-xl font-serif font-bold tracking-tight">{title}</h1>
      </div>
      {rightCluster}
    </header>
  );
};
