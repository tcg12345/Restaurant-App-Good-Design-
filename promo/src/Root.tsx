import React from 'react';
import { Composition } from 'remotion';
import { GourmetCanvasAd } from './GourmetCanvasAd';
import { VIDEO } from './brand';

export const Root: React.FC = () => (
  <Composition
    id="GourmetCanvasAd"
    component={GourmetCanvasAd}
    durationInFrames={VIDEO.durationInFrames}
    fps={VIDEO.fps}
    width={VIDEO.width}
    height={VIDEO.height}
  />
);
