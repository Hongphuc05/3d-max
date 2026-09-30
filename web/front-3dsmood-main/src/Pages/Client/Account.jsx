import Header from "../../Components/header";
import React, { useMemo, useEffect, useRef, useState } from "react";
import InfoView from "../../Components/Account/InfoView";
import DepositView from "../../Components/Account/DepositView";
import PointsView from "../../Components/Account/PointsView";
import Discount from "../../Components/Account/Discounts";
import Collection from "../../Components/Account/CollectionView";
import Downloads from "../../Components/Account/DownloadsView";
import DepositHistoryCard from "../../Components/Account/DepositHistoryCard";
import OrdersUsedCard from "../../Components/Account/OrdersUsedCard";
import { useAuth } from "../../Contexts/AuthContext";

import {
  User,
  Wallet,
  TicketPercent,
  Download,
  Heart,
  Clock,
  ReceiptText,
  LogOut,
} from "lucide-react";
import { FaRegStar } from "react-icons/fa";
import { useParams, useNavigate } from "react-router-dom";

// Utility: vi-VN number format (10.000.000)
const nf = new Intl.NumberFormat("vi-VN");

const NAV_ITEMS = [
  { key: "info",           label: "Thông tin tài khoản", icon: User },
  { key: "deposit",        label: "Nạp tiền",            icon: Wallet },
  { key: "points",         label: "Điểm thưởng",         icon: FaRegStar },
  { key: "coupons",        label: "Phiếu giảm giá",      icon: TicketPercent },
  { key: "collections",    label: "Bộ sưu tập của tôi",  icon: Heart },
  { key: "downloads",      label: "Sản phẩm đã tải",     icon: Download },
  { key: "depositHistory", label: "Lịch sử nạp",         icon: Clock },
  { key: "orders",         label: "Lịch sử đơn hàng",    icon: ReceiptText },
  { key: "logout",         label: "Đăng xuất",           icon: LogOut },
];

const VALID_TABS = new Set(NAV_ITEMS.map(n => n.key).filter(k => k !== "logout"));
const normalizeTab = (t) => (t && VALID_TABS.has(t) ? t : "info");

