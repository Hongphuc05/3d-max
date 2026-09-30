// /src/Contexts/AuthContext.jsx
import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import axios from "axios";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

const API = import.meta.env.VITE_API_BASE_URL;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const tokenRef = useRef(localStorage.getItem("token") || null);
  const [loadingUser, setLoadingUser] = useState(false);

  // ✅ Tạo axios instance 1 lần (tránh chồng interceptor)
  const api = useMemo(() => axios.create({ baseURL: API }), []);

  // ✅ Gắn interceptor 1 lần và eject khi unmount
  useEffect(() => {
    const id = api.interceptors.request.use((config) => {
      const t = tokenRef.current;
      if (t) config.headers.Authorization = `Bearer ${t}`;
      return config;
    });
    return () => api.interceptors.request.eject(id);
  }, [api]);

  // ✅ Cờ đã hydrate sau F5 (đợi gọi /me xong hoặc bỏ qua nếu không có token)
  const [hydrated, setHydrated] = useState(false);

  const refreshUser = useCallback(
    async ({ silent = true } = {}) => {
      if (!tokenRef.current) return;
      try {
        if (!silent) setLoadingUser(true);
        const { data } = await api.get("/api/auth/me");
        // tuỳ backend: data.user hoặc data.data
        setUser(data.user || data.data || data);
      } catch (e) {
        console.error("refreshUser failed:", e?.response?.data || e.message);
        // token hỏng => có thể logout nhẹ nếu muốn:
        // if (e?.response?.status === 401) { tokenRef.current=null; localStorage.removeItem("token"); setUser(null); }
      } finally {
        if (!silent) setLoadingUser(false);
      }
    },
    [api]
  );

  // /src/Contexts/AuthContext.jsx (thay hàm login) — GIỮ NGUYÊN CHỮ KÝ
  const login = useCallback(
    async (...args) => {
      let t = null,
        u = null;
      if (args.length === 1) {
        t = args[0];
      } else if (args.length >= 2) {
        u = args[0];
        t = args[1];
      }
      if (!t || typeof t !== "string") {
        console.error("Login requires a string token");
        return;
      }
      tokenRef.current = t;
      localStorage.setItem("token", t);
      if (u) setUser(u); // optional: nhận sẵn user từ /login nếu muốn
      await refreshUser({ silent: false }); // đồng bộ user từ /me
    },
    [refreshUser]
  );

  const logout = useCallback(() => {
    tokenRef.current = null;
    localStorage.removeItem("token");
    setUser(null);
  }, []);

  // tải user nếu đã có token khi app khởi động — và set hydrated sau khi thử
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (tokenRef.current) {
        await refreshUser({ silent: true });
      }
      if (mounted) setHydrated(true);
    })();
    return () => {
      mounted = false;
    };
  }, [refreshUser]);

  // đồng bộ giữa các tab
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === "token") {
        tokenRef.current = e.newValue;
        if (e.newValue) refreshUser({ silent: true });
        else setUser(null);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refreshUser]);

  // cập nhật khi người dùng quay lại tab/focus (lấy coins mới nhất)
  useEffect(() => {
    const onFocus = () => refreshUser({ silent: true });
    const onVisible = () =>
      document.visibilityState === "visible" && refreshUser({ silent: true });
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshUser]);

  // (Tuỳ chọn) Polling nhẹ 60s
  useEffect(() => {
    if (!tokenRef.current) return;
    const id = setInterval(() => refreshUser({ silent: true }), 60000);
    return () => clearInterval(id);
  }, [refreshUser, user?.id]);

  // tiện: hàm cập nhật coins cục bộ sau khi gọi API nạp/mua để UI phản hồi tức thì
  const mutateCoins = useCallback((updater) => {
    setUser((prev) =>
      prev
        ? {
            ...prev,
            coins:
              typeof updater === "function" ? updater(prev.coins) : updater,
          }
        : prev
    );
  }, []);

  // ✅ GIỮ NGUYÊN các key cũ, chỉ bổ sung 'hydrated' để guard có thể đợi
  const value = {
    user,
    login,
    logout,
    refreshUser,
    mutateCoins,
    loadingUser,
    hydrated, // <-- thêm
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
};
