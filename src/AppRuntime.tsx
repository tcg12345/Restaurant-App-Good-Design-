import { observeSecurityPolicy } from './lib/security-policy';
import { installApiTelemetry } from './lib/api-telemetry';
import { MotionConfig } from 'motion/react';
import App from './App';
import { installGlobalErrorHandlers } from './components/AppErrorBoundary';
import './index.css';
import './components/filterSheet.css';

observeSecurityPolicy(document, window.location.origin);
installApiTelemetry();
installGlobalErrorHandlers();

export default function AppRuntime() {
  return <MotionConfig reducedMotion="user"><App /></MotionConfig>;
}
