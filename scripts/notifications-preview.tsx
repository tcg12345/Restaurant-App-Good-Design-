// Development-only visual fixture. No real account or device operations.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {ChevronLeft} from 'lucide-react';
import {NotificationSettings} from '../src/components/notifications/NotificationSettings';
import '../src/index.css';
import '../src/pages/SettingsPage.css';
if(new URLSearchParams(location.search).has('dark'))document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')!).render(<BrowserRouter><div className="settings-design"><header className="settings-header"><button className="settings-back" aria-label="Back"><ChevronLeft size={22}/></button><h1>Notifications</h1></header><main className="settings-scroll"><div className="settings-content"><NotificationSettings/></div></main></div></BrowserRouter>);
