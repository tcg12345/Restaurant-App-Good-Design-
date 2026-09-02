import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Users, MessageCircle } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useChat } from '../contexts/ChatContext';
import { useNotifications } from '../contexts/NotificationsContext';
import { useHeaderFade } from '../lib/useHeaderFade';
import { GlassButton, GlassGroup, GlassSurface } from '../lib/glass-buttons';
import { Logo } from './Logo';

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
  /** Discover-style scroll fade: the bar dissolves as the page scrolls
   *  and returns near the top. For body-scrolling pages that render the
   *  bar directly (Profile); Discover animates its own wrapper instead. */
  fadeOnScroll?: boolean;
  /** With `fadeOnScroll`, hand off to a compact glass bar carrying this
   *  label instead of just dissolving — the actions stay reachable all
   *  the way down the page, and the label says whose page you're on.
   *  Tapping it returns to the top. */
  condensedTitle?: string;
}

export const TopBar: React.FC<TopBarProps> = ({ title = "GoodEats", rightAction, leftAction, centerLogo = false, showBackButton = false, onBack, fadeOnScroll = false, condensedTitle }) => {
  const { pendingRequestCount } = useAuth();
  const { unreadCount } = useChat();
  // The Circle button is the only way into the notification centre on a
  // phone, so its badge covers requests + alerts together.
  const { unreadCount: alertCount } = useNotifications();
  const circleBadge = pendingRequestCount + alertCount;
  const navigate = useNavigate();
  const location = useLocation();

  const isCirclePage = location.pathname === '/circle';
  // condensedOnScrollUp: the compact bar follows the home page's manners —
  // away while scrolling down (content owns the full screen, nothing for
  // it to slide into), back the moment the user scrolls up.
  const fade = useHeaderFade({ enabled: fadeOnScroll, windowScroll: true, condensedOnScrollUp: true });
  const fadeProps = fadeOnScroll ? { ref: fade.headerRef, style: fade.headerStyle } : {};
  const showCondensed = fadeOnScroll && !!condensedTitle;

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate('/');
    }
  };

  // Drawn, not set in type. The mark used to be an italic serif "G", which
  // meant it inherited whatever family the page had scoped itself to —
  // Home and the restaurant flow run in Archivo and override `font-serif`
  // wholesale, so the brand mark came out in the page's font and had to
  // pin `font-family` inline to defend itself. An SVG has no such problem:
  // it looks identical on every screen because there is no font involved.
  const logo = <Logo size={40} className="text-primary" />;

  // 44pt, not the old 40: a glass control needs enough of itself for the
  // material to read, which is why the system's own circular chrome is this
  // size, and it lands exactly on the minimum touch target as a bonus.
  const backButton = (
    <GlassButton
      id="topbar-back"
      symbol="arrow.left"
      label="Back to Explore"
      onClick={handleBack}
      className="hit-44 w-11 h-11 rounded-full flex items-center justify-center text-on-surface/70 transition-colors"
    >
      <ArrowLeft size={20} />
    </GlassButton>
  );

  /** Messages + Circle, at the full header size or the condensed one.
   *  `rightAction` is a caller-sized node, so it only rides along in the
   *  full header. */
  const buildRightCluster = (compact: boolean) => {
    const badge = cn(
      'absolute rounded-full text-white font-bold flex items-center justify-center border-2 border-surface',
      compact ? '-top-1 -right-1 min-w-[17px] h-[17px] px-1 text-[10px]' : '-top-0.5 -right-0.5 min-w-[20px] h-5 px-1.5 text-[12px]',
    );
    const icon = compact ? 18 : 21;
    const scope = compact ? 'compact' : 'full';

    // Messages and Circle share one capsule rather than sitting in two of
    // their own. Two touching glass circles read as two objects; one surface
    // with two regions reads as the single control it is, which is how the
    // system groups its own header actions.
    const items = [
      {
        id: 'messages',
        symbol: 'message',
        label: 'Messages',
        badge: unreadCount > 0 ? String(unreadCount) : undefined,
        onClick: () => navigate('/messages'),
        icon: (
          <>
            <MessageCircle size={icon} />
            {unreadCount > 0 && <span className={cn(badge, 'bg-primary')}>{unreadCount}</span>}
          </>
        ),
      },
      ...(isCirclePage ? [] : [{
        id: 'circle',
        symbol: 'person.2',
        label: 'Your Circle',
        badge: circleBadge > 0 ? String(circleBadge) : undefined,
        badgeTone: (pendingRequestCount > 0 ? 'danger' : 'primary') as 'danger' | 'primary',
        onClick: () => navigate('/circle'),
        icon: (
          <>
            <Users size={icon} />
            {circleBadge > 0 && (
              <span className={cn(badge, pendingRequestCount > 0 ? 'bg-red-500' : 'bg-primary')}>
                {circleBadge}
              </span>
            )}
          </>
        ),
      }]),
    ];

    // The capsule's own padding is what separates the regions; each is a
    // square so the glyphs sit on the same centres the old circles used.
    const region = cn(
      'relative flex items-center justify-center text-on-surface/70 transition-colors',
      compact ? 'w-9 h-9' : 'w-11 h-11',
    );

    return (
      <div className={cn('flex items-center', compact ? 'gap-1' : 'gap-2')}>
        {!compact && rightAction}
        <GlassGroup
          id={`topbar-actions-${scope}`}
          className="flex items-center rounded-full"
          itemClassName={region}
          items={items}
        />
      </div>
    );
  };

  const rightCluster = buildRightCluster(false);

  // Three-column layout when the logo is pinned to centre so the title
  // doesn't sit awkwardly next to the leftAction.
  const header = centerLogo ? (
    <motion.header
      {...fadeProps}
      className={cn(
        'w-full px-4 pt-safe-4 pb-4 grid grid-cols-[1fr_auto_1fr] items-center bg-surface/70 backdrop-blur-md',
        showCondensed ? '' : 'sticky top-0 z-40',
      )}
    >
      <div className="flex items-center justify-start">
        {leftAction ?? (showBackButton ? backButton : null)}
      </div>
      <div className="flex items-center justify-center">{logo}</div>
      <div className="flex items-center justify-end">{rightCluster}</div>
    </motion.header>
  ) : (
    <motion.header
      {...fadeProps}
      className={cn(
        'w-full px-6 pt-safe-4 pb-4 flex items-center justify-between bg-surface/70 backdrop-blur-md',
        showCondensed ? '' : 'sticky top-0 z-40',
      )}
    >
      <div className="flex items-center gap-3">
        {leftAction ?? (showBackButton ? backButton : logo)}
        <h1 className="text-xl font-serif font-bold tracking-tight">{title}</h1>
      </div>
      {rightCluster}
    </motion.header>
  );

  if (!showCondensed) return header;

  // Both live inside one sticky box: the header defines its height, the
  // condensed bar overlays it. (A second sticky sibling would only pin
  // after a full header's worth of scroll, so it would still be sliding
  // upward while it faded in.)
  return (
    <div className="sticky top-0 z-40">
      {header}
      <motion.div
        style={fade.condensedStyle}
        className="absolute inset-x-0 top-0 px-3 pt-safe-3 pb-2"
      >
        {/* Soft scrim: page content dissolves into the top edge instead
            of cutting across it behind the glass. */}
        <div
          className="absolute inset-x-0 top-0 -bottom-3 bg-gradient-to-b from-surface via-surface/70 to-transparent pointer-events-none"
          aria-hidden
        />
        <div
          className={cn(
            'glass-control relative flex items-center gap-1.5 rounded-full p-1.5',
          )}
        >
          <GlassSurface>
            {leftAction ?? (showBackButton ? backButton : null)}
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              aria-label={`${condensedTitle} — back to top`}
              className="flex-1 min-w-0 px-1 text-center font-serif font-bold text-[15px] leading-tight truncate text-on-surface"
            >
              {condensedTitle}
            </button>
            {buildRightCluster(true)}
          </GlassSurface>
        </div>
      </motion.div>
    </div>
  );
};
