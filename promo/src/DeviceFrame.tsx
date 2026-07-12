import React from 'react';
import { COLORS } from './brand';

/**
 * iPhone-style device frame: near-black shell, big radius, Dynamic
 * Island cutout. Children render as the screen (fills a 9:19.5-ish
 * viewport). Sized via `width`; height derives from the phone ratio.
 */
export const DeviceFrame: React.FC<{
  width: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
  /** Screen background (defaults to app surface white). */
  screenBg?: string;
}> = ({ width, children, style, screenBg = COLORS.surface }) => {
  const height = width * 2.05;
  const bezel = width * 0.032;
  const radius = width * 0.16;
  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius,
        background: '#101010',
        padding: bezel,
        boxShadow:
          '0 60px 120px -30px rgba(30, 27, 26, 0.45), 0 24px 48px -18px rgba(30, 27, 26, 0.35), inset 0 0 0 2px rgba(255,255,255,0.06)',
        position: 'relative',
        ...style,
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: radius - bezel,
          background: screenBg,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {children}
        {/* Dynamic Island */}
        <div
          style={{
            position: 'absolute',
            top: width * 0.028,
            left: '50%',
            transform: 'translateX(-50%)',
            width: width * 0.29,
            height: width * 0.085,
            borderRadius: 999,
            background: '#101010',
          }}
        />
      </div>
    </div>
  );
};
