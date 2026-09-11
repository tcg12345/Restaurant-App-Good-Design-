import React, { Suspense, useState } from 'react';
import { ReelMediaPoster } from './ReelMediaPoster';
import type { MuxReelMediaProps } from './MuxReelPlayer';
export type { ActiveReelMedia } from './MuxReelPlayer';

const load = () => import('./MuxReelPlayer').then(module => ({ default: module.MuxReelMedia }));
const Player = React.lazy(load);
class MediaBoundary extends React.Component<{children:React.ReactNode;retry:()=>void},{failed:boolean}> {
  declare props: {children:React.ReactNode;retry:()=>void};
  state = { failed:false };
  static getDerivedStateFromError() { return {failed:true}; }
  render() { return this.state.failed
    ? <button className="absolute inset-0 z-10 flex items-center justify-center text-white bg-black/50" onClick={this.props.retry}>Retry video</button>
    : this.props.children; }
}
/** Download the video engine only for a nearby reel. Posters paint immediately. */
export const MuxReelMedia: React.FC<MuxReelMediaProps> = props => {
  const [attempt,setAttempt] = useState(()=>({Player,id:0}));
  const poster = <ReelMediaPoster src={props.poster} ready={false} fit={props.objectFit ?? (props.phoneMode ? 'cover' : 'contain')} />;
  if(!props.near) return poster;
  const Current=attempt.Player;
  return <MediaBoundary key={attempt.id} retry={()=>setAttempt(previous=>({Player:React.lazy(load),id:previous.id+1}))}>
    <Suspense fallback={poster}><Current {...props} /></Suspense>
  </MediaBoundary>;

};
