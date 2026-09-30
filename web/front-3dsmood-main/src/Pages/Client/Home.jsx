// src/pages/Home.jsx
import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import "../../assets/home.css";
import { FaSearch, FaRegHeart, FaArrowUp, FaFacebookMessenger, FaHome, FaRegUser } from "react-icons/fa";
import { motion } from "framer-motion";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import DownloadPopup from "../../Components/dowloadPopup";
import CollectionPopup from "../../Components/CollectionPopup";
import Header from "../../Components/header";
import axios from "axios";
import { useNavigate } from "react-router-dom";

// Swiper (hiệu ứng hero → top products)
import { Swiper, SwiperSlide } from "swiper/react";
import { Mousewheel, Pagination, Parallax } from "swiper/modules";
import "swiper/css";
import "swiper/css/pagination";
import { COUNTER_EVENT_DIRTY, COUNTER_EVENT_SET } from "../../utils/counterBus";

// ===== API base =====
const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const ASSET_BASE = import.meta.env.VITE_ASSET_BASE_URL || API;

// Chuẩn hoá URL ảnh trả về từ API (previewImagePath là đường dẫn tương đối)
const buildUrl = (path) => {
  if (!path) return "/product1-1.jpg";
  if (/^https?:\/\//i.test(path)) return path;
  return `${ASSET_BASE}${String(path).startsWith("/") ? path : `/${path}`}`;
};

// Chuẩn hoá object sản phẩm cho UI hiện tại
const normalize = (p) => {
  const x = p?.product ? p.product : p; // nếu API downloads trả { product: {...} }
  return {
    id: x?._id || x?.id,
    name: x?.name || "Unnamed",
    price: typeof x?.price === "number" ? x.price : 0,
    image: buildUrl(x?.previewImagePath || x?.image || x?.cover?.path),
    liked: !!x?.liked,
  };
};

// Chuẩn hoá dữ liệu banner cho popup (để sau nối API thật)
const normalizeBanner = (b) => ({
  image: buildUrl(b?.image || b?.bannerImage || b?.cover?.path || b?.previewImagePath),
  href: b?.href || b?.url || b?.link || "#",
  title: b?.title || b?.name || "Home Banner",
});

/* ============================
   Popup căn giữa kiểu banner (~560px)
=============================*/
const CenterModal = ({
  open,
  onClose,
  title,
  children,
  widthPx,
  noPadding = true,
}) => {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-[92vw] sm:w-auto rounded-2xl shadow-2xl overflow-hidden"
        style={{ maxWidth: widthPx ? `${widthPx}px` : undefined }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          aria-label="Đóng"
          className="absolute top-2 right-2 bg-black/70 border border-white/30 text-white rounded-full w-9 h-9 flex items-center justify-center hover:scale-105 transition z-10"
        >
          ✕
        </button>

        {/* Content */}
        <div className={noPadding ? "" : "px-5 py-4"}>
          {title && !noPadding && (
            <h3 className="text-white text-lg font-semibold mb-3">{title}</h3>
          )}
          <div className={noPadding ? "" : "text-white/90"}>{children}</div>
        </div>
      </div>
    </div>,
    document.body
  );
};

const Home = () => {
  // ===== Custom arrows cho react-slick (desktop) =====
  const CustomPrevArrow = ({ onClick }) => (
    <div
      onClick={onClick}
      className="absolute border border-white/30 z-50 top-1/2 -translate-y-1/2 left-2 bg-black/70 rounded-full cursor-pointer transition-transform hover:scale-110"
      title="Previous"
    >
      <img src="/Muiten.svg" alt="Previous" className="w-10 h-10 object-contain" />
    </div>
  );

  const CustomNextArrow = ({ onClick }) => (
    <div
      onClick={onClick}
      className="absolute border border-white/30 z-50 top-1/2 -translate-y-1/2 right-2 rounded-full cursor-pointer transition-transform bg-black/70 hover:scale-110"
      title="Next"
    >
      <img src="/Muiten.svg" alt="Next" className="w-10 h-10 object-contain rotate-180" />
    </div>
  );

  // ===== Mock fallback để UI chạy ngay cả khi API rỗng =====
  const [productList] = useState([
    { name: "Architecture", id: "sdfg12435012308541...", price: 0, image: "/product.jpeg", liked: true },
    { name: "Exterior", id: "sdfg12435012308542...", price: 10, image: "/anh-sang-tu-nhien.jpg", liked: false },
    { name: "House Space", id: "sdfg12435012308543...", price: 0, image: "/product.jpeg", liked: true },
    { name: "Restaurant & Coffee", id: "sdfg12435012308544...", price: 10, image: "/anh-sang-tu-nhien.jpg", liked: true },
    { name: "Office Space", id: "sdfg12435012308545...", price: 10, image: "/product.jpeg", liked: false },
    { name: "Interior Garden", id: "sdfg12435012308546...", price: 10, image: "/anh-sang-tu-nhien.jpg", liked: true },
  ]);

  const products = useMemo(
    () => [
      { name: "Bathroom accessories Z56", id: "sdfg124350123085412...", price: 0, image: "/product1-1.jpg", liked: true },
      { name: "Slippers and bath mat", id: "sdfg124350123085413...", price: 10, image: "/product1-1.jpg", liked: false },
      { name: "Song of India Tree in Pot", id: "sdfg124350123085414...", price: 10, image: "/product1-1.jpg", liked: true },
      { name: "Indoor plant set 4D", id: "sdfg124350123085415...", price: 0, image: "/product1-1.jpg", liked: false },
      { name: "Freedom Curvo Modular Sofa", id: "sdfg124350123085416...", price: 10, image: "/product1-1.jpg", liked: true },
      { name: "LLOYD Pendant Light", id: "sdfg124350123085417...", price: 10, image: "/product1-1.jpg", liked: true },
      { name: "Panel 000-1", id: "sdfg1243501230854117...", price: 10, image: "/product1-1.jpg", liked: false },
      { name: "Stone Wave Wall Panel", id: "sdfg124350123085418...", price: 10, image: "/product1-1.jpg", liked: true },
      { name: "Texture Grande", id: "sdfg124350123085419...", price: 10, image: "/product1-1.jpg", liked: true },
      { name: "Wall Panels | Set S13", id: "sdfg124350123085410...", price: 10, image: "/product1-1.jpg", liked: true },
      { name: "Dining Set S4", id: "sdfg1243501230854111...", price: 10, image: "/product1-1.jpg", liked: true },
      { name: "Milano Klee Pendant Lamp", id: "sdfg12435012308541112...", price: 10, image: "/product1-1.jpg", liked: true },
    ],
    []
  );

  // ===== UI states =====
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [isPopupOpenDowload, setIsPopupOpenDowload] = useState(false);
  const [selectedProductDowload, setSelectedProductDowload] = useState([]);
  const [selectedProduct1, setSelectedProduct1] = useState(null);
  const [allowScrollDown, setAllowScrollDown] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const lastScrollY = useRef(0);
  const navigate = useNavigate();
  const [isScrollingUp, setIsScrollingUp] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [previewPosition, setPreviewPosition] = useState({ top: 0, left: 0 });

  // ===== NEW: Yêu thích & Sở hữu =====
  const [favoriteIdSet, setFavoriteIdSet] = useState(() => new Set());
  const [ownedIdSet, setOwnedIdSet] = useState(() => new Set());

  // ====== NEW: ref cho vùng Swiper desktop + ref giữ instance ======
  const desktopSwiperRef = React.useRef(null);
  const swiperRef = React.useRef(null);

  // === Open in same tab or new tab (middle / Ctrl / Cmd) ===
  const openSmart = useCallback((e, href) => {
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
  }, [navigate]);

  // Tạo bộ handler để gắn vào các thẻ "clickable card/slide"
  const linkHandlers = useCallback((href, beforeNav) => ({
    onClick: (e) => {
      beforeNav?.();
      openSmart(e, href);
    },
    onAuxClick: (e) => {
      beforeNav?.();
      openSmart(e, href);
    },
    onMouseDown: (e) => {
      if (e.button === 1) {
        beforeNav?.();
        openSmart(e, href);
      }
    },
    onKeyDown: (e) => {
      if (e.key === "Enter") {
        beforeNav?.();
        openSmart(e, href);
      }
    },
  }), [openSmart]);

  // Ẩn scrollbar + bật/tắt mousewheel khi Swiper chiếm trọn viewport (KHÔNG khóa cuộn)
  // useEffect(() => {
  //   const host = desktopSwiperRef.current;
  //   if (!host) return;

  //   const update = () => {
  //     const rect = host.getBoundingClientRect();
  //     const fullyIn = rect.top <= 1 && rect.bottom >= window.innerHeight - 1;

  //     // document.documentElement.classList.toggle("hide-scrollbar", fullyIn);
  //     // document.body.classList.toggle("hide-scrollbar", fullyIn);

  //     const sw = swiperRef.current;
  //     if (sw) {
  //       // if (fullyIn) sw.mousewheel.enable();
  //       // else sw.mousewheel.disable();
  //     }
  //   };

  //   window.addEventListener("scroll", update, { passive: true });
  //   window.addEventListener("resize", update);
  //   update();

  //   return () => {
  //     window.removeEventListener("scroll", update);
  //     window.removeEventListener("resize", update);
  //     // document.documentElement.classList.remove("hide-scrollbar");
  //     // document.body.classList.remove("hide-scrollbar");
  //   };
  // }, []);

  useEffect(() => {
  const el = desktopSwiperRef.current;
  if (!el) return;

  let lastWheel = 0;

  const onWheel = (e) => {
    const sw = swiperRef.current;
    if (!sw) return;

    const now = Date.now();
    const scrollingDown = e.deltaY > 0;
    const scrollingUp = e.deltaY < 0;

    // Slide cuối + cuộn xuống → nhả cho page scroll
    if (sw.isEnd && scrollingDown) return;

    // Slide đầu + cuộn lên + page đã scroll xuống → nhả cho page
    if (sw.isBeginning && scrollingUp && window.scrollY > 0) return;

    // Còn lại: Swiper xử lý, chặn page
    e.preventDefault();

    // Debounce: tránh chuyển nhiều slide 1 lúc
    if (now - lastWheel < 700) return;
    lastWheel = now;

    if (scrollingDown) sw.slideNext();
    else sw.slidePrev();
  };

  el.addEventListener("wheel", onWheel, { passive: false });
  return () => el.removeEventListener("wheel", onWheel);
}, []);

  // Popup banner + dữ liệu banner
  const [isCenterOpen, setIsCenterOpen] = useState(false);
  const [centerWidth, setCenterWidth] = useState(560);

  const [homeBanner, setHomeBanner] = useState(() => ({
    image: "/anh-sang-tu-nhien.jpg",
    href: "#",
    title: "Home Banner",
  }));

  // Lưới Recently purchased + dữ liệu API
  const [visibleCount, setVisibleCount] = useState(8);
  const [recentProducts, setRecentProducts] = useState([]);

  // LẤY slides cho Swiper Desktop
  const [slides, setSlides] = useState([]);

  // Scenes / Models cho 2 slider đầu trang
  const [sceneList, setSceneList] = useState([]);
  const [modelList, setModelList] = useState([]);

  // Token helper
  function readToken() {
    try {
      const raw = localStorage.getItem("token");
      if (!raw) return null;
      const may = JSON.parse(raw);
      return typeof may === "string" ? may : may?.token ?? raw;
    } catch {
      return localStorage.getItem("token");
    }
  }

  // ===== NEW: recordView giống ModelGallery
  const recordView = useCallback((productId) => {
    const url = `${API}/api/products/${productId}/view`;
    try {
      if (navigator?.sendBeacon) {
        const blob = new Blob([JSON.stringify({})], { type: "application/json" });
        navigator.sendBeacon(url, blob);
        return;
      }
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: "{}",
      }).catch(() => {});
    } catch {}
  }, []);

  // ===== LẤY "RECENTLY PURCHASED PRODUCTS"
  useEffect(() => {
    let cancelled = false;
    const http = axios.create({ baseURL: API });

    const token = readToken();

    const candidates = [
      {
        url: "/api/downloads/recent",
        config: {
          params: { limit: 24 },
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
        pick: (data) => data?.items || data?.list || data?.data || data,
      },
      // {
      //   url: "/api/home/client",
      //   config: { params: { name: "recent", limit: 24 } },
      //   pick: (data) => data?.items || data?.list || data?.data || data,
      // },
      // {
      //   url: "/api/products",
      //   config: { params: { sort: "createdAt:desc", limit: 24 } },
      //   pick: (data) => data?.items || data?.list || data?.data || data,
      // },
    ];

    (async () => {
      for (const c of candidates) {
        try {
          const { data } = await http.get(c.url, c.config);
          const raw = c.pick(data);
          const arr = Array.isArray(raw) ? raw : [];
          if (arr.length && !cancelled) {
            setRecentProducts(arr.map(normalize));
            return;
          }
        } catch (e) {
          // thử endpoint kế tiếp
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ===== LẤY DỮ LIỆU THẬT CHO 2 SLIDER (Scenes + Models)
  useEffect(() => {
    const http = axios.create({ baseURL: API });

    async function fetchScenes() {
      try {
        const { data } = await http.get("/api/home/client", {
          params: { name: "3dscenes", limit: 20 },
        });
        const items = Array.isArray(data?.items) ? data.items : [];
        setSceneList(items.map(normalize));
      } catch (e) {
        console.error("Load 3dscenes failed:", e?.message || e);
      }
    }
    async function fetchModels() {
      try {
        const { data } = await http.get("/api/home/client", {
          params: { name: "3dmodel", limit: 20 },
        });
        const items = Array.isArray(data?.items) ? data.items : [];
        setModelList(items.map(normalize));
      } catch (e) {
        console.error("Load 3dmodel failed:", e?.message || e);
      }
    }

    fetchScenes();
    fetchModels();
  }, []);

  // ===== Slides cấu hình
  useEffect(() => {
    const device = window.matchMedia("(max-width: 639px)").matches ? "mobile" : "desktop";
    axios
      .get(`${API}/api/home/slides`, { params: { enabled: true, device } })
      .then(({ data }) => setSlides(Array.isArray(data?.items) ? data.items : []))
      .catch(() => setSlides([]));
  }, []);

  // ===== NEW: Lấy YÊU THÍCH -> favoriteIdSet
  useEffect(() => {
    const fetchFavoriteProducts = async () => {
      try {
        const token = readToken();
        const { data } = await axios.get(`${API}/api/product-detail/favorites`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const toId = (x) => {
          if (!x) return null;
          if (typeof x === "string") return x;
          return String(x.productId || x._id || x.id || "");
        };
        const ids = Array.isArray(data) ? data.map(toId).filter(Boolean) : [];
        setFavoriteIdSet(new Set(ids));
      } catch (e) {
        console.error("fetchFavoriteProducts error:", e);
        setFavoriteIdSet(new Set());
      }
    };
    fetchFavoriteProducts();
  }, []);

  // ===== NEW: Kiểm tra OWNED theo batch -> ownedIdSet
  const checkOwnedBatch = useCallback(async (ids) => {
    try {
      const token = readToken();
      if (!token || !ids?.length) {
        setOwnedIdSet(new Set());
        return;
      }
      const res = await axios.post(
        `${API}/api/products/owned`,
        { ids },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const ownedIds = res.data?.ownedIds || [];
      setOwnedIdSet(new Set(ownedIds.map(String)));
    } catch (e) {
      console.error("checkOwnedBatch error:", e);
      setOwnedIdSet(new Set());
    }
  }, []);

  // ===== NEW: Decorator gắn liked/owned vào items đang render
  const decorate = useCallback(
    (arr) =>
      (arr || []).map((it) => ({
        ...it,
        liked: favoriteIdSet.has(String(it.id)) || !!it.liked,
        owned: ownedIdSet.has(String(it.id)),
      })),
    [favoriteIdSet, ownedIdSet]
  );

  // Fallback nếu API rỗng để giữ nguyên UI (đã trang bị liked/owned)
  const scenes = decorate(sceneList.length ? sceneList : productList);
  const models = decorate(modelList.length ? modelList : productList);

  // Recently purchased + visible
  const recent = decorate(recentProducts.length ? recentProducts : products);
  const visibleProducts = recent.slice(0, visibleCount);

  // ===== NEW: Gọi owned batch theo những gì đang hiển thị
  useEffect(() => {
    const ids = new Set();
    (sceneList.length ? sceneList : productList).forEach((i) => i?.id && ids.add(String(i.id)));
    (modelList.length ? modelList : productList).forEach((i) => i?.id && ids.add(String(i.id)));
    (recentProducts.length ? recentProducts : products)
      .slice(0, visibleCount)
      .forEach((i) => i?.id && ids.add(String(i.id)));
    checkOwnedBatch(Array.from(ids));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneList, modelList, recentProducts, visibleCount]);

  const handleRemoveProductFromDownload = (productId) => {
    setSelectedProductDowload((prev) => prev.filter((item) => item.id !== productId));
  };

  useEffect(() => {
    const timeout = setTimeout(() => setHasMounted(true), 100);
    return () => clearTimeout(timeout);
  }, []);

  // Scroll: hiện/ẩn header + nút lên đầu trang
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

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // ===== Slider configs (desktop)
  const settings = {
    infinite: true,
    autoplay: true,
    speed: 800,
    slidesToShow: 5,
    slidesToScroll: 1,
    nextArrow: <CustomNextArrow />,
    prevArrow: <CustomPrevArrow />,
    responsive: [
      { breakpoint: 1280, settings: { slidesToShow: 4 } },
      { breakpoint: 1024, settings: { slidesToShow: 3 } },
      { breakpoint: 768, settings: { slidesToShow: 2 } },
      { breakpoint: 640, settings: { slidesToShow: 1 } },
    ],
  };

  // Scenes: luôn 1 slide lớn chữ nhật trong khung
  const settings3dScenes = {
    infinite: true,
    autoplay: true,
    speed: 900,
    slidesToShow: 1,
    slidesToScroll: 1,
    nextArrow: <CustomNextArrow />,
    prevArrow: <CustomPrevArrow />,
    responsive: [],
  };

  const handleAddToCart = useCallback(
    async (e, product) => {
      e.stopPropagation();
      try {
        const token = readToken();
        if (!token) {
          alert("Vui lòng đăng nhập để thêm vào giỏ hàng.");
          return;
        }

        const res = await axios.post(
          `${API}/api/cart/add`,
          { productId: product.id, quantity: 1 },
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (res.data?.ok && res.data?.alreadyPurchased) {
          alert("Bạn đã mua sản phẩm này rồi. Không cần thêm vào giỏ.");
          return;
        }

        if (res.data?.ok) {
          setIsPopupOpenDowload(true); // giữ hành vi cũ
          
          // ✅ Cập nhật badge giỏ trên Header
          window.dispatchEvent(new Event(COUNTER_EVENT_DIRTY));
          try {
            const bc = new BroadcastChannel("user:counters");
            bc.postMessage({ type: "dirty" });
            bc.close();
          } catch {}
        } else {
          alert(res.data?.message || "Không thể thêm vào giỏ hàng");
        }
      } catch (err) {
        if (err?.response?.status === 401) {
          alert("Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.");
        } else {
          console.error(err);
          alert("Lỗi khi thêm vào giỏ hàng.");
        }
      }
    },
    []
  );

  const [homeQuery, setHomeQuery] = useState("");

  const goSearch = useCallback(() => {
    const q = homeQuery.trim();
    if (!q) {
      navigate("/3d-model");
      return;
    }
    navigate(`/3d-model?q=${encodeURIComponent(q)}`);
  }, [homeQuery, navigate]);

  const sectionRef = useRef(null);
  const [sectionActive, setSectionActive] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.4) {
          setSectionActive(true);
          io.disconnect();
        }
      },
      { threshold: [0, 0.25, 0.4, 0.75], rootMargin: "0px 0px -10% 0px" }
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  // ===== AUTO-OPEN POPUP & LẤY DỮ LIỆU BANNER
  useEffect(() => {
    let cancelled = false;
    const http = axios.create({ baseURL: API });

    (async () => {
      try {
        const { data } = await http.get("/api/home/popup");
        if (cancelled) return;

        const isMobile = window.matchMedia("(max-width: 639px)").matches;
        const deviceOk =
          data?.devices === "all" ||
          (isMobile && data?.devices === "mobile") ||
          (!isMobile && data?.devices === "desktop");

        setHomeBanner(normalizeBanner(data));
        setCenterWidth(Number(data?.widthPx) || 560);
        setIsCenterOpen(!!data?.enabled && deviceOk);
      } catch (e) {
        console.error("Load popup config failed:", e?.message || e);
        setIsCenterOpen(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const slideBg = (imgPath) => {
    if (!imgPath) return "url('/anh-sang-tu-nhien.jpg')";
    const isAbs = /^https?:\/\//i.test(imgPath);
    const full = isAbs ? imgPath : `${ASSET_BASE}${imgPath.startsWith("/") ? imgPath : `/${imgPath}`}`;
    return `url('${full}')`;
  };

  // openSlide hỗ trợ middle/Ctrl/Cmd
  const openSlide = (e, s) => {
    const href = s?.href;
    if (!href || href === "#") return openSmart(e, "/product-detail");
    openSmart(e, href);
  };

  /* ============================
     ✨ CALLBACKS ÁP DỤNG THEO YÊU CẦU ✨
     - onAddedToFavorites
     - onOwnedChange
     - refreshOwnedFlags (gọi khi đóng DownloadPopup)
  ============================ */
  const handleFavoritesAdded = useCallback((added) => {
    const ids = new Set(Array.isArray(added) ? added.map(String) : [String(added)]);
    setFavoriteIdSet((prev) => {
       const next = new Set(prev);
       ids.forEach((id) => next.add(id));
  
       // 🔔 Báo Header cập nhật badge
       // 1) Nhảy số ngay lập tức nếu Header lắng nghe COUNTER_EVENT_SET
       try {
         window.dispatchEvent(
           new CustomEvent(COUNTER_EVENT_SET, { detail: { favorites: next.size } })
         );
       } catch {}
       // 2) Cho Header tự refetch counters nếu đang lắng nghe DIRTY
       try {
          window.dispatchEvent(new Event(COUNTER_EVENT_DIRTY));
       } catch {}
       // 3) Đồng bộ giữa các tab (nếu Header nghe BroadcastChannel)
       try {
         const bc = new BroadcastChannel("user:counters");
         bc.postMessage({ type: "dirty" });
         bc.close();
       } catch {}
  
       return next;
     });
     setIsPopupOpen(false);
    }, []);

  const handleOwnedChange = useCallback((ownedIds) => {
    const ids = new Set(Array.isArray(ownedIds) ? ownedIds.map(String) : [String(ownedIds)]);
    setOwnedIdSet((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const refreshOwnedFlags = useCallback(() => {
    const ids = new Set();
    (sceneList.length ? sceneList : productList).forEach((i) => i?.id && ids.add(String(i.id)));
    (modelList.length ? modelList : productList).forEach((i) => i?.id && ids.add(String(i.id)));
    (recentProducts.length ? recentProducts : products)
      .slice(0, visibleCount)
      .forEach((i) => i?.id && ids.add(String(i.id)));
    checkOwnedBatch(Array.from(ids));
  }, [sceneList, modelList, recentProducts, visibleCount, productList, products, checkOwnedBatch]);
// [BGFILE] ===== Dynamic Home BG (BgFile)
    const [homeBg, setHomeBg] = useState(null);

    useEffect(() => {
      let cancelled = false;
      axios
        .get(`${API}/api/bg-files`, {
          params: { activeNow: 1, limit: 1, sort: "updatedAt:desc" },
        })
        .then(({ data }) => {
          const it = Array.isArray(data?.items) ? data.items[0] : null;
          if (!cancelled) setHomeBg(it || null);
        })
        .catch(() => !cancelled && setHomeBg(null));

      return () => { cancelled = true; };
    }, []);

    const homeBgUrl = homeBg?.filePath
      ? (/^https?:\/\//i.test(homeBg.filePath)
          ? homeBg.filePath
          : `${ASSET_BASE}${homeBg.filePath.startsWith("/") ? homeBg.filePath : `/${homeBg.filePath}`}`)
      : null;

    const isHomeBgVideo = homeBgUrl ? /\.(mp4|webm|ogg)$/i.test(homeBgUrl) : false;
    const isHomeBgImage = homeBgUrl ? /\.(png|jpe?g|webp|avif|gif)$/i.test(homeBgUrl) : false;
    const removeFromCollections = useCallback(async (productId) => {
      try {
        const token = readToken();
        if (!token) {
          alert("Vui lòng đăng nhập để thao tác bộ sưu tập.");
          return;
        }
        const headers = { Authorization: `Bearer ${token}` };
        const pid = String(productId);
  
        // 🔸 Optimistic UI: bỏ tim đỏ ngay
        setFavoriteIdSet((prev) => {
          const next = new Set(prev);
          next.delete(pid);
          return next;
        });
  
        // Gọi API gỡ khỏi mọi collection của user
        const res = await axios.post(
          `${API}/api/collections/remove`,
          { productId: pid },
          { headers }
        );
  
        if (res.data?.ok === false) {
          // rollback nếu cần
          setFavoriteIdSet((prev) => new Set(prev).add(pid));
          throw new Error(res.data?.message || "Không thể gỡ sản phẩm khỏi bộ sưu tập");
        }
  
        // Báo Header refetch counters (nếu có lắng nghe)
        try { window.dispatchEvent(new Event(COUNTER_EVENT_DIRTY)); } catch {}
        try {
          const bc = new BroadcastChannel("user:counters");
          bc.postMessage({ type: "dirty", favorites: res.data?.favorites });
          bc.close();
        } catch {}
      } catch (err) {
        console.error(err);
        alert(err?.message || err?.response?.data?.message || "Có lỗi khi gỡ khỏi bộ sưu tập");
      }
    }, [API]);
    useEffect(() => {
      document.title = "Home | 3dsmood"; // tiêu đề riêng của trang này
    }, []);
  return (
    <div className="relative w-full overflow-hidden bg-black">
      {homeBgUrl && isHomeBgVideo ? (
          <>
            <video
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              src={homeBgUrl}
              autoPlay
              muted
              loop
              playsInline
            />
            {/* overlay chỉ làm dịu background, không ảnh hưởng nội dung vì ở dưới */}
            <div className="absolute inset-0 bg-black/30 pointer-events-none" />
          </>
        ) : homeBgUrl && isHomeBgImage ? (
          <>
            <img
              className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
              src={homeBgUrl}
              alt=""
              decoding="async"
              loading="eager"
              aria-hidden="true"
            />
            <div className="absolute inset-0 bg-black/30 pointer-events-none" />
          </>
        ) : null}
      <Header hasMounted={hasMounted} showHeader={showHeader} isScrollingUp={isScrollingUp} />

      {/* =========================
          DESKTOP (>= sm) – Swiper 2 slide
         ========================= */}
      <section ref={desktopSwiperRef} className="hidden sm:block relative w-full">
        <Swiper
          direction="vertical"
          speed={900}
          parallax={true}
          nested={false}
          allowTouchMove={true}
          pagination={{ clickable: true }}
          modules={[Pagination, Parallax]}
          className="h-screen"
          onSwiper={(sw) => { swiperRef.current = sw; }}
          onSlideChange={(sw) => setAllowScrollDown(sw.activeIndex >= 1)}
        >
          {(slides.length ? slides : [
            { _id: "d1", imagePath: "/anh-sang-tu-nhien.jpg", href: "/product-detail" },
            { _id: "d2", imagePath: "/anh-sang-tu-nhien.jpg", href: "/product-detail" },
            { _id: "d3", imagePath: "/anh-sang-tu-nhien.jpg", href: "/product-detail" },
            { _id: "d4", imagePath: "/anh-sang-tu-nhien.jpg", href: "/product-detail" },
          ]).map((s, idx) => (
            <SwiperSlide key={s._id || idx}>
              <div
                className="w-full h-screen bg-black flex flex-col"
                style={{
                  backgroundImage: slideBg(s.imagePath),
                  backgroundSize: "100% auto",
                  backgroundPosition: "center top",
                  backgroundRepeat: "no-repeat",
                }}
                onClick={(e) => openSlide(e, s)}
                onAuxClick={(e) => openSlide(e, s)}
                onMouseDown={(e) => { if (e.button === 1) openSlide(e, s); }}
              >
                {/* Slide 1 có ô search */}
                {idx === 0 ? (
                  <div
                    className="flex-1 flex items-end justify-center px-12"
                    data-swiper-parallax="-20%"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div
                      className="w-full max-w-xl flex items-center px-4 py-2 rounded-md bg-white/10 backdrop-blur-[1px] shadow-md border border-white/20"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        placeholder="Tìm kiếm 3D Models, Texture, Material..."
                        className="flex-1 bg-transparent text-white placeholder-white text-sm focus:outline-none"
                        value={homeQuery}
                        onChange={(e) => setHomeQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            e.stopPropagation();
                            goSearch();
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span
                        className="text-white text-2xl cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); goSearch(); }}
                        role="button"
                      >
                        <FaSearch />
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1" data-swiper-parallax="-20%" />
                )}

                <div className="h-40 bg-gradient-to-t from-black to-transparent" />
              </div>
            </SwiperSlide>
          ))}
        </Swiper>
      </section>

      <div className="w-screen relative ">
        <div className="flex items-center justify-between mb-8 xl:max-w-screen-xl 2xl:max-w-screen-2xl mx-auto w-full pt-2">
          <h2 className="text-white text-3xl font-bold font-codec mt-6">TOP PRODUCTS</h2>
        </div>

        {/* Khung lớn 3D Scenes */}
        <div className="relative lg:max-w-screen-xl 2xl:max-w-screen-2xl mx-auto w-full rounded-xl overflow-hidden mb-10 cursor-pointer border border-white/10">
          <div className="md:h-[320px] xl:h-[400px] 3xl:h-[560px] bg-[#222]">
            <Slider {...settings3dScenes}>
              {scenes.map((item, index) => (
                <div key={item.id || index} className="h-full">
                  <div
                    className="relative group w-full h-full rounded-lg overflow-hidden"
                    {...linkHandlers(`/product-detail-scenes/${item.id}`, () => recordView(item.id))}
                    role="button"
                    tabIndex={0}
                  >
                  {Number(item.price) === 0 && (
                    <div className="absolute top-[12px] left-[12px] z-10">
                      <span className="px-2 py-0.5 rounded-full bg-[#7a9739] text-white text-[10px] font-semibold border border-white/40 shadow">
                        Free
                      </span>
                    </div>
                  )}
                    <div className="flex gap-2 absolute top-3 right-3 z-10">
                    {/* Liked badge (top-right) */}
                    {item.liked && (
                      <span
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      className={`bg-[#8f120d] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-10 h-10 cursor-pointer hover:animate-shake`}
                      title="Yêu thích"
                    >
                      <FaRegHeart className="text-white text-md" />
                    </span>
                    )}
                    {item.owned && (
                        <span
                          className="bg-[#8AA062] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-10 h-10 cursor-pointer hover:animate-shake"
                          onClick={(e) => { e.stopPropagation(); recordView(item.id); navigate(`/product-detail-scenes/${item.id}`); }}
                          title="Đã mua – tải ngay"
                        >
                          <img src="/Download.svg" alt="Download" className="w-8 h-8 object-contain" />
                        </span>
                      )}
                    </div>
                    <img
                      src={item.image}
                      alt={item.name}
                      className="xl:h-[400px] 3xl:h-[560px] w-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                      decoding="async"
                    />

                    {/* Action center */}
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex justify-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      {item.owned ? (
                        <span
                          className="bg-[#8AA062] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-10 h-10 cursor-pointer hover:animate-shake"
                          onClick={(e) => { e.stopPropagation(); recordView(item.id); navigate(`/product-detail-scenes/${item.id}`); }}
                          title="Đã mua – tải ngay"
                        >
                          <img src="/Download.svg" alt="Download" className="w-8 h-8 object-contain" />
                        </span>
                      ) : (
                        <span
                          className="bg-black/80 border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-10 h-10 cursor-pointer hover:animate-shake"
                          onClick={(e) => { e.stopPropagation(); handleAddToCart(e, item); }}
                          title="Thêm vào giỏ"
                        >
                          <img src="/giohang.svg" alt="Cart" className="w-8 h-8 object-contain" />
                        </span>
                      )}
                      {item.liked ? (
                      <span
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromCollections(item.id);
                      }}
                      className={`bg-[#8f120d] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-10 h-10 cursor-pointer hover:animate-shake`}
                      title="Yêu thích"
                    >
                      <FaRegHeart className="text-white text-md" />
                    </span> ):(
                        <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedProduct1(normalize(item));
                          setIsPopupOpen(true);
                        }}
                        className={`bg-black/80 border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-10 h-10 cursor-pointer hover:animate-shake`}
                        title="Yêu thích"
                      >
                        <FaRegHeart className="text-white text-md" />
                      </span>
                    )}
                    </div>
                  </div>
                </div>
              ))}
            </Slider>
          </div>
        </div>

        {/* Khung nhỏ TOP PRODUCTS */}
        <div className="lg:max-w-screen-xl 2xl:max-w-screen-2xl mx-auto w-full">
          <Slider {...settings}>
            {models.map((item, index) => (
              <div key={item.id || index} className="px-1">
                <div
                  className="relative group rounded-lg overflow-hidden bg-[#1a1a1a] border border-white/10"
                  {...linkHandlers(`/product-detail/${item.id}`, () => recordView(item.id))}
                  role="button"
                  tabIndex={0}
                >
                   {Number(item.price) === 0 && (
                    <div className="absolute top-[12px] left-[12px] z-10">
                      <span className="px-2 py-0.5 rounded-full bg-[#7a9739] text-white text-[10px] font-semibold border border-white/40 shadow">
                        Free
                      </span>
                    </div>
                  )}
                  <div className="flex gap-2 absolute top-3 right-3 z-10">
                    {/* Liked badge (top-right) */}
                    {item.liked && (
                      <span
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      className={`bg-[#8f120d] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-10 h-10 cursor-pointer hover:animate-shake`}
                      title="Yêu thích"
                    >
                      <FaRegHeart className="text-white text-md" />
                    </span>
                    )}
                    {item.owned && (
                        <span
                          className="bg-[#8AA062] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-10 h-10 cursor-pointer hover:animate-shake"
                          onClick={(e) => { e.stopPropagation(); recordView(item.id); navigate(`/product-detail-scenes/${item.id}`); }}
                          title="Đã mua – tải ngay"
                        >
                          <img src="/Download.svg" alt="Download" className="w-8 h-8 object-contain" />
                        </span>
                      )}
                    </div>

                  <div className="aspect-square w-full overflow-hidden">
                    <img
                      src={item.image}
                      alt={item.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>

                  {/* Action center */}
                  <div className="absolute top-2/3 left-1/2 -translate-x-1/2 z-10 flex justify-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    {item.owned ? (
                      <span
                        className="bg-[#8AA062] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-10 h-10 cursor-pointer hover:animate-shake"
                        onClick={(e) => { e.stopPropagation(); recordView(item.id); navigate(`/product-detail/${item.id}`); }}
                        title="Đã mua – tải ngay"
                      >
                        <img src="/Download.svg" alt="Download" className="w-8 h-8 object-contain" />
                      </span>
                    ) : (
                      <span
                        className="bg-black/80 border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-10 h-10 cursor-pointer hover:animate-shake"
                        onClick={(e) => { e.stopPropagation(); handleAddToCart(e, item); }}
                        title="Thêm vào giỏ"
                      >
                        <img src="/giohang.svg" alt="Cart" className="w-8 h-8 object-contain" />
                      </span>
                    )}

                    {item.liked ? (
                      <span
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromCollections(item.id);
                      }}
                      className={`bg-[#8f120d] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-10 h-10 cursor-pointer hover:animate-shake`}
                      title="Yêu thích"
                    >
                      <FaRegHeart className="text-white text-md" />
                    </span> ) : (
                        <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedProduct1(normalize(item));
                          setIsPopupOpen(true);
                        }}
                        className={`bg-black/80 border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-10 h-10 cursor-pointer hover:animate-shake`}
                        title="Yêu thích"
                      >
                        <FaRegHeart className="text-white text-md" />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </Slider>
        </div>
      </div>

      {/* Recently purchased (desktop) */}
      <section
        ref={sectionRef}
        id="recent-products"
        className="hidden sm:block text-white py-24 lg:max-w-screen-xl 2xl:max-w-screen-2xl mx-auto w-full"
      >
        <h2 className="text-white text-3xl font-bold uppercase font-codec mb-12">Recently purchased products</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {visibleProducts.map((model, index) => (
            <motion.div
              key={model.id || index}
              className={[
                "relative group px-1 py-0.5 rounded-xl hover:shadow-lg transition h-full w-full mx-auto will-change-transform",
                "fiuanimated",
                sectionActive ? "fadeInUp" : "pre-fiu",
              ].join(" ")}
              style={{
                animationDelay: sectionActive ? `${index * 100}ms` : undefined,
                animationDuration: ".42s",
              }}
              {...linkHandlers(`/product-detail/${model.id}`, () => recordView(model.id))}
              role="button"
              tabIndex={0}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const windowWidth = window.innerWidth;
                const windowHeight = window.innerHeight;

                const previewWidth = 500;
                const previewHeight = 500;

                let left = rect.right;
                let top = rect.top;

                if (rect.right + previewWidth > windowWidth) {
                  left = rect.left - previewWidth;
                }
                if (rect.top + previewHeight > windowHeight) {
                  top = windowHeight - previewHeight;
                }
                if (top < 20) top = 20;

                setPreviewImage(model.image);
                setPreviewPosition({ top, left });
              }}
              onMouseLeave={() => setPreviewImage(null)}
            >
              {/* Heart if liked */}
                <div className="flex gap-2 absolute top-3 right-3 z-10">
                    {/* Liked badge (top-right) */}
                    {model.liked && (
                      <span
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      className={`bg-[#8f120d] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-10 h-10 cursor-pointer hover:animate-shake`}
                      title="Yêu thích"
                    >
                      <FaRegHeart className="text-white text-md" />
                    </span>
                    )}
                    {model.owned && (
                        <span
                          className="bg-[#8AA062] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-10 h-10 cursor-pointer hover:animate-shake"
                          onClick={(e) => { e.stopPropagation(); recordView(model.id); navigate(`/product-detail/${model.id}`); }}
                          title="Đã mua – tải ngay"
                        >
                          <img src="/Download.svg" alt="Download" className="w-8 h-8 object-contain" />
                        </span>
                      )}
                    </div>
                    {Number(model.price) === 0 && (
                    <div className="absolute top-[12px] left-[12px] z-10">
                      <span className="px-2 py-0.5 rounded-full bg-[#7a9739] text-white text-[10px] font-semibold border border-white/40 shadow">
                        Free
                      </span>
                    </div>
                  )}
              {/* Hover actions */}
              <div className="absolute top-3/4 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                {model.owned ? (
                  <span
                    className="bg-[#8AA062] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer hover:animate-shake"
                    onClick={(e) => { e.stopPropagation(); recordView(model.id); navigate(`/product-detail/${model.id}`); }}
                    title="Đã mua – tải ngay"
                  >
                    <img src="/Download.svg" alt="Download" className="w-8 h-8 object-contain" />
                  </span>
                ) : (
                  <span className="bg-black/80 border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer hover:animate-shake">
                    <img
                      src="/giohang.svg"
                      alt="Cart"
                      className="w-8 h-8 object-contain"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddToCart(e, model);
                      }}
                    />
                  </span>
                )}
                   {model.liked ? (
                      <span
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromCollections(model.id);
                      }}
                      className={`bg-[#8f120d] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-8 h-8 cursor-pointer hover:animate-shake`}
                      title="Yêu thích"
                    >
                      <FaRegHeart className="text-white text-md" />
                    </span> ):(
                        <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedProduct1(model);
                          setIsPopupOpen(true);
                        }}
                        className={`bg-black/80 border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-8 h-8 cursor-pointer hover:animate-shake`}
                        title="Yêu thích"
                      >
                        <FaRegHeart className="text-white text-md" />
                      </span>
                    )}

              </div>

              {/* Image */}
              <div className="relative overflow-hidden rounded-lg group aspect-square">
                <img
                  src={model.image}
                  alt={model.name}
                  className="w-full h-full object-cover rounded-lg cursor-pointer group-hover:scale-110 transition-transform duration-300 ease-in-out"
                  loading="lazy"
                  decoding="async"
                />
              </div>

              {/* Info (truncate tên) */}
              <div className="mt-2 mb-1 flex items-center justify-between bg-[#282828] px-3 py-1 rounded w-full max-w-full overflow-hidden">
                <p className="text-white xl:text-[1rem] 2xl:text-[1.2rem] font-codec truncate min-w-[200px] max-w-[220px]">
                  {model.name}
                </p>
                <div className="border-r border-[#2D2D2D] h-6 font-codec ml-1"></div>
              </div>
            </motion.div>
          ))}

          {visibleCount < recent.length && (
            <div className="col-span-full flex justify-center mt-6">
              <button
                onClick={() => setVisibleCount((prev) => prev + 8)}
                className="border border-white text-white my-6 py-2 px-6 rounded-md hover:scale-105 transition font-semibold font-codec bg-white/10 backdrop-blur-[1px]"
              >
                SEE MORE
              </button>
            </div>
          )}

          {/* Preview Image */}
          {previewImage && (
            <div
              className="fixed z-40 pointer-events-none"
              style={{
                top: previewPosition.top,
                left: previewPosition.left,
              }}
            >
              <img
                src={previewImage}
                alt="Preview"
                className="max-w-[500px] max-h-[500px] object-contain border border-white rounded shadow-lg"
              />
            </div>
          )}
        </div>
        <div className="absolute bottom-[18px] left-0 w-full h-[1px] bg-white/40 z-0" />
      </section>

      {/* =========================
          MOBILE (< sm)
         ========================= */}
      {/* Hero (mobile) */}
      <section className="block sm:hidden w-full bg-black pt-20 pb-6">
        <div
          className="relative bg-black max-w-[100vw] overflow-x-hidden"
          style={{
            backgroundImage: "url('/anh-sang-tu-nhien.jpg')",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="bg-black/40 p-4">
            <h1 className="text-white text-xl font-semibold font-codec mb-3">
              Tải Models, Textures & Materials nhanh hơn
            </h1>
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-white/10 backdrop-blur-[1px] border border-white/20">
              <FaSearch className="text-white text-lg" />
              <input
                type="text"
                placeholder="Tìm kiếm 3D asset..."
                className="flex-1 bg-transparent text-white placeholder-white/90 text-sm focus:outline-none"
                value={homeQuery}
                onChange={(e) => setHomeQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && goSearch()}
              />
              <button onClick={goSearch} className="text-white text-sm px-2 py-1 rounded-md border border-white/20 bg-transparent">
                Search
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 3D Scenes strip (mobile) */}
      <section className="block sm:hidden w-full max-w-[100vw] px-1 py-6 overflow-x-hidden">
        <div className="px-4 mb-2 flex items-center justify-between">
          <h2 className="text-white text-lg font-bold font-codec">3D Scenes</h2>
          <button onClick={() => navigate("/3d-scenes")} className="text-white/80 text-md p-1 bg-[#484848]">
            Xem tất cả
          </button>
        </div>
        <div className="overflow-x-auto">
          <div className="flex gap-4 pb-2 px-4">
            {scenes.slice(0, 12).map((item, idx) => (
              <div
                key={item.id || idx}
                className="shrink-0 w-full h-[160px] rounded-lg overflow-hidden relative group cursor-pointer border border-white/10"
                {...linkHandlers(`/product-detail-scenes/${item.id}`, () => recordView(item.id))}
                role="button"
                tabIndex={0}
              >
                {/* Liked badge */}
                {item.liked && (
                  <div className="absolute top-2 right-2 z-10">
                    <button className="bg-[#8f120d] text-white p-1 rounded-full text-xs">
                      <FaRegHeart className="text-white text-sm" />
                    </button>
                  </div>
                )}

                <img src={item.image} alt={item.name} className="w-full h-full object-cover" loading="lazy" />
                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                  <p className="text-white text-xs font-medium line-clamp-1 drop-shadow w-[150px]">{item.name}</p>
                  <div className="flex items-center gap-2">
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedProduct1(item);
                        setIsPopupOpen(true);
                      }}
                      className={`${item.liked ? "bg-[#8f120d]" : "bg-black/80"} border border-white rounded-full flex items-center justify-center overflow-hidden shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer hover:animate-shake p-1`}
                    >
                      <FaRegHeart className="text-white text-[18px] leading-none " />
                    </span>
                    {item.owned ? (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          recordView(item.id);
                          navigate(`/product-detail-scenes/${item.id}`);
                        }}
                        className="bg-[#8AA062] border border-white rounded-full flex items-center justify-center overflow-hidden shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer hover:animate-shake p-1"
                      >
                        <img src="/Download.svg" alt="Download" className="w-5 h-5 object-contain" />
                      </span>
                    ) : (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddToCart(e, item);
                        }}
                        className="bg-black/80 border border-white rounded-full flex items-center justify-center overflow-hidden shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer hover:animate-shake p-1"
                      >
                        <img src="/giohang.svg" alt="Cart" className="w-5 h-5 object-contain" />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Top Products strip (mobile) */}
      <section className="block sm:hidden w-full max-w-[100vw] px-1 py-6 overflow-x-hidden">
        <div className="px-4 mb-2 flex items-center justify-between">
          <h2 className="text-white text-lg font-bold font-codec">Top Products</h2>
          <button onClick={() => navigate("/3d-model")} className="text-white/80 text-md p-1 bg-[#484848]">
            Xem tất cả
          </button>
        </div>
        <div className="px-4 overflow-x-auto">
          <div className="flex gap-3 pb-2">
            {models.slice(0, 16).map((item, idx) => (
              <div
                key={item.id || idx}
                className="shrink-0 w-[164px] rounded-lg overflow-hidden bg-[#1a1a1a] border border-white/10"
                {...linkHandlers(`/product-detail/${item.id}`, () => recordView(item.id))}
                role="button"
                tabIndex={0}
              >
                {/* Liked badge */}
                {item.liked && (
                  <div className="absolute top-2 right-2 z-10">
                    <button className="bg-[#8f120d] text-white p-1 rounded-full text-xs">
                      <FaRegHeart className="text-white text-sm" />
                    </button>
                  </div>
                )}

                <div className="w-full aspect-square overflow-hidden">
                  <img src={item.image} alt={item.name} className="w-full h-full object-cover" loading="lazy" />
                </div>
                <div className="px-2 py-2 flex items-center justify-between">
                  <p className="text-white text-xs font-codec line-clamp-1 pr-2 w-[60px]">{item.name}</p>
                  <div className="flex items-center gap-2">
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedProduct1(item);
                        setIsPopupOpen(true);
                      }}
                      className={`${item.liked ? "bg-[#8f120d]" : "bg-black/80"} border border-white rounded-full flex items-center justify-center overflow-hidden shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer hover:animate-shake p-1`}
                    >
                      <FaRegHeart className="text-white text-[18px] leading-none " />
                    </span>

                    {item.owned ? (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          recordView(item.id);
                          navigate(`/product-detail/${item.id}`);
                        }}
                        className="bg-[#8AA062] border border-white rounded-full flex items-center justify-center overflow-hidden shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer hover:animate-shake p-1"
                      >
                        <img src="/Download.svg" alt="Download" className="w-5 h-5 object-contain" />
                      </span>
                    ) : (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddToCart(e, item);
                        }}
                        className="bg-black/80 border border-white rounded-full flex items-center justify-center overflow-hidden shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer hover:animate-shake p-1"
                      >
                        <img src="/giohang.svg" alt="Cart" className="w-5 h-5 object-contain" />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Recently purchased (mobile) */}
      <section className="block sm:hidden w-full px-4 py-6 pb-28">
        <h2 className="text-white text-lg font-bold uppercase font-codec mb-4">Recently purchased</h2>
        <div className="grid grid-cols-2 gap-3">
          {visibleProducts.map((model, index) => (
            <div
              key={model.id || index}
              className="relative rounded-lg overflow-hidden bg-[#1f1f1f] border border-white/10"
              {...linkHandlers(`/product-detail/${model.id}`, () => recordView(model.id))}
              role="button"
              tabIndex={0}
            >
              {/* Heart */}
              {model.liked && (
                <div className="absolute top-2 right-2 z-10">
                  <button className="bg-[#8f120d] text-white p-1 rounded-full text-xs">
                    <FaRegHeart className="text-white text-sm" />
                  </button>
                </div>
              )}
              <div className="aspect-square w-full overflow-hidden">
                <img
                  src={model.image}
                  alt={model.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div className="px-2 py-2 flex items-center justify-between">
                <p className="text-white text-xs font-codec line-clamp-1 w-[60px]">{model.name}</p>
                <div className="flex items-center gap-2">
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedProduct1(model);
                      setIsPopupOpen(true);
                    }}
                    className={`${model.liked ? "bg-[#8f120d]" : "bg-black/80"} border border-white rounded-full flex items-center justify-center overflow-hidden shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer hover:animate-shake p-1`}
                  >
                    <FaRegHeart className="text-white text-[18px] leading-none " />
                  </span>

                  {model.owned ? (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        recordView(model.id);
                        navigate(`/product-detail/${model.id}`);
                      }}
                      className="bg-[#8AA062] border border-white rounded-full flex items-center justify-center overflow-hidden shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer hover:animate-shake p-1"
                    >
                      <img src="/Download.svg" alt="Download" className="w-5 h-5 object-contain" />
                    </span>
                  ) : (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddToCart(e, model);
                      }}
                      className="bg-black/80 border border-white rounded-full flex items-center justify-center overflow-hidden shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer hover:animate-shake p-1"
                    >
                      <img src="/giohang.svg" alt="Cart" className="w-5 h-5 object-contain" />
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {visibleCount < recent.length && (
          <div className="flex justify-center mt-4">
            <button
              onClick={() => setVisibleCount((prev) => prev + 8)}
              className="border border-white text-white py-2 px-5 rounded-md hover:scale-105 transition font-semibold font-codec bg-white/10 backdrop-blur-[1px]"
            >
              XEM THÊM
            </button>
          </div>
        )}
      </section>

      {/* Popup banner ~560px */}
      <CenterModal open={isCenterOpen} onClose={() => setIsCenterOpen(false)} widthPx={centerWidth} noPadding>
        <a href={homeBanner.href} target="_blank" rel="noopener noreferrer" className="block">
          <img
            src={homeBanner.image}
            alt={homeBanner.title}
            className="w-full h-auto block"
            loading="lazy"
            decoding="async"
          />
        </a>
      </CenterModal>

      {/* Popups cũ + ÁP DỤNG CALLBACKS */}
      {isPopupOpen && selectedProduct1 && (
        <CollectionPopup
          isOpen={isPopupOpen}
          onClose={() => setIsPopupOpen(false)}
          selectedProduct={selectedProduct1}
          onAddedToFavorites={handleFavoritesAdded}
        />
      )}
      {isPopupOpenDowload && selectedProductDowload && (
        <DownloadPopup
          isOpen={isPopupOpenDowload}
          onClose={() => { setIsPopupOpenDowload(false); refreshOwnedFlags(); }}
          selectedProduct={selectedProductDowload}
          onRemove={handleRemoveProductFromDownload}
          onOwnedChange={handleOwnedChange}
        />
      )}

      {/* Nút nổi – chỉ desktop */}
      <div className="hidden sm:flex fixed bottom-10 right-4 sm:bottom-10 sm:right-6 z-[60] flex-col gap-4">
        {showScrollTop && (
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="bg-black/80 backdrop-blur-md border border-white/30 rounded-full w-12 h-12 flex items-center justify-center shadow hover:scale-105 transition"
            title="Lên đầu trang"
          >
            <FaArrowUp className="text-xl text-white scale-[2]" />
          </button>
        )}

        <button
          onClick={() => alert("Mở hộp thoại nhắn tin / Chatbox")}
          className="bg-black/80 backdrop-blur-md border border-white/30 rounded-full w-12 h-12 flex items-center justify-center shadow hover:scale-105 transition"
          title="Nhắn tin"
        >
          <FaFacebookMessenger className="text-xl text-white scale-[2.5]" />
        </button>
      </div>

      {/* Thanh điều hướng đáy (mobile) */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-[70] bg-[#0f0f0f]/95 border-t border-white/10 backdrop-blur-md">
        <div className="grid grid-cols-4">
          <button className="py-3 flex flex-col items-center justify-center text-white/90 bg-transparent" onClick={() => navigate("/")}>
            <FaHome className="text-lg" />
            <span className="text-[10px] mt-1">Home</span>
          </button>
          <button className="py-3 flex flex-col items-center justify-center text-white/90 bg-transparent" onClick={() => navigate("/account")}>
            <FaRegUser className="text-lg" />
            <span className="text-[10px] mt-1">Account</span>
          </button>
          <button className="py-3 flex flex-col items-center justify-center text-white/90 bg-transparent" onClick={() => navigate("account/collections")}>
            <FaRegHeart className="text-lg" />
            <span className="text:[10px] mt-1">Favorites</span>
          </button>
          <button className="py-1 flex flex-col items-center justify-center text-white/90 bg-transparent" onClick={() => setIsPopupOpenDowload(true)}>
            <span className="flex items-center justify-center overflow-hidden shadow-md hover:scale-110 transition w-6 h-5 cursor-pointer hover:animate-shake">
              <img src="/Download.svg" alt="Download" className="w-8 h-8 object-contain" />
            </span>
            <span className="text-[10px] mt-1">Cart</span>
          </button>
        </div>
      </nav>
    </div>
  );
};

export default Home;
