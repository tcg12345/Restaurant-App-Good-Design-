import React from 'react';

/** Matches index.html's pre-bundle screen and the native LaunchScreen.
 * No timer: this disappears as soon as the app can show its destination. */
export function LaunchScreen() {
  return <div className="launch-screen" role="status" aria-label="Opening GoodEats" aria-busy="true">
    <div className="launch-brand" aria-hidden="true">
      <svg className="launch-mark" viewBox="0 0 100 100" focusable="false">
        <circle cx="50" cy="50" r="48" fill="#a8d0b8" />
        <rect x="23" y="40" width="54" height="6.5" rx="3.25" fill="#1c2721" />
        <path d="M28 52 Q50 75 72 52 Z" fill="#1c2721" opacity=".82" />
      </svg>
      <p className="launch-name">GoodEats</p>
      <p className="launch-tagline">Good food. Good company.</p>
    </div>
    <div className="launch-activity" aria-hidden="true" />
    <span className="launch-status">Opening GoodEats…</span>
  </div>;
}
