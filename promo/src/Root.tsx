import React from 'react';
import { Composition } from 'remotion';
import { GoodEatsAd } from './GoodEatsAd';
import { VIDEO } from './brand';

export const Root: React.FC = () => (
  <Composition
    id="GoodEatsAd"
    component={GoodEatsAd}
    durationInFrames={VIDEO.durationInFrames}
    fps={VIDEO.fps}
    width={VIDEO.width}
    height={VIDEO.height}
  />
);
