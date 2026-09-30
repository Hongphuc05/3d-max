import React, { useEffect, useMemo, useState, useCallback } from "react";
import { FaTimes } from "react-icons/fa";
import axios from "axios";
import DownloadPopup from "../../Components/dowloadPopup";
import { useNavigate } from "react-router-dom";
import { FaEdit, FaTrash } from "react-icons/fa";
import { COUNTER_EVENT_DIRTY, COUNTER_EVENT_SET } from "../../utils/counterBus";

export default function Collection({ onOpenDownload }) {
  const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
  const ASSET_BASE = import.meta.env.VITE_ASSET_BASE_URL || API;
  const buildUrl = (path) => {
    if (!path) return "/product1-1.jpg"; // ảnh mặc định
    if (typeof path === "object") {
      console.warn("Path is an object:", path);
      return `${ASSET_BASE}${path?.path || "/product1-1.jpg"}`;
    }
    if (/^https?:\/\//i.test(path)) return path;
    return `${ASSET_BASE}/${String(path).replace(/^\/+/, "")}`;
  };
  const navigate = useNavigate();

  // ====== Điều hướng theo điều kiện category ======
  const SCENE_CATEGORY_ID = "68a55296e06aee921714659e"; // ID bạn yêu cầu
  const ROUTE_SCENE_DETAIL = "/product-detail-scenes";
  const ROUTE_MODEL_DETAIL = "/product-detail";
  function getDetailPath(itemId, isScene) {
    return `${isScene ? ROUTE_SCENE_DETAIL : ROUTE_MODEL_DETAIL}/${itemId}`;
  }
  // =================================================

  // ✅ axios instance
  const api = useMemo(() => {
    const instance = axios.create({ baseURL: API });
    instance.interceptors.request.use((cfg) => {
      const token = localStorage.getItem("token");
      if (token) cfg.headers.Authorization = `Bearer ${token}`;
      return cfg;
    });
    return instance;
  }, [API]);

  const [active, setActive] = useState("all");

  const [categories, setCategories] = useState([]);
  const [collections, setCollections] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState(new Set());

  const useInternalPopup = typeof onOpenDownload !== "function";
  const [isDownloadOpen, setIsDownloadOpen] = useState(false);
  const [selectedProductDowload, setSelectedProductDowload] = useState([]);
  const handleRemoveProductFromDownload = (productId) =>
    setSelectedProductDowload((prev) => prev.filter((item) => item.id !== productId));
  const [showConfirm, setShowConfirm] = useState(false);

  // ===== Pagination state (client-side): 10 sản phẩm / trang =====
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  // fetch collections
  const fetchCollections = useCallback(
    async (signal) => {
      try {
        setLoading(true);
        setError("");
        const { data } = await api.get("/api/account/collections", {
          params: { populate: 1 },
          signal,
        });

        setCollections(data.collections || []);
        setCategories(data.categories || []);
        setAllItems(data.allItems || []);

        if (active !== "all") {
          const stillExists = (data.collections || []).some((c) => c.slug === active);
          if (!stillExists) setActive("all");
        }

        setSelected((prev) => {
          const validIds = new Set((data.allItems || []).map(({ product }) => String(product?._id)));
          const next = new Set();
          prev.forEach((id) => {
            if (validIds.has(String(id))) next.add(id);
          });
          return next;
        });
      } catch (e) {
        if (e?.name !== "CanceledError") {
          console.error(e);
          setError("Không tải được danh sách bộ sưu tập.");
        }
      } finally {
        setLoading(false);
      }
    },
    [api, active]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchCollections(controller.signal);
    return () => controller.abort();
  }, [fetchCollections]);

  // Build product list theo tab (chưa cắt trang)
  const PRODUCTS = useMemo(() => {
    if (loading) return [];
    if (active === "all") {
      return (allItems || []).map(({ product, inSlug }, i) => ({
        id: String(product?._id || i),
        name: product?.name || "Unnamed",
        image: buildUrl(product?.previewImagePath || product?.thumbnail || product?.images?.[0]),
        price: typeof product?.price === "number" ? product.price : 0,
        category: inSlug,
        catIds: Array.isArray(product?.categoryIds)
          ? product.categoryIds.map(String)
          : Array.isArray(product?.categories)
          ? product.categories.map(String)
          : [],
      }));
    }
    const c = (collections || []).find((x) => x.slug === active);
    if (!c) return [];
    return (c.items || []).map((p, i) => ({
      id: String(p?._id || i),
      name: p?.name || "Unnamed",
      image: buildUrl(p?.previewImagePath || p?.thumbnail || p?.images?.[0]),
      price: typeof p?.price === "number" ? p.price : 0,
      category: c.slug,
    }));
  }, [active, loading, allItems, collections]);

  useEffect(() => {
    setPage(1);
  }, [active]);

  const totalItems = PRODUCTS.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalItems, limit]);

  const pagedItems = useMemo(() => {
    const start = (page - 1) * limit;
    const end = start + limit;
    return PRODUCTS.slice(start, end);
  }, [PRODUCTS, page, limit]);

  // ====== Helpers phân trang kiểu OrdersUsedCard ======
  const getVisiblePages = (current, total, max = 5) => {
    if (total <= max) return Array.from({ length: total }, (_, i) => i + 1);
    let start = Math.max(1, current - Math.floor(max / 2));
    let end = Math.min(total, start + max - 1);
    if (end - start + 1 < max) start = Math.max(1, end - max + 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  };
  const visiblePages = getVisiblePages(page, totalPages);

  const goToPage = (p) => {
    if (p < 1 || p > totalPages || p === page) return;
    setPage(p);
  };
  // ====================================================

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const removeSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const selectedItems = useMemo(() => PRODUCTS.filter((p) => selected.has(p.id)), [PRODUCTS, selected]);

  const isValidObjectId = (id) => /^[a-f\d]{24}$/i.test(String(id || ""));

  const removeFromCollections = async (productId) => {
    try {
      if (!isValidObjectId(productId)) {
        setError("ID sản phẩm không hợp lệ.");
        return;
      }

      if (active === "all") {
        await api.delete(`/api/account/collections/items/${productId}`);
      } else {
        await api.delete(`/api/account/collections/${active}/items/${productId}`);
      }

      await fetchCollections();
      removeSelect(String(productId));
    } catch (e) {
      console.error(e?.response?.status, e?.response?.data || e.message);
      setError(e?.response?.data?.message || "Không xoá được khỏi bộ sưu tập.");
    }
  };

  // DownloadPopup handlers
  const dedupeMerge = (base, itemsToAdd) => {
    const map = new Map(base.map((i) => [String(i.id), i]));
    itemsToAdd.forEach((i) => map.set(String(i.id), i));
    return Array.from(map.values());
  };

  const addToDownloadAndOpen = (itemsToAdd) => {
    if (!itemsToAdd?.length) return;
    if (useInternalPopup) {
      setSelectedProductDowload((prev) => dedupeMerge(prev, itemsToAdd));
      setIsDownloadOpen(true);
    } else {
      onOpenDownload(itemsToAdd);
    }
  };
  const openDownloadForAll = () => {
    if (!PRODUCTS?.length) return; // tất cả theo bộ lọc hiện tại
    addToDownloadAndOpen(PRODUCTS);
  };
  const openDownloadForSelected = () => {
    if (selectedItems.length) addToDownloadAndOpen(selectedItems);
  };
  const openDownloadForOne = (item) => addToDownloadAndOpen([item]);

  // ====================== Add-to-cart cho toàn bộ item trong tab ======================
  const [cartBusy, setCartBusy] = useState(false);

  function readTokenFromLS() {
    let tok = localStorage.getItem("token");
    if (!tok) return null;
    try {
      const parsed = JSON.parse(tok);
      return typeof parsed === "string" ? parsed : parsed?.token ?? tok;
    } catch {
      return tok;
    }
  }

  async function addOneToCart(productId) {
    const { data } = await api.post("/api/cart/add", { productId, quantity: 1 });
    return data; // { ok: true, alreadyPurchased?: boolean, cartCount?: number }
  }

  const addAllInTabToCart = useCallback(async () => {
    const token = readTokenFromLS();
    if (!token) {
      alert("Vui lòng đăng nhập để thêm vào giỏ hàng.");
      return;
    }
    if (!PRODUCTS?.length) return;

    setCartBusy(true);
    let ok = 0,
      skippedPurchased = 0,
      failed = 0;

    const ids = PRODUCTS.map((p) => String(p.id)).filter((id) => isValidObjectId(id));
    const uniqIds = [...new Set(ids)];

    for (const pid of uniqIds) {
      try {
        const res = await addOneToCart(pid);
        if (res?.ok && res?.alreadyPurchased) skippedPurchased++;
        else if (res?.ok) ok++;
        else failed++;
      } catch (err) {
        if (err?.response?.status === 401) {
          alert("Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.");
          break;
        }
        failed++;
      }
    }

    setCartBusy(false);
    openDownloadForAll();

    // 🔔 Sau khi thêm hàng loạt xong mới cập nhật header
    try {
      window.dispatchEvent(new Event(COUNTER_EVENT_DIRTY));
    } catch {}
    try {
      const bc = new BroadcastChannel("user:counters");
      bc.postMessage({ type: "dirty" });
      bc.close();
    } catch {}
  }, [api, PRODUCTS]);
  // =========================================================================================

  // ====== CLICK CARD ======
  const handleCardClick = (e, item) => {
    if (e.ctrlKey || e.metaKey) {
      toggleSelect(item.id);
      return;
    }
    const isScene = Array.isArray(item.catIds) && item.catIds.includes(SCENE_CATEGORY_ID);
    navigate(getDetailPath(item.id, isScene));
  };

  const handleAddToCart = useCallback(
    async (e, product) => {
      e.stopPropagation();
      try {
        const token = readTokenFromLS();
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
          setIsDownloadOpen(true);

          // 🔔 Cập nhật badge ngay nếu server trả về cartCount
          try {
            const n = res?.data?.cartCount;
            if (typeof n === "number") {
              window.dispatchEvent(
                new CustomEvent(COUNTER_EVENT_SET, { detail: { cart: n } })
              );
            }
          } catch {}

          // 🔔 Yêu cầu Header refetch & sync đa tab
          try { window.dispatchEvent(new Event(COUNTER_EVENT_DIRTY)); } catch {}
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

  const [editingKey, setEditingKey] = useState(null); // slug đang sửa
  const [editValue, setEditValue] = useState("");
  const [busyCat, setBusyCat] = useState(false);

  async function renameCollection(slug, newName) {
    const name = String(newName || "").trim();
    if (!slug || !name) return;
    try {
      setBusyCat(true);
      await api.patch(`/api/account/collections/${slug}`, { name });
      await fetchCollections();
      setEditingKey(null);
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.message || "Đổi tên bộ sưu tập thất bại.");
    } finally {
      setBusyCat(false);
    }
  }

  async function deleteCollection(slug, label) {
    if (!slug) return;
    const ok = window.confirm(`Xoá bộ sưu tập "${label}"?`);
    if (!ok) return;
    try {
      setBusyCat(true);
      await api.delete(`/api/account/collections/${slug}`);
      if (active === slug) setActive("all");
      await fetchCollections();
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.message || "Xoá bộ sưu tập thất bại.");
    } finally {
      setBusyCat(false);
    }
  }

  // ==================== handleCreate() với fallback endpoint ====================
  function extractSlugFromCreateResponse(data) {
    return (
      data?.collection?.slug ||
      data?.created?.slug ||
      data?.slug ||
      data?.data?.slug ||
      null
    );
  }

  async function handleCreate() {
    const name = (window.prompt("Tên bộ sưu tập mới:") || "").trim();
    if (!name) return;

    const candidates = [
      "/api/account/collections",          // mong muốn
      "/api/collections",                  // fallback 1
      "/api/account/collections/create",   // fallback 2
      "/api/collections/create",           // fallback 3
    ];

    try {
      setBusyCat(true);

      let createdData = null;
      let usedUrl = null;

      for (const url of candidates) {
        try {
          const { data } = await api.post(url, { name });
          createdData = data;
          usedUrl = url;
          break;
        } catch (err) {
          const sc = err?.response?.status;
          if (sc === 404 || sc === 405) {
            // thử endpoint tiếp theo
            continue;
          }
          // lỗi khác -> ném ra luôn
          throw err;
        }
      }

      if (!createdData) {
        throw new Error("Không tìm thấy endpoint tạo bộ sưu tập (404/405 ở tất cả routes).");
      }

      console.warn("Create collection via:", usedUrl);

      await fetchCollections(); // làm tươi list

      const newSlug = extractSlugFromCreateResponse(createdData);
      if (newSlug) setActive(newSlug);
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.message || e.message || "Không tạo được bộ sưu tập.");
    } finally {
      setBusyCat(false);
    }
  }
  // ============================================================================

  return (
    <>
      <div className="rounded-2xl bg-opacity-50 overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between py-2">
          {/* Tabs */}
          <div className="flex items-center flex-wrap gap-2 font-codec">
            {(categories || []).map((c, i) => {
              const isActive = active === c.key;
              const isLocked = c.key === "all";
              const isEditing = editingKey === c.key;

              return (
                <div key={c.key} className="relative flex items-center gap-2 group">
                  {isEditing ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        renameCollection(c.key, editValue);
                      }}
                      className="flex items-center gap-2"
                    >
                      <input
                        autoFocus
                        disabled={busyCat}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditingKey(null);
                        }}
                        className="px-3 py-1 rounded-lg text-sm border border-[#4d4d4d] text-zinc-200 outline-none"
                        placeholder="Tên bộ sưu tập"
                      />
                      <button
                        type="submit"
                        disabled={busyCat || !editValue.trim()}
                        className="px-2 py-1 rounded bg-[#8f120d] text-white text-xs disabled:opacity-50 font-source"
                        title="Lưu"
                      >
                        Lưu
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingKey(null)}
                        className="px-2 py-1 rounded bg-[#1f1f1f] text-zinc-200 text-xs font-source"
                        title="Huỷ"
                      >
                        Huỷ
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        onClick={() => setActive(c.key)}
                        aria-selected={isActive}
                        disabled={busyCat}
                        className={`px-3 py-0.5 rounded-lg text-sm transition border
                          ${
                            isActive
                              ? "bg-[#8f120d] text-white border-transparent"
                              : "text-zinc-300 hover:text-white bg-transparent border-transparent"
                          }
                        `}
                        title={c.label}
                      >
                        {c.label}{" "}
                        <span className={isActive ? "opacity-90" : "text-zinc-400"}>({c.count})</span>
                      </button>

                      {!isLocked && (
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                          <span
                            type="button"
                            disabled={busyCat}
                            onClick={() => {
                              setEditingKey(c.key);
                              setEditValue(c.label || "");
                            }}
                            className="h-7 w-7 rounded-full bg-black/70 border border-[#4d4d4d] flex items-center justify-center text-zinc-200 hover:text-white"
                            title="Sửa tên"
                          >
                            <FaEdit size={12} />
                          </span>
                          <span
                            type="button"
                            disabled={busyCat}
                            onClick={() => deleteCollection(c.key, c.label)}
                            className="h-7 w-7 rounded-full bg-black/70 border border-[#4d4d4d] flex items-center justify-center text-zinc-200 hover:text-white"
                            title="Xoá"
                          >
                            <FaTrash size={12} />
                          </span>
                        </div>
                      )}

                      {i < (categories?.length || 0) - 1 && (
                        <span className="mx-3 text-zinc-600 hidden sm:inline">|</span>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Nút tạo bộ sưu tập mới */}
          <div className="font-codec">
            <button
              type="button"
              onClick={handleCreate}
              disabled={busyCat}
              className="px-3 py-1 rounded-lg text-sm border border-[#4d4d4d] text-zinc-200 hover:text-white bg-transparent disabled:opacity-50"
              title="Tạo bộ sưu tập mới"
            >
              + New
            </button>
          </div>
        </div>

        {/* Nút mở DownloadPopup + thêm tất cả vào giỏ */}
        <div className="relative h-6 mb-6">
          <button
            onClick={() => setShowConfirm(true)}
            disabled={PRODUCTS.length === 0 || cartBusy}
            className="absolute inline-flex items-center gap-2 rounded-lg border border-[#4d4d4d] bg-[#131313] px-3 py-1 text-sm text-zinc-200 hover:bg-black/50 right-2 font-codec disabled:opacity-50 font-source"
            title={selectedItems.length ? "Mở danh sách đã chọn" : "Hãy chọn item trước"}
            aria-busy={cartBusy ? "true" : "false"}
          >
            <img
              src="/Download.svg"
              alt="Cart"
              className="w-6 h-6 rounded-full border border-[#4d4d4d] p-1 bg-black "
            />
            Thêm vào danh sách thanh toán
          </button>
        </div>

        {/* Grid (đã cắt trang) */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-y-2 font-codec">
          {loading ? (
            <div className="col-span-full text-center text-zinc-400 py-10"></div>
          ) : error ? (
            <div className="col-span-full text-center text-red-300 py-10">{error}</div>
          ) : pagedItems.length === 0 ? (
            <div className="col-span-full text-center text-zinc-400 py-10 font-source">Chưa có sản phẩm nào.</div>
          ) : (
            pagedItems.map((p) => {
              const isSelected = selected.has(p.id);
              return (
                <div
                  key={p.id}
                  className={`group relative rounded-lg shadow-sm border overflow-hidden cursor-pointer xl:w-[160px] xl:h-[160px] 2xl:w-[240px] 2xl:h-[240px]
                              ${isSelected ? "border-[#8f120d]" : "border-[#4d4d4d]"}`}
                  onClick={(e) => handleCardClick(e, p)}
                  title={p.name}
                >
                  {/* Overlay buttons */}
                  <div className="absolute inset-0 flex items-start justify-end p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          await removeFromCollections(p.id);
                        }}
                        aria-label="Xoá khỏi yêu thích"
                        title="Xoá khỏi yêu thích"
                        className="relative h-8 w-8 rounded-full bg-black/80 border border-[#4d4d4d] flex items-center justify-center shadow-md overflow-hidden"
                      >
                        <FaTimes size={12} className="text-white absolute" />
                      </button>
                    </div>
                  </div>

                  {/* Quick Download */}
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddToCart(e, p);
                      }}
                      title="Mở DownloadPopup cho item này"
                      className="relative h-8 w-8 rounded-full bg-black/80 border border-[#4d4d4d] flex items-center justify-center shadow-md overflow-hidden"
                    >
                      <img
                        src="/Download.svg"
                        alt="download"
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-6 w-6 object-contain pointer-events-none [image-rendering:crisp-edges] [image-rendering:-webkit-optimize-contrast]"
                      />
                    </button>
                  </div>

                  <img
                    src={p.image}
                    alt={p.name}
                    className="w-full object-cover xl:min-h-[160px] 2xl:min-h-[240px]"
                  />
                </div>
              );
            })
          )}
        </div>

        {/* Pagination kiểu OrdersUsedCard */}
        <div className="px-3 py-3 border-t border-[#2D2D2D] flex items-center justify-between gap-2 font-codec">
          <div className="text-sm text-zinc-400 font-source">
            Trang {page} / {totalPages} • Tổng sản phẩm: {new Intl.NumberFormat("vi-VN").format(totalItems)}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              className={`text-sm px-3 py-1.5 rounded-md border font-source ${
                page <= 1
                  ? "text-zinc-500 border-[#3a3a3a] cursor-not-allowed"
                  : "text-zinc-200 border-[#4d4d4d] hover:bg-white/5 bg-black/40"
              }`}
            >
              Trước
            </button>

            {visiblePages.map((p) => (
              <button
                key={p}
                onClick={() => goToPage(p)}
                className={`text-sm px-3 py-1.5 rounded-md border font-source ${
                  p === page
                    ? "bg-white/10 text-white border-white/30"
                    : "bg-black/40 text-zinc-300 border-[#4d4d4d] hover:bg-white/5"
                }`}
              >
                {p}
              </button>
            ))}

            <button
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className={`text-sm px-3 py-1.5 rounded-md border font-source ${
                page >= totalPages
                  ? "text-zinc-500 border-[#3a3a3a] cursor-not-allowed"
                  : "text-zinc-200 border-[#4d4d4d] hover:bg-white/5 bg-black/40"
              }`}
            >
              Sau
            </button>
          </div>
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center">
          {/* overlay */}
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowConfirm(false)} />
          {/* modal */}
          <div className="relative z-[1001] w-[40%] max-w-[360px] bg-[linear-gradient(to_bottom,_#0c0002_70%,_#290602_100%)] border border-[#2D2D2D] rounded-xl px-4 py-4 text-white">
            <p className="text-sm mb-3 text-center font-source">
              Thêm <b>{PRODUCTS.length}</b> sản phẩm ở tab hiện tại vào giỏ hàng?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="bg-[#9b1c1c] hover:bg-[#8f120d] text-white text-sm px-4 py-0 rounded"
              >
                No
              </button>
              <button
                onClick={async () => {
                  await addAllInTabToCart();
                  setShowConfirm(false);
                }}
                disabled={cartBusy}
                className="bg-[#9b1c1c] hover:bg-[#8f120d] disabled:opacity-60 text-white text-sm px-4 py-1 rounded"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Popup nội bộ (nếu không dùng callback từ cha) */}
      {useInternalPopup && (
        <DownloadPopup
          isOpen={isDownloadOpen}
          onClose={() => setIsDownloadOpen(false)}
          selectedProduct={selectedProductDowload}
          onRemove={handleRemoveProductFromDownload}
        />
      )}
    </>
  );
}
