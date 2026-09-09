/** Preserve old Friends links within the shared Messages & Friends destination. */
import React from 'react';
import { Navigate } from 'react-router-dom';
export const Circle: React.FC = () => <Navigate to="/messages?tab=friends" replace />;