export default function AccountDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { tab } = useParams(); // đọc tab từ URL

  // State và đồng bộ với URL
  const [active, setActive] = useState(normalizeTab(tab));
  useEffect(() => {
    setActive(normalizeTab(tab));
  }, [tab]);

  const API = import.meta.env.VITE_API_BASE_URL;

  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token =
          localStorage.getItem("token") ||
          localStorage.getItem("accessToken") ||
          user?.token;

        const res = await fetch(`${API}/api/account/stats`, {
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: "include",
        });

        if (!res.ok) throw new Error("Cannot load stats");
        const data = await res.json();
        setStats(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingStats(false);
      }
    })();
  }, [API, user?.token]);

  const viewStats = useMemo(
    () => ({
      balance:     stats?.balance    ?? user?.coins ?? 0,
      points:      stats?.points     ?? 0,
      coupons:     stats?.coupons    ?? 0,
      downloads:   stats?.downloads  ?? (user?.purchased?.length ?? 0),
      collections: stats?.collections?? (user?.collections?.length ?? 0),
    }),
    [stats, user]
  );

  // Điều hướng khi bấm menu
  const handleNav = (key) => {
    if (key === "logout") {
      try { logout?.(); } catch {}
      navigate("/login");
      return;
    }
    navigate(`/account/${key}`);
  };

  // ✨ Điều hướng thông minh: chuột giữa / Ctrl/Cmd click mở tab mới, còn lại điều hướng trong SPA
  const openSmart = (e, href) => {
    const isMiddle = e?.button === 1;
    const isModifier = e?.ctrlKey || e?.metaKey;

    if (isMiddle || isModifier) {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      const url = /^https?:\/\//i.test(href)
        ? href
        : `${window.location.origin}${href.startsWith("/") ? href : `/${href}`}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      navigate(href);
    }
  };

  const linkHandlers = (href) => ({
    onClick: (e) => openSmart(e, href),
    onAuxClick: (e) => openSmart(e, href),
    onMouseDown: (e) => { if (e.button === 1) openSmart(e, href); },
    onKeyDown: (e) => { if (e.key === "Enter") openSmart(e, href); },
  });

  const renderContent = () => {
    switch (active) {
      case "info":
        return <InfoView />;
      case "deposit":
        return <DepositView />;
      case "points":
        return <PointsView />;
      case "coupons":
        return <Discount />;
      case "collections":
        return <Collection />;
      case "downloads":
        return <Downloads />;
      case "depositHistory":
        return (
          <DepositHistoryCard/>
        );
      case "orders":
        return <OrdersUsedCard />;
      default:
        return (
          <div className="h-full flex items-center justify-center text-zinc-400">
            Đang phát triển…
          </div>
        );
    }
  };

  const lastScrollY = useRef(0);
  const [hasMounted, setHasMounted] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const [isScrollingUp, setIsScrollingUp] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setHasMounted(true), 100);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      setShowScrollTop(currentScrollY > 100);

      if (currentScrollY < 50) {
        setShowHeader(true);
        setIsScrollingUp(false);
      } else if (currentScrollY > lastScrollY.current) {
        setShowHeader(false);
        setIsScrollingUp(false);
      } else if (currentScrollY < lastScrollY.current) {
        setShowHeader(true);
        setIsScrollingUp(true);
      }
      lastScrollY.current = currentScrollY;
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);
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
  useEffect(() => {
    document.title = "Tài khoản | 3dsmood"; // tiêu đề riêng của trang này
  }, []);
  return (
    <div className="text-sm text-zinc-200">
      {/* Top bar */}
      <Header hasMounted={hasMounted} showHeader={showHeader} isScrollingUp={isScrollingUp} />
      <div className="w-screen h-screen flex justify-center bg-[url('/back.svg')] bg-cover bg-center">
      <main className="xl:px-4 2xl:px-32 xl:w-[1280px] 2xl:w-[1820px] mt-24">
        <div className="flex gap-2">
          {/* Sidebar */}
          <aside className="w-60 shrink-0">
            <div className="sticky rounded-2xl top-20 space-y-2 border border-[#4d4d4d] border-opacity-40 bg-black bg-opacity-50 p-2 font-codec">
              {/* Profile mini card */}
              <div className="rounded-2xl border border-[#4d4d4d] border-opacity-40 p-2 h-[6rem]">
                <div className="flex items-center gap-3">
                  <img
                    src={buildUrl(user?.avatar) || "/product.jpeg"}
                    alt="avatar"
                    className="w-10 h-10 rounded-full object-cover"
                  />
                  <div>
                    <div className="font-medium text-white font-codec">
                      {user?.username || user?.name || "Khách"}
                    </div>
                    <div className="text-xs text-zinc-400 truncate max-w-[8rem]">
                      {user?.email || ""}
                    </div>
                  </div>
                </div>
              </div>

              {/* Nav */}
              <nav className="rounded-2xl h-[32rem] font-codec">
                <div className="flex flex-col gap-1.5">
                  {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
                    const isActive = active === key;

                    if (key === "logout") {
                      // giữ hành vi cũ: click trái để đăng xuất, không mở tab mới
                      return (
                        <button
                          key={key}
                          onClick={() => handleNav(key)}
                          className={`group w-full flex items-center gap-3 px-3 py-0.5 my-1 rounded-lg text-left transition
                            ${
                              isActive
                                ? "bg-[#8f120d] text-white"
                                : "text-zinc-300 hover:bg-white/5 bg-transparent"
                            }
                          `}
                        >
                          <span className="flex h-8 w-8 items-center justify-center rounded-md">
                            <Icon size={18} />
                          </span>
                          <span className="text-sm font-source">{label}</span>
                        </button>
                      );
                    }

                    const href = `/account/${key}`;
                    return (
                      <button
                        key={key}
                        // ✨ gắn các handler để hỗ trợ chuột giữa / Ctrl / Cmd
                        {...linkHandlers(href)}
                        aria-current={isActive ? "page" : undefined}
                        className={`group w-full flex items-center gap-3 px-3 py-0.5 my-1 rounded-lg text-left transition
                          ${
                            isActive
                              ? "bg-[#8f120d] text-white"
                              : "text-zinc-300 hover:bg-white/5 bg-transparent"
                          }
                        `}
                        role="link"
                        tabIndex={0}
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-md">
                          <Icon size={18} />
                        </span>
                        <span className="text-sm font-source">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </nav>
            </div>
          </aside>

          {/* Content */}
          <section className="flex-1 min-w-0 font-codec">
            {/* Stats */}
            <div className="rounded-xl h-[6.6rem] border border-[#4d4d4d] border-opacity-40 bg-black bg-opacity-50">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 font-codec mt-[20px]">
                {[
                  nf.format(viewStats.balance),
                  nf.format(viewStats.points),
                  String(nf.format(viewStats.coupons)).padStart(2, "0"),
                  nf.format(viewStats.downloads),
                  nf.format(viewStats.collections),
                ].map((value, i, arr) => (
                <div key={i} className="relative py-2 text-center">
                  {i === 0 ? (
                    <span className="text-white text-lg tracking-wide font-codec flex items-baseline justify-center gap-1">
                      {loadingStats ? "…" : nf.format(viewStats.balance)}
                      <span className="text-xs text-gray-400 font-normal">VND</span>
                    </span>
                  ) : (
                    <span className="text-white text-lg tracking-wide font-codec">
                      {loadingStats
                        ? "…"
                        : [
                            nf.format(viewStats.points),
                            String(nf.format(viewStats.coupons)).padStart(2, "0"),
                            nf.format(viewStats.downloads),
                            nf.format(viewStats.collections),
                          ][i - 1]}
                    </span>
                  )}

                  {i !== arr.length - 1 && (
                    <span className="hidden lg:block absolute right-0 top-1/2 -translate-y-1/2 h-6 w-px bg-[#2D2D2D]" />
                  )}
                </div>

                ))}
              </div>


              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 p-2 font-codec">
                {["Số dư ví", "Điểm thưởng", "Phiếu giảm giá", "Lượt tải xuống", "Bộ sưu tập"].map((label) => (
                  <div key={label} className="flex justify-center">
                    <span className="inline-flex items-center justify-center rounded-md border border-[#4d4d4d] border-opacity-40 bg-[#131313] py-1 w-full text-xs text-zinc-300 font-source">
                      <span>{label}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Account info card */}
            <div className="mt-2 rounded-2xl border border-[#4d4d4d] border-opacity-40 bg-black bg-opacity-50 p-2 min-h-[32.6rem]">
              {renderContent()}
            </div>
          </section>
        </div>
      </main>
      </div>
    </div>
  );
}
