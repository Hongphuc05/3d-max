import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as api from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

// user: undefined = dang kiem tra, null = chua dang nhap, object = da dang nhap
export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const [restoreError, setRestoreError] = useState('');
  const generation = useRef(0);
  const queue = useRef(Promise.resolve());
  const mounted = useRef(true);

  const retrySession = useCallback(async () => {
    const current = ++generation.current;
    setRestoreError('');
    try {
      const data = await api.me();
      if (mounted.current && current === generation.current) setUser(data.user);
    } catch (error) {
      if (!mounted.current || current !== generation.current) return;
      // A missing network or a server outage cannot tell us whether the existing
      // HttpOnly cookie is still valid. Keep the account unresolved until retry.
      if (error?.status === 401) setUser(null);
      else setRestoreError('Không thể kết nối máy chủ. Vui lòng kết nối Internet rồi thử lại.');
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    retrySession();
    return () => { mounted.current = false; generation.current++; };
  }, [retrySession]);

  useEffect(() => {
    if (!restoreError) return;
    window.addEventListener('online', retrySession);
    return () => window.removeEventListener('online', retrySession);
  }, [restoreError, retrySession]);

  // Cookie-changing requests must finish in order. In particular, logout must
  // reach the server after an in-flight password change renews the sid cookie.
  const mutateSession = useCallback((operation, clearImmediately = false) => {
    const current = ++generation.current;
    setRestoreError('');
    if (clearImmediately) setUser(null);
    const result = queue.current.then(operation);
    queue.current = result.catch(() => {});
    return result.then(data => {
      if (mounted.current && current === generation.current) setUser(data?.user || null);
      return data;
    });
  }, []);

  const value = {
    user,
    restoreError,
    retrySession,
    login: (email, password) => mutateSession(() => api.login(email, password)),
    changeAdminAccount: body => mutateSession(() => api.updateAdminAccount(body)),
    logout: () => mutateSession(() => api.logout().catch(() => null), true),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
