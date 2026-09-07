import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {DecideTogether} from '../src/pages/DecideTogether';
import '../src/index.css';
if(location.search.includes('dark'))document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/decide?code=PREVIEW1']}><DecideTogether/></MemoryRouter>);
