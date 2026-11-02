import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as api from './api.js';
import { useAuth } from './auth.jsx';
import * as native from './integrations/3dsmax/bridge.js';
import { proveDevice, licenseError } from './license-flow.js';

const Context = createContext(null);
export const useLicense = () => useContext(Context);
const empty = { userId: null, license: null, devices: [], session: null, identity: null, error: '', loading: false };

export function LicenseProvider({ children }) {
  const { user } = useAuth();
  // Admin dashboard does not participate in customer license/device activation.
  const userId = user?.role === 'ADMIN' ? null : user?.id;
  const max = native.isMaxHost();
  const generation = useRef(0);
  const [state, setState] = useState(empty);
  const [open, setOpen] = useState(() => location.pathname === '/license');

  const refresh = useCallback(async (restore = true) => {
    const current = ++generation.current;
    if (!userId) { setState(empty); return; }
    setState((s) => ({ ...(s.userId === userId ? s : empty), userId, loading: true, error: '' }));
    try {
      const [{ license }, { devices }] = await Promise.all([api.myLicense(), api.licenseDevices()]);
      if (current !== generation.current) return;
      // Show the owner's key as soon as it arrives; native proof must not delay it.
      setState(previous => ({ userId, license, devices, session: restore ? null : previous.session,
        identity: restore ? null : previous.identity, error: '', loading: max && restore }));
      let session = null;
      let identity = null;
      let error = '';
      if (max && restore) {
        try {
          identity = await native.getDeviceIdentity();
          session = await proveDevice({ api, native, identity });
        }
        catch (e) { error = licenseError(e); }
      }
      if (current !== generation.current) return;
      setState((previous) => ({ userId, license, devices, session: restore ? session : previous.session,
        identity: restore ? identity : previous.identity, error, loading: false }));
      if (max && restore && !session) setOpen(true);
    } catch (e) {
      if (current === generation.current) setState({ ...empty, userId, error: licenseError(e) });
    }
  }, [userId, max]);

  useEffect(() => {
    setState(empty);
    refresh();
    return () => { generation.current++; };
  }, [refresh]);

  useEffect(() => {
    if (!max || !userId) return;
    const timer = setInterval(() => refresh(), 8 * 60 * 1000);
    return () => clearInterval(timer);
  }, [max, userId, refresh]);

  const activate = async (licenseKey) => {
    const current = ++generation.current;
    setState((s) => ({ ...(s.userId === userId ? s : empty), userId, loading: true, error: '', session: null }));
    let identity = null;
    try {
      identity = await native.getDeviceIdentity();
      const session = await proveDevice({ api, native, identity, licenseKey: licenseKey.trim() });
      const [{ license }, { devices }] = await Promise.all([api.myLicense(), api.licenseDevices()]);
      if (current === generation.current) setState({ userId, license, devices, session, identity, loading: false, error: '' });
      return current === generation.current;
    } catch (e) {
      if (current === generation.current) setState((s) => ({ ...s, identity, loading: false, error: licenseError(e), session: null }));
      return false;
    }
  };

  // Effects run after render: synchronously hide the previous account's key/session.
  const visible = state.userId === userId ? state : empty;
  const expiresAt = Date.parse(visible.session?.expiresAt || '');
  const canImport = !!userId && visible.license?.status === 'ACTIVE'
    && visible.session?.license?.status === 'ACTIVE' && visible.session.license.id === visible.license.id
    && expiresAt > Date.now();
  return <Context.Provider value={{ ...visible, canImport, max, open, setOpen, refresh, activate }}>{children}</Context.Provider>;
}
