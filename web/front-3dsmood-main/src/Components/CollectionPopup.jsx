import React, { useEffect, useMemo, useState, useRef } from "react";
import { FaTimes, FaRegHeart } from "react-icons/fa";
import axios from "axios";
import {
  fetchCollections,
  createCollection,
  addItemToCollection,
  getCollectionItems,
} from "../api/collections";

// ---- Hook: detect mobile (<768px) ----
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false
  );
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener ? mql.addEventListener("change", handler) : mql.addListener(handler);
    return () => {
      mql.removeEventListener ? mql.removeEventListener("change", handler) : mql.removeListener(handler);
    };
  }, []);
  return isMobile;
}

const CollectionPopup = ({
  isOpen,
  onClose,
  selectedProduct,
  onQuickCheckout,
  onAddedToFavorites, // ✅ NEW: báo parent cập nhật tim đỏ
}) => {
  const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
  const ASSET_BASE = (import.meta.env.VITE_ASSET_BASE_URL || API).replace(/\/+$/, "");
  const isMobile = useIsMobile();

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

  // mapProductsToDownloadItems (local)
  function mapProductsToDownloadItems(items = []) {
    return items
      .map((it) => {
        const p = it?.product || it;
        const id = p?.id ?? p?._id ?? it?.productId ?? it?.id ?? it?._id;
        if (!id) return null;

        const name = p?.name ?? p?.title ?? "Unnamed";
        const previewPath =
          p?.previewImagePath ??
          p?.preview ??
          p?.image ??
          p?.cover ??
          (Array.isArray(p?.images) ? p.images[0] : undefined);

        const preview = buildUrl(previewPath);
        const price = p?.price ?? p?.pricing?.price ?? it?.price ?? 0;
        const type = p?.type ?? p?.productType ?? p?.kind ?? null;
        const slug = p?.slug ?? null;

        return {
          id: String(id),
          productId: String(id),
          name,
          image: preview,
          preview,
          price,
          type,
          slug,
          raw: p,
        };
      })
      .filter(Boolean);
  }

  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingCid, setPendingCid] = useState(null);
  const [confirmMode, setConfirmMode] = useState(null); // 'ADD' | 'OPEN' | 'CART'

  const [collections, setCollections] = useState([]); // [{_id,name,count,contains}]
  const [selected, setSelected] = useState(new Set()); // set of collectionIds
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  // Safe product access
  const hasProduct = !!selectedProduct;
  const productId = hasProduct ? (selectedProduct._id || selectedProduct.id) : null;
  const productIdStr = productId ? String(productId) : null; // ✅ chuẩn hoá cho callback
  const productName = hasProduct ? (selectedProduct.name || "Unnamed") : "Chưa chọn sản phẩm";
  const mainImagePath = hasProduct
    ? (selectedProduct.image ?? selectedProduct.images?.[0])
    : null;

  // Fallback gọi danh sách thư mục khi không có productId (để vẫn hiển thị favorites)
  async function fetchCollectionsNoProduct() {
    try {
      let tok = localStorage.getItem("token");
      try {
        const parsed = JSON.parse(tok);
        tok = typeof parsed === "string" ? parsed : (parsed?.token ?? tok);
      } catch {}
      const headers = tok ? { Authorization: `Bearer ${tok}` } : undefined;

      const res = await axios.get(`${API}/api/account/collections`, {
        headers,
        params: { populate: 0 },
      });
      return res?.data?.collections || [];
    } catch (e) {
      console.error("fetchCollectionsNoProduct error:", e);
      return [];
    }
  }

  // Luôn hiển thị thư mục
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      setLoading(true);
      try {
        let list;
        if (productId) {
          list = await fetchCollections(productId);
          setSelected(
            new Set((list || []).filter((c) => c?.contains).map((c) => c?._id).filter(Boolean))
          );
        } else {
          try {
            list = await fetchCollections();
          } catch {
            list = null;
          }
          if (!Array.isArray(list)) list = await fetchCollectionsNoProduct();
          setSelected(new Set()); // chưa có sản phẩm thì không tick contains
        }
        setCollections(list || []);
      } catch (e) {
        console.error(e);
        setCollections([]);
        setSelected(new Set());
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen, productId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return collections || [];
    return (collections || []).filter((c) => (c?.name || "").toLowerCase().includes(q));
  }, [collections, query]);

  const toggle = (id) => {
    if (!id || !productId) return; // không cho tick khi chưa có sản phẩm
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const handleCreate = async () => {
    const name = (prompt("Tên thư mục mới:") || "").trim();
    if (!name) return;
    setLoading(true);
    try {
      const created = await createCollection(name);
      setCollections((prev) => [created, ...(prev || [])]);
      if (productId) setSelected((prev) => new Set(prev).add(created._id));
    } catch (e) {
      alert(e?.response?.data?.message || "Không tạo được thư mục");
    } finally {
      setLoading(false);
    }
  };

  const handleAddSelected = async () => {
    if (!productId) {
      alert("Chưa chọn sản phẩm để thêm vào thư mục.");
      return;
    }
    if (selected.size === 0) {
      onClose?.();
      return;
    }
    setLoading(true);
    try {
      await Promise.all([...selected].map((cid) => addItemToCollection(cid, productId)));
      // ✅ báo parent để cập nhật tim đỏ ngay
      onAddedToFavorites?.(productIdStr);
      onClose?.();
    } catch (e) {
      alert(e?.response?.data?.message || "Thêm vào thư mục thất bại");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickCheckout = async (e, collectionId) => {
    e.stopPropagation();
    try {
      const { items } = await getCollectionItems(collectionId, { limit: 200 });
      const mapped = mapProductsToDownloadItems(items || []);
      if (typeof onQuickCheckout === "function") onQuickCheckout(mapped);
      onClose?.(); // đóng CollectionPopup
    } catch (err) {
      alert(err?.response?.data?.message || "Không thể lấy danh sách sản phẩm của thư mục");
    }
  };

  // ====== Đổ tất cả sp của collection vào giỏ ======
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

  async function addOneToCart(pid, token) {
    const res = await axios.post(
      `${API}/api/cart/add`,
      { productId: pid, quantity: 1 },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return res?.data ?? {};
  }

  async function bulkAddCollectionToCart(collectionId) {
    const token = readToken();
    if (!token) {
      alert("Vui lòng đăng nhập để thêm vào giỏ hàng.");
      return;
    }
    try {
      const { items } = await getCollectionItems(collectionId, { limit: 500 });

      const ids = (items || [])
        .map((it) => it?.product?.id || it?.product?._id || it?.id || it?._id || it?.productId)
        .filter(Boolean)
        .map(String);

      const uniqIds = [...new Set(ids)];

      let ok = 0, skippedPurchased = 0, failed = 0;

      for (const pid of uniqIds) {
        try {
          const data = await addOneToCart(pid, token);
          if (data?.ok && data?.alreadyPurchased) skippedPurchased++;
          else if (data?.ok) ok++;
          else failed++;
        } catch (err) {
          if (err?.response?.status === 401) {
            alert("Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.");
            break;
          }
          failed++;
        }
      }

      alert(
        `Đã thêm vào giỏ: thành công ${ok}` +
        (skippedPurchased ? `, đã mua ${skippedPurchased}` : "") +
        (failed ? `, lỗi ${failed}` : "")
      );
    } catch (err) {
      alert(err?.response?.data?.message || "Không thể lấy danh sách sản phẩm của thư mục");
    }
  }
  // ================================================
  const popupRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlerMouse = (e) => { if (popupRef.current && !popupRef.current.contains(e.target)) onClose?.(); };
    const handlerTouch = (e) => { if (popupRef.current && !popupRef.current.contains(e.target)) onClose?.(); };
    document.addEventListener("mousedown", handlerMouse);
    document.addEventListener("touchstart", handlerTouch);
    return () => {
      document.removeEventListener("mousedown", handlerMouse);
      document.removeEventListener("touchstart", handlerTouch);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // ===== Desktop layout (GIỮ NGUYÊN) =====
  const DesktopLayout = () => (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[999] font-codec">
      <div className="bg-[linear-gradient(to_bottom,_#0c0002_70%,_#290602_100%)] rounded-xl border border-[#2D2D2D]"
       ref={popupRef}>
        <div className="rounded-xl shadow-lg flex w-[550px] overflow-hidden">
          {/* Left: Image + title */}
          <div className="w-[300px] p-4 mb-28">
            {(() => {
              const previewPath = mainImagePath;
              const name = productName;
              return (
                <>
                  <img
                    src={buildUrl(previewPath)}
                    alt={hasProduct ? "Preview" : "No product"}
                    className="w-[240px] h-[240px] object-cover rounded-md mb-3"
                  />
                  <p className="text-white/80 text-[14px] bg-[#2b2b2b]  w-[240px] px-3 py-1 rounded">
                    {name}
                  </p>
                </>
              );
            })()}
          </div>

          <div className="w-px bg-white/10 mx-1" />

          {/* Right: Collections */}
          <div className="w-[400px] p-4 text-white flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg flex items-center gap-2">
                  <FaRegHeart className="text-white text-lg mx-1" />
                  <span className="font-codec">My Collection</span>
                </h3>
                <button
                  onClick={onClose}
                  className="text-white/60 hover:text-white text-xl bg-transparent p-0"
                >
                  <FaTimes />
                </button>
              </div>

              {/* Search */}
              <div className="flex items-center bg-[#2b2b2b] text-white rounded px-1 py-2 mt-6">
                <span className="flex items-center justify-center transition sm:w-12 sm:h-6 cursor-pointer ml-[-10px] p-0 mt-[-6px]">
                  <img
                    src="/Untitled-2.svg"
                    alt="Cart"
                    className="w-12 h-12 object-contain scale-125"
                  />
                </span>
                <input
                  type="text"
                  placeholder="Search here..."
                  className="bg-transparent text-white placeholder-white/60 placeholder:text-[14px] placeholder:font-codec text-sm w-full focus:outline-none"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              {/* List of collections */}
              <div className="custom-checkbox space-y-2 mt-6 ml-[-6px]">
                {loading && <div className="text-white/60 text-[14px]">Loading...</div>}
                {!loading &&
                  (filtered || []).map((c, index) => {
                    const idHtml = `checkbox-${index}`;
                    const cid = c?._id;
                    const checked = cid ? selected.has(cid) : false;
                    return (
                      <div
                        key={cid || index}
                        className="flex items-center justify-between w-full rounded group transition"
                      >
                        {/* Left: checkbox + label */}
                        <div className="flex items-center gap">
                          <input
                            type="checkbox"
                            id={idHtml}
                            checked={checked}
                            onChange={() => toggle(cid)}
                            disabled={!cid || !productId}
                            title={!productId ? "Chọn sản phẩm để thêm vào thư mục" : undefined}
                          />
                          <label
                            htmlFor={idHtml}
                            className="text-white/60 text-[14px] cursor-pointer"
                          >
                            {c?.name || "(no name)"}
                          </label>
                        </div>

                        {/* Right: Quick action (CART mặc định) */}
                        <div
                          className="w-6 h-6 p-1 rounded-full border border-white/30 opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center justify-center"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!cid) return;
                            setPendingCid(cid);
                            setConfirmMode("CART"); // hoặc 'OPEN'
                            setShowConfirm(true);
                          }}
                          role="button"
                          aria-disabled={!cid}
                        >
                          <img
                            src="/Download.svg"
                            alt="Arrow icon"
                            className="w-full h-full scale-150 cursor-pointer"
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex justify-between items-center mt-6">
              <button
                className="flex items-center gap-2 text-sm text-white/80 hover:text-white bg-[#2b2b2b] px-5 py-0.5"
                onClick={handleCreate}
              >
                <span className="text-lg font-codec">+ Create new</span>
              </button>

              <button
                className="bg-[#8f120d] hover:bg-[#6c0d0a] text-white text-sm px-5 py-0.5 rounded disabled:opacity-60"
                onClick={handleAddSelected}
                disabled={loading || selected.size === 0 || !productId}
                title={!productId ? "Chưa có sản phẩm để thêm" : undefined}
              >
                <span className="text-lg font-codec">Add</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirm */}
      {showConfirm && (
        <div className="absolute top-8 left-1/2 -translate-x-1/2 bg-[linear-gradient(to_bottom,_#0c0002_70%,_#290602_100%)] rounded-xl border border-[#2D2D2D] text-white px-4 py-3 rounded-md shadow-lg z-50 w-[290px]">
          <p className="text-sm mb-3 text-center">
            {confirmMode === "OPEN"
              ? "Open this collection in Download?"
              : confirmMode === "CART"
              ? "Thêm toàn bộ sản phẩm của thư mục vào giỏ hàng?"
              : "Add this model to the collection?"}
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => {
                setShowConfirm(false);
                setPendingCid(null);
                setConfirmMode(null);
              }}
              className="bg-[#9b1c1c] hover:bg-[#8f120d] text-white text-sm px-4 py-0 rounded"
            >
              No
            </button>
            <button
              onClick={async () => {
                if (!pendingCid) {
                  setShowConfirm(false);
                  setConfirmMode(null);
                  return;
                }
                try {
                  if (confirmMode === "ADD") {
                    if (!productId) {
                      alert("Chưa có sản phẩm để thêm vào thư mục.");
                    } else {
                      await addItemToCollection(pendingCid, productId);
                      // ✅ callback ngay cả khi thêm qua confirm 'ADD'
                      onAddedToFavorites?.(productIdStr);
                    }
                  } else if (confirmMode === "OPEN") {
                    const { items } = await getCollectionItems(pendingCid, { limit: 200 });
                    const mapped = mapProductsToDownloadItems(items || []);
                    if (typeof onQuickCheckout === "function") onQuickCheckout(mapped);
                    onClose?.();
                  } else if (confirmMode === "CART") {
                    await bulkAddCollectionToCart(pendingCid);
                  }
                } catch (e) {
                  alert(e?.response?.data?.message || "Thao tác thất bại");
                } finally {
                  setShowConfirm(false);
                  setPendingCid(null);
                  setConfirmMode(null);
                }
              }}
              className="bg-[#9b1c1c] hover:bg-[#8f120d] text-white text-sm px-4 py-1 rounded"
            >
              Yes
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // ===== Mobile layout (BOTTOM SHEET) =====
  const MobileLayout = () => (
    <div className="fixed inset-0 z-[999] font-codec">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Sheet */}
      <div
         ref={popupRef}
        className="
          absolute inset-x-0 bottom-0
          bg-[linear-gradient(to_bottom,_#0c0002_65%,_#290602_100%)]
          border-t border-[#2D2D2D]
          rounded-t-2xl shadow-lg
          max-h-[90vh] min-h-[72vh]
          flex flex-col
        "
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 10px)" }}
      >
        {/* Header */}
        <div className="relative px-4 pt-3 pb-2">
          <div className="mx-auto h-1.5 w-12 rounded-full bg-white/25 mb-3" />
          <div className="flex items-center justify-between">
            <h3 className="text-white text-base font-semibold flex items-center gap-2">
              <FaRegHeart className="text-white/90" />
              My Collection
            </h3>
            <button
              className="text-white/80 active:scale-95 bg-transparent"
              onClick={onClose}
              aria-label="Đóng"
              title="Đóng"
            >
              <FaTimes size={18} />
            </button>
          </div>
        </div>

        <div className="h-px bg-[#1e1d1e]" />

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scroll px-3 pb-3">
          {/* Product preview (compact) */}
          <div className="mt-3">
            <div className="flex gap-3 p-2 rounded-lg border border-[#2D2D2D] bg-black/20">
              <img
                src={buildUrl(mainImagePath)}
                alt={hasProduct ? "Preview" : "No product"}
                className="w-16 h-16 object-cover rounded"
              />
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate" title={productName}>
                  {productName}
                </p>
                <p className="text-white/60 text-[11px] mt-0.5">
                  {hasProduct ? "Sẵn sàng thêm vào thư mục" : "Chưa chọn sản phẩm"}
                </p>
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="flex items-center bg-[#2b2b2b] text-white rounded px-2 py-2 mt-4">
            <img src="/Untitled-2.svg" alt="Cart" className="w-7 h-7 object-contain mr-1" />
            <input
              type="text"
              placeholder="Search here..."
              className="bg-transparent text-white placeholder-white/60 text-sm w-full focus:outline-none"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {/* Collections list */}
          <div className="mt-3 space-y-2">
            {loading && <div className="text-white/60 text-[14px]">Loading...</div>}
            {!loading &&
              (filtered || []).map((c, index) => {
                const idHtml = `m-checkbox-${index}`;
                const cid = c?._id;
                const checked = cid ? selected.has(cid) : false;
                return (
                  <div
                    key={cid || index}
                    className="flex items-center justify-between p-2 rounded-lg border border-[#2D2D2D] bg-black/20"
                  >
                    <label htmlFor={idHtml} className="flex items-center gap-2 min-w-0">
                      <input
                        id={idHtml}
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(cid)}
                        disabled={!cid || !productId}
                      />
                      <span className="text-white/80 text-sm truncate">
                        {c?.name || "(no name)"}
                      </span>
                    </label>

                    <span
                      className="shrink-0 w-8 h-8 rounded-full border border-white/25 grid place-items-center active:scale-95"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!cid) return;
                        setPendingCid(cid);
                        setConfirmMode("CART"); // hoặc 'OPEN'
                        setShowConfirm(true);
                      }}
                      title="Thêm toàn bộ vào giỏ"
                    >
                      <img src="/Download.svg" alt="" className="w-4 h-4" />
                    </span>
                  </div>
                );
              })}
          </div>

          <div className="h-24" /> {/* spacer for sticky footer */}
        </div>

        {/* Sticky Footer */}
        <div className="sticky bottom-0 inset-x-0 px-3">
          <div className="rounded-xl bg-[#1e1e1e] border border-[#373737] px-3 py-3 text-[#cfcfcf] flex items-center justify-between">
            <button
              className="text-white/80 bg-[#2b2b2b] px-4 py-2 rounded active:scale-95"
              onClick={handleCreate}
            >
              + Create new
            </button>
            <button
              className="h-11 rounded-lg bg-[#8f120d] hover:bg-[#a91410] disabled:opacity-60 text-white text-base px-5 active:scale-[.99]"
              onClick={handleAddSelected}
              disabled={loading || selected.size === 0 || !productId}
              title={!productId ? "Chưa có sản phẩm để thêm" : ""}
            >
              Add {selected.size ? `(${selected.size})` : ""}
            </button>
          </div>
        </div>
      </div>

      {/* Confirm (centered modal) */}
      {showConfirm && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => {
            setShowConfirm(false); setPendingCid(null); setConfirmMode(null);
          }} />
          <div className="relative z-[1001] w-[90%] max-w-[320px] bg-[linear-gradient(to_bottom,_#0c0002_70%,_#290602_100%)] border border-[#2D2D2D] rounded-xl px-4 py-4 text-white">
            <p className="text-sm mb-3 text-center">
              {confirmMode === "OPEN"
                ? "Open this collection in Download?"
                : confirmMode === "CART"
                ? "Thêm toàn bộ sản phẩm của thư mục vào giỏ hàng?"
                : "Add this model to the collection?"}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowConfirm(false); setPendingCid(null); setConfirmMode(null); }}
                className="bg-[#9b1c1c] hover:bg-[#8f120d] text-white text-sm px-4 py-1 rounded"
              >
                No
              </button>
              <button
                onClick={async () => {
                  if (!pendingCid) {
                    setShowConfirm(false);
                    setConfirmMode(null);
                    return;
                  }
                  try {
                    if (confirmMode === "ADD") {
                      if (!productId) {
                        alert("Chưa có sản phẩm để thêm vào thư mục.");
                      } else {
                        await addItemToCollection(pendingCid, productId);
                        // ✅ callback ngay cả khi thêm qua confirm 'ADD'
                        onAddedToFavorites?.(productIdStr);
                      }
                    } else if (confirmMode === "OPEN") {
                      const { items } = await getCollectionItems(pendingCid, { limit: 200 });
                      const mapped = mapProductsToDownloadItems(items || []);
                      if (typeof onQuickCheckout === "function") onQuickCheckout(mapped);
                      onClose?.();
                    } else if (confirmMode === "CART") {
                      await bulkAddCollectionToCart(pendingCid);
                    }
                  } catch (e) {
                    alert(e?.response?.data?.message || "Thao tác thất bại");
                  } finally {
                    setShowConfirm(false);
                    setPendingCid(null);
                    setConfirmMode(null);
                  }
                }}
                className="bg-[#9b1c1c] hover:bg-[#8f120d] text-white text-sm px-4 py-1 rounded"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return isMobile ? <MobileLayout /> : <DesktopLayout />;
};

export default CollectionPopup;
