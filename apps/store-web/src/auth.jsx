import { createContext, useContext, useEffect, useState } from 'react';
import * as api from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

// user: undefined = dang kiem tra, null = chua dang nhap, object = da dang nhap
export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    api.me().then((d) => setUser(d.user), () => setUser(null));
  }, []);

  const value = {
    user,
    login: async (email, password) => setUser((await api.login(email, password)).user),
    register: async (email, password) => setUser((await api.register(email, password)).user),
    logout: async () => { await api.logout().catch(() => {}); setUser(null); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
