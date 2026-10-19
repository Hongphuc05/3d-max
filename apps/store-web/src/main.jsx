import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import './index.css';

if (import.meta.env.DEV && new URLSearchParams(location.search).has('mockMax')) {
  (await import('./integrations/3dsmax/devMockHost.js')).installMockHost();
}

createRoot(document.getElementById('root')).render(<StrictMode><AuthProvider><App /></AuthProvider></StrictMode>);
