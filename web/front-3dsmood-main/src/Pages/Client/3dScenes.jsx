// src/pages/Scenes/ModelGallery.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { FaSearch, FaRegHeart, FaArrowUp, FaFacebookMessenger, FaTimes } from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import Header from "../../Components/header-extra";
import DownloadPopup from "../../Components/dowloadPopup";
import CollectionPopup from "../../Components/CollectionPopup";
import axios from "axios";
import { COUNTER_EVENT_DIRTY } from "../../utils/counterBus";

// ===== Config helpers =====
const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const imgURL = (rel) => (rel ? `${API}${rel.startsWith("/") ? rel : `/${rel}`}` : "");

// wait 2 frames to ensure layout is painted
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

// === ĐO WIDTH CHUẨN của container (trừ padding) ===
const measure = (el) => {
  if (!el) return window.innerWidth;
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const pad = parseFloat(cs.paddingLeft || "0") + parseFloat(cs.paddingRight || "0");
  return Math.max(0, rect.width - pad);
};

export default function ModelGallery() {
  const navigate = useNavigate();
  const galleryRef = useRef(null);
  const reqRef = useRef(0);      // request/version guard
  const roRef = useRef(null);    // ResizeObserver
  const lastScrollY = useRef(0);

  // [FIX FLICKER] guards & mirrors
  const rowsRef = useRef([]);
  const lastCwRef = useRef(0);
  const roRafRef = useRef(0);

  // ===== UI base =====
  const [rows, setRows] = useState([]);
  useEffect(() => { rowsRef.current = rows; }, [rows]); // mirror for RO callback

  const gap = 8; // gutter cố định
  const [targetRowHeight, setTargetRowHeight] = useState(250);
  const [openCategory, setOpenCategory] = useState(null);
  const [activeFilter, setActiveFilter] = useState(null); // 'free' | 'pro' | null
  const [selectedProduct1, setSelectedProduct1] = useState(null);
  const [isPopupOpenDowload, setIsPopupOpenDowload] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [selectedProductDowload, setSelectedProductDowload] = useState([]);
  const [selectedSort, setSelectedSort] = useState("Mặc định");
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const [isScrollingUp, setIsScrollingUp] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // ===== Data =====
  // Chỉ hiển thị CÁC CON của root "3dscenes"
  const [categories, setCategories] = useState([]);  // [{_id,name,image,children:[...]}, ...]
  const [selectedCatIds, setSelectedCatIds] = useState([]);

  const [styleOptions, setStyleOptions] = useState([]); // [{_id,name}]
  const [selectedStyleIds, setSelectedStyleIds] = useState([]);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const limit = 50;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // === NEW: favorite & owned sets ===
  const [favoriteIdSet, setFavoriteIdSet] = useState(() => new Set());
  const [ownedIdSet, setOwnedIdSet] = useState(() => new Set());

  // [BGFILE] ===== Dynamic page background from BgFile (ảnh/GIF/video)
  const [homeBg, setHomeBg] = useState(null);
  useEffect(() => {
    let cancelled = false;
    axios
      .get(`${API}/api/bg-files`, { params: { activeNow: 1, limit: 1, sort: "updatedAt:desc" } })
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
        : `${API}${homeBg.filePath.startsWith("/") ? homeBg.filePath : `/${homeBg.filePath}`}`)
    : null;
  const isHomeBgVideo = homeBgUrl ? /\.(mp4|webm|ogg)$/i.test(homeBgUrl) : false;
  const isHomeBgImage = homeBgUrl ? /\.(png|jpe?g|webp|avif|gif)$/i.test(homeBgUrl) : false;

  // ===== Responsive row height =====
  useEffect(() => {
    const updateRowHeight = () => {
      const w = window.innerWidth;
      if (w < 640) setTargetRowHeight(150);
      else if (w < 1024) setTargetRowHeight(200);
      else if (w < 1440) setTargetRowHeight(270);
      else setTargetRowHeight(230);
    };
    updateRowHeight();
    window.addEventListener("resize", updateRowHeight);
    return () => window.removeEventListener("resize", updateRowHeight);
  }, []);

  // ===== Header show/hide =====
  useEffect(() => {
    const t = setTimeout(() => setHasMounted(true), 100);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setShowScrollTop(y > 100);
      if (y < 50) {
        setShowHeader(true);
        setIsScrollingUp(false);
      } else if (y > lastScrollY.current) {
        setShowHeader(false);
        setIsScrollingUp(false);
      } else {
        setShowHeader(true);
        setIsScrollingUp(true);
      }
      lastScrollY.current = y;
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // ===== CATEGORY TREE: chỉ lấy children của 3dscenes & giữ count =====
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/api/categories/tree/3dscenes`);
        const root = r.ok ? await r.json() : null;
        if (!root) return setCategories([]);

        const normalize = (n) => ({
          _id: String(n._id),
          name: n.name,
          image: n.image || "/3dmodel/categories/home.svg",
          count: Number(n.count ?? n.productCount ?? 0),
          children: Array.isArray(n.children) ? n.children.map(normalize) : [],
        });

        const rootNode = normalize(root);
        setCategories(rootNode.children); // chỉ các con
      } catch {
        setCategories([]);
      }
    })();
  }, []);

  // ===== STYLES =====
  useEffect(() => {
    fetch(`${API}/api/styles`)
      .then((r) => (r.ok ? r.json() : []))
      .then((arr) => setStyleOptions(Array.isArray(arr) ? arr : []))
      .catch(() => setStyleOptions([]));
  }, []);

  // ===== PRODUCTS =====
  const priceType = useMemo(
    () => (activeFilter === "free" ? "free" : activeFilter === "pro" ? "pro" : null),
    [activeFilter]
  );
  const apiSort = useMemo(
    () => (selectedSort === "Cũ nhất" ? "oldest" : "newest"),
    [selectedSort]
  );

  // === Xếp hàng 3–4 items/row + CHIỀU CAO BẰNG NHAU + CĂN LỀ HAI BÊN VỚI GUTTER CỐ ĐỊNH ===
  const arrangeRows = useCallback(
    (imgs, containerWidth) => {
      if (!Array.isArray(imgs) || imgs.length === 0 || !containerWidth) {
        setRows([]);
        return;
      }

      const H = targetRowHeight; // chiều cao ô — đồng nhất mọi hàng
      const G = gap;             // gutter cố định giữa các item

      // --- Chia số item thành các hàng 3–4 (ưu tiên 4) ---
      const n = imgs.length;
      let sizes = [];
      for (let b = Math.floor(n / 4); b >= 0; b--) {
        const rem = n - 4 * b;
        if (rem % 3 === 0) {
          sizes = [...Array(rem / 3).fill(3), ...Array(b).fill(4)];
          break;
        }
      }
      if (!sizes.length) {
        if (n <= 4) sizes = [n];
        else if (n === 5) sizes = [3, 2]; // bất khả kháng còn 2
        else {
          let r = n;
          while (r > 0) {
            const sz = Math.min(4, r);
            sizes.push(sz);
            r -= sz;
          }
          let i = sizes.length - 1;
          while (sizes[i] < 3 && i > 0) {
            if (sizes[i - 1] > 3) {
              sizes[i] += 1; sizes[i - 1] -= 1;
            } else break;
          }
        }
      }

      // --- Tính width cho từng item ở chiều cao H, full-justify với gutter G ---
      const out = [];
      let cursor = 0;
      for (const k of sizes) {
        const rowItems = imgs.slice(cursor, cursor + k);
        cursor += k;

        const baseW = rowItems.map((it) => (it.ratio || 1.6) * H);
        const sumBase = baseW.reduce((a, b) => a + b, 0);
        const available = containerWidth - G * (k - 1);

        // scale đồng đều, hạn chế crop quá đà bằng clamp
        let factor = available / sumBase;
        factor = Math.max(0.75, Math.min(1.25, factor));

        // Bù phần dư/thiếu (do clamp) theo tỉ trọng để khít 2 mép
        const scaledTotal = sumBase * factor;
        const leftover = available - scaledTotal; // có thể âm/dương
        const weights = baseW.map((w) => w / sumBase || 0);

        const widths = baseW.map((w, i) => Math.max(40, w * factor + leftover * weights[i]));

        const itemsWithW = rowItems.map((it, i) => ({ ...it, w: widths[i] }));
        out.push({ items: itemsWithW });
      }

      // [FIX FLICKER] chỉ setRows nếu layout THỰC SỰ thay đổi (bỏ qua lệch < 0.5px)
      const prev = rowsRef.current;
      let same = prev.length === out.length;
      if (same) {
        for (let i = 0; i < out.length; i++) {
          const a = prev[i]?.items || [];
          const b = out[i]?.items || [];
          if (a.length !== b.length) { same = false; break; }
          for (let j = 0; j < b.length; j++) {
            if (Math.abs((a[j]?.w || 0) - (b[j]?.w || 0)) > 0.5) { same = false; break; }
          }
          if (!same) break;
        }
      }
      if (!same) setRows(out);
    },
    [gap, targetRowHeight]
  );

  const fetchProducts = async () => {
    setLoading(true);
    setMsg("");
    setRows([]); // clear layout cũ để tránh dính state width
    const myReq = ++reqRef.current;

    try {
      const qs = new URLSearchParams({
        page: String(currentPage),
        limit: String(limit),
        sort: apiSort,
      });
      if (searchQuery.trim()) qs.set("search", searchQuery.trim());
      if (priceType) qs.set("priceType", priceType);
      if (selectedStyleIds.length) qs.set("styles", selectedStyleIds.join(","));
      if (selectedCatIds.length) qs.set("categories", selectedCatIds.join(","));

      const res = await fetch(`${API}/api/product-scenes/client?${qs.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      if (reqRef.current !== myReq) return; // có request mới hơn

      setItems(data.items || []);
      setTotal(data.total || 0);

      // chờ paint xong rồi đo width để xếp hàng chính xác
      await nextPaint();
      const containerWidth = measure(galleryRef.current);

      const withRatio = await Promise.all(
        (data.items || []).map(
          (p) =>
            new Promise((resolve) => {
              const src =
                imgURL(p.previewImagePath) ||
                imgURL(p.images?.[0]?.path) ||
                "/product1-1.jpg";
              const im = new Image();
              im.src = src;
              im.onload = () =>
                resolve({
                  id: p._id,
                  name: p.name,
                  price: p.price || 0,
                  // liked & owned sẽ gắn ở bước render từ Set
                  image: src,
                  ratio:
                    im.naturalWidth && im.naturalHeight
                      ? im.naturalWidth / im.naturalHeight
                      : 1.6,
                });
              im.onerror = () =>
                resolve({
                  id: p._id,
                  name: p.name,
                  price: p.price || 0,
                  image: "/product1-1.jpg",
                  ratio: 1.6,
                });
            })
        )
      );

      if (reqRef.current !== myReq) return;
      arrangeRows(withRatio, containerWidth);
    } catch (e) {
      if (reqRef.current !== myReq) return;
      setMsg(`Lỗi: ${e.message || "Không tải được dữ liệu"}`);
      setItems([]);
      setTotal(0);
      setRows([]);
    } finally {
      if (reqRef.current === myReq) setLoading(false);
    }
  };

  // gọi API khi filter/sort/page/search đổi
  useEffect(() => {
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentPage,
    limit,
    apiSort,
    activeFilter,
    JSON.stringify(selectedStyleIds),
    JSON.stringify(selectedCatIds),
    searchQuery,
  ]);

  // Reflow khi container đổi kích thước (ResizeObserver) => đo lại bằng measure()
  useEffect(() => {
    const el = galleryRef.current;
    if (!el) return;

    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    const ro = new ResizeObserver(() => {
      const cw = measure(el);
      if (!cw) return;

      // [FIX FLICKER] bỏ qua jitter < 1px để tránh vòng lặp reflow
      if (Math.abs(cw - lastCwRef.current) < 1) return;
      lastCwRef.current = cw;

      // Debounce 1 frame
      if (roRafRef.current) cancelAnimationFrame(roRafRef.current);
      roRafRef.current = requestAnimationFrame(() => {
        const imgs = rowsRef.current.flatMap((r) => r.items);
        if (imgs.length) arrangeRows(imgs, cw);
      });
    });
    ro.observe(el);
    roRef.current = ro;
    return () => {
      ro.disconnect();
      if (roRafRef.current) cancelAnimationFrame(roRafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, arrangeRows]);

  // ===== handlers =====
  const toggleCategory = (index) => setOpenCategory(openCategory === index ? null : index);

  const toggleCatId = (id) => {
    setSelectedCatIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setCurrentPage(1);
  };

  const toggleStyle = (id) => {
    setSelectedStyleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setCurrentPage(1);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setCurrentPage(1);
    fetchProducts();
  };

  const handleSortSelect = (option) => {
    setSelectedSort(option);
    setCurrentPage(1);
  };

  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleRemoveProductFromDownload = (productId) =>
    setSelectedProductDowload((prev) => prev.filter((item) => item.id !== productId));

  // ===== Token helper =====
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
        // rollback nếu cần (hiếm khi dùng, nhưng để chắc)
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

  // === NEW: function to refresh favorites (reuse for mount & after closing popup)
  const refreshFavorites = useCallback(async () => {
    try {
      const token = readToken();
      if (!token) {
        setFavoriteIdSet(new Set());
        return;
      }
      const { data } = await axios.get(`${API}/api/product-detail/favorites`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const toId = (x) => {
        if (!x) return null;
        if (typeof x === "string") return x;
        return String(x.productId || x._id || x.id || "");
      };
      const ids = Array.isArray(data) ? data.map(toId).filter(Boolean) : [];
      setFavoriteIdSet(new Set(ids.map(String)));
    } catch (e) {
      console.error("fetchFavorites error:", e);
      setFavoriteIdSet(new Set());
    }
  }, []);

  // call once on mount
  useEffect(() => {
    refreshFavorites();
  }, [refreshFavorites]);

  // === NEW: check owned for current items (batch)
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

  useEffect(() => {
    if (!items?.length) {
      setOwnedIdSet(new Set());
      return;
    }
    const ids = items.map((p) => String(p._id || p.id));
    checkOwnedBatch(ids);
  }, [items, checkOwnedBatch]);

  // === NEW: when CollectionPopup closes, refetch favorites so heart shows immediately
  const prevPopupOpen = useRef(false);
  useEffect(() => {
    if (prevPopupOpen.current && !isPopupOpen) {
      refreshFavorites();
    }
    prevPopupOpen.current = isPopupOpen;
  }, [isPopupOpen, refreshFavorites]);

  // === NEW: làm tươi owned flags theo items hiện tại
  const refreshOwnedFlags = useCallback(async () => {
    try {
      if (!items?.length) {
        setOwnedIdSet(new Set());
        return;
      }
      const ids = items.map((p) => String(p._id || p.id));
      await checkOwnedBatch(ids); // sẽ setOwnedIdSet bên trong
    } catch {
      // ignore
    }
  }, [items, checkOwnedBatch]);

  // === NEW: cập nhật tim ngay khi thêm vào bộ sưu tập
  const handleAddedToFavorites = useCallback((added) => {
    const ids = new Set(Array.isArray(added) ? added.map(String) : [String(added)]);
    setFavoriteIdSet((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      try {
        window.dispatchEvent(new Event(COUNTER_EVENT_DIRTY));
        const bc = new BroadcastChannel("user:counters");
        bc.postMessage({ type: "dirty" });
        bc.close();
      } catch {}
      return next;
    });
    setIsPopupOpen(false);
  }, []);

  // === NEW: nhận danh sách id đã owned ngay khi thanh toán xong từ DownloadPopup
  const handleOwnedChange = useCallback((ownedIds) => {
    const ids = Array.isArray(ownedIds) ? ownedIds.map(String) : [String(ownedIds)];
    setOwnedIdSet((prev) => {
      const next = new Set(prev);
      ids.forEach((x) => next.add(x));
      return next;
    });
  }, []);

  // === NEW: derive visible rows with liked/owned flags
  const visibleRows = useMemo(() => {
    if (!rows?.length) return [];
    return rows.map((r) => ({
      ...r,
      items: r.items.map((img) => ({
        ...img,
        liked: favoriteIdSet.has(String(img.id)),
        owned: ownedIdSet.has(String(img.id)),
      })),
    }));
  }, [rows, favoriteIdSet, ownedIdSet]);

  // ====== Active Chips (Categories + Styles + Price + Search) ======
  const categoryIndex = useMemo(() => {
    const map = new Map();
    (categories || []).forEach((g) => {
      (g.children || []).forEach((sub) => {
        map.set(String(sub._id), { path: `${g.name} / ${sub.name}` });
        (sub.children || []).forEach((g3) => {
          map.set(String(g3._id), { path: `${g.name} / ${sub.name} / ${g3.name}` });
        });
      });
    });
    return map;
  }, [categories]);

  const styleIndex = useMemo(() => new Map(styleOptions.map((s) => [String(s._id), s.name])), [styleOptions]);

  const activeChips = useMemo(() => {
    const arr = [];

    selectedCatIds.forEach((id) => {
      const info = categoryIndex.get(String(id));
      arr.push({
        key: `cat-${id}`,
        label: info?.path || "Category",
        onRemove: () => toggleCatId(String(id)),
      });
    });

    selectedStyleIds.forEach((id) => {
      const name = styleIndex.get(String(id)) || "Style";
      arr.push({
        key: `style-${id}`,
        label: `Style: ${name}`,
        onRemove: () => toggleStyle(String(id)),
      });
    });

    if (activeFilter) {
      arr.push({
        key: `price-${activeFilter}`,
        label: activeFilter === "free" ? "Price: Free" : "Price: Pro",
        onRemove: () => setActiveFilter(null),
      });
    }

    if (searchQuery) {
      arr.push({
        key: "q",
        label: `Tìm: "${searchQuery}"`,
        onRemove: () => {
          setSearchQuery("");
          setCurrentPage(1);
        },
      });
    }

    return arr;
  }, [selectedCatIds, selectedStyleIds, activeFilter, searchQuery, categoryIndex, styleIndex]);

  const handleAddToCart = useCallback(async (e, product) => {
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

      // Nếu backend có trả alreadyPurchased
      if (res.data?.ok && res.data?.alreadyPurchased) {
        alert("Bạn đã mua sản phẩm này rồi. Không cần thêm vào giỏ.");
        return;
      }

      if (res.data?.ok) {
        setIsPopupOpenDowload(true);

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
  }, []);

  // ====== ✨ Thêm điều hướng thông minh (chuột giữa / Ctrl / Cmd) ======
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

  const linkHandlers = useCallback((href) => ({
    onClick: (e) => openSmart(e, href),
    onAuxClick: (e) => openSmart(e, href),            // chuột giữa trên một số trình duyệt
    onMouseDown: (e) => { if (e.button === 1) openSmart(e, href); }, // fallback khác
    onKeyDown: (e) => { if (e.key === "Enter") openSmart(e, href); },
  }), [openSmart]);
  useEffect(() => {
    document.title = "3dscenes | 3dsmood"; // tiêu đề riêng của trang này
  }, []);
  return (
    <div className="xl:w-[1480px] 2xl:w-[1920px] overflow-hidden bg-black mx-auto">
      {/* [BGFILE] Page background (giữ giao diện, chỉ phủ nền) */}
      {homeBgUrl && isHomeBgVideo ? (
        <video className="fixed inset-0 w-full h-full object-cover -z-10" src={homeBgUrl} autoPlay muted loop playsInline />
      ) : homeBgUrl && isHomeBgImage ? (
        <img className="fixed inset-0 w-full h-full object-cover z-0  select-none pointer-events-none" src={homeBgUrl} alt="" decoding="async" />
      ) : null}
      {/* <div className="fixed inset-0 -z-10 bg-black/30 pointer-events-none" /> */}

      <div className="h-16">
        <Header hasMounted={hasMounted} showHeader={showHeader} isScrollingUp={isScrollingUp} />
      </div>

      <div className="m-3 p-4 text-white rounded-md shadow text-sm text-center font-codec"></div>

      <div className="flex flex-col lg:flex-row text-white min-h-screen bg-[#000000] w-full mx-auto z-100">
        {/* Sidebar */}
        <aside className="w-56 p-4 overflow-y-auto ml-16 border border-[#2D2D2D] rounded z-20">
          <h2 className="text-xl mb-4 text-center font-codec px-4 py-1 bg-[#1a1a1a] rounded-md ">Categories</h2>

          <ul className="space-y-3">
            {categories.map((cat, index) => (
              <li key={cat._id || cat.name}>
                <div className="cursor-pointer flex justify-between items-center font-codec" onClick={() => setOpenCategory(openCategory === index ? null : index)}>
                  <span className="flex items-center gap-2 font-codec text-sm">
                    <div className="w-6 h-6 flex items-center justify-center rounded overflow-hidden shrink-0">
                      <img
                        src={cat.image || "/3dmodel/categories/home.svg"}
                        alt="icon"
                        className="w-[18px] h-[18px] object-contain filter invert"
                      />
                    </div>
                    <span className="mt-[2px]">{cat.name}</span>
                  </span>
                  <div className="w-6 h-6 relative">
                    <img
                      src="/3dmodel/v.svg"
                      alt="Expand"
                      className={`absolute inset-0 w-full h-full scale-150 object-contain pointer-events-none ${openCategory === index ? "rotate-180" : ""}`}
                    />
                  </div>
                </div>

                {openCategory === index && (
                  <ul className="ml-2 mt-2 space-y-2">
                    {(cat.children || []).map((sub) => {
                      const subCount = Number(sub.count ?? sub.productCount ?? 0);
                      return (
                        <li key={sub._id || sub.name} className="flex items-center space-x-2 font-codec">
                          <input
                            type="checkbox"
                            className="form-checkbox text-white bg-neutral-700 border-gray-500"
                            checked={selectedCatIds.includes(String(sub._id))}
                            onChange={() => toggleCatId(String(sub._id))}
                          />
                          <label
                            className="text-sm text-gray-300 hover:text-white cursor-pointer font-codec"
                            onClick={() => toggleCatId(String(sub._id))}
                          >
                            {sub.name} <span className="text-xs text-gray-400 font-codec">({subCount})</span>
                          </label>

                          {Array.isArray(sub.children) && sub.children.length > 0 && (
                            <ul className="ml-4 mt-1 space-y-1">
                              {sub.children.map((g3) => {
                                const c3 = Number(g3.count ?? g3.productCount ?? 0);
                                return (
                                  <li key={g3._id} className="flex items-center space-x-2 font-codec">
                                    <input
                                      type="checkbox"
                                      className="form-checkbox text-white bg-neutral-700 border-gray-500"
                                      checked={selectedCatIds.includes(String(g3._id))}
                                      onChange={() => toggleCatId(String(g3._id))}
                                    />
                                    <label
                                      className="text-sm text-gray-300 hover:text-white cursor-pointer font-codec"
                                      onClick={() => toggleCatId(String(g3._id))}
                                    >
                                      {g3.name} <span className="text-xs text-gray-400 font-codec">({c3})</span>
                                    </label>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
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
              {styleOptions.length === 0 ? (
                <div className="text-sm text-gray-400 col-span-2">Chưa có style.</div>
              ) : (
                styleOptions.map((st) => {
                  const selected = selectedStyleIds.includes(st._id);
                  return (
                    <button
                      key={st._id}
                      onClick={() => toggleStyle(st._id)}
                      className={`relative px-3 py-1 rounded text-sm border transition font-codec ${
                        selected
                          ? "bg-red-600 text-white border-red-600"
                          : "bg-[#1a1a1a] text-white border-[#2D2D2D] hover:bg-white/10"
                      }`}
                    >
                      {st.name}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </aside>

        {/* Gallery */}
        <main className="flex-1 mr-12">
          <div className="relative">
            <button
              onClick={() => setShowSearch(!showSearch)}
              className="text-white bg-transparent w-10 px-3 py-1 mt-0.5 mb-1 "
            >
              <FaSearch />
            </button>

            <form onSubmit={handleSearchSubmit}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm kiếm..."
                className={`absolute top-0 left-12 transition-all duration-300 ease-in-out w-52 px-3 py-1 text-sm rounded bg-neutral-800 border border-gray-600 text-white z-20 ${
                  showSearch ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-10 pointer-events-none"
                }`}
              />
            </form>
          </div>

          {/* Top actions */}
          <div className="flex items-center justify-between relative">
            <div className="flex items-center space-x-2">
              <button
                className={`text-xs w-[38px] px-2 py-0.5 rounded w-16 transition font-codec bg-[#282828] text-[#a1a1a1] border border-[#2D2D2D] ml-2 ${
                  activeFilter === "free" ? "bg-red-600 text-white border-red-600" : ""
                }`}
                onClick={() => setActiveFilter(activeFilter === "free" ? null : "free")}
              >
                Free
              </button>

              <button
                className={`w-[38px] px-1 py-0.5 text-xs rounded w-16 transition font-codec bg-[#282828] text-[#a1a1a1] border border-[#2D2D2D] ${
                  activeFilter === "pro" ? "bg-red-600 text-white border-red-600" : ""
                }`}
                onClick={() => setActiveFilter(activeFilter === "pro" ? null : "pro")}
              >
                Pro
              </button>

              {/* ====== Selected Filters Chips ====== */}
              <div className="flex items-center flex-wrap gap-2">
                {activeChips.length === 0 ? (
                  <button className="px-0 py-0 text-xs rounded transition font-codec bg-[#282828] text-[#a1a1a1] whitespace-nowrap border border-[#2D2D2D]">
                  </button>
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
                        setSelectedCatIds([]);
                        setSelectedStyleIds([]);
                        setActiveFilter(null);
                        setSearchQuery("");
                        setCurrentPage(1);
                      }}
                      className="px-2 py-0.5 text-xs rounded bg-[#1a1a1a] border border-[#2D2D2D] text-[#a1a1a1] hover:bg-white/10 font-source"
                      title="Xóa tất cả điều kiện"
                    >
                      Xóa hết
                    </button>
                  </>
                )}
              </div>
              {/* ====== /Selected Filters Chips ====== */}
            </div>

            {/* Sort dropdown hover/focus */}
            <div className="relative inline-block min-w-32 group mr-2 mb-2">
              <button
                id="sort-trigger"
                className="flex items-center text-xs min-w-32 mr-2 justify-center py-0.5 px-1 rounded transition font-codec bg-[#282828] text-[#a1a1a1] border border-[#2D2D2D]"
                aria-haspopup="menu"
                aria-expanded="false"
              >
                <img src="/3dmodel/form/mt.svg" alt="sort icon" className="w-4 h-4 transform scale-[2.5] origin-center" />
                <span className="mt-[1px]">{selectedSort}</span>
              </button>

              <div
                role="menu"
                aria-labelledby="sort-trigger"
                className="
                  absolute right-0 top-7 z-30 bg-[#1a1a1a] border border-[#2D2D2D]
                  rounded shadow-lg text-xs min-w-[160px]
                  invisible opacity-0 translate-y-1
                  group-hover:visible group-hover:opacity-100 group-hover:translate-y-0
                  group-focus-within:visible group-focus-within:opacity-100 group-focus-within:translate-y-0
                  transition pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto
                "
              >
                {["Mặc định", "Mới nhất", "Cũ nhất"].map((op) => (
                  <div
                    key={op}
                    role="menuitem"
                    onClick={() => handleSortSelect(op)}
                    className={`w-full block text-left px-3 py-2 cursor-pointer hover:bg-white/10 ${
                      selectedSort === op ? "text-white" : "text-[#a1a1a1]"
                    }`}
                  >
                    {op}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Gallery rows */}
          <div
            key={currentPage} // remount nhẹ khi nhảy trang nhanh
            ref={galleryRef}
            className="bg-black p-2 w-full xl:min-w-[920px] 3xl:min-w-[1200px]"
          >
            {loading ? (
              <div className="text-white/80 p-4"></div>
            ) : visibleRows.length === 0 ? (
              <div className="text-white/80 p-4">{msg || "Không có dữ liệu"}</div>
            ) : (
              visibleRows.map((row, rowIndex) => (
                <div key={rowIndex} className="flex mb-2 w-full" style={{ gap: `${gap}px` }}>
                  {row.items.map((img) => (
                    <div
                      key={img.id}
                      className="relative group overflow-hidden rounded-lg cursor-pointer"
                      style={{
                        height: `${targetRowHeight}px`, // mọi hàng cùng chiều cao
                        width: `${img.w}px`,            // độ rộng đã tính để justify
                      }}
                      // 🔗 Điều hướng thông minh
                      {...linkHandlers(`/product-detail-scenes/${img.id}`)}
                      role="button"
                      tabIndex={0}
                    >
                      <img
                        src={img.image}
                        alt={img.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />

                      {/* Top-right: icons */}
                      <div className="flex gap-2 absolute top-[12px] right-[12px] z-10">
                        {img.owned && (
                          <span
                            className="bg-[#8AA062] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer"
                            onClick={(e) => { e.stopPropagation(); openSmart(e, `/product-detail-scenes/${img.id}`); }}
                            onAuxClick={(e) => { e.stopPropagation(); openSmart(e, `/product-detail-scenes/${img.id}`); }}
                            onMouseDown={(e) => { if (e.button === 1) { e.stopPropagation(); openSmart(e, `/product-detail-scenes/${img.id}`); } }}
                          >
                            <img src="/Download.svg" alt="Download" className="w-8 h-8 object-contain" />
                          </span>
                        )}
                        {img.liked && (
                          <span className="bg-[#8f120d] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer hover:animate-shake">
                            <FaRegHeart className="text-white text-lg" />
                          </span>
                        )}
                      </div>
                      {Number(img.price) === 0 && (
                        <div className="absolute top-[12px] left-[12px] z-10">
                          <span className="px-2 py-0.5 rounded-full bg-[#7a9739] text-white text-[10px] font-semibold border border-white/40 shadow">
                            Free
                          </span>
                        </div>
                      )}
                      {/* Center actions on hover */}
                      <div className="absolute top-1/3 right-3 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        {img.owned ? (
                          <span
                            className="bg-[#8AA062] border border-white rounded-full items-center justify-center shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer hover:animate-shake"
                            onClick={(e) => { e.stopPropagation(); openSmart(e, `/product-detail-scenes/${img.id}`); }}
                            onAuxClick={(e) => { e.stopPropagation(); openSmart(e, `/product-detail-scenes/${img.id}`); }}
                            onMouseDown={(e) => { if (e.button === 1) { e.stopPropagation(); openSmart(e, `/product-detail-scenes/${img.id}`); } }}
                          >
                            <img src="/Download.svg" alt="Download" className="w-8 h-8 object-contain" />
                          </span>
                        ) : (
                          <span className="bg-black/80 border border-white rounded-full items-center justify-center shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer hover:animate-shake">
                            <img
                              src="/giohang.svg"
                              alt="Cart"
                              className="w-8 h-8 object-contain"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddToCart(e, img);
                              }}
                            />
                          </span>
                        )}

                        {/* Thêm vào bộ sưu tập (Favorite) */}
                        {img.liked ? (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFromCollections(img.id);
                            }}
                            className="bg-[#8f120d] border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer hover:animate-shake"
                          >
                            <FaRegHeart className="text-white text-lg" />
                          </span>
                        ) : (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedProduct1(img);
                              setIsPopupOpen(true);
                            }}
                            className="bg-black/80 border border-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition sm:w-8 sm:h-8 cursor-pointer hover:animate-shake"
                          >
                            <FaRegHeart className="text-white text-lg" />
                          </span>
                        )}
                      </div>

                      {/* Bottom name */}
                      <div className="absolute bottom-0 left-0 right-0 flex justify-between items-center px-1 ">
                        <div className="flex items-center gap-1 truncate opacity-0 group-hover:opacity-100 transition-opacity z-10">
                          <p className="text-white text-sm font-codec truncate whitespace-nowrap overflow-hidden text-ellipsis flex-1">
                            {img.name}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="col-span-full flex flex-wrap items-center justify-center gap-2 mt-8 font-codec text-sm text-white">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="h-8 px-20 bg-[#1a1a1a] border border-[#2D2D2D] rounded text-white/60"
              >
                Previous
              </button>

              <div className="flex flex-wrap h-8 items-center justify-center gap-2 bg-[#1a1a1a] text-[#a1a1a1] py-1 px-2 rounded border border-[#2D2D2D]">
                {Array.from({ length: totalPages }).map((_, index) => {
                  const page = index + 1;
                  if (page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1) {
                    return (
                      <button
                        key={page}
                        onClick={() => handlePageChange(page)}
                        className={`h-6 px-3 border rounded flex items-center justify-center ${
                          currentPage === page
                            ? "bg-white text-black"
                            : "bg-[#1a1a1a] text-white hover:bg-white/10 border-[#2D2D2D]"
                        }`}
                      >
                        {page}
                      </button>
                    );
                  } else if (
                    (page === currentPage - 2 && page > 2) ||
                    (page === currentPage + 2 && page < totalPages - 1)
                  ) {
                    return <span key={page} className="h-6 flex items-center px-2">...</span>;
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
                className="h-8 px-20 bg-[#1a1a1a] border border-[#2D2D2D] rounded text-white/60"
              >
                Next
              </button>
            </div>
          )}
        </main>

        {/* Popups & FAB */}
        {isPopupOpen && selectedProduct1 && (
          <CollectionPopup
            isOpen={isPopupOpen}
            onClose={() => setIsPopupOpen(false)}
            selectedProduct={selectedProduct1}
            onAddedToFavorites={handleAddedToFavorites}
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
            onRemove={(productId) =>
              setSelectedProductDowload((prev) => prev.filter((item) => item.id !== productId))
            }
            onOwnedChange={(ownedIds) => {
              const ids = Array.isArray(ownedIds) ? ownedIds.map(String) : [String(ownedIds)];
              setOwnedIdSet((prev) => {
                const next = new Set(prev);
                ids.forEach((x) => next.add(x));
                return next;
              });
            }}
          />
        )}
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
    </div>
  );
}
