import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { FaRegHeart } from "react-icons/fa";
import Header from "../../Components/header-extra";
import { motion } from "framer-motion";
import axios from "axios";
import { useParams, useNavigate } from "react-router-dom";
import DownloadPopup from "../../Components/dowloadPopup";
import CollectionPopup from "../../Components/CollectionPopup";
import { COUNTER_EVENT_DIRTY } from "../../utils/counterBus";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const ASSET_BASE = import.meta.env.VITE_ASSET_BASE_URL || API;

// ===== Helpers =====
const buildUrl = (path) => {
  if (!path) return "/product1-1.jpg";
  if (/^https?:\/\//i.test(path)) return path;
  return `${ASSET_BASE}/${String(path).replace(/^\/+/, "")}`;
};
const getId = (obj) => String(obj?._id ?? obj?.id ?? obj?.productId ?? "");
const toId = (x) => {
  if (!x) return null;
  if (typeof x === "string") return x;
  return String(x.productId || x._id || x.id || "");
};
function readToken() {
  try {
    const raw = localStorage.getItem("token");
    if (!raw) return null;
    const may = JSON.parse(raw);
    return typeof may === "string" ? may : (may?.token ?? raw);
  } catch {
    return localStorage.getItem("token");
  }
}

const isAbsUrl = (u) => /^https?:\/\//i.test(String(u || ""));
const startBrowserDownload = (href) => {
  try {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = href;
    document.body.appendChild(iframe);
    setTimeout(() => {
      try { document.body.removeChild(iframe); } catch {}
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

const ProductDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  // ====== Smart link open (giữ nguyên desktop behavior) ======
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
    onClick: (e) => { if (stop) e.stopPropagation(); openSmart(e, href); },
    onAuxClick: (e) => { if (stop) e.stopPropagation(); openSmart(e, href); },
    onKeyDown: (e) => { if (e.key === "Enter") { if (stop) e.stopPropagation(); openSmart(e, href); } },
    role: "link",
    tabIndex: 0,
  });

  // Header & scroll
  const [hasMounted, setHasMounted] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const [isScrollingUp, setIsScrollingUp] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const lastScrollY = useRef(0);

  // Data
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [product, setProduct] = useState(null);

  // Similar grid
  const [similar, setSimilar] = useState([]);
  const [visibleCount, setVisibleCount] = useState(8);
  const visibleProducts = useMemo(() => similar.slice(0, visibleCount), [similar, visibleCount]);

  // Favorites
  const [favoriteIds, setFavoriteIds] = useState(new Set());

  // Overlay preview (tắt ở mobile/touch)
  const [overlaySrc, setOverlaySrc] = useState(null);
  const [overlayPos, setOverlayPos] = useState({ top: 0, left: 0 });
  const isTouchRef = useRef(false);
  useEffect(() => {
    // phát hiện thiết bị touch để không hiển thị overlay hover ở mobile/ipad
    isTouchRef.current = window.matchMedia("(pointer: coarse)").matches;
  }, []);

  // Popups & cart/download
  const [selectedProductDowload, setSelectedProductDowload] = useState([]);
  const [isPopupOpenDowload, setIsPopupOpenDowload] = useState(false);
  const handleRemoveProductFromDownload = (productId) =>
    setSelectedProductDowload((prev) => prev.filter((item) => item.id !== productId));

  const [selectedProduct1, setSelectedProduct1] = useState(null);
  const [isPopupOpen, setIsPopupOpen] = useState(false);

  // Current product status
  const [status, setStatus] = useState({ purchased: false, inCollections: [], inCart: false });

  // ===== Mount delay =====
  useEffect(() => {
    const t = setTimeout(() => setHasMounted(true), 100);
    return () => clearTimeout(t);
  }, []);

  // ===== Scroll header logic =====
  useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY;
      setShowScrollTop(y > 100);
      if (y < 50) {
        setShowHeader(true);
        setIsScrollingUp(false);
      } else if (y > lastScrollY.current) {
        setShowHeader(false);
        setIsScrollingUp(false);
      } else if (y < lastScrollY.current) {
        setShowHeader(true);
        setIsScrollingUp(true);
      }
      lastScrollY.current = y;
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // ===== Fetch favorites once =====
  useEffect(() => {
    const fetchFavoriteProducts = async () => {
      try {
        const token = readToken();
        if (!token) {
          setFavoriteIds(new Set());
          return;
        }
        const { data } = await axios.get(`${API}/api/product-detail/favorites`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const ids = new Set(
          (Array.isArray(data) ? data : []).map(toId).filter(Boolean).map(String)
        );
        setFavoriteIds(ids);
      } catch (e) {
        console.error("Fetch favorites error:", e);
        setFavoriteIds(new Set());
      }
    };
    fetchFavoriteProducts();
  }, []);

  // ===== Load product + similar =====
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!id) {
        setErr("Missing product id");
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr("");
      try {
        const token = readToken();
        const { data } = await axios.get(`${API}/api/product-detail/products/${id}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!mounted) return;

        const prod = data?.product || null;
        setProduct(prod);

        const simsRaw = Array.isArray(data?.similar) ? data.similar : [];
        const sims = simsRaw.map((s, idx) => ({
          id: getId(s) || String(idx),
          name: s.name || "",
          price: s.price || 0,
          image: s.image || s.images?.[0]?.url || "/product1-1.jpg",
          liked: false,
          owned: false,
        }));
        setSimilar(sims);
      } catch (e) {
        console.error(e);
        if (!mounted) return;
        setErr(e?.response?.data?.message || "Load product failed");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  // ===== Clear overlay khi đổi id =====
  useEffect(() => {
    setOverlaySrc(null);
  }, [id]);

  // ===== Owned & favorites mapping =====
  const computeStatuses = useCallback(async () => {
    try {
      const token = readToken();
      const currentId = getId(product) || String(id);
      const inCollections = favoriteIds.has(currentId) ? ["favorites"] : [];

      let purchased = false;
      if (token && (product || similar.length)) {
        const ids = [currentId, ...similar.map((x) => String(x.id))].filter(Boolean);
        if (ids.length) {
          const ownRes = await axios.post(
            `${API}/api/products/owned`,
            { ids },
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const ownedSet = new Set((ownRes.data?.ownedIds || []).map(String));
          purchased = ownedSet.has(currentId);

          setSimilar((prev) =>
            prev.map((it) => ({
              ...it,
              owned: ownedSet.has(String(it.id)),
              liked: favoriteIds.has(String(it.id)),
            }))
          );
        } else {
          setSimilar((prev) => prev.map((it) => ({ ...it, liked: favoriteIds.has(String(it.id)) })));
        }
      } else {
        setSimilar((prev) => prev.map((it) => ({ ...it, liked: favoriteIds.has(String(it.id)) })));
      }

      setStatus((prev) => ({ ...prev, purchased, inCollections }));
    } catch (e) {
      setSimilar((prev) => prev.map((it) => ({ ...it, liked: favoriteIds.has(String(it.id)) })));
    }
  }, [product, similar.length, favoriteIds, id]);

  useEffect(() => {
    if (!product && !similar.length) return;
    computeStatuses();
  }, [product, similar.length, favoriteIds, computeStatuses]);

  // ===== Add to cart =====
  const pushToDownloadPopup = useCallback((item) => {
    setIsPopupOpenDowload(true);
    setSelectedProductDowload((prev) => {
      const exists = prev.some((x) => x.id === item.id);
      return exists ? prev : [...prev, item];
    });
  }, []);

  const handleAddToCart = useCallback(
    async (e, productItem) => {
      e.stopPropagation();
      try {
        const token = readToken();
        if (!token) {
          alert("Vui lòng đăng nhập để thêm vào giỏ hàng.");
          return;
        }
        const headers = { Authorization: `Bearer ${token}` };

        // 1) Check owned
        try {
          const ownRes = await axios.post(
            `${API}/api/products/owned`,
            { ids: [String(productItem.id)] },
            { headers }
          );
          const ownedIds = (ownRes.data?.ownedIds || []).map(String);
          const isOwned = ownedIds.includes(String(productItem.id));
          if (isOwned) {
            pushToDownloadPopup(productItem);
            return;
          }
        } catch {
          // ignore
        }

        // 2) Add to cart
        const res = await axios.post(
          `${API}/api/cart/add`,
          { productId: productItem.id, quantity: 1 },
          { headers }
        );
        if (res.data?.ok) {
          pushToDownloadPopup(productItem);

          window.dispatchEvent(new Event(COUNTER_EVENT_DIRTY));
          try {
            const bc = new BroadcastChannel("user:counters");
            bc.postMessage({ type: "dirty" });
            bc.close();
          } catch {}
        } else if (res.data?.alreadyPurchased) {
          alert("Bạn đã mua sản phẩm này rồi.");
          pushToDownloadPopup(productItem);
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
    [pushToDownloadPopup]
  );

  // ===== Collections =====
  const removeFromCollections = useCallback(async (productId) => {
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
      setFavoriteIds((prev) => {
        const next = new Set([...prev]);
        next.delete(pid);
        return next;
      });

      const currentId = getId(product) || String(id);
      if (pid === currentId) {
        setStatus((prev) => ({ ...prev, inCollections: [] }));
      }

      setSimilar((prev) => prev.map((it) => (String(it.id) === pid ? { ...it, liked: false } : it)));

      try { window.dispatchEvent(new Event(COUNTER_EVENT_DIRTY)); } catch {}
      try { const bc = new BroadcastChannel("user:counters"); bc.postMessage({ type: "dirty" }); bc.close(); } catch {}
    } catch (err) {
      console.error(err);
      alert(err?.message || err?.response?.data?.message || "Có lỗi khi gỡ khỏi bộ sưu tập");
    }
  }, [product, id]);

  // ===== Download cả image + file =====
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

      urls.forEach((href, idx) => {
        setTimeout(() => startBrowserDownload(href), idx * 400);
      });
    } catch (e) {
      alert(e?.response?.data?.message || e.message || "Không tải được tệp");
    }
  }, []);

  // ===== Refresh owned sau khi đóng popup =====
  const refreshOwnedFlags = useCallback(async () => {
    try {
      const token = readToken();
      if (!token) return;
      const currentId = getId(product) || String(id);
      const ids = [currentId, ...similar.map((x) => String(x.id))].filter(Boolean);
      if (!ids.length) return;
      const ownRes = await axios.post(
        `${API}/api/products/owned`,
        { ids },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const ownedSet = new Set((ownRes.data?.ownedIds || []).map(String));

      setStatus((prev) => ({ ...prev, purchased: ownedSet.has(currentId) }));
      setSimilar((prev) => prev.map((it) => ({ ...it, owned: ownedSet.has(String(it.id)) })));
    } catch (e) { /* ignore */ }
  }, [product, similar, id]);

  const handleQuickCheckoutFromCollection = (items) => {
    setSelectedProductDowload(items);
    setIsPopupOpen(false);
    setIsPopupOpenDowload(true);
  };

  const handleFavoritesAdded = useCallback(
    (added, favoritesTotal) => {
      const ids = new Set(Array.isArray(added) ? added.map(String) : [String(added)]);
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        ids.forEach((x) => next.add(x));
        try { window.dispatchEvent(new Event(COUNTER_EVENT_DIRTY)); } catch {}
        try { const bc = new BroadcastChannel("user:counters"); bc.postMessage({ type: "dirty", favorites: typeof favoritesTotal === "number" ? favoritesTotal : next.size }); bc.close(); } catch {}
        return next;
      });

      const currentId = getId(product) || String(id);
      if (ids.has(currentId)) {
        setStatus((prev) => ({
          ...prev,
          inCollections: prev.inCollections?.length ? prev.inCollections : ["favorites"],
        }));
      }

      setSimilar((prev) =>
        prev.map((it) => (ids.has(String(it.id)) ? { ...it, liked: true } : it))
      );

      setIsPopupOpen(false);
    },
    [product, id]
  );

  const handleOwnedChange = useCallback(
    (ownedIds) => {
      const setIds = new Set(Array.isArray(ownedIds) ? ownedIds.map(String) : [String(ownedIds)]);
      const currentId = getId(product) || String(id);
      if (setIds.has(currentId)) {
        setStatus((prev) => ({ ...prev, purchased: true }));
      }
      setSimilar((prev) => prev.map((it) => (setIds.has(String(it.id)) ? { ...it, owned: true } : it)));
    },
    [product, id]
  );

  useEffect(() => {
    document.title = product?.name ? `${product.name} | 3dsmood` : "Sản phẩm | 3dsmood";
  }, [product?.name]);

  // ===== Render guards =====
  if (loading) {
    return (
      <div className="bg-black text-white w-screen min-h-screen p-4 sm:p-6 md:p-8 lg:p-12 xl:p-32 font-sans xl:w-[1366px] 3xl:w-[1920px] mx-auto">
        <Header hasMounted={hasMounted} showHeader={showHeader} isScrollingUp={isScrollingUp} />
        <div className="animate-pulse text-[#a1a1a1]">Đang tải dữ liệu sản phẩm…</div>
      </div>
    );
  }
  if (err || !product) {
    return (
      <div className="bg-black text-white w-screen min-h-screen p-4 sm:p-6 md:p-8 lg:p-12 xl:p-32 font-sans xl:w-[1366px] 2xl:w-[1920px] mx-auto">
        <Header hasMounted={hasMounted} showHeader={showHeader} isScrollingUp={isScrollingUp} />
        <div className="text-red-400">Lỗi: {err || "Không tìm thấy sản phẩm."}</div>
      </div>
    );
  }

  const currentId = getId(product);
  const currentItem = {
    id: currentId,
    name: product.name,
    price: product.price || 0,
    image: product.image || product.images?.[0]?.url || "/product1-1.jpg",
  };
  const bytesToMB = (b) => {
    if (!b || isNaN(b)) return "–";
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="bg-black text-white w-screen min-h-screen p-4 sm:p-6 md:p-8 lg:p-12 xl:p-32 font-sans xl:w-[1366px] 2xl:w-[1720px] mx-auto">
      <Header hasMounted={hasMounted} showHeader={showHeader} isScrollingUp={isScrollingUp} />

      {/* Breadcrumb */}
      <div className="text-xs sm:text-sm text-gray-300 mb-3 sm:mb-4 font-codec">
        <span className="bg-[#282828] px-2 py-1 sm:px-3 sm:py-1 rounded inline-block">
          <span className=" text-[#a1a1a1]">Categories</span>
          {(product?.categories || []).map((c, i) => (
            <span key={c?.id || i} className="text-[#a1a1a1]">
              {i === 0 ? " " : " / "}
              {c?.name}
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

      <div className="flex flex-col lg:flex-row gap-3 sm:gap-4 border border-[#2b2b2b] rounded-xl p-3 sm:p-4 h-auto">
        {/* Image */}
        <div className="flex-1 rounded-2xl overflow-hidden">
          {/* Mobile/iPad giữ tỉ lệ ảnh đẹp: ưu tiên vuông trên mobile */}
          <div className="w-full aspect-square sm:aspect-[4/3] lg:aspect-auto">
            <img
              src={buildUrl(product.image)}
              alt={product.name || "Product image"}
              className="w-full h-full object-cover rounded-2xl"
            />
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 flex flex-col gap-3 sm:gap-4 rounded shadow">
          <div className="text-white rounded-md shadow font-codec flex flex-col gap-3 sm:gap-4">
            <div className="flex items-center justify-between border border-[#2b2b2b] rounded py-2 bg-[#1e1e1e]">
              <div className="flex items-center justify-between px-3 w-full max-w-full overflow-hidden ">
                <p className="text-white text-base sm:text-lg xl:text-[1rem] 2xl:text-[1.2rem] font-codec truncate whitespace-nowrap overflow-hidden text-ellipsis flex-1">
                  {product.name}
                </p>
                <div className="flex items-center gap-1 text-white text-xs whitespace-nowrap ">
                  {product.price === 0 ? (
                    <span className="text-green-400 text-base sm:text-lg xl:text-[1rem] 2xl:text-[1.2rem]">Free</span>
                  ) : (
                    <span className="text-lg sm:text-xl xl:text-[1.2rem] 2xl:text-[1.4rem]">{product.price}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Info Grid */}
            <div className="text-sm divide-y divide-[#2a2a2a] border border-[#2a2a2a] bg-[#1e1e1e] rounded overflow-hidden flex-grow 2xl:min-h-[572px]">
              <div className="flex justify-between px-3 py-3.5">
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base xl:text-[1rem] 2xl:text-[1.2rem]">ID :</span>
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base">{product.code || currentId}</span>
              </div>
              <div className="flex justify-between px-3 py-3.5">
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base">Size:</span>
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base">
                  {product.sizeMB != null ? bytesToMB(product?.sizeMB) : "–"}
                </span>
              </div>
              <div className="flex justify-between px-3 py-3.5">
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base">Style:</span>
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base">
                  {Array.isArray(product.styles) && product.styles.length ? product.styles.join(", ") : "–"}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-3.5">
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base">Form:</span>
                <div className="flex gap-3">
                  {(product.form || []).slice(0, 2).map((f, i) => (
                    <div key={f?.id || i} className="w-7 h-7 sm:w-8 sm:h-8 overflow-hidden">
                      {f?.image ? (
                        <img src={f.image} alt={f.name || "form"} className="w-full h-full object-cover" />
                      ) : null}
                    </div>
                  ))}
                  {!product.form?.length && <div className="text-[#9e9e9e]">–</div>}
                </div>
              </div>
              <div className="flex justify-between px-3 py-3">
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base">Material:</span>
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base">
                  {Array.isArray(product.materials) && product.materials.length ? product.materials.join(", ") : "–"}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-3.5">
                <span className="text-[#9e9e9e] font-codec text-sm sm:text-base">Color:</span>
                <div className="flex gap-2 sm:gap-3">
                  {(product.colors || []).map((hex, i) => (
                    <div
                      key={`${hex}-${i}`}
                      className="w-5 h-5 sm:w-6 sm:h-6 rounded-full border border-white"
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                  {!product.colors?.length && <div className="text-[#9e9e9e]">–</div>}
                </div>
              </div>
              <div className="px-3 py-3 sm:py-4">
                <div className="text-gray-400 text-sm sm:text-base">Description:</div>
                <span className="text-[#9e9e9e] text-xs sm:text-sm block max-h-40 overflow-y-auto pr-2">
                  {product.description?.trim() ? product.description : ""}
                </span>
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-2">
            {status.purchased ? (
              <button
                className="relative flex items-center justify-center gap-2 bg-[#7a9739] text-white/80 font-codec rounded w-full py-2 transition text-sm sm:text-base"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDirectDownloadBoth(currentId);
                }}
              >
                <img src="/Download.svg" alt="Download Icon" className="w-5 h-5 sm:w-6 sm:h-6 scale-150 shrink-0" />
                <span className="text-base sm:text-lg">Download</span>
              </button>
            ) : (
              <>
                {product.price === 0 ? (
                  <button
                    className="relative flex items-center justify-center gap-2 bg-[#7a9739] hover:bg-[#6a8f36] text-white/80 font-codec rounded w-full py-2 transition text-sm sm:text-base"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDirectDownloadBoth(currentId);
                    }}
                  >
                    <img src="/Download.svg" alt="Download Icon" className="w-5 h-5 sm:w-6 sm:h-6 scale-150 shrink-0" />
                    <span className="text-base sm:text-lg">Download</span>
                  </button>
                ) : (
                  <button
                    className={`relative flex items-center justify-center gap-2 ${
                      status.purchased ? "bg-[#7a9739] hover:bg-[#6a8f36]" : "bg-[#8f120d]"
                    } text-white/80 font-codec rounded w-full py-2 transition text-sm sm:text-base`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddToCart(e, currentItem);
                    }}
                  >
                    <img src="/Download.svg" alt="Download Icon" className="w-5 h-5 sm:w-6 sm:h-6 scale-150 shrink-0" />
                    <span className="text-base sm:text-lg">Download</span>
                  </button>
                )}
              </>
            )}
            {status.inCollections?.length ? (
              <button
                className="bg-[#8f120d] text-white w-12 h-12 sm:w-14 sm:h-14 flex justify-center items-center rounded transition"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFromCollections(currentId);
                }}
                title={status.inCollections?.length ? "Trong bộ sưu tập" : "Thêm vào bộ sưu tập"}
              >
                <FaRegHeart className="w-5 h-5 sm:w-6 sm:h-6 scale-[1.5]" />
              </button>
            ) : (
              <button
                className="bg-transparent text-white w-12 h-12 sm:w-14 sm:h-14 flex justify-center items-center rounded transition border border-[#2D2D2D]"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedProduct1(currentItem);
                  setIsPopupOpen(true);
                }}
                title={status.inCollections?.length ? "Trong bộ sưu tập" : "Thêm vào bộ sưu tập"}
              >
                <FaRegHeart className="w-5 h-5 sm:w-6 sm:h-6 scale-[1.5]" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Similar */}
      <section className="text-white pt-10 pb-16 sm:py-16 mx-auto w-full">
        <h2 className="text-white text-xl sm:text-2xl md:text-3xl font-codec mb-6 sm:mb-10">SIMILAR MODELS</h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-2 sm:gap-x-3 md:gap-x-4">
          {visibleProducts.map((model, index) => {
            const href = `/product-detail/${model.id}`;
            return (
              <motion.div
                key={model.id || index}
                className="relative group px-1 py-0.5 rounded-xl hover:shadow-lg transition h-full w-full mx-auto"
                onMouseEnter={(e) => {
                  if (isTouchRef.current) return; // không hiển thị overlay trên thiết bị touch (điện thoại/iPad)
                  const rect = e.currentTarget.getBoundingClientRect();
                  const W = window.innerWidth, H = window.innerHeight;
                  const previewW = 500, previewH = 500;
                  let left = rect.right, top = rect.top;
                  if (rect.right + previewW > W) left = rect.left - previewW;
                  if (rect.top + previewH > H) top = H - previewH;
                  left = Math.max(8, Math.min(left, W - previewW - 8));
                  top = Math.max(8, Math.min(top, H - previewH - 8));
                  setOverlaySrc(buildUrl(model.image));
                  setOverlayPos({ top, left });
                }}
                onMouseLeave={() => setOverlaySrc(null)}
                {...linkHandlers(href)}
              >
                {/* Top-right badges */}
                <div className="absolute top-2 right-2 z-10 flex gap-2">
                  {model.owned && (
                    <span
                      className="bg-[#8AA062] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-7 h-7 sm:w-8 sm:h-8 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        pushToDownloadPopup({
                          id: model.id,
                          name: model.name,
                          price: model.price || 0,
                          image: model.image,
                        });
                      }}
                      title="Đã mua"
                    >
                      <img src="/Download.svg" alt="Owned" className="w-7 h-7 sm:w-8 sm:h-8 object-contain" />
                    </span>
                  )}
                  {model.liked && (
                    <button className="bg-[#8f120d] text-white p-1 rounded-full text-sm" title="Trong bộ sưu tập">
                      <FaRegHeart className="text-white text-base sm:text-lg" />
                    </button>
                  )}
                </div>

                {Number(model.price) === 0 && (
                  <div className="absolute top-2 left-2 z-10">
                    <span className="px-2 py-0.5 rounded-full bg-[#7a9739] text-white text-[10px] font-semibold border border-white/40 shadow">
                      Free
                    </span>
                  </div>
                )}

                {/* Hover actions (ẩn bớt ở mobile) */}
                <div className="hidden sm:flex absolute top-3/4 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  {model.owned ? (
                    <span
                      className="bg-[#8AA062] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-8 h-8 cursor-pointer hover:animate-shake"
                      title="Đã mua – mở tải"
                      onClick={(e) => {
                        e.stopPropagation();
                        pushToDownloadPopup({
                          id: model.id,
                          name: model.name,
                          price: model.price || 0,
                          image: model.image,
                        });
                      }}
                    >
                      <img src="/Download.svg" alt="Owned" className="w-8 h-8 object-contain" />
                    </span>
                  ) : (
                    <span
                      className="bg-black/80 border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-8 h-8 cursor-pointer hover:animate-shake"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddToCart(e, {
                          id: model.id,
                          name: model.name,
                          price: model.price || 0,
                          image: model.image,
                        });
                      }}
                    >
                      <img src="/giohang.svg" alt="Cart" className="w-8 h-8 object-contain" />
                    </span>
                  )}

                  {model.liked ? (
                    <span
                      className="bg-[#8f120d] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-8 h-8 cursor-pointer hover:animate-shake"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromCollections(model.id);
                      }}
                      title="Trong bộ sưu tập"
                    >
                      <FaRegHeart className="text-white text-lg" />
                    </span>
                  ) : (
                    <span
                      className="bg-black/80 border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-8 h-8 cursor-pointer hover:animate-shake"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedProduct1({
                          id: model.id,
                          name: model.name,
                          price: model.price || 0,
                          image: model.image,
                        });
                        setIsPopupOpen(true);
                      }}
                      title="Thêm vào bộ sưu tập"
                    >
                      <FaRegHeart className="text-white text-lg" />
                    </span>
                  )}
                </div>

                <div className="relative overflow-hidden rounded-lg group aspect-square">
                  <img
                    src={buildUrl(model.image)}
                    alt={model.name}
                    className="w-full h-full object-cover rounded-lg cursor-pointer group-hover:scale-110 transition-transform duration-300 ease-in-out"
                  />
                </div>

                <div className="mt-2 mb-1 flex items-center justify-between bg-[#282828] px-2 sm:px-3 py-1 rounded w-full max-w-full overflow-hidden">
                  <p className="text-white text-xs sm:text-sm font-codec truncate min-w-[120px] sm:min-w-[200px] sm:max-w-[220px]">
                    {model.name}
                  </p>
                </div>
              </motion.div>
            );
          })}

          {visibleCount < similar.length && (
            <div className="col-span-full flex justify-center mt-4 sm:mt-6">
              <button
                onClick={() => setVisibleCount((prev) => prev + 8)}
                className="border border-white text-white my-4 sm:my-6 py-2 px-5 sm:px-6 rounded-md hover:scale-105 transition font-semibold font-codec bg-white/10 backdrop-blur-[1px]"
              >
                XEM THÊM
              </button>
            </div>
          )}

          {overlaySrc && !isTouchRef.current && (
            <div className="fixed z-40 pointer-events-none" style={{ top: overlayPos.top, left: overlayPos.left }}>
              <img
                src={overlaySrc}
                alt="Preview"
                className="max-w-[500px] max-h-[500px] object-contain border border-white rounded shadow-lg"
              />
            </div>
          )}
        </div>
      </section>

      {/* Popups */}
      {isPopupOpenDowload && selectedProductDowload && (
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
      {isPopupOpen && selectedProduct1 && (
        <CollectionPopup
          isOpen={isPopupOpen}
          onClose={() => setIsPopupOpen(false)}
          selectedProduct={selectedProduct1}
          onQuickCheckout={handleQuickCheckoutFromCollection}
          onAddedToFavorites={handleFavoritesAdded}
        />
      )}
    </div>
  );
};

export default ProductDetail;