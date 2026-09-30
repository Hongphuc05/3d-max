import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from "./Contexts/AuthContext.jsx"; // đúng đường dẫn

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider> 
    <App />
    </AuthProvider> 
  </StrictMode>,
)
