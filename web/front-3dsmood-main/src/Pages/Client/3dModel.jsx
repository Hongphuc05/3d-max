import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { FaSearch, FaRegHeart, FaArrowUp, FaFacebookMessenger, FaTimes, FaFilter } from "react-icons/fa";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import DownloadPopup from "../../Components/dowloadPopup";
import CollectionPopup from "../../Components/CollectionPopup";
import Header from "../../Components/header-extra";
import axios from "axios";
import { COUNTER_EVENT_DIRTY } from "../../utils/counterBus";
import { decodeHtml } from "../../utils/html";

export default function ModelGallery() {
  // --- STATE CẤU TRÚC/ĐIỀU HƯỚNG ---
  const navigate = useNavigate();
  const location = useLocation();
  const lastScrollY = useRef(0);
  const topAnchorRef = useRef(null);

  const [hasMounted, setHasMounted] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const [isScrollingUp, setIsScrollingUp] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // --- TREE CATEGORY (sidebar) ---
  const [tree, setTree] = useState(null);
  const [loadingTree, setLoadingTree] = useState(true);
  const [errorTree, setErrorTree] = useState(null);
  const [openCategory, setOpenCategory] = useState(null);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState([]);

  // --- FILTER SOURCES (style/color/form/material) ---
  const [styles, setStyles] = useState([]);
  const [selectedStyleIds, setSelectedStyleIds] = useState([]);

  const [colors, setColors] = useState([]);
  const [selectedColorCodes, setSelectedColorCodes] = useState([]);

  const [formOptions, setFormOptions] = useState([]);
  const [selectedFormIds, setSelectedFormIds] = useState([]);

  const [materials, setMaterials] = useState([]);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState([]);

  // --- SẢN PHẨM + PHÂN TRANG ---
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / itemsPerPage));

  // NEW: yêu thích & đã mua
  const [favoriteIdSet, setFavoriteIdSet] = useState(() => new Set());
  const [ownedIdSet, setOwnedIdSet] = useState(() => new Set());

  // --- LỌC/SEARCH/SORT ---
  const [activeFilter, setActiveFilter] = useState(null); // 'free' | 'pro' | null
  const [sortOpen, setSortOpen] = useState(false);
  const [selectedSort, setSelectedSort] = useState("Mặc định");
  const [showSearch, setShowSearch] = useState(false);
  const [searchQueryRaw, setSearchQueryRaw] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // --- PREVIEW + POPUPS ---
  const [previewImage, setPreviewImage] = useState(null);
  const [previewPosition, setPreviewPosition] = useState({ top: 0, left: 0 });

  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [selectedProduct1, setSelectedProduct1] = useState(null);

  const [isPopupOpenDowload, setIsPopupOpenDowload] = useState(false);
  const [selectedProductDowload, setSelectedProductDowload] = useState([]);

  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
  const ASSET_BASE = import.meta.env.VITE_ASSET_BASE_URL || API;

  const buildUrl = (path) => {
    if (!path) return "/product1-1.jpg";
    if (/^https?:\/\//i.test(path)) return path;
    return `${ASSET_BASE}/${String(path).replace(/^\/+/, "")}`;
  };

  // === Open in same tab or new tab (middle / Ctrl / Cmd) ===
  const openSmart = useCallback(
    (e, href) => {
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
        // Mang theo URL hiện tại (có ?page, ?q, filter...) – không ảnh hưởng back của trình duyệt
        navigate(href, { state: { from: location } });
      }
    },
    [navigate, location]
  );

  // Tạo bộ handler điều hướng
  const linkHandlers = useCallback(
    (href, beforeNav) => ({
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
    }),
    [openSmart]
  );

  // ------------------ INIT & FETCH SOURCES ------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingTree(true);
        const r = await fetch(`${API}/api/categories/tree/3dmodel`);
        if (!r.ok) throw new Error("Fetch category tree failed");
        const data = await r.json();
        if (!cancelled) setTree(data);
      } catch (e) {
        if (!cancelled) setErrorTree(e.message || "Error");
      } finally {
        if (!cancelled) setLoadingTree(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    axios
      .get(`${API}/api/styles`)
      .then((res) => setStyles(res.data || []))
      .catch((err) => console.error("Lỗi lấy styles:", err));
  }, []);
  useEffect(() => {
    fetch(`${API}/api/colors`)
      .then((r) => r.json())
      .then((data) => setColors(data || []))
      .catch((err) => console.error("Lỗi lấy colors:", err));
  }, []);
  useEffect(() => {
    fetch(`${API}/api/forms`)
      .then((r) => r.json())
      .then((data) => setFormOptions(data || []))
      .catch((err) => console.error("Lỗi lấy forms:", err));
  }, []);
  useEffect(() => {
    axios
      .get(`${API}/api/materials`)
      .then((res) => setMaterials(res.data || []))
      .catch((err) => console.error("Lỗi lấy materials:", err));
  }, []);

  // ===== Index helpers =====
  const categoryIndex = useMemo(() => {
    const m = new Map();
    (tree?.children ?? []).forEach((group) => {
      (group.children ?? []).forEach((child) => {
        m.set(child._id, { name: child.name, path: `${group.name} / ${child.name}` });
      });
    });
    return m;
  }, [tree]);

  const styleIndex = useMemo(() => new Map(styles.map((s) => [s._id, s.name])), [styles]);
  const materialIndex = useMemo(() => new Map(materials.map((m) => [m._id, m.name])), [materials]);
  const formIndex = useMemo(() => new Map(formOptions.map((f) => [f._id, f.name])), [formOptions]);
  const colorIndex = useMemo(
    () => new Map(colors.map((c) => [c.code, { name: c.name, code: c.code }])),
    [colors]
  );

  // ------------------ UI MOUNT & SCROLL ------------------
  useEffect(() => {
    const t = setTimeout(() => setHasMounted(true), 100);
    return () => clearTimeout(t);
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

  // ------------------ helper đồng bộ URL query ------------------
  // Ổn định: không phụ thuộc location.search để tránh đổi tham chiếu khi URL đổi
  const updateSearchParam = useCallback(
    (patch) => {
      const params = new URLSearchParams(window.location.search);
      Object.entries(patch).forEach(([k, v]) => {
        if (v === undefined || v === null || v === "") {
          params.delete(k);
        } else {
          params.set(k, String(v));
        }
      });
      navigate({ search: `?${params.toString()}` }, { replace: false }); // push
    },
    [navigate]
  );

  // ------------------ HANDLERS (SIDEBAR) ------------------
  const toggleCategory = (index) => setOpenCategory(openCategory === index ? null : index);

  const resetToFirstPage = useCallback(() => {
    updateSearchParam({ page: 1 });
    setCurrentPage(1);
  }, [updateSearchParam]);

  const toggleCategoryChild = (id) => {
    setSelectedCategoryIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    resetToFirstPage();
  };
  const toggleStyle = (id) => {
    setSelectedStyleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    resetToFirstPage();
  };
  const toggleColor = (code) => {
    setSelectedColorCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
    resetToFirstPage();
  };
  const toggleForm = (id) => {
    setSelectedFormIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    resetToFirstPage();
  };
  const toggleMaterial = (id) => {
    setSelectedMaterialIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    resetToFirstPage();
  };

  const toggleSortDropdown = () => setSortOpen((s) => !s);
  const handleSortSelect = (label) => {
    setSelectedSort(label);
    resetToFirstPage();
  };

  const handlePriceFilter = (type) => {
    setActiveFilter((prev) => (prev === type ? null : type));
    resetToFirstPage();
  };

  const handleRemoveProductFromDownload = (productId) =>
    setSelectedProductDowload((prev) => prev.filter((item) => item.id !== productId));

  // ------------------ ĐỔI TRANG: chỉ đổi URL, không set state trực tiếp ------------------
  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages) {
      updateSearchParam({ page });
      requestAnimationFrame(() => {
        if (topAnchorRef.current) {
          topAnchorRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      });
    }
  };

  // ------------------ SEARCH DEBOUNCE ------------------
  // Chỉ cập nhật URL khi q thực sự đổi; tránh reset page về 1 khi Back
  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = searchQueryRaw.trim();
      const urlParams = new URLSearchParams(window.location.search);
      const currentQOnURL = urlParams.get("q") || "";

      setSearchQuery(trimmed);

      if (trimmed !== currentQOnURL) {
        updateSearchParam({ page: 1, q: trimmed || undefined });
        setCurrentPage(1);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [searchQueryRaw]); // không phụ thuộc updateSearchParam

  // ------------------ BUILD QUERY PARAMS ------------------
  const sortParam = useMemo(() => {
    switch (selectedSort) {
      case "Mới nhất":
        return "newest";
      case "Cũ nhất":
        return "oldest";
      case "Nhiều lượt mua":
        return "most_purchased";
      case "Nhiều lượt xem":
        return "most_viewed";
      default:
        return "default";
    }
  }, [selectedSort]);

  const selectedColorIds = useMemo(() => {
    if (!colors?.length || !selectedColorCodes.length) return [];
    const map = new Map(colors.map((c) => [c.code, c._id]));
    return selectedColorCodes.map((code) => map.get(code)).filter(Boolean);
  }, [colors, selectedColorCodes]);

  // ===== Build danh sách chips =====
  const activeChips = useMemo(() => {
    const arr = [];

    selectedCategoryIds.forEach((id) => {
      const info = categoryIndex.get(id);
      if (info) {
        arr.push({ key: `cat-${id}`, label: info.path, onRemove: () => toggleCategoryChild(id) });
      }
    });

    selectedStyleIds.forEach((id) => {
      const name = styleIndex.get(id) || "Style";
      arr.push({ key: `style-${id}`, label: `Style: ${name}`, onRemove: () => toggleStyle(id) });
    });

    selectedMaterialIds.forEach((id) => {
      const name = materialIndex.get(id) || "Material";
      arr.push({ key: `mat-${id}`, label: `Material: ${name}`, onRemove: () => toggleMaterial(id) });
    });

    selectedFormIds.forEach((id) => {
      const name = formIndex.get(id) || "Form";
      arr.push({ key: `form-${id}`, label: `Form: ${name}`, onRemove: () => toggleForm(id) });
    });

    selectedColorCodes.forEach((code) => {
      const info = colorIndex.get(code) || { name: code, code };
      arr.push({ key: `color-${code}`, color: code, label: info.name || code, onRemove: () => toggleColor(code) });
    });

    if (activeFilter) {
      arr.push({
        key: `price-${activeFilter}`,
        label: activeFilter === "free" ? "Price: Free" : "Price: Pro",
        onRemove: () => handlePriceFilter(activeFilter),
      });
    }

    if (searchQuery) {
      arr.push({
        key: "q",
        label: `Tìm: "${searchQuery}"`,
        onRemove: () => {
          setSearchQueryRaw("");
          setSearchQuery("");
          updateSearchParam({ page: 1, q: undefined });
          setCurrentPage(1);
        },
      });
    }

    return arr;
  }, [
    selectedCategoryIds,
    selectedStyleIds,
    selectedMaterialIds,
    selectedFormIds,
    selectedColorCodes,
    activeFilter,
    searchQuery,
    categoryIndex,
    styleIndex,
    materialIndex,
    formIndex,
    colorIndex,
  ]);

  // ------------------ FETCH PRODUCTS ------------------
  const fetchProducts = useCallback(async () => {
    try {
      setProductsLoading(true);
      setProductsError(null);

      const params = {
        page: currentPage,
        limit: itemsPerPage,
        q: searchQuery || undefined,
        sort: sortParam,
        priceType: activeFilter || undefined,
        categoryIds: selectedCategoryIds.length ? selectedCategoryIds.join(",") : undefined,
        styleIds: selectedStyleIds.length ? selectedStyleIds.join(",") : undefined,
        colorIds: selectedColorIds.length ? selectedColorIds.join(",") : undefined,
        formIds: selectedFormIds.length ? selectedFormIds.join(",") : undefined,
        materialIds: selectedMaterialIds.length ? selectedMaterialIds.join(",") : undefined,
      };

      const res = await axios.get(`${API}/api/products`, { params });

      const items = res.data?.items ?? res.data?.data ?? [];
      const totalCount = res.data?.total ?? 0;

      const mapped = items.map((p) => ({
        id: p._id,
        name: p.name,
        price: p.price ?? 0,
        image: p.previewImagePath || "/product1-1.jpg",
        liked: false,
      }));

      setProducts(mapped);
      setTotal(Number(totalCount) || 0);
    } catch (err) {
      console.error(err);
      setProductsError("Không thể tải sản phẩm");
      setProducts([]);
      setTotal(0);
    } finally {
      setProductsLoading(false);
    }
  }, [
    currentPage,
    itemsPerPage,
    searchQuery,
    sortParam,
    activeFilter,
    selectedCategoryIds,
    selectedStyleIds,
    selectedColorIds,
    selectedFormIds,
    selectedMaterialIds,
  ]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // ------------------ POPUP: QUICK CHECKOUT ------------------
  const handleQuickCheckoutFromCollection = (items) => {
    setSelectedProductDowload(items);
    setIsPopupOpen(false);
    setIsPopupOpenDowload(true);
  };

  // ------------------ AUTH TOKEN ------------------
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

  // ------------------ CART ------------------
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
          setIsPopupOpenDowload(true);
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
    [API]
  );

  // ------------------ KHÔI PHỤC STATE TỪ URL: q & page ------------------
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const q = params.get("q") || "";
    const p = Math.max(1, parseInt(params.get("page") || "1", 10));

    setShowSearch(!!q);
    setSearchQueryRaw((prev) => (prev !== q ? q : prev));
    setSearchQuery((prev) => (prev !== q ? q : prev));
    setCurrentPage((prev) => (prev !== p ? p : prev));
  }, [location.search]);

  // ------------------ VIEW COUNT ------------------
  const recordView = useCallback(
    (productId) => {
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
    },
    [API]
  );

  // ------------------ FAVORITES ------------------
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
  }, [API]);

  const removeFromCollections = useCallback(
    async (productId) => {
      try {
        const token = readToken();
        if (!token) {
          alert("Vui lòng đăng nhập để thao tác bộ sưu tập.");
          return;
        }
        const headers = { Authorization: `Bearer ${token}` };
        const pid = String(productId);

        // Optimistic
        setFavoriteIdSet((prev) => {
          const next = new Set(prev);
          next.delete(pid);
          return next;
        });

        const res = await axios.post(
          `${API}/api/collections/remove`,
          { productId: pid },
          { headers }
        );

        if (res.data?.ok === false) {
          setFavoriteIdSet((prev) => new Set(prev).add(pid));
          throw new Error(res.data?.message || "Không thể gỡ sản phẩm khỏi bộ sưu tập");
        }

        try {
          window.dispatchEvent(new Event(COUNTER_EVENT_DIRTY));
        } catch {}
        try {
          const bc = new BroadcastChannel("user:counters");
          bc.postMessage({ type: "dirty", favorites: res.data?.favorites });
          bc.close();
        } catch {}
      } catch (err) {
        console.error(err);
        alert(err?.message || err?.response?.data?.message || "Có lỗi khi gỡ khỏi bộ sưu tập");
      }
    },
    [API]
  );

  // ------------------ OWNED ------------------
  const checkOwnedBatch = useCallback(
    async (ids) => {
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
    },
    [API]
  );

  useEffect(() => {
    if (!products?.length) {
      setOwnedIdSet(new Set());
      return;
    }
    const ids = products.map((p) => String(p.id));
    checkOwnedBatch(ids);
  }, [products, checkOwnedBatch]);

  // ------------------ VISIBLE PRODUCTS ------------------
  const visibleProducts = useMemo(
    () =>
      products.map((p) => ({
        ...p,
        liked: favoriteIdSet.has(String(p.id)),
        owned: ownedIdSet.has(String(p.id)),
      })),
    [products, favoriteIdSet, ownedIdSet]
  );

  const handleFavoritesAdded = useCallback((added) => {
    const ids = new Set(Array.isArray(added) ? added.map(String) : [String(added)]);
    setFavoriteIdSet((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      try {
        const bc = new BroadcastChannel("user:counters");
        bc.postMessage({ type: "dirty" });
        bc.close();
      } catch {}
      try { window.dispatchEvent(new Event(COUNTER_EVENT_DIRTY)); } catch {}
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
    const ids = products.map((p) => String(p.id));
    if (ids.length) checkOwnedBatch(ids);
  }, [products, checkOwnedBatch]);

  const [homeBg, setHomeBg] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${API}/api/bg-files`, {
          params: { activeNow: 1, limit: 5, sort: "updatedAt:desc" },
        });
        const list = Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data?.item)
          ? data.item
          : [];
        const best = list?.[0] || null;
        if (!cancelled) setHomeBg(best);
      } catch {
        if (!cancelled) setHomeBg(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [API]);

  const homeBgUrl = useMemo(() => {
    const p = homeBg?.filePath || homeBg?.file?.path;
    if (!p) return null;
    return /^https?:\/\//i.test(p) ? p : `${API}${p.startsWith("/") ? p : `/${p}`}`;
  }, [homeBg, API]);

  const isVideoBg = useMemo(() => (homeBgUrl ? /\.(mp4|webm|ogg)$/i.test(homeBgUrl) : false), [homeBgUrl]);
  const isImageBg = useMemo(
    () => (homeBgUrl ? /\.(png|jpe?g|gif|webp|avif)$/i.test(homeBgUrl) : false),
    [homeBgUrl]
  );

  const BgLayer = () => (
    <>
      {homeBgUrl && isVideoBg && (
        <video
          className="fixed inset-0 w-full h-full object-cover z-0 pointer-events-none"
          src={homeBgUrl}
          autoPlay
          muted
          loop
          playsInline
        />
      )}
      {homeBgUrl && !isVideoBg && isImageBg && (
        <img
          className="fixed inset-0 w-full h-full object-cover z-0 select-none pointer-events-none"
          src={homeBgUrl}
          alt=""
          decoding="async"
        />
      )}
      <div className="absolute inset-0 z-0 bg-black/30 pointer-events-none" />
    </>
  );

  useEffect(() => {
    document.title = "3dmodel | 3dsmood";
  }, []);

  // ------------------ SAFE RETURNS FOR TREE ------------------
  if (errorTree) return <div className="p-4 text-red-400">{errorTree}</div>;
  if (!tree?.root) return <div className="p-4 text-white"></div>;

  // ------------------ RENDER ------------------
  return (
    <div className="xl:w-[1480px] 2xl:w-[1820px] overflow-hidden bg-black mx-auto">
      <BgLayer />

      <div className="h-16">
        <Header hasMounted={hasMounted} showHeader={showHeader} isScrollingUp={isScrollingUp} />
      </div>
      <span ref={topAnchorRef} />

      <div className="m-3 p-4 text-white rounded-md shadow text-sm text-center font-codec" />

      <div className="flex flex-col lg:flex-row text-white min-h-screen bg-[#000000] w-full mx-auto">
        {/* Sidebar */}
        {/* ======= giữ nguyên toàn bộ UI của bạn ======= */}
        <aside className="hidden lg:block w-56 p-4 z-10 overflow-y-auto border border-[#2D2D2D] rounded">
          <h2 className="text-xl mb-4 text-center font-codec px-4 py-1 bg-[#1a1a1a] rounded-md">Categories</h2>

          <ul className="space-y-3">
            {(tree.children ?? []).map((group, index) => (
              <li key={group._id || group.name}>
                <div
                  className="cursor-pointer flex justify-between items-center font-codec"
                  onClick={() => toggleCategory(index)}
                >
                  <span className="flex items-center gap-2 font-codec text-sm">
                    <div className="w-6 h-6 flex items-center justify-center rounded overflow-hidden shrink-0">
                      {group.image ? (
                        <img src={group.image} alt="icon" className="w-[18px] h-[18px] object-contain filter invert" />
                      ) : (
                        <div className="w-[18px] h-[18px] bg-white/10 rounded" />
                      )}
                    </div>
                    <span className="mt-[2px]">{group.name}</span>
                  </span>

                  <div className="w-6 h-6 relative">
                    <img
                      src="/3dmodel/v.svg"
                      alt="Expand"
                      className={`absolute inset-0 w-full h-full scale-150 object-contain pointer-events-none ${
                        openCategory === index ? "rotate-180" : ""
                      }`}
                    />
                  </div>
                </div>

                {openCategory === index && (
                  <ul className="ml-2 mt-2 space-y-2">
                    {(group.children ?? []).map((child) => {
                      const checked = selectedCategoryIds.includes(child._id);
                      return (
                        <li key={child._id || child.name} className="flex items-center space-x-2 font-codec">
                          <input
                            type="checkbox"
                            className="form-checkbox text-white bg-neutral-700 border-gray-500"
                            checked={checked}
                            onChange={() => toggleCategoryChild(child._id)}
                          />
                          <label
                            className="text-sm text-gray-300 hover:text-white cursor-pointer font-codec"
                            onClick={() => toggleCategoryChild(child._id)}
                          >
                            {child.name} <span className="text-xs text-gray-400 font-codec">({child.count ?? 0})</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          {/* Properties */}
          <h2 className="text-xl mb-4 text-center font-codec px-4 py-1 bg-[#1a1a1a] rounded-md mt-4">Properties</h2>

          <div className="text-white">
            <h3 className="mb-2 text-md font-codec">Style</h3>
            <div className="grid grid-cols-2 gap-2">
              {styles.map((style) => {
                const active = selectedStyleIds.includes(style._id);
                return (
                  <button
                    key={style._id}
                    className={`px-3 py-1 rounded text-sm border transition font-codec ${
                      active
                        ? "bg-red-600 text-white border-red-600"
                        : "bg-[#1a1a1a] text-white border-[#2D2D2D] hover:bg:white/10"
                    }`}
                    onClick={() => toggleStyle(style._id)}
                  >
                    {style.name}
                  </button>
                );
              })}
            </div>
          </div>

          <h2 className="my-4 text-md font-codec">Color</h2>
          <div className="grid grid-cols-4 gap-3">
            {colors.map((color) => {
              const selected = selectedColorCodes.includes(color.code);
              return (
                <div
                  key={color._id}
                  onClick={() => toggleColor(color.code)}
                  title={color.name || color.code}
                  className={`flex items-center justify-center w-10 h-10 rounded-full cursor-pointer transition 
                    ${selected ? "border-2 border-red-600" : "border border-[#2D2D2D]"} 
                    hover:border-red-600`}
                >
                  <div className="w-8 h-8 rounded-full" style={{ backgroundColor: color.code }} />
                </div>
              );
            })}
          </div>

          <h2 className="mt-8 mb-4 text-left my-4 text-md font-codec">Form</h2>
          <div className="grid grid-cols-2 gap-2">
            {formOptions.map((form) => {
              const isSelected = selectedFormIds.includes(form._id);
              return (
                <button
                  key={form._id}
                  type="button"
                  onClick={() => toggleForm(form._id)}
                  className={`flex items-center justify-center w-24 h-12 bg-[#1a1a1a] rounded border ${
                    isSelected ? "border-red-600" : "border-[#2D2D2D]"
                  } hover:bg-white/10 transition`}
                  aria-pressed={isSelected}
                  title={form.name}
                >
                  <img src={form.image} alt={form.name} className="w-8 h-8 object-contain" />
                </button>
              );
            })}
          </div>

          <h2 className="text-xl font-bold mt-8 mb-4 text-left font-codec">Materials</h2>
          <div className="grid grid-cols-2 gap-2">
            {materials.map((material) => {
              const isSelected = selectedMaterialIds.includes(material._id);
              return (
                <button
                  key={material._id}
                  onClick={() => toggleMaterial(material._id)}
                  className={`px-3 py-1 rounded border font-codec text-sm transition ${
                    isSelected ? "bg-red-600 text-white border-red-600" : "bg-[#1a1a1a] text-white border-[#2D2D2D] hover:bg-white/10"
                  }`}
                >
                  {material.name}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Gallery */}
        <main className="flex-1">
          {/* Search + Sort */}
          <div className="relative">
            <div className="flex items-center gap-2">
              {/* Nút Filter: mobile-only */}
              <button
                onClick={() => setMobileFilterOpen(true)}
                className="lg:hidden inline-flex items-center gap-2 text-white bg-[#1a1a1a] border border-[#2D2D2D] px-3 py-1 rounded"
                title="Bộ lọc"
              >
                <FaFilter className="text-sm" />
                <span className="text-xs font-codec">Filter</span>
              </button>

              {/* Nút Search */}
              <button
                onClick={() => setShowSearch(!showSearch)}
                className="text-white bg-transparent w-10 px-3 py-1 mt-0.5 mb-1"
              >
                <FaSearch />
              </button>
              <input
                type="text"
                value={searchQueryRaw}
                onChange={(e) => setSearchQueryRaw(e.target.value)}
                placeholder="Tìm kiếm..."
                className={`absolute top-0 left-[96px] lg:left-12 transition-all duration-300 ease-in-out w-52 px-3 py-1 text-sm rounded bg-neutral-800 border border-gray-600 text-white z-20 ${
                  showSearch ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-10 pointer-events-none"
                }`}
              />
            </div>
          </div>

          <div className="flex items-center justify-between relative">
            <div className="flex items-center space-x-2 mb-2 ml-1">
              <button
                className={`text-xs w-16 px-2 py-0.5 rounded transition font-codec border ${
                  activeFilter === "free" ? "bg-red-600 text-white border-red-600" : "bg-[#282828] text-[#a1a1a1] border-[#2D2D2D]"
                }`}
                onClick={() => handlePriceFilter("free")}
              >
                Free
              </button>
              <button
                className={`text-xs w-16 px-2 py-0.5 rounded transition font-codec border ${
                  activeFilter === "pro" ? "bg-red-600 text-white border-red-600" : "bg-[#282828] text-[#a1a1a1] border-[#2D2D2D]"
                }`}
                onClick={() => handlePriceFilter("pro")}
              >
                Pro
              </button>

              {/* Selected Filters Chips */}
              <div className="hidden lg:flex items-center flex-wrap gap-2">
                {activeChips.length === 0 ? (
                  <button className="px-0 py-0 text-xs rounded transition font-codec bg-[#282828] text-[#a1a1a1] whitespace-nowrap border border-[#2D2D2D]" />
                ) : (
                  <>
                    {activeChips.map((chip) => (
                      <div
                        key={chip.key}
                        className="flex items-center px-1 py-0 text-xs rounded bg-[#282828] text-white border border-[#2D2D2D] font-codec"
                      >
                        {chip.color && (
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-white/20"
                            style={{ backgroundColor: chip.color }}
                          />
                        )}
                        <span className="text-[#d0d0d0]">{chip.label}</span>
                        <button
                          onClick={chip.onRemove}
                          className="ml-1 text-[#a1a1a1] items-center h-[22px] py-0 hover:text-white leading-none bg-transparent"
                          title="Xóa điều kiện"
                        >
                          <FaTimes />
                        </button>
                      </div>
                    ))}

                    <button
                      onClick={() => {
                        setSelectedCategoryIds([]);
                        setSelectedStyleIds([]);
                        setSelectedColorCodes([]);
                        setSelectedFormIds([]);
                        setSelectedMaterialIds([]);
                        setActiveFilter(null);
                        setSearchQueryRaw("");
                        setSearchQuery("");
                        updateSearchParam({ page: 1, q: undefined });
                        setCurrentPage(1);
                      }}
                      className="px-2 py-0.5 text-xs rounded bg-[#1a1a1a] border border-[#2D2D2D] text-[#a1a1a1] hover:bg-white/10 font-codec"
                      title="Xóa tất cả điều kiện"
                    >
                      Xóa hết
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="relative inline-block min-w-32 group">
              <button
                id="sort-trigger"
                className="flex items-center text-xs w-min-32 justify-center py-0.5 px-1 rounded transition font-codec bg-[#282828] text-[#a1a1a1] border border-[#2D2D2D] mb-2"
                aria-haspopup="menu"
                aria-expanded="false"
                onClick={toggleSortDropdown}
              >
                <img src="/3dmodel/form/mt.svg" alt="sort icon" className="w-4 h-4 transform scale-[2.5] origin-center" />
                <span className="mt-[1px] w-[100px] ">{selectedSort}</span>
              </button>

              {/* Dropdown */}
              {sortOpen && (
                <div
                  role="menu"
                  aria-labelledby="sort-trigger"
                  className="absolute right-0 top-7 z-30 bg-[#1a1a1a] border border-[#2D2D2D] rounded shadow-lg text-xs min-w-32"
                >
                  {["Mặc định", "Mới nhất", "Cũ nhất", "Nhiều lượt mua", "Nhiều lượt xem"].map((opt) => (
                    <div
                      key={opt}
                      role="menuitem"
                      onClick={() => {
                        handleSortSelect(opt);
                        setSortOpen(false);
                      }}
                      className={`px-3 py-2 cursor-pointer hover:bg:white/10 min-w-32 ${
                        selectedSort === opt ? "text:white" : "text-[#a1a1a1]"
                      }`}
                    >
                      {opt}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {productsError && (
              <div className="col-span-full p-4 text-center text-red-400">{productsError}</div>
            )}
            {!productsLoading && !productsError && visibleProducts.length === 0 && (
              <div className="col-span-full p-4 text-center text-[#a1a1a1]">Không tìm thấy sản phẩm phù hợp</div>
            )}

            {visibleProducts.map((model) => (
              <motion.div
                key={model.id}
                className="relative group px-1 py-0.5 rounded-xl hover:shadow-lg transition h-full w-full mx-auto"
                {...linkHandlers(`/product-detail/${model.id}`, () => recordView(model.id))}
                role="button"
                tabIndex={0}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const windowWidth = window.innerWidth;
                  const windowHeight = window.innerHeight;
                  const previewWidth = 600;
                  const previewHeight = 600;
                  let left = rect.right;
                  let top = rect.top;
                  if (rect.right + previewWidth > windowWidth) left = rect.left - previewWidth;
                  if (rect.top + previewHeight > windowHeight) top = windowHeight - previewHeight;
                  if (top < 20) top = 20;
                  setPreviewImage(buildUrl(model.previewImagePath || model.image));
                  setPreviewPosition({ top, left });
                }}
                onMouseLeave={() => setPreviewImage(null)}
              >
                <div className=" flex gap-2 absolute top-[12px] right-[12px] z-10">
                  {model.owned && (
                    <span className="bg-[#8AA062] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer">
                      <img
                        src="/Download.svg"
                        alt="Cart"
                        className="w-8 h-8 object-contain"
                        onClick={(e) => {
                          e.stopPropagation();
                          openSmart(e, `/product-detail/${model.id}`);
                        }}
                        onAuxClick={(e) => {
                          e.stopPropagation();
                          openSmart(e, `/product-detail/${model.id}`);
                        }}
                        onMouseDown={(e) => {
                          if (e.button === 1) {
                            e.stopPropagation();
                            openSmart(e, `/product-detail/${model.id}`);
                          }
                        }}
                      />
                    </span>
                  )}
                  {model.liked && (
                    <button className="bg-[#8f120d] text-white p-1.5 rounded-full text-sm">
                      <FaRegHeart className="text-white text-lg" />
                    </button>
                  )}
                </div>

                {/* TOP-LEFT: Free badge */}
                {Number(model.price) === 0 && (
                  <div className="absolute top-[12px] left-[12px] z-10">
                    <span className="px-2 py-0.5 rounded-full bg-[#7a9739] text-white text-[10px] font-semibold border border-white/40 shadow">
                      Free
                    </span>
                  </div>
                )}

                <div
                  className="
                    absolute bottom-[20%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex gap-2
                    opacity-100 lg:opacity-0 lg:group-hover:opacity-100
                    transition-opacity duration-300
                  "
                >
                  {model.owned ? (
                    <span className="bg-[#8AA062] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer hover:animate-shake">
                      <img
                        src="/Download.svg"
                        alt="Cart"
                        className="w-8 h-8 object-contain"
                        onClick={(e) => {
                          e.stopPropagation();
                          openSmart(e, `/product-detail/${model.id}`);
                        }}
                        onAuxClick={(e) => {
                          e.stopPropagation();
                          openSmart(e, `/product-detail/${model.id}`);
                        }}
                        onMouseDown={(e) => {
                          if (e.button === 1) {
                            e.stopPropagation();
                            openSmart(e, `/product-detail/${model.id}`);
                          }
                        }}
                      />
                    </span>
                  ) : (
                    <span className="bg-black/80 border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-8 h-8 cursor-pointer hover:animate-shake">
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
                      className="bg-[#8f120d] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-8 h-8 cursor-pointer hover:animate-shake"
                    >
                      <FaRegHeart className="text-white text-lg" />
                    </span>
                  ) : (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedProduct1(model);
                        setIsPopupOpen(true);
                      }}
                      className="bg-black/80 border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition w-8 h-8 cursor-pointer hover:animate-shake"
                    >
                      <FaRegHeart className="text-white text-lg" />
                    </span>
                  )}
                </div>

                <div className="relative overflow-hidden rounded-lg group aspect-square">
                  <img
                    src={buildUrl(model.previewImagePath || model.image)}
                    alt={model.name}
                    className="w-full h-full object-cover rounded-lg cursor-pointer group-hover:scale-110 transition-transform duration-300 ease-in-out"
                  />
                </div>
                <div className="mt-2 mb-1 flex items-center justify-between bg-[#282828] border border-[#4d4d4d] px-3 py-1 rounded w-full max-w-full overflow-hidden">
                  <p className="text-[#9e9e9e] text-sm font-codec truncate whitespace-nowrap overflow-hidden text-ellipsis flex-1 pr-2">
                    {decodeHtml(model.name)}
                  </p>
                </div>
              </motion.div>
            ))}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="col-span-full flex flex-wrap items-center z-50 justify-center gap-2 mt-8 mb-16 font-codec text-sm text-white">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="h-8 px-20 bg-[#1a1a1a] border border-[#2D2D2D] rounded text-white/60 disabled:opacity-40"
                >
                  Previous
                </button>

                <div className="flex flex-wrap h-8 items-center justify-center gap-2 bg-[#1a1a1a] text-[#a1a1a1] py-1 px-2 rounded border border-[#2D2D2D] font-codec text-sm">
                  {[...Array(totalPages)].map((_, i) => {
                    const page = i + 1;
                    if (page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1) {
                      return (
                        <button
                          key={page}
                          onClick={() => handlePageChange(page)}
                          className={`h-6 px-3 border rounded flex items-center justify-center ${
                            currentPage === page
                              ? "bg-white text-black"
                              : "bg-[#1a1a1a] text-white hover:bg:white/10 border-[#2D2D2D]"
                          }`}
                        >
                          {page}
                        </button>
                      );
                    } else if (
                      (page === currentPage - 2 && page > 2) ||
                      (page === currentPage + 2 && page < totalPages - 1)
                    ) {
                      return (
                        <span key={page} className="h-6 flex items-center px-2">
                          ...
                        </span>
                      );
                    }
                    return null;
                  })}
                  <div className="flex items-center h-6 bg-[#131313] text-[#a1a1a1] px-3 rounded border border-[#2D2D2D] ml-2">
                    <span className="text-sm font-codec">Go to page</span>
                    <div className="border-l border-[#2D2D2D] h-4 mx-2" />
                    <input
                      type="number"
                      min="1"
                      max={totalPages}
                      placeholder={currentPage}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handlePageChange(Number(e.target.value));
                      }}
                      className="w-10 bg-transparent text-white text-center outline-none font-codec placeholder-[#a1a1a1]"
                    />
                  </div>
                </div>

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="h-8 px-20 bg-[#1a1a1a] border border-[#2D2D2D] rounded text-white/60 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </div>

          {/* Preview on hover */}
          {previewImage && (
            <div
              className="fixed z-[100] pointer-events-none"
              style={{ top: previewPosition.top, left: previewPosition.left }}
            >
              <img
                src={previewImage}
                alt="Preview"
                className="max-w:[600px] max-h-[600px] object-contain border border-white rounded shadow-lg"
              />
            </div>
          )}
        </main>

        {/* Mobile Filter Drawer */}
        {mobileFilterOpen && (
          <div className="lg:hidden fixed inset-0 z-[9999]">
            <div className="absolute inset-0 bg-black/60" onClick={() => setMobileFilterOpen(false)} />
            <div className="absolute right-0 top-0 h-full w-[85%] max-w-[360px] bg-[#0f0f0f] border-l border-[#2D2D2D] shadow-2xl p-4 overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-codec">Bộ lọc</h2>
                <button
                  onClick={() => setMobileFilterOpen(false)}
                  className="bg-transparent border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer hover:animate-shake"
                  title="Đóng"
                >
                  <FaTimes className="text-white text-lg" />
                </button>
              </div>

              {/* COPY nội dung sidebar */}
              <h2 className="text-xl mb-4 text-center font-codec px-4 py-1 bg-[#1a1a1a] rounded-md">Categories</h2>
              <ul className="space-y-3">
                {(tree.children ?? []).map((group, index) => (
                  <li key={group._id || group.name}>
                    <div className="cursor-pointer flex justify-between items-center font-codec" onClick={() => toggleCategory(index)}>
                      <span className="flex items-center gap-2 font-codec text-sm">
                        <div className="w-6 h-6 flex items:center justify-center rounded overflow-hidden shrink-0">
                          {group.image ? (
                            <img src={group.image} alt="icon" className="w-[18px] h-[18px] object-contain filter invert" />
                          ) : (
                            <div className="w-[18px] h-[18px] bg:white/10 rounded" />
                          )}
                        </div>
                        <span className="mt-[2px]">{group.name}</span>
                      </span>

                      <div className="w-6 h-6 relative">
                        <img
                          src="/3dmodel/v.svg"
                          alt="Expand"
                          className={`absolute inset-0 w-full h-full scale-150 object-contain pointer-events-none ${
                            openCategory === index ? "rotate-180" : ""
                          }`}
                        />
                      </div>
                    </div>

                    {openCategory === index && (
                      <ul className="ml-2 mt-2 space-y-2">
                        {(group.children ?? []).map((child) => {
                          const checked = selectedCategoryIds.includes(child._id);
                          return (
                            <li key={child._id || child.name} className="flex items-center space-x-2 font-codec">
                              <input
                                type="checkbox"
                                className="form-checkbox text-white bg-neutral-700 border-gray-500"
                                checked={checked}
                                onChange={() => toggleCategoryChild(child._id)}
                              />
                              <label
                                className="text-sm text-gray-300 hover:text-white cursor-pointer font-codec"
                                onClick={() => toggleCategoryChild(child._id)}
                              >
                                {child.name} <span className="text-xs text-gray-400 font-codec">({child.count ?? 0})</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>

              <h2 className="text-xl mb-4 text-center font-codec px-4 py-1 bg-[#1a1a1a] rounded-md mt-4">Properties</h2>

              {/* Style */}
              <div className="text-white">
                <h3 className="mb-2 text-md font-codec">Style</h3>
                <div className="grid grid-cols-2 gap-2">
                  {styles.map((style) => {
                    const active = selectedStyleIds.includes(style._id);
                    return (
                      <button
                        key={style._id}
                        className={`px-3 py-1 rounded text-sm border transition font-codec ${
                          active
                            ? "bg-red-600 text-white border-red-600"
                            : "bg-[#1a1a1a] text-white border-[#2D2D2D] hover:bg:white/10"
                        }`}
                        onClick={() => toggleStyle(style._id)}
                      >
                        {style.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Color */}
              <h2 className="my-4 text-md font-codec">Color</h2>
              <div className="grid grid-cols-5 gap-3">
                {colors.map((color) => {
                  const selected = selectedColorCodes.includes(color.code);
                  return (
                    <div
                      key={color._id}
                      onClick={() => toggleColor(color.code)}
                      title={color.name || color.code}
                      className={`flex items-center justify-center w-10 h-10 rounded-full cursor-pointer transition 
                        ${selected ? "border-2 border-red-600" : "border border-[#2D2D2D]"} 
                        hover:border-red-600`}
                    >
                      <div className="w-8 h-8 rounded-full" style={{ backgroundColor: color.code }} />
                    </div>
                  );
                })}
              </div>

              {/* Form */}
              <h2 className="mt-8 mb-4 text-left my-4 text-md font-codec">Form</h2>
              <div className="grid grid-cols-3 gap-2">
                {formOptions.map((form) => {
                  const isSelected = selectedFormIds.includes(form._id);
                  return (
                    <button
                      key={form._id}
                      type="button"
                      onClick={() => toggleForm(form._id)}
                      className={`flex items-center justify-center h-12 bg-[#1a1a1a] rounded border ${
                        isSelected ? "border-red-600" : "border-[#2D2D2D]"
                      } hover:bg:white/10 transition`}
                      aria-pressed={isSelected}
                      title={form.name}
                    >
                      <img src={form.image} alt={form.name} className="w-8 h-8 object-contain" />
                    </button>
                  );
                })}
              </div>

              {/* Materials */}
              <h2 className="text-xl font-bold mt-8 mb-4 text-left font-codec">Materials</h2>
              <div className="grid grid-cols-2 gap-2 mb-24">
                {materials.map((material) => {
                  const isSelected = selectedMaterialIds.includes(material._id);
                  return (
                    <button
                      key={material._id}
                      onClick={() => toggleMaterial(material._id)}
                      className={`px-3 py-2 rounded border font-codec text-sm transition ${
                        isSelected ? "bg-red-600 text-white border-red-600" : "bg-[#1a1a1a] text:white border-[#2D2D2D] hover:bg:white/10"
                      }`}
                    >
                      {material.name}
                    </button>
                  );
                })}
              </div>

              {/* Action bar dưới cùng */}
              <div className="fixed bottom-0 right-0 w-[85%] max-w-[360px] bg-[#0f0f0f] border-t border-[#2D2D2D] p-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setSelectedCategoryIds([]);
                      setSelectedStyleIds([]);
                      setSelectedColorCodes([]);
                      setSelectedFormIds([]);
                      setSelectedMaterialIds([]);
                      setActiveFilter(null);
                      setSearchQueryRaw("");
                      setSearchQuery("");
                      updateSearchParam({ page: 1, q: undefined });
                      setCurrentPage(1);
                    }}
                    className="flex-1 px-3 py-2 text-sm rounded bg-[#1a1a1a] border border-[#2D2D2D] text-[#a1a1a1] hover:bg:white/10 font-source"
                  >
                    Xóa hết
                  </button>
                  <button
                    onClick={() => setMobileFilterOpen(false)}
                    className="flex-1 px-3 py-2 text-sm rounded bg-red-600 text-white font-source"
                  >
                    Áp dụng
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Popups */}
      {isPopupOpen && selectedProduct1 && (
        <CollectionPopup
          isOpen={isPopupOpen}
          onClose={() => setIsPopupOpen(false)}
          selectedProduct={selectedProduct1}
          onQuickCheckout={handleQuickCheckoutFromCollection}
          onAddedToFavorites={handleFavoritesAdded}
        />
      )}

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

      {/* Floating Buttons */}
      <div className="fixed bottom-10 right-4 sm:bottom-10 sm:right-6 z-[60] flex flex-col gap-3 sm:gap-4">
        {showScrollTop && (
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="bg-black/80 backdrop-blur-md border border-white/30 rounded-full w-12 h-12 sm:w-12 sm:h-12 flex items-center justify-center shadow hover:scale-105 transition"
            title="Lên đầu trang"
          >
            <FaArrowUp className="text-xl text-white scale-[2]" />
          </button>
        )}
        <button
          onClick={() => alert("Mở hộp thoại nhắn tin / Chatbox")}
          className="bg-black/80 backdrop-blur-md border border-white/30 rounded-full w-12 h-12 sm:w-12 sm:h-12 flex items-center justify-center shadow hover:scale-105 transition"
          title="Nhắn tin"
        >
          <FaFacebookMessenger className="text-xl text-white scale-[2.5]" />
        </button>
      </div>
    </div>
  );
}
