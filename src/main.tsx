// FIRST, and for its side effect: it moves an existing install's stored data
// off the pre-rename prefixes. Modules below read storage while they
// evaluate, and ESM runs imports in order, so anything above this line
// would read the old world. See lib/storage-migration.ts.
import './lib/storage-migration';
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
