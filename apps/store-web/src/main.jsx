import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import OfflineLibrary from './OfflineLibrary.jsx';
import './index.css';

if (import.meta.env.DEV && new URLSearchParams(location.search).has('mockMax')) {
  (await import('./integrations/3dsmax/devMockHost.js')).installMockHost();
}

createRoot(document.getElementById('root')).render(<StrictMode><OfflineLibrary /></StrictMode>);
