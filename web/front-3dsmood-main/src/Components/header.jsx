import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { FaRegHeart } from "react-icons/fa";
import { useAuth } from "../Contexts/AuthContext";
import DownloadPopup from "../Components/dowloadPopup";
import CollectionPopup from "../Components/CollectionPopup";
import {
  User,
  Wallet,
  Star,
  TicketPercent, // nếu thiếu icon này ở version của bạn, dùng BadgePercent
  Heart,
  Download,
  Clock,
  ReceiptText,
  LogOut,
} from "lucide-react";
import axios from "axios";
import {
  COUNTER_EVENT_DIRTY,
  COUNTER_EVENT_SET,
} from "../utils/counterBus";

const Header = ({ hasMounted, showHeader, isScrollingUp }) => {
  const [isPopupOpenDowload, setIsPopupOpenDowload] = useState(false);
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const nf = new Intl.NumberFormat("vi-VN");
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const isLoggedIn = !!user;

  const menuItems = [
    { label: "3D Models", path: "/3d-model" },
    { label: "3D Scenes", path: "/3d-scenes" },
    { label: "Collection Pack" },
    { label: "Interior Design" },
    { label: "AI Generator" },
  ];

  const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

  function readToken() {
    try {
      const raw = localStorage.getItem("token");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return typeof parsed === "string" ? parsed : (parsed?.token ?? null);
    } catch {
      return localStorage.getItem("token");
    }
  }

  // ====== Smart navigation: middle-click or Ctrl/Cmd opens new tab, otherwise SPA navigate ======
  const openSmart = (e, href) => {
    const isMiddle = e?.button === 1 || e?.which === 2;
    const isModifier = e?.ctrlKey || e?.metaKey;
    if (isMiddle || isModifier) {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      const url = /^https?:\/\//i.test(href)
        ? href
        : `${window.location.origin}${href.startsWith("/") ? href : `/${href}`}`;
      window.open(url, "_blank", "noopener,noreferrer");
      return true; // opened new tab
    } else {
      navigate(href);
      return false; // navigated SPA
    }
  };
  const linkHandlers = (href, { stop = false, closeMobile = false } = {}) => ({
    onClick: (e) => {
      if (stop) e.stopPropagation();
      const openedNewTab = openSmart(e, href);
      if (closeMobile && !openedNewTab) setIsMobileMenuOpen(false);
    },
    onAuxClick: (e) => {
      if (stop) e.stopPropagation();
      const openedNewTab = openSmart(e, href);
      if (closeMobile && !openedNewTab) setIsMobileMenuOpen(false);
    },
    onMouseDown: (e) => {
      if (e.button === 1) {
        if (stop) e.stopPropagation();
        const openedNewTab = openSmart(e, href);
        if (closeMobile && !openedNewTab) setIsMobileMenuOpen(false);
      }
    },
    onKeyDown: (e) => {
      if (e.key === "Enter") {
        if (stop) e.stopPropagation();
        const openedNewTab = openSmart(e, href);
        if (closeMobile && !openedNewTab) setIsMobileMenuOpen(false);
      }
    },
    role: "link",
    tabIndex: 0,
  });

  const [counters, setCounters] = useState({ cart: 0, fav: 0 });

  async function fetchCounters() {
    try {
      const token = readToken();
      if (!token) return setCounters({ cart: 0, fav: 0 });
      const res = await axios.get(`${API}/api/account/counters`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data?.ok) {
        setCounters({
          cart: Number(res.data.cartCount || 0),
          fav: Number(res.data.favoritesCount || 0),
        });
      }
    } catch {
      setCounters({ cart: 0, fav: 0 });
    }
  }

  useEffect(() => {
    if (isLoggedIn) fetchCounters();
    else setCounters({ cart: 0, fav: 0 });

    const onDirty = () => fetchCounters();
    const onSet = (e) => {
      const next = e?.detail || {};
      setCounters((prev) => ({
        cart: Number(next.cart ?? prev.cart),
        fav: Number(next.fav ?? prev.fav),
      }));
    };

    window.addEventListener(COUNTER_EVENT_DIRTY, onDirty);
    window.addEventListener(COUNTER_EVENT_SET, onSet);

    // Đồng bộ đa tab (tuỳ chọn)
    let bc = null;
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      bc = new BroadcastChannel("user:counters");
      bc.onmessage = (ev) => {
        if (ev?.data?.type === "dirty") onDirty();
        if (ev?.data?.type === "set") onSet({ detail: ev.data.payload || {} });
      };
    }

    return () => {
      window.removeEventListener(COUNTER_EVENT_DIRTY, onDirty);
      window.removeEventListener(COUNTER_EVENT_SET, onSet);
      bc?.close();
    };
  }, [isLoggedIn]);

  // Khi có overlay (popup/menu) thì không cho header trượt và khoá cuộn body
  const anyOverlayOpen = isPopupOpenDowload || isPopupOpen || isMobileMenuOpen;
  useEffect(() => {
    const cls = "overflow-hidden";
    if (anyOverlayOpen) {
      // document.body.classList.add(cls);
    } else {
      // document.body.classList.remove(cls);
    }
  }, [anyOverlayOpen]);
  const ASSET_BASE = (import.meta.env.VITE_ASSET_BASE_URL || API).replace(/\/+$/, "");

  // buildUrl "trâu bò"
  const DEFAULT_FALLBACK = "/product1-1.jpg";
  const buildUrl = (path, fallback = DEFAULT_FALLBACK) => {
    try {
      if (path == null) return fallback;
      if (Array.isArray(path)) return buildUrl(path.find(Boolean), fallback);
      if (typeof path === "object") {
        const candidate = path.path ?? path.url ?? path.src ?? "";
        return buildUrl(candidate, fallback);
      }
      const s = String(path).trim();
      if (!s) return fallback;
      if (/^(https?:)?\/\//i.test(s) || /^data:/i.test(s) || /^blob:/i.test(s)) return s;
      const clean = s.replace(/^\/+/, "");
      return clean ? `${ASSET_BASE}/${clean}` : fallback;
    } catch {
      return fallback;
    }
  };

  return (
    <>
      <motion.header
        initial={{ y: -100, opacity: 0 }}
        animate={{
          y: hasMounted ? ((!showHeader && !anyOverlayOpen) ? -100 : 0) : 0,
          opacity: hasMounted ? ((!showHeader && !anyOverlayOpen) ? 0 : 1) : 1,
        }}
        transition={{
          duration: hasMounted ? 0.5 : 1.8,
          ease: [0.22, 1, 0.36, 1],
        }}
        className={`fixed top-0 left-0 w-full 
        ${isScrollingUp ? "bg-black/50 backdrop-blur-sm" : "bg-gradient from-neutral-900 via-black to-neutral-900"} 
        text-white xl:px-4 sm:px-0  py-4 flex items-center justify-between z-[999]`}
      >
        {/* Logo */}
        <div
          className="flex items-center h-12 overflow-hidden p-0 cursor-pointer z-50"
          {...linkHandlers("/")}
        >
          <img
            src="/LOGO-WEB.svg"
            alt="3dsMood Logo"
            className="h-64 w-auto object-contain z-50"
          />
        </div>

        {/* Desktop menu */}
        <nav className="hidden md:flex items-center space-x-8 text-sm font-codec mt-2 z-50">
          {menuItems.map((item, index) => {
            const clickable = !!item.path;
            return (
              <span
                key={index}
                className={`relative flex items-center gap-2 text-[22px] ${
                  clickable ? "cursor-pointer" : "cursor-default"
                } text-white hover:text-[var(--wine)] font-codec`}
                style={{ "--wine": "#8f120d" }}
                {...(clickable ? linkHandlers(item.path) : {})}
              >
                <span
                  className="w-1 h-5 block rounded-sm mb-1"
                  style={{ backgroundColor: "#8f120d" }}
                ></span>
                {item.label}
              </span>
            );
          })}
        </nav>

        {/* Right side */}
        <div className="hidden md:flex items-center space-x-2">
          <div className="flex items-center gap-2">
            {isLoggedIn ? (
              <>
                <div className="flex items-center gap-1 rounded px-3  text-white text-sm bg-[#1a1a1a] bg-opacity-70 h-8">
                  {/* DOWNLOAD (giỏ) */}
                  <div
                    className="relative w-12 h-6 flex items-center justify-center rounded "
                    onClick={() => setIsPopupOpenDowload(true)}
                    title="Giỏ tải / Thanh toán"
                  >
                    <img
                      src="/giohang.svg"
                      alt="download"
                      className="w-6 h-6 scale-125 object-contain pointer-events-none"
                    />
                    <AnimatePresence initial={false} mode="popLayout">
                      {counters.cart > 0 && (
                        <motion.span
                          key={counters.cart}
                          initial={{ scale: 0.6, y: -6, opacity: 0 }}
                          animate={{ scale: 1, y: 0, opacity: 1 }}
                          exit={{ scale: 0.8, opacity: 0 }}
                          transition={{ type: "spring", stiffness: 420, damping: 22 }}
                          className="absolute -top-1 -right-2 z-10 min-w-[18px] h-[18px] px-2 rounded-full bg-[var(--wine)] text-white text-[12px] leading-[18px] text-center"
                        >
                          {counters.cart}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="border-r border-[#2D2D2D] h-6"></div>

                  {/* HEART (yêu thích) */}
                  <div
                    className="relative w-10 px-2"
                    onClick={() => navigate('/account/collections')}
                    title="Bộ sưu tập"
                  >
                    <FaRegHeart className="text-white text-lg" />
                    <AnimatePresence initial={false} mode="popLayout">
                      {counters.fav > 0 && (
                        <motion.span
                          key={counters.fav}
                          initial={{ scale: 0.6, y: -6, opacity: 0 }}
                          animate={{ scale: 1, y: 0, opacity: 1 }}
                          exit={{ scale: 0.8, opacity: 0 }}
                          transition={{ type: "spring", stiffness: 420, damping: 22 }}
                          className="absolute -top-[6px] -right-2 z-10 min-w-[16px] h-[16px] px-2 rounded-full bg-[var(--wine)] text-white text-[12px] leading-[16px] text-center"
                        >
                          {counters.fav}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="border-r border-[#2D2D2D] h-6"></div>

                  {/* DESKTOP-ONLY: hover to open */}
                  <div className="relative hidden md:inline-block group">
                    <button
                      className="text-white px-2 py-0 rounded-sm flex items-center justify-center h-8 text-2xl bg-black/20"
                      aria-haspopup="menu"
                      aria-expanded="false"
                    >
                      ☰
                    </button>

                    <div
                      role="menu"
                      className="
                        absolute right-1 w-64 bg-neutral-900 text-white text-sm shadow-xl rounded-xl z-50 p-2
                        invisible opacity-0 translate-y-1 pointer-events-none
                        md:group-hover:visible md:group-hover:opacity-100 md:group-hover:translate-y-0 md:group-hover:pointer-events-auto
                        md:group-focus-within:visible md:group-focus-within:opacity-100 md:group-focus-within:translate-y-0 md:group-focus-within:pointer-events-auto
                        transition
                      "
                    >
                      {/* Header */}
                      <div
                        className="px-3 py-2 flex items-center gap-2 text-white/90 font-medium border-b border-white/10 rounded-t-2xl cursor-pointer"
                        {...linkHandlers("/account/info", { stop: true })}
                      >
                        <User className="w-4 h-4 text-white/70" />
                        <span className="font-codec">Thông tin tài khoản</span>
                      </div>

                      {/* Nạp tiền + số coin */}
                      <div
                        className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/5 rounded-lg bg-transparent cursor-pointer"
                        {...linkHandlers("/account/deposit", { stop: true })}
                      >
                        <span className="flex items-center gap-2">
                          <Wallet className="w-4 h-4 text-white/70" />
                          <span className="font-codec">Nạp tiền</span>
                        </span>
                        <span className="px-2 py-0.5 rounded bg-neutral-800 border border-white/10 text-white/80">
                          {nf.format(user?.coins ?? 0)}
                        </span>
                      </div>

                      {/* Điểm thưởng */}
                      <div
                        className="px-3 py-2 flex cursor-pointer items-center justify-between rounded-lg bg-transparent hover:bg-white/5"
                        {...linkHandlers("/account/points", { stop: true })}
                      >
                        <span className="flex items-center gap-2">
                          <Star className="w-4 h-4 text-white/70" />
                          <span className="font-codec">Điểm thưởng</span>
                        </span>
                        <span className="px-2 py-0.5 rounded bg-neutral-800 border border-white/10 text-white/80">
                          {nf.format(user?.points ?? 0)}
                        </span>
                      </div>

                      {/* Phiếu giảm giá */}
                      <div
                        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/5 rounded-lg bg-transparent cursor-pointer"
                        {...linkHandlers("/account/coupons", { stop: true })}
                      >
                        <TicketPercent className="w-4 h-4 text-white/70" />
                        <span className="font-codec">Phiếu giảm giá</span>
                      </div>

                      {/* Bộ sưu tập */}
                      <div
                        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/5 rounded-lg bg-transparent cursor-pointer"
                        {...linkHandlers("/account/collections", { stop: true })}
                      >
                        <Heart className="w-4 h-4 text-white/70" />
                        <span className="font-codec">Bộ sưu tập của tôi</span>
                      </div>

                      {/* Sản phẩm đã tải */}
                      <div
                        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/5 rounded-lg bg-transparent cursor-pointer"
                        {...linkHandlers("/account/downloads", { stop: true })}
                      >
                        <Download className="w-4 h-4 text-white/70" />
                        <span className="font-codec">Sản phẩm đã tải</span>
                      </div>

                      {/* Lịch sử nạp */}
                      <div
                        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/5 rounded-lg bg-transparent cursor-pointer"
                        {...linkHandlers("/account/depositHistory", { stop: true })}
                      >
                        <Clock className="w-4 h-4 text-white/70" />
                        <span className="font-codec">Lịch sử nạp</span>
                      </div>

                      {/* Lịch sử đơn hàng */}
                      <div
                        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/5 rounded-lg bg-transparent cursor-pointer"
                        {...linkHandlers("/account/orders", { stop: true })}
                      >
                        <ReceiptText className="w-4 h-4 text-white/70" />
                        <span className="font-codec">Lịch sử đơn hàng</span>
                      </div>

                      {/* Đăng xuất */}
                      <button
                        className="w-full mt-1 px-3 py-2 flex items-center gap-2 hover:bg-white/5 rounded-lg text-red-400 hover:text-red-300 bg-transparent"
                        onClick={() => { logout(); navigate("/login"); }}
                      >
                        <LogOut className="w-4 h-4" />
                        <span className="font-codec">Đăng xuất</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Avatar */}
                <div
                  className="ml-2"
                  {...linkHandlers("/account")}
                  title="Tài khoản"
                >
                  <img
                    src={buildUrl(user?.avatar) || "/product.jpeg"}
                    alt="avatar"
                    className="w-10 h-10 rounded-full object-cover cursor-pointer"
                  />
                </div>
              </>
            ) : (
              <>
                <span
                  className="bg-[var(--wine)] text-white px-3 rounded text-[22px] font-codec cursor-pointer hover:scale-105"
                  style={{ "--wine": "#8f120d" }}
                  {...linkHandlers("/login")}
                >
                  Login
                </span>
                <span
                  className="bg-[var(--wine)] text-white px-3 rounded text-[22px] font-codec cursor-pointer hover:scale-105"
                  style={{ "--wine": "#8f120d" }}
                  {...linkHandlers("/signup")}
                >
                  Sign up
                </span>
              </>
            )}
          </div>
        </div>

        {/* Mobile hamburger */}
        <div className="md:hidden z-50">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="text-white px-2 py-1 cursor-pointer hover:animate-shake text-2xl bg-black/20 mr-2"
          >
            ☰
          </button>
        </div>

        {/* Line bottom */}
        <div className="absolute bottom-[18px] left-0 w-full h-[1px] bg-white/40 z-0" />
      </motion.header>

      {/* === PORTALS === */}
      {isPopupOpenDowload &&
        createPortal(
          <DownloadPopup
            isOpen={isPopupOpenDowload}
            onClose={() => setIsPopupOpenDowload(false)}
          />,
          document.body
        )}

      {isPopupOpen &&
        createPortal(
          <CollectionPopup
            isOpen={isPopupOpen}
            onClose={() => setIsPopupOpen(false)}
          />,
          document.body
        )}

      {/* Mobile menu overlay + drawer */}
      {isMobileMenuOpen &&
        createPortal(
          <>
            {/* Overlay */}
            <div
              className="fixed inset-0 bg-black/60 z-[950] md:hidden"
              onClick={() => setIsMobileMenuOpen(false)}
            />
            {/* Drawer */}
            <div className="fixed top-[72px] left-0 w-full border-t border-white/20 py-4 flex flex-col items-center gap-4 z-[960] md:hidden bg-transparent">
              {menuItems.map((item, index) => {
                const clickable = !!item.path;
                return (
                  <span
                    key={index}
                    className={`text-white text-xl font-codec hover:text-[var(--wine)] bg-white/10 backdrop-blur-[1px] px-6 py-2 rounded ${
                      clickable ? "cursor-pointer" : "cursor-default"
                    }`}
                    style={{ "--wine": "#8f120d" }}
                    {...(clickable ? linkHandlers(item.path, { closeMobile: true }) : {})}
                  >
                    {item.label}
                  </span>
                );
              })}
              {isLoggedIn ? (
                <>
                  <div
                    className="flex items-center gap-2 cursor-pointer"
                    {...linkHandlers("/account", { closeMobile: true })}
                  >
                    <img
                      src={user?.avatar || "/product.jpeg"}
                      alt="avatar"
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  </div>
                  <button
                    className="bg-white/10 backdrop-blur-[1px] mt-1 px-3 py-2 flex items-center gap-2 hover:bg-white/5 rounded-lg text-red-400 hover:text-red-300 bg-transparent"
                    onClick={() => {
                      logout();
                      setIsMenuOpen(false);
                      setIsMobileMenuOpen(false);
                      navigate("/login");
                    }}
                  >
                    <LogOut className="w-4 h-4" />
                    <span className="font-codec">Đăng xuất</span>
                  </button>
                </>
              ) : (
                <div className="flex gap-4 mt-2">
                  <span
                    className="bg-[var(--wine)] text-white px-4 py-1 rounded text-lg font-codec cursor-pointer hover:scale-105"
                    style={{ "--wine": "#8f120d" }}
                    {...linkHandlers("/login", { closeMobile: true })}
                  >
                    Login
                  </span>
                  <span
                    className="bg-[var(--wine)] text-white px-4 py-1 rounded text-lg font-codec cursor-pointer hover:scale-105"
                    style={{ "--wine": "#8f120d" }}
                    {...linkHandlers("/signup", { closeMobile: true })}
                  >
                    Sign up
                  </span>
                </div>
              )}
            </div>
          </>,
          document.body
        )}
    </>
  );
};

export default Header;
