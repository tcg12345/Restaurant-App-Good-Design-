import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {installGlobalErrorHandlers} from './components/AppErrorBoundary';
import './index.css';
import './components/filterSheet.css';

installGlobalErrorHandlers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
