import React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from 'remotion';
import { Scene1Hook } from './Scene1Hook';
import { Scene2Reveal } from './Scene2Reveal';
import { Scene3H2H } from './Scene3H2H';
import { Scene4Montage } from './Scene4Montage';
import { Scene5CTA } from './Scene5CTA';
import './fonts';

/**
 * Gourmet Canvas — 9:16 promo, 20.5s @30fps (615 frames).
 *
 *   0–115   Hook     every restaurant is a 4.3
 * 115–235   Reveal   the URR — one number that means something
 * 235–400   H2H      rate by choosing (this-or-that flow)
 * 400–520   Montage  Discover map · Friends · Lists & Trips
 * 520–615   CTA      download on the App Store
 */

/** Quick cream dip between two scenes to soften hard cuts. */
const Dip: React.FC<{ at: number; color?: string }> = ({ at, color = '#fbf4f0' }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [at - 6, at, at + 8], [0, 0.9, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  if (opacity <= 0.01) return null;
  return <AbsoluteFill style={{ background: color, opacity, pointerEvents: 'none' }} />;
};

export const GourmetCanvasAd: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: '#fbf4f0' }}>
      <Sequence from={0} durationInFrames={115}>
        <Scene1Hook />
      </Sequence>
      <Sequence from={115} durationInFrames={120}>
        <Scene2Reveal />
      </Sequence>
      <Sequence from={235} durationInFrames={165}>
        <Scene3H2H />
      </Sequence>
      <Sequence from={400} durationInFrames={120}>
        <Scene4Montage />
      </Sequence>
      <Sequence from={520} durationInFrames={95}>
        <Scene5CTA />
      </Sequence>

      <Dip at={235} />
      <Dip at={400} />
      <Dip at={520} />
    </AbsoluteFill>
  );
};
