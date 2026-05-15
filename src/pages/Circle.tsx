/**
 * /circle route — renders the redesigned CirclePanel as a full page.
 * On desktop the panel typically opens as a slide-out from the
 * sidebar; this page is the fallback for direct URL hits and mobile.
 */
import React from 'react';
import { CirclePanel } from '../components/CirclePanel';

export const Circle: React.FC = () => <CirclePanel variant="page" />;
