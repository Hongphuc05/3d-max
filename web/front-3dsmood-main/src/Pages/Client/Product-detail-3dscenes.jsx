import React, { useEffect, useRef, useState, useCallback } from "react";
import { FaRegHeart, FaArrowUp, FaFacebookMessenger } from "react-icons/fa";
import Header from "../../Components/header-extra";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import DownloadPopup from "../../Components/dowloadPopup";
import CollectionPopup from "../../Components/CollectionPopup";
import axios from "axios";
import { useParams, useNavigate } from "react-router-dom";
import { COUNTER_EVENT_DIRTY } from "../../utils/counterBus";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const ASSET_BASE = import.meta.env.VITE_ASSET_BASE_URL || API;

const buildUrl = (pathOrUrl) => {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${ASSET_BASE}/${String(pathOrUrl).replace(/^\/+/, "")}`.replace(/\s/g, "%20");
};

const bytesToMB = (b) => {
  if (b === 0) return "0 MB";
  if (!b || isNaN(b)) return "—";
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

const joinNames = (arr) => (Array.isArray(arr) ? arr.map((x) => x?.name ?? String(x)).join(", ") : "—");

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

// ===== download helpers =====
const isAbsUrl = (u) => /^https?:\/\//i.test(String(u || ""));
const startBrowserDownload = (href) => {
  try {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = href;
    document.body.appendChild(iframe);
    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch {}
    }, 120000);
  } catch {
    const a = document.createElement("a");
    a.href = href;
    a.rel = "noopener";
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
};

export default function ProductDetailScenes() {
  const { id } = useParams();
  const navigate = useNavigate();

  // ✨ Điều hướng thông minh: chuột giữa / Ctrl/Cmd mở tab mới, còn lại navigate SPA
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
    } else {
      navigate(href);
    }
  };
  const linkHandlers = (href, stop = false) => ({
    onClick: (e) => {
      if (stop) e.stopPropagation();
      openSmart(e, href);
    },
    onAuxClick: (e) => {
      if (stop) e.stopPropagation();
      openSmart(e, href);
    },
    onMouseDown: (e) => {
      if (e.button === 1) {
        if (stop) e.stopPropagation();
        openSmart(e, href);
      }
    },
    onKeyDown: (e) => {
      if (e.key === "Enter") {
        if (stop) e.stopPropagation();
        openSmart(e, href);
      }
    },
  });

  // Popups & downloads
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [isPopupOpenDowload, setIsPopupOpenDowload] = useState(false);
  const [selectedProductDowload, setSelectedProductDowload] = useState([]);
  const handleRemoveProductFromDownload = (productId) => {
    setSelectedProductDowload((prev) => prev.filter((item) => item.id !== productId));
  };
  const [selectedProduct1, setSelectedProduct1] = useState(null);

  // Detail & sliders
  const [product, setProduct] = useState(null);
  const [imagesSlide, setImagesSlide] = useState([]);
  const fallbackSlide = ["/product1-1.jpg"];

  // Similar grid
  const [similar, setSimilar] = useState([]);

  // Justified grid state
  const [rows, setRows] = useState([]);
  const galleryRef = useRef(null);
  const gap = 8;
  const [targetRowHeight, setTargetRowHeight] = useState(250);

  // Sliders
  const [nav1, setNav1] = useState(null);
  const [nav2, setNav2] = useState(null);
  const slider1 = useRef();
  const slider2 = useRef();

  // Header & scroll
  const [hasMounted, setHasMounted] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const [isScrollingUp, setIsScrollingUp] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const lastScrollY = useRef(0);

  // Trạng thái của sản phẩm hiện tại
  const [status, setStatus] = useState({ purchased: false, inCollections: [], inCart: false });

  // Viewport width for responsive thumbs
  const [viewportW, setViewportW] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const thumbsToShow = React.useMemo(() => {
    const len = imagesSlide?.length || 1;
    if (viewportW < 640) return Math.min(len, 4);     // phone
    if (viewportW < 1024) return Math.min(len, 6);    // tablet
    return Math.min(len, 8);                           // desktop
  }, [viewportW, imagesSlide]);

  // Mount delay
  useEffect(() => {
    const t = setTimeout(() => setHasMounted(true), 100);
    return () => clearTimeout(t);
  }, []);

  // Scroll logic (throttle via rAF)
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const currentScrollY = window.scrollY;
        setShowScrollTop(currentScrollY > 100);

        if (currentScrollY < 50) {
          setShowHeader(true);
          setIsScrollingUp(false);
        } else if (currentScrollY > lastScrollY.current) {
          setShowHeader(false);
          setIsScrollingUp(false);
        } else {
          setShowHeader(true);
          setIsScrollingUp(true);
        }
        lastScrollY.current = currentScrollY;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Responsive row height
  useEffect(() => {
    const updateRowHeight = () => {
      const width = window.innerWidth;
      if (width < 640) setTargetRowHeight(150);
      else if (width < 1024) setTargetRowHeight(200);
      else if (width < 1440) setTargetRowHeight(270);
      else setTargetRowHeight(350);
    };
    updateRowHeight();
    window.addEventListener("resize", updateRowHeight);
    return () => window.removeEventListener("resize", updateRowHeight);
  }, []);

  // Load detail + similar + trạng thái (favorites & owned)
  useEffect(() => {
    const toId = (x) => {
      if (!x) return null;
      if (typeof x === "string") return x;
      return String(x.productId || x._id || x.id || "");
    };

    const load = async () => {
      try {
        const detailRes = await axios.get(`${API}/api/product-detail3dscenes/${id}`);
        const detail = detailRes.data;
        setProduct(detail);

        const slides = (detail.images || []).map((x) => x?.url).filter(Boolean) || [];
        setImagesSlide(slides.length ? Array.from(new Set(slides)) : fallbackSlide);

        // Similar
        const simRes = await axios.get(`${API}/api/product-detail3dscenes/${id}/similar?limit=12`);
        const sims = simRes.data?.items || [];
        const normalized = sims.map((it, idx) => ({
          id: it._id || it.id || String(idx),
          name: it.name || "",
          price: it.price || 0,
          image: buildUrl(it.image) || "/product1-1.jpg",
          liked: false,
          owned: false,
        }));
        setSimilar(normalized);

        // ===== Fetch statuses từ API sẵn có =====
        const token = readToken();
        if (token) {
          const headers = { Authorization: `Bearer ${token}` };

          // 1) Favorites set
          let favoriteSet = new Set();
          try {
            const favRes = await axios.get(`${API}/api/product-detail/favorites`, { headers });
            const favArr = Array.isArray(favRes.data) ? favRes.data.map(toId).filter(Boolean) : [];
            favoriteSet = new Set(favArr.map(String));
          } catch {
            favoriteSet = new Set();
          }

          // 2) Owned set cho current + similar
          let ownedSet = new Set();
          try {
            const ids = [...normalized.map((x) => String(x.id)), String(detail?._id || detail?.id || id)].filter(Boolean);
            const ownRes = await axios.post(`${API}/api/products/owned`, { ids }, { headers });
            const ownedIds = ownRes.data?.ownedIds || [];
            ownedSet = new Set(ownedIds.map(String));
          } catch {
            ownedSet = new Set();
          }

          // Cập nhật CURRENT product
          const currentId = String(detail?._id || detail?.id || id);
          const purchased = ownedSet.has(currentId);
          const inCollections = favoriteSet.has(currentId) ? ["favorites"] : [];
          setStatus({ purchased, inCollections, inCart: false });

          // Cập nhật SIMILAR grid
          setSimilar((prev) =>
            prev.map((img) => ({
              ...img,
              liked: favoriteSet.has(String(img.id)),
              owned: ownedSet.has(String(img.id)),
            }))
          );
        } else {
          setStatus({ purchased: false, inCollections: [], inCart: false });
        }
      } catch (err) {
        console.error("Load product/similar failed:", err);
        setImagesSlide(fallbackSlide);
        setSimilar([]);
      }
    };
    if (id) load();
  }, [id]);

  // Khi similar đổi và đã login → refresh owned 1 nhịp
  useEffect(() => {
    if (!readToken() || !similar.length) return;
    refreshOwnedFlags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [similar]);

  const getId = (obj) => String(obj?._id ?? obj?.id ?? obj?.productId ?? "");
  const removeFromCollections = useCallback(
    async (productId) => {
      try {
        const token = readToken();
        if (!token) {
          alert("Vui lòng đăng nhập để thao tác bộ sưu tập.");
          return;
        }
        const headers = { Authorization: `Bearer ${token}` };

        const res = await axios.post(`${API}/api/collections/remove`, { productId }, { headers });
        if (res.data?.ok === false) {
          throw new Error(res.data?.message || "Không thể gỡ sản phẩm khỏi bộ sưu tập");
        }

        const pid = String(productId);

        const currentId = getId(product) || String(id);
        if (pid === currentId) {
          setStatus((prev) => ({ ...prev, inCollections: [] }));
        }

        setSimilar((prev) => prev.map((it) => (String(it.id) === pid ? { ...it, liked: false } : it)));

        try {
          window.dispatchEvent(new Event(COUNTER_EVENT_DIRTY));
        } catch {}
        try {
          if ("BroadcastChannel" in window) {
            const bc = new BroadcastChannel("user:counters");
            bc.postMessage({ type: "dirty" });
            bc.close();
          }
        } catch {}
      } catch (err) {
        console.error(err);
        alert(err?.message || err?.response?.data?.message || "Có lỗi khi gỡ khỏi bộ sưu tập");
      }
    },
    [product, id]
  );

  // ====== REFRESH OWNED FLAGS (gọi khi đóng DownloadPopup) ======
  const refreshOwnedFlags = useCallback(
    async () => {
      try {
        const token = readToken();
        if (!token) return;
        const headers = { Authorization: `Bearer ${token}` };
        const currentId = String(product?._id || product?.id || id);
        const ids = [currentId, ...similar.map((x) => String(x.id))].filter(Boolean);
        if (!ids.length) return;

        const ownRes = await axios.post(`${API}/api/products/owned`, { ids }, { headers });
        const ownedSet = new Set((ownRes.data?.ownedIds || []).map(String));

        setStatus((prev) => ({ ...prev, purchased: ownedSet.has(currentId) }));
        setSimilar((prev) => prev.map((img) => ({ ...img, owned: ownedSet.has(String(img.id)) })));
      } catch {
        // ignore
      }
    },
    [product, similar, id]
  );

  // ====== Direct download cả image + file nếu đã mua ======
  const handleDirectDownloadBoth = useCallback(async (productId) => {
    try {
      const token = readToken();
      if (!token) {
        alert("Vui lòng đăng nhập để tải tệp.");
        return;
      }
      const headers = { Authorization: `Bearer ${token}` };

      const [imgRes, fileRes] = await Promise.all([
        axios.get(`${API}/api/downloads/product/${productId}?type=image`, { headers }),
        axios.get(`${API}/api/downloads/product/${productId}?type=file`, { headers }),
      ]);

      const mkHref = (url) => (isAbsUrl(url) ? url : `${API}${url?.startsWith("/") ? url : `/${url}`}`);
      const urls = [imgRes?.data?.url, fileRes?.data?.url].filter(Boolean).map(mkHref);

      if (!urls.length) throw new Error("Không nhận được URL tải.");

      urls.forEach((href, idx) => setTimeout(() => startBrowserDownload(href), idx * 400));
    } catch (e) {
      alert(e?.response?.data?.message || e.message || "Không tải được tệp");
    }
  }, []);

  // ====== Add to cart + cập nhật counter header ======
  const handleAddToCart = useCallback(async (e, productItem) => {
    e.stopPropagation();
    try {
      const token = readToken();
      if (!token) {
        alert("Vui lòng đăng nhập để thêm vào giỏ hàng.");
        return;
      }
      const headers = { Authorization: `Bearer ${token}` };

      // Nếu đã mua → mở popup tải
      try {
        const ownRes = await axios.post(`${API}/api/products/owned`, { ids: [String(productItem.id)] }, { headers });
        const ownedIds = ownRes.data?.ownedIds || [];
        const purchased = ownedIds.map(String).includes(String(productItem.id));
        if (purchased) {
          setIsPopupOpenDowload(true);
          setSelectedProductDowload((prev) => {
            const exists = prev.some((x) => x.id === productItem.id);
            return exists ? prev : [...prev, productItem];
          });
          return;
        }
      } catch {}

      const res = await axios.post(`${API}/api/cart/add`, { productId: productItem.id, quantity: 1 }, { headers });

      if (res.data?.ok) {
        setIsPopupOpenDowload(true);
        setSelectedProductDowload((prev) => {
          const exists = prev.some((x) => x.id === productItem.id);
          return exists ? prev : [...prev, productItem];
        });

        window.dispatchEvent(new Event(COUNTER_EVENT_DIRTY));
        try {
          if ("BroadcastChannel" in window) {
            const bc = new BroadcastChannel("user:counters");
            bc.postMessage({ type: "dirty" });
            bc.close();
          }
        } catch {}
      } else if (res.data?.alreadyPurchased) {
        alert("Bạn đã mua sản phẩm này rồi.");
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
  }, []);

  // ✅ CALLBACK: cập nhật tim đỏ sau khi add vào Collection
  const handleFavoritesAdded = useCallback(
    (added, favoritesTotal) => {
      const ids = new Set(Array.isArray(added) ? added.map((x) => String(x)) : [String(added)]);
      setSimilar((prev) => prev.map((it) => (ids.has(String(it.id)) ? { ...it, liked: true } : it)));
      if (product && ids.has(String(product.id || product._id))) {
        setStatus((prev) => ({
          ...prev,
          inCollections: prev.inCollections?.length ? prev.inCollections : ["favorites"],
        }));
      }
      try {
        window.dispatchEvent(new Event(COUNTER_EVENT_DIRTY));
      } catch {}
      try {
        if ("BroadcastChannel" in window) {
          const bc = new BroadcastChannel("user:counters");
          bc.postMessage({ type: "dirty", favorites: favoritesTotal });
          bc.close();
        }
      } catch {}
      setIsPopupOpen(false);
    },
    [product]
  );

  // ✅ CALLBACK: cập nhật OWNED ngay khi thanh toán xong
  const handleOwnedChange = useCallback(
    (ownedIds) => {
      const setIds = new Set(Array.isArray(ownedIds) ? ownedIds.map(String) : [String(ownedIds)]);
      if (product && setIds.has(String(product.id || product._id || id))) {
        setStatus((prev) => ({ ...prev, purchased: true }));
      }
      setSimilar((prev) => prev.map((it) => (setIds.has(String(it.id)) ? { ...it, owned: true } : it)));
    },
    [product, id]
  );

  // ===== arrange justified rows
  useEffect(() => {
    let mounted = true;

    const calculate = () => {
      if (!galleryRef.current) return;
      const containerWidth = galleryRef.current.clientWidth;
      if (containerWidth === 0) return;

      Promise.all(
        (similar || []).map(
          (img) =>
            new Promise((resolve) => {
              const image = new Image();
              image.src = img.image;
              image.onload = () => resolve({ ...img, ratio: (image.width / image.height) || 1 });
              image.onerror = () => resolve({ ...img, ratio: 1 });
            })
        )
      ).then((imgsWithRatio) => {
        if (mounted) arrangeRows(imgsWithRatio, containerWidth);
      });
    };

    const timeout = setTimeout(calculate, 200);
    window.addEventListener("resize", calculate);
    return () => {
      mounted = false;
      clearTimeout(timeout);
      window.removeEventListener("resize", calculate);
    };
  }, [similar, targetRowHeight]);

  const arrangeRows = (imgs, containerWidth) => {
    let currentRow = [];
    let currentWidth = 0;
    const allRows = [];

    imgs.forEach((img) => {
      const scaledWidth = targetRowHeight * img.ratio;
      currentRow.push(img);
      currentWidth += scaledWidth + gap;

      if (currentWidth >= containerWidth) {
        const scale = (containerWidth - gap * (currentRow.length - 1)) / (currentWidth - gap);
        allRows.push({ items: currentRow, scale });
        currentRow = [];
        currentWidth = 0;
      }
    });

    if (currentRow.length > 0) {
      const finalWidth = currentRow.reduce((acc, img) => acc + targetRowHeight * img.ratio + gap, 0);
      const scale = (containerWidth - gap * (currentRow.length - 1)) / (finalWidth - gap);
      allRows.push({ items: currentRow, scale: Math.min(scale, 1) });
    }

    setRows(allRows);
  };

  // Custom arrows for main slider (desktop ok)
  const CustomPrevArrow = ({ onClick }) => (
    <div
      onClick={onClick}
      className="absolute border border-white/30 z-50 top-1/2 -translate-y-1/2 left-2 bg-black/70 rounded-full cursor-pointer transition-transform hover:scale-110"
    >
      <img src="/Muiten.svg" alt="prev" className="w-10 h-10 object-contain" />
    </div>
  );
  const CustomNextArrow = ({ onClick }) => (
    <div
      onClick={onClick}
      className="absolute border border-white/30 z-50 top-1/2 -translate-y-1/2 right-2 rounded-full cursor-pointer transition-transform bg-black/70 hover:scale-110"
    >
      <img src="/Muiten.svg" alt="next" className="w-10 h-10 object-contain rotate-180" />
    </div>
  );

  // Lightbox
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const openLightbox = useCallback((idx = 0) => {
    setLightboxIndex(idx);
    setIsLightboxOpen(true);
  }, []);
  const closeLightbox = useCallback(() => setIsLightboxOpen(false), []);
  const gotoPrev = useCallback(() => {
    setLightboxIndex((i) => {
      const arr = imagesSlide.length ? imagesSlide : fallbackSlide;
      return (i - 1 + arr.length) % arr.length;
    });
  }, [imagesSlide]);
  const gotoNext = useCallback(() => {
    setLightboxIndex((i) => {
      const arr = imagesSlide.length ? imagesSlide : fallbackSlide;
      return (i + 1) % arr.length;
    });
  }, [imagesSlide]);
  useEffect(() => {
    if (!isLightboxOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") { e.preventDefault(); gotoPrev(); }
      if (e.key === "ArrowRight") { e.preventDefault(); gotoNext(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isLightboxOpen, closeLightbox, gotoPrev, gotoNext]);

  // Lightbox arrows for mobile/tablet/desktop
  function LightboxArrow({ dir = "prev", onClick }) {
    return (
      <button
        onClick={onClick}
        className={`absolute ${dir === "prev" ? "left-2 sm:left-3 md:left-6" : "right-2 sm:right-3 md:right-6"}
                    top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 rounded-full
                    border border-white/30 bg-black/40 hover:scale-105 transition flex items-center justify-center`}
        title={dir === "prev" ? "Ảnh trước (←)" : "Ảnh sau (→)"}
        aria-label={dir === "prev" ? "Ảnh trước" : "Ảnh sau"}
      >
        <img src="/Muiten.svg" alt={dir} className={`w-7 h-7 sm:w-8 sm:h-8 ${dir === "next" ? "rotate-180" : ""}`} />
      </button>
    );
  }

  const currentId = String(product?._id || product?.id || id);
  useEffect(() => {
    document.title = product?.name ? `${product.name} | 3dsmood` : "Sản phẩm | 3dsmood";
  }, [product?.name]);

  const formatPrice = (v) => Number(v || 0).toLocaleString("vi-VN");

  return (
    <div
      className="
        bg-black text-white min-h-screen font-sans
        w-full
        px-3 py-16
        sm:px-6 sm:py-16
        md:px-8
        lg:px-10
        xl:w-[1366px] xl:p-32
        2xl:w-[1720px] 2xl:p-32
        mx-auto
      "
    >
      <Header hasMounted={hasMounted} showHeader={showHeader} isScrollingUp={isScrollingUp} />

      {/* Breadcrumb */}
      <div className="text-[12px] sm:text-sm text-gray-300 mb-3 sm:mb-4 font-codec">
        <span className="bg-[#282828] px-2 py-1 sm:px-3 rounded inline-block">
          <span className="text-[#a1a1a1]">Categories</span>
          {(product?.categories || []).map((c, i) => (
            <span key={c.id} className="text-[#a1a1a1]">
              {i === 0 ? " " : " / "}
              {c.name}
            </span>
          ))}
          {product?.name && (
            <>
              <span className="text-[#a1a1a1]"> /</span>
              <span className="text-[#a1a1a1]"> {product.name}</span>
            </>
          )}
        </span>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 border border-[#2b2b2b] rounded-xl p-3 sm:p-4 h-auto xl:h-[600px] 2xl:h-[640px] bg-transparent">
        {/* LEFT: SLIDER */}
        <div className="flex-1 min-w-[60%] flex flex-col justify-center items-center gap-2">
          <div className="
            w-full flex justify-center items-center rounded-2xl overflow-hidden
            mt-2
            h-[320px]
            sm:h-[400px]
            md:h-[500px]
            lg:h-[540px]
            xl:h-[600px]
            2xl:h-[800px]
          ">
            <Slider
              asNavFor={nav2}
              ref={(slider) => {
                if (slider1.current !== slider) {
                  slider1.current = slider;
                  setNav1(slider);
                }
              }}
              arrows
              dots={false}
              infinite={false}
              slidesToShow={1}
              slidesToScroll={1}
              className="w-full"
              prevArrow={<CustomPrevArrow />}
              nextArrow={<CustomNextArrow />}
            >
              {(imagesSlide.length ? imagesSlide : fallbackSlide).map((img, idx) => (
                <div key={idx}>
                  <div className="flex justify-center items-center w-full h-full">
                    <img
                      src={buildUrl(img)}
                      alt={`Slide ${idx}`}
                      className="max-h-full max-w-full rounded-2xl"
                      onClick={() => openLightbox(idx)}
                    />
                  </div>
                </div>
              ))}
            </Slider>
          </div>

          {/* Thumbnails */}
          <div className="w-full px-1 mt-2">
            <style>{`
              .thumbnail-slider .slick-slide { width: auto !important; display: inline-block !important; padding-right:5px; padding-left:5px}
              .thumbnail-slider .slick-track { display: flex !important; align-items: center;}
            `}</style>
            <Slider
              asNavFor={nav1}
              ref={(slider) => {
                if (slider2.current !== slider) {
                  slider2.current = slider;
                  setNav2(slider);
                }
              }}
              swipeToSlide
              focusOnSelect
              arrows
              infinite={false}
              slidesToShow={thumbsToShow}
              className="thumbnail-slider px-2"
            >
              {(imagesSlide.length ? imagesSlide : fallbackSlide).map((img, idx) => (
                <img
                  key={idx}
                  src={buildUrl(img)}
                  alt={`Thumbnail ${idx}`}
                  className="rounded-md border border-white/20 hover:border-white transition object-cover
                             h-[50px] w-auto
                             sm:h-[58px]
                             md:h-[62px]"
                />
              ))}
            </Slider>
          </div>
        </div>

        {/* RIGHT: INFO */}
        <div className="flex-1 flex flex-col justify-between rounded shadow h-full">
          <div className="text-white rounded-md shadow font-codec flex flex-col gap-4">
            {/* Title + badges */}
            <div className="flex items-center justify-between border border-[#2b2b2b] rounded py-2 bg-[#1e1e1e]">
              <div className="flex items-center justify-between px-3 w-full max-w-full overflow-hidden ">
                <p className="text-white text-sm md:text-base xl:text-[1rem] 2xl:text-[1.2rem] truncate whitespace-nowrap overflow-hidden text-ellipsis flex-1">
                  {product?.name || "Living room black an"}
                </p>
                <div className="flex items-center gap-1 text-white text-xs md:text-sm xl:text-[1rem] 2xl:text-[1.2rem] whitespace-nowrap ">
                  {Number(product?.price || 0) === 0 ? (
                    <span className="text-green-400 text-base md:text-lg xl:text-[1rem] 2xl:text-[1.2rem]">Free</span>
                  ) : (
                    <span className="text-base md:text-lg xl:text-[1.2rem] 2xl:text-[1.4rem]">{formatPrice(product?.price)} đ</span>
                  )}
                </div>
              </div>
            </div>

            {/* Info Grid */}
            <div className="text-sm divide-y divide-[#2a2a2a] border border-[#2a2a2a] bg-[#1e1e1e] rounded overflow-hidden flex-grow 2xl:min-h-[468px]">
              <div className="flex justify-between px-3 py-3 sm:py-4">
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base md:text-[1rem] xl:text-[1rem] 2xl:text-[1.2rem]">ID :</span>
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base md:text-[1rem] xl:text-[1rem] 2xl:text-[1.2rem]">{product?.customId || "—"}</span>
              </div>
              <div className="flex justify-between px-3 py-3 sm:py-4">
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base md:text-[1rem] xl:text-[1rem] 2xl:text-[1.2rem]">Size:</span>
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base md:text-[1rem] xl:text-[1rem] 2xl:text-[1.2rem]">
                  {bytesToMB(product?.modelSize)}
                </span>
              </div>
              <div className="flex justify-between px-3 py-3 sm:py-4">
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base md:text-[1rem] xl:text-[1rem] 2xl:text-[1.2rem]">Style:</span>
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base md:text-[1rem] xl:text-[1rem] 2xl:text-[1.2rem]">
                  {joinNames(product?.styles)}
                </span>
              </div>
              <div className="flex justify-between px-3 py-3 sm:py-4">
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base md:text-[1rem] xl:text-[1rem] 2xl:text-[1.2rem]">Render:</span>
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base md:text-[1rem] xl:text-[1rem] 2xl:text-[1.2rem]">
                  {product?.render ? product.render : "—"}
                </span>
              </div>
              <div className="flex justify-between px-3 py-3 sm:py-4">
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base md:text-[1rem] xl:text-[1rem] 2xl:text-[1.2rem]">Lighting:</span>
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base md:text-[1rem] xl:text-[1rem] 2xl:text-[1.2rem]">
                  {product?.lighting ? product.lighting : "—"}
                </span>
              </div>
              <div className="flex justify-between px-3 py-3 sm:py-4">
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base md:text-[1rem] xl:text-[1rem] 2xl:text-[1.2rem]">Camera:</span>
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base md:text-[1rem] xl:text-[1rem] 2xl:text-[1.2rem]">
                  {product?.cameraType ? product.cameraType : "—"}
                </span>
              </div>
              <div className="justify-between px-3 py-3 sm:py-4">
                <span className="text-gray-400 text-sm sm:text-base md:text-[1rem] xl:text-[1rem] 2xl:text-[1.2rem]">Description:</span>
                <span className="text-[#9e9e9e] block max-h-40 overflow-y-auto pr-1 sm:pr-2 text-xs sm:text-sm md:text-base">
                  {product?.description?.trim() ? product.description : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-2">
            <button
              className={`relative flex items-center justify-center gap-2 w-full
                ${
                  status.purchased || Number(product?.price) === 0
                    ? "bg-[#7a9739] hover:bg-[#6a8f36]"
                    : "bg-[#8f120d] hover:bg-[#6b0e0c]"
                }
                text-white/80 font-codec rounded
                py-3 md:py-3.5 xl:py-0
                text-sm md:text-base xl:text-[1rem] 2xl:text-[1.2rem]
                transition`}
              onClick={(e) => {
                if (!product) return;
                const cover = product.images?.[0]?.url || imagesSlide?.[0] || "/product1-1.jpg";
                const item = { id: currentId, name: product.name, image: cover, price: product.price || 0 };

                const token = readToken();
                const isFree = Number(product?.price) === 0;

                if (status.purchased || (isFree && token)) {
                  handleDirectDownloadBoth(currentId);
                  return;
                }

                if (isFree && !token) {
                  alert("Sản phẩm miễn phí – vui lòng đăng nhập để hệ thống ghi nhận và hiển thị trong thư viện của bạn.");
                  return;
                }

                handleAddToCart(e, item);
              }}
            >
              <img src="/Download.svg" alt="Download Icon" className="w-4 h-4 md:w-5 md:h-5 xl:scale-150 shrink-0" />
              <span className="text-sm md:text-base xl:text-[1.2rem] 2xl:text-[1.4rem]">Download</span>
            </button>

            {status.inCollections?.length ? (
              <button
                className={`${status.inCollections?.length
                    ? "bg-[#8f120d] hover:bg-[#821212] text-white"
                    : "bg-transparent hover:bg-transparent text-white"
                  } flex justify-center items-center rounded transition border border-[#2D2D2D]
                  w-12 h-12 md:w-14 md:h-14`}
                onClick={() => {
                  removeFromCollections(currentId);
                }}
                title="Trong bộ sưu tập"
                aria-label="Trong bộ sưu tập"
              >
                <FaRegHeart className="text-white w-5 h-5 md:w-6 md:h-6" />
              </button>
            ) : (
              <button
                className={`${status.inCollections?.length
                    ? "bg-[#8f120d] hover:bg-[#821212] text-white"
                    : "bg-transparent hover:bg-transparent text-white"
                  } flex justify-center items-center rounded transition border border-[#2D2D2D]
                  w-12 h-12 md:w-14 md:h-14`}
                onClick={() => {
                  if (product) {
                    setSelectedProduct1({
                      id: currentId,
                      name: product.name,
                      price: product.price || 0,
                      image: product.images?.[0]?.url || imagesSlide?.[0] || "/product1-1.jpg",
                    });
                    setIsPopupOpen(true);
                  }
                }}
                title="Thêm vào bộ sưu tập"
                aria-label="Thêm vào bộ sưu tập"
              >
                <FaRegHeart className="text-white w-5 h-5 md:w-6 md:h-6" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Similar Grid */}
      <section className="text-white py-16 sm:py-20 mx-auto w-full">
        <h2 className="text-white text-2xl sm:text-3xl font-codec mb-6 sm:mb-12">SIMILAR MODELS</h2>
        <div ref={galleryRef} className="bg-black p-1 sm:p-2 w-full">
          {rows.map((row, rowIndex) => (
            <div key={rowIndex} className="flex mb-2" style={{ gap: `${gap}px` }}>
              {row.items.map((img) => {
                const href = `/product-detail-scenes/${img.id}`;
                return (
                  <div
                    key={img.id}
                    className="relative group overflow-hidden rounded-lg cursor-pointer"
                    style={{
                      height: `${targetRowHeight * row.scale}px`,
                      width: `${targetRowHeight * img.ratio * row.scale}px`,
                    }}
                    {...linkHandlers(href)}
                    role="link"
                    tabIndex={0}
                  >
                    <img
                      src={img.image}
                      alt={img.name}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />

                    {/* TOP-RIGHT BADGES: owned + liked */}
                    <div className="flex gap-2 absolute top-2 right-2 sm:top-[12px] sm:right-[12px] z-10">
                      {img.owned && (
                        <span
                          className="bg-[#8AA062] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-7 h-7 sm:w-8 sm:h-8 cursor-pointer"
                          {...linkHandlers(href, true)}
                          title="Đã mua"
                        >
                          <img src="/Download.svg" alt="Owned" className="w-7 h-7 sm:w-8 sm:h-8 object-contain" />
                        </span>
                      )}
                      {img.liked && (
                        <button
                          className="bg-[#8f120d] text-white rounded-full text-xs sm:text-sm w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center"
                          title="Trong bộ sưu tập"
                          aria-label="Trong bộ sưu tập"
                        >
                          <FaRegHeart className="text-white text-base sm:text-lg" />
                        </button>
                      )}
                    </div>

                    {Number(img.price) === 0 && (
                      <div className="absolute top-2 left-2 sm:top-[12px] sm:left-[12px] z-10">
                        <span className="px-2 py-0.5 rounded-full bg-[#7a9739] text-white text-[10px] font-semibold border border-white/40 shadow">
                          Free
                        </span>
                      </div>
                    )}

                    {/* HOVER ACTIONS */}
                    <div className="absolute top-1/3 right-2 sm:right-3 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      {img.owned ? (
                        <span
                          className="bg-[#8AA062] border border-white rounded-full items-center justify-center shadow-md hover:scale-110 transition w-7 h-7 sm:w-8 sm:h-8 cursor-pointer"
                          {...linkHandlers(href, true)}
                          title="Đã mua – xem chi tiết để tải"
                        >
                          <img src="/Download.svg" alt="Owned" className="w-7 h-7 sm:w-8 sm:h-8 object-contain" />
                        </span>
                      ) : (
                        <span className="bg-black/80 border border-white rounded-full items-center justify-center shadow-md hover:scale-110 transition w-7 h-7 sm:w-8 sm:h-8 cursor-pointer">
                          <img
                            src="/giohang.svg"
                            alt="Thêm vào giỏ"
                            className="w-7 h-7 sm:w-8 sm:h-8 object-contain"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddToCart(e, img);
                            }}
                          />
                        </span>
                      )}

                      {img.liked ? (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromCollections(img.id);
                          }}
                          className={`${img.liked ? "bg-[#8f120d]" : "bg:black/80"} border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-7 h-7 sm:w-8 sm:h-8 cursor-pointer`}
                          title={img.liked ? "Trong bộ sưu tập" : "Thêm vào bộ sưu tập"}
                        >
                          <FaRegHeart className="text-white text-base sm:text-lg" />
                        </span>
                      ) : (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedProduct1(img);
                            setIsPopupOpen(true);
                          }}
                          className={`${img.liked ? "bg-[#8f120d]" : "bg-black/80"} border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-7 h-7 sm:w-8 sm:h-8 cursor-pointer`}
                          title={img.liked ? "Trong bộ sưu tập" : "Thêm vào bộ sưu tập"}
                        >
                          <FaRegHeart className="text-white text-base sm:text-lg" />
                        </span>
                      )}
                    </div>

                    <div className="absolute bottom-0 left-0 right-0 flex justify-between items-center px-1 ">
                      <div className="flex items-center gap-1 truncate opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <p className="text-white text-xs sm:text-sm font-codec truncate whitespace-nowrap overflow-hidden text-ellipsis flex-1">
                          {img.name}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Popups */}
        {isPopupOpen && selectedProduct1 && (
          <CollectionPopup
            isOpen={isPopupOpen}
            onClose={() => setIsPopupOpen(false)}
            selectedProduct={selectedProduct1}
            onAddedToFavorites={handleFavoritesAdded}
          />
        )}

        {isPopupOpenDowload && (
          <DownloadPopup
            isOpen={isPopupOpenDowload}
            onClose={() => {
              setIsPopupOpenDowload(false);
              refreshOwnedFlags();
            }}
            selectedProduct={selectedProductDowload}
            onRemove={handleRemoveProductFromDownload}
            onOwnedChange={handleOwnedChange}
          />
        )}

        {/* Floating actions */}
        <div className="fixed bottom-6 right-3 sm:bottom-10 sm:right-6 z-[60] flex flex-col gap-3 sm:gap-4">
          {showScrollTop && (
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="bg-black/80 backdrop-blur-md border border-white/30 rounded-full w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center shadow hover:scale-105 transition"
              title="Lên đầu trang"
              aria-label="Lên đầu trang"
            >
              <FaArrowUp className="text-lg sm:text-xl text-white scale-[2]" />
            </button>
          )}

          <button
            onClick={() => alert("Mở hộp thoại nhắn tin / Chatbox")}
            className="bg-black/80 backdrop-blur-md border border-white/30 rounded-full w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center shadow hover:scale-105 transition"
            title="Nhắn tin"
            aria-label="Nhắn tin"
          >
            <FaFacebookMessenger className="text-lg sm:text-xl text-white scale-[2.5]" />
          </button>
        </div>

        {/* Lightbox phóng to ảnh */}
        {isLightboxOpen && (
          <div
            className="fixed inset-0 z-[1000] bg-black/90 backdrop-blur-sm flex items-center justify-center"
            onClick={closeLightbox}
            role="dialog"
            aria-modal="true"
          >
            <div className="relative w-full h-[95vh] max-w-none flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={closeLightbox}
                className="absolute bg-transparent top-4 right-4 border border-white/30 text-white rounded-full w-10 h-10 flex items-center justify-center hover:scale-105 transition"
                title="Đóng (Esc)"
                aria-label="Đóng"
              >
                ✕
              </button>

              {(imagesSlide.length > 1) && (
                <>
                  <LightboxArrow dir="prev" onClick={gotoPrev} />
                  <LightboxArrow dir="next" onClick={gotoNext} />
                </>
              )}

              <img
                src={buildUrl((imagesSlide.length ? imagesSlide : fallbackSlide)[lightboxIndex])}
                alt={`Zoom ${lightboxIndex}`}
                className="max-w-[95vw] max-h-[90vh] object-contain select-none"
                draggable={false}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
