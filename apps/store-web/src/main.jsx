import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PluginApp from './PluginApp.jsx';
import { isAdminPath } from './admin-route.js';
import './index.css';

if (import.meta.env.DEV && new URLSearchParams(location.search).has('mockMax')) {
  (await import('./integrations/3dsmax/devMockHost.js')).installMockHost();
}

const Root = isAdminPath(location.pathname) ? (await import('./AdminEntry.jsx')).default : PluginApp;
createRoot(document.getElementById('root')).render(<StrictMode><Root /></StrictMode>);
