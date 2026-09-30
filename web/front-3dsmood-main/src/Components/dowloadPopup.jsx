// DownloadPopup.jsx
import React, { useState, useEffect, useRef } from "react";
import { FaTimes, FaWallet, FaRegStar } from "react-icons/fa";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../Contexts/AuthContext";
import { COUNTER_EVENT_DIRTY, COUNTER_EVENT_SET } from "../utils/counterBus";

const nf = new Intl.NumberFormat("vi-VN");

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

// ===== getAuthHeaders KHÔNG dùng navigate ở scope ngoài (tránh lỗi ReferenceError) =====
const getAuthHeaders = () => {
  const token = localStorage.getItem("token");
  if (!token) throw new Error("NO_AUTH");
  return { Authorization: `Bearer ${token}` };
};

// URL tuyệt đối?
const isAbsUrl = (u) => /^https?:\/\//i.test(String(u || ""));

// Mở download do trình duyệt xử lý (hiện download bar, không rời trang)
const startBrowserDownload = (href) => {
  try {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = href; // cần Content-Disposition: attachment từ BE
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

/**
 * Props:
 * - isOpen: boolean
 * - onClose: () => void
 * - initialDiscountId?: string  // ID mã giảm (từ Discount) -> popup sẽ tự áp khi mở
 * - onOwnedChange?: (ids: string[] | string) => void   // báo cha cập nhật owned badge ngay
 */
export default function DownloadPopup({ isOpen, onClose, initialDiscountId, onOwnedChange }) {
  const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
  const ASSET_BASE = import.meta.env.VITE_ASSET_BASE_URL || API;
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const popupRef = useRef(null);

  const buildUrl = (path) => {
    if (!path) return "/product1-1.jpg";
    if (typeof path === "object") return `${ASSET_BASE}${path?.path || "/product1-1.jpg"}`;
    if (/^https?:\/\//i.test(path)) return path;
    return `${ASSET_BASE}/${String(path).replace(/^\/+/, "")}`;
  };
  const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

  // ----- State tổng quát -----
  const [payMethod, setPayMethod] = useState("wallet"); // "wallet" | "points"
  const [walletBalance, setWalletBalance] = useState(0);
  const [points, setPoints] = useState(0);

  // ⤵️ TÁCH TỶ LỆ: earn (tích điểm khi trả coins) vs pay (quy đổi khi trả bằng points)
  const [pointRateEarn, setPointRateEarn] = useState(1000); // 1 điểm = X coins (khi TÍCH)
  const [pointRatePay, setPointRatePay] = useState(1000);   // 1 điểm = X coins (khi THANH TOÁN BẰNG ĐIỂM)

  const [applied, setApplied] = useState(null); // { id, code, finalTotal, discount, ui }
  const [discounts, setDiscounts] = useState([]);
  const [applyingId, setApplyingId] = useState(null);

  const [products, setProducts] = useState([]);
  const [purchasedIds, setPurchasedIds] = useState(new Set());
  const [buying, setBuying] = useState(false);
  const [unownedTotalAfterDiscount, setUnownedTotalAfterDiscount] = useState(null);

  // NEW: cờ biết khi nào dữ liệu đã sẵn sàng để auto-apply
  const [cartLoaded, setCartLoaded] = useState(false);
  const [ownedLoaded, setOwnedLoaded] = useState(false);
  const autoAppliedRef = useRef(null); // đảm bảo auto-apply 1 lần cho mỗi id

  // ===== CHỌN SẢN PHẨM THANH TOÁN =====
  const [selectedIds, setSelectedIds] = useState(new Set());
  const keyOf = (id) => String(id);

  // toàn bộ SP chưa sở hữu
  const unownedAll = products.filter((p) => !purchasedIds.has(keyOf(p.id)));

  // đồng bộ selection theo giỏ/owned; mặc định chọn tất cả chưa sở hữu
  useEffect(() => {
    const valid = new Set(unownedAll.map((p) => keyOf(p.id)));
    setSelectedIds((prev) => {
      if (!prev || prev.size === 0) return valid; // nếu rỗng → chọn tất cả
      const next = new Set();
      for (const id of prev) if (valid.has(id)) next.add(id);
      return next.size ? next : valid;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, purchasedIds]);

  const isSelected = (id) => selectedIds.has(keyOf(id));
  const toggleSelect = (id) => {
    const k = keyOf(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const toggleSelectAll = () => {
    const all = new Set(unownedAll.map((p) => keyOf(p.id)));
    setSelectedIds((prev) => (prev.size === all.size ? new Set() : all));
  };
  const selectedUnowned = unownedAll.filter((p) => selectedIds.has(keyOf(p.id)));

  // ----- Fetchers -----
  const fetchSummary = async () => {
    try {
      if (user) {
        if (typeof user.coins === "number") setWalletBalance(user.coins);
        if (typeof user.points === "number") setPoints(user.points);
      }
      const res = await axios.get(`${API}/api/account/summary`, { headers: getAuthHeaders() });
      if (typeof res?.data?.wallet === "number") setWalletBalance(res.data.wallet);
      if (typeof res?.data?.points === "number") setPoints(res.data.points);
    } catch (e) {
      if (e.message !== "NO_AUTH") console.warn(e?.response?.data || e.message);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await axios.get(`${API}/api/payments/config`, { headers: getAuthHeaders() });
      // Hỗ trợ cả cấu hình mới & tương thích cũ
      const earn = Number(res?.data?.pointRateEarn);
      const pay = Number(res?.data?.pointRatePay);
      const legacy = Number(res?.data?.pointRate); // cũ: dùng chung

      if (!Number.isNaN(earn) && earn > 0) setPointRateEarn(earn);
      else if (!Number.isNaN(legacy) && legacy > 0) setPointRateEarn(legacy);

      if (!Number.isNaN(pay) && pay > 0) setPointRatePay(pay);
      else if (!Number.isNaN(legacy) && legacy > 0) setPointRatePay(legacy);
    } catch {
      // giữ mặc định
    }
  };

  const fetchCart = async () => {
    try {
      const res = await axios.get(`${API}/api/cart`, { headers: getAuthHeaders() });
      const cart = toArray(res?.data?.cart);
      const mapped = cart.map((it) => {
        const p = it.productId || {};
        return {
          id: p?._id || it.productId,
          name: p?.name || "",
          price: typeof p?.price === "number" ? p.price : Number(p?.price || 0),
          previewImagePath: p?.previewImagePath || null,
          image: p?.previewImagePath || "/product1-1.jpg",
          quantity: Math.max(1, Number(it?.quantity || 1)),
          categoryIds: p?.categoryIds || it?.categoryId || null,
          customId: p?.customId || null,
        };
      });
      console.log(mapped);
      setProducts(mapped);
    } finally {
      setCartLoaded(true); // đánh dấu giỏ đã sẵn sàng
    }
  };

  // ----- Khởi động khi mở popup -----
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        await Promise.all([fetchSummary(), fetchConfig(), fetchCart()]);
      } catch (e) {
        if (e.message === "NO_AUTH") {
          // navigate("/login");
        } else {
          console.warn(e?.response?.data || e.message);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Kiểm tra sản phẩm đã mua
  useEffect(() => {
    if (!isOpen || products.length === 0) {
      setOwnedLoaded(true); // giỏ trống xem như xong
      return;
    }
    const ids = products.map((p) => p.id).join(",");
    axios
      .get(`${API}/api/orders/owned?ids=${ids}`, { headers: getAuthHeaders() })
      .then((res) => setPurchasedIds(new Set(toArray(res?.data?.owned).map(String))))
      .catch((e) => {
        if (e.message !== "NO_AUTH") console.warn(e?.response?.data || e.message);
      })
      .finally(() => setOwnedLoaded(true));
  }, [isOpen, products, API]);

  // Lấy danh sách mã public hiển thị trong popup
  useEffect(() => {
    axios
      .get(`${API}/api/discounts/public/list`)
      .then((res) => setDiscounts(res.data || []))
      .catch(() => setDiscounts([]));
  }, [API]);

  // Đóng khi click ra ngoài
  useEffect(() => {
    if (!isOpen) return;
    const handlerMouse = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) onClose?.();
    };
    const handlerTouch = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) onClose?.();
    };
    document.addEventListener("mousedown", handlerMouse);
    document.addEventListener("touchstart", handlerTouch);
    return () => {
      document.removeEventListener("mousedown", handlerMouse);
      document.removeEventListener("touchstart", handlerTouch);
    };
  }, [isOpen, onClose]);

  // ======= Handlers =======
  const handleRemoveProduct = async (productId) => {
    try {
      const res = await axios.delete(`${API}/api/cart/${productId}`, {
        headers: getAuthHeaders(),
      });

      const ok =
        (res && res.status >= 200 && res.status < 300) ||
        res?.data?.ok === true ||
        res?.data?.success === true;

      if (!ok) {
        throw new Error(res?.data?.message || "Xóa sản phẩm thất bại");
      }

      // Cập nhật UI local trước, đồng thời tính count để bắn sự kiện
      setProducts((prev) => {
        const next = prev.filter(
          (item) => String(item.id ?? item._id) !== String(productId)
        );

        // Ưu tiên số lượng từ server; nếu không có thì dùng next.length
        const serverCount = res?.data?.cartCount;
        const nextCount =
          typeof serverCount === "number" ? serverCount : next.length;

        // 🔔 Cập nhật badge ngay lập tức theo nextCount
        try {
          window.dispatchEvent(
            new CustomEvent(COUNTER_EVENT_SET, { detail: { cart: nextCount } })
          );
        } catch {}

        // 🔔 Cho Header tự refetch để đảm bảo tuyệt đối
        try {
          window.dispatchEvent(new Event(COUNTER_EVENT_DIRTY));
        } catch {}

        // 🔔 Đồng bộ giữa các tab
        try {
          const bc = new BroadcastChannel("user:counters");
          bc.postMessage({ type: "dirty" });
          bc.close();
        } catch {}

        return next;
      });

      // loại khỏi selection nếu đang chọn
      setSelectedIds((old) => {
        const k = keyOf(productId);
        const nn = new Set(old);
        nn.delete(k);
        return nn;
      });
    } catch (e) {
      alert(e?.response?.data?.message || e.message || "Không xoá được sản phẩm khỏi giỏ");
    }
  };

  const handleRemoveAll = async () => {
    try {
      const res = await axios.delete(`${API}/api/cart`, { headers: getAuthHeaders() });

      // ✅ Chỉ coi là thành công khi backend trả 2xx hoặc có cờ ok
      const ok =
        (res && res.status >= 200 && res.status < 300) ||
        (res?.data && (res.data.ok === true || res.data.success === true));

      if (!ok) {
        throw new Error(res?.data?.message || "Xóa giỏ hàng thất bại");
      }

      // Cập nhật UI local trước
      setProducts([]);

      // reset selection
      setSelectedIds(new Set());

      // 🔔 1) Cập nhật badge ngay lập tức về 0
      try {
        window.dispatchEvent(
          new CustomEvent(COUNTER_EVENT_SET, { detail: { cart: 0 } })
        );
      } catch {}

      // 🔔 2) Yêu cầu Header refetch
      try {
        window.dispatchEvent(new Event(COUNTER_EVENT_DIRTY));
      } catch {}

      // 🔔 3) Đồng bộ giữa các tab
      try {
        const bc = new BroadcastChannel("user:counters");
        bc.postMessage({ type: "dirty" });
        bc.close();
      } catch {}
    } catch (e) {
      alert(e?.response?.data?.message || e.message || "Không thể xoá toàn bộ giỏ");
    }
  };

  // Áp / Huỷ mã (toggle theo cùng 1 mã), chỉ áp cho phần CHƯA MUA & ĐANG CHỌN
  const handleApplyDiscount = async (badge) => {
    // Toggle OFF nếu bấm lại cùng 1 mã đang áp
    if (applied?.id === badge._id) {
      setApplied(null);
      setUnownedTotalAfterDiscount(null);
      return;
    }

    try {
      setApplyingId(badge._id);

      const cartItems = selectedUnowned.map((p) => ({
        productId: p.id,
        price: Number(p.price || 0),
        qty: Math.max(1, Number(p.quantity || 1)),
        categoryId: p.categoryId || null,
      }));

      if (cartItems.length === 0) {
        alert("Hãy chọn ít nhất 1 sản phẩm để áp mã.");
        setApplyingId(null);
        return;
      }

      const orderTotal = cartItems.reduce(
        (s, it) => s + Number(it.price || 0) * Math.max(1, Number(it.qty || 1)),
        0
      );

      const res = await axios.post(
        `${API}/api/discounts/apply`,
        { discountId: badge._id, cartItems, orderTotal, mini: false },
        { headers: getAuthHeaders() }
      );
      setApplied({
        ui: res.data.ui,
        discount: res.data.discount,
        finalTotal: res.data.finalTotal,
        code: res.data.code || null,
        id: badge._id,
      });
    } catch (e) {
      alert(e?.response?.data?.message || "Áp dụng thất bại");
    } finally {
      setApplyingId(null);
    }
  };

  // Tính mini cho phần CHƯA MUA & ĐANG CHỌN khi đã có applied
  useEffect(() => {
    const items = selectedUnowned.map((p) => ({
      productId: p.id,
      price: Number(p.price || 0),
      qty: Math.max(1, Number(p.quantity || 1)),
      categoryId: p.categoryId || null,
    }));
    if (!applied || items.length === 0) {
      setUnownedTotalAfterDiscount(null);
      return;
    }
    const orderTotal = items.reduce((s, it) => s + it.price * it.qty, 0);
    axios
      .post(
        `${API}/api/discounts/apply`,
        { discountId: applied.id, cartItems: items, orderTotal, mini: true },
        { headers: getAuthHeaders() }
      )
      .then((r) => setUnownedTotalAfterDiscount(r?.data?.finalTotal ?? null))
      .catch(() => setUnownedTotalAfterDiscount(null));
  }, [applied?.id, selectedIds, products, purchasedIds, API]);

  // Mua (chỉ phần CHƯA MUA & ĐANG CHỌN)
  const handleBuy = async () => {
    try {
      setBuying(true);

      const unownedIds = Array.from(new Set(selectedUnowned.map((p) => keyOf(p.id))));
      if (unownedIds.length === 0) {
        alert("Hãy chọn ít nhất 1 sản phẩm để thanh toán.");
        setBuying(false);
        return;
      }

      const body = {
        productIds: unownedIds,
        couponCode: applied?.code || null,
        discountId: applied?.id || null,
        paymentMethod: payMethod, // "wallet" | "points"
      };

      const res = await axios.post(`${API}/api/orders/buy`, body, { headers: getAuthHeaders() });

      if (res.data?.ok) {
        const next = new Set(purchasedIds);
        const newly = toArray(res?.data?.purchasedNew).map(String);
        (newly.length ? newly : unownedIds).forEach((id) => next.add(String(id)));
        setPurchasedIds(next);

        if (res?.data?.balances) {
          if (typeof res.data.balances.wallet === "number") setWalletBalance(res.data.balances.wallet);
          if (typeof res.data.balances.points === "number") setPoints(res.data.balances.points);
        }

        // báo cha cập nhật owned badge ngay
        try {
          const notifyIds = newly.length ? newly : unownedIds;
          onOwnedChange?.(notifyIds);
        } catch {}

        if (res?.data?.earnedPoints) {
          // optional toast
        }

        alert("Thanh toán thành công!");
      } else {
        alert(res.data?.message || "Thanh toán thất bại");
      }
    } catch (e) {
      alert(e?.response?.data?.message || e.message || "Thanh toán thất bại");
    } finally {
      setBuying(false);
    }
  };

  // Download (image/file) – native download để có progress & không chuyển trang
  const downloadProduct = async (productId, type) => {
    try {
      const res = await axios.get(`${API}/api/downloads/product/${productId}?type=${type}`, {
        headers: getAuthHeaders(),
      });
    const url = res.data?.url; // thường là /api/downloads/stream/:token
      if (!url) throw new Error("Không nhận được URL tải");

      const href = isAbsUrl(url) ? url : `${API}${url.startsWith("/") ? url : `/${url}`}`;
      startBrowserDownload(href); // trình duyệt hiện download bar
    } catch (e) {
      alert(e?.response?.data?.message || e.message || "Không tải được tệp");
    }
  };

  const canDownload = (item) =>
    Number(item.price || 0) === 0 || purchasedIds.has(String(item.id));

  // ====== Auto-apply discount khi mở từ Discount.jsx ======
  useEffect(() => {
    if (isOpen) autoAppliedRef.current = null; // reset mỗi lần mở mới
  }, [isOpen, initialDiscountId]);

  useEffect(() => {
    if (!isOpen) return;
    if (!initialDiscountId) return;
    if (!cartLoaded || !ownedLoaded) return;     // chờ cart + owned sẵn sàng
    if (!discounts?.length) return;

    if (applied?.id === initialDiscountId) return;                // đã áp
    if (autoAppliedRef.current === initialDiscountId) return;     // đã thử

    const target = discounts.find(d => String(d._id) === String(initialDiscountId));
    if (!target) return;

    autoAppliedRef.current = initialDiscountId;
    handleApplyDiscount(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialDiscountId, discounts, cartLoaded, ownedLoaded, applied?.id]);

  if (!isOpen) return null;

  // ------ TÍNH TỔNG CHO SẢN PHẨM ĐÃ CHỌN & CHƯA SỞ HỮU ------
  const unownedTotal = selectedUnowned.reduce(
    (s, it) => s + Number(it.price || 0) * Math.max(1, Number(it.quantity || 1)),
    0
  );

  const displayTotal = applied
    ? (unownedTotalAfterDiscount ?? applied.finalTotal ?? unownedTotal)
    : unownedTotal;

  // Tổng phải trả thật sự
  const payableTotal = applied
    ? (unownedTotalAfterDiscount ?? unownedTotal)
    : unownedTotal;

  // ⤵️ TÍNH BẰNG TỶ LỆ THANH TOÁN pointRatePay (KHÔNG dùng pointRateEarn)
  const requiredPoints = Math.ceil((payableTotal || 0) / (pointRatePay || 1)) || 0;
  const lacksFunds = payMethod === "wallet" ? walletBalance < payableTotal : points < requiredPoints;

  // (Fix) tổng hiển thị trên mobile bar
  const shownTotal = payMethod === "points" ? requiredPoints : displayTotal;

  const SCENE_CATEGORY_ID = "68a55296e06aee921714659e"; // ID bạn yêu cầu
  const ROUTE_SCENE_DETAIL = "/product-detail-scenes";  // ví dụ: /scenes/:id
  const ROUTE_MODEL_DETAIL = "/product-detail";         // ví dụ: /models/:id
  function getDetailPath(itemId, isScene) {
    return `${isScene ? ROUTE_SCENE_DETAIL : ROUTE_MODEL_DETAIL}/${itemId}`;
  }
  const handleCardClick = (e, item) => {
    if (e.ctrlKey || e.metaKey) {
      // Giữ Ctrl/Cmd để chỉ chọn/bỏ chọn (không điều hướng)
      toggleSelect(item.id);
      return;
    }
    const isScene = Array.isArray(item.categoryIds) && item.categoryIds.includes(SCENE_CATEGORY_ID);
    navigate(getDetailPath(item.id, isScene));
  };
  // ===== Desktop layout (GIỮ NGUYÊN GIAO DIỆN + checkbox + X ở cuối) =====
  const DesktopLayout = () => (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[999] font-codec"
      aria-modal="true"
      role="dialog"
    >
      <div
        className="bg-[linear-gradient(to_bottom,_#0c0002_70%,_#290602_100%)] rounded-xl shadow-lg w-[560px] overflow-hidden border border-[#2D2D2D]"
        ref={popupRef}
      >
        {/* Close */}
        <div className="flex justify-end mb-2">
          <button className="bg-transparent text-white/70 hover:text-white text-lg pr-2 pt-2 pb-0" onClick={onClose}>
            <FaTimes />
          </button>
        </div>

        <div className="h-px bg-[#1e1d1e] mb-4"></div>

        {/* List */}
        <div className="px-4">
          <div className="custom-scroll overflow-y-auto 2xl:max-h-[320px] 2xl:min-h-[320px] xl:max-h-[280px] xl:min-h-[20px] pr-1 font-codec py-0">
            {/* Thanh chọn tất cả + count + nút xóa all */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-[#cfcfcf] text-sm">
                  <input
                    type="checkbox"
                    className="accent-[#8f120d] w-4 h-4 cursor-pointer"
                    checked={selectedIds.size === unownedAll.length && unownedAll.length > 0}
                    onChange={toggleSelectAll}
                  />
                  <span className="font-source">Chọn tất cả</span>
                </label>
                <span className="text-[#9e9e9e] text-xs font-source">
                  Đã chọn: <b className="text-white">{selectedIds.size}</b> / {unownedAll.length}
                </span>
              </div>

              <button className="flex items-center gap-1 text-[#888] bg-[#282828] rounded py-[2px] px-[4px] text-[10px]" onClick={handleRemoveAll}>
                <FaTimes size={10} /> all
              </button>
            </div>

            {products.map((item) => {
              const allow = canDownload(item);
              const isFree = Number(item.price || 0) === 0;
              const isOwned = purchasedIds.has(String(item.id));
              const selectable = !isOwned && !isFree;
              const checked = isSelected(item.id);
              return (
                <div key={item.id} className="flex items-center gap-1 h-[56px] p-0 rounded-md">
                  {/* checkbox chọn */}
                  <div className="">
                    <input
                      type="checkbox"
                      className="accent-[#8f120d] w-4 h-4 cursor-pointer"
                      disabled={!selectable}
                      checked={selectable ? checked : false}
                      onChange={() => selectable && toggleSelect(item.id)}
                      title={selectable ? "Chọn sản phẩm để thanh toán" : (isOwned ? "Đã mua" : "Miễn phí")}
                    />
                  </div>

                  {/* ảnh */}
                  <img
                    src={buildUrl(item.previewImagePath || item.image)}
                    alt={item.name}
                    className="w-16 h-12 object-cover rounded ml-1"
                  />

                  {/* info */}
                  <div className="flex-1"
                  onClick={(e) => handleCardClick(e, item)}
                  >
                    <button
                      className="w-[200px] text-sm bg-[#282828] border border-[#373737] text-[#9e9e9e] px-2 py-0 rounded mb-1 text-left font-codec truncate"
                      style={{ maxWidth: "200px" }}
                      title={item.name}
                    >
                      {item.name}
                    </button>

                    <div className="flex items-center justify-between text-xs text-[#9e9e9e] font-codec">
                      <p className="text-[#908e8e]">ID: {item.customId}</p>
                      <div className="flex items-center gap-1 text-[#878585] text-sm">
                        <span className="text-[18px]">
                          {isFree ? (
                            <span className="text-green-400 text-sm">Free</span>
                          ) : isOwned ? (
                            <span className="text-emerald-400 text-sm font-medium font-source">Đã mua</span>
                          ) : (
                            <div className="flex items-center justify-center gap-1 text-white rounded-full min-w-[42px]">
                              <span>{nf.format(item.price)}</span>
                              <div className="border border-white/30 rounded-full bg-[#8f120d] mb-1"></div>
                            </div>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* divider */}
                  <div className="w-px h-16 bg-[#1e1e1e] mx-2"></div>

                  {/* cột download */}
                  <div className="flex flex-col gap-1 font-codec">
                    <button
                      className={`bg-[#282828] border border-[#373737] text-xs px-2 py-0.5 rounded flex items-center gap-1 leading-none font-codec ${
                        allow ? "text-[#9e9e9e] hover:opacity-90" : "text-[#5a5a5a] opacity-60 cursor-not-allowed"
                      }`}
                      onClick={() => allow && downloadProduct(item.id, "image")}
                      disabled={!allow}
                      title={allow ? "Tải ảnh preview" : "Hãy mua trước để tải"}
                    >
                      <img src="/arrowdown.svg" alt="icon" className="w-4 h-4 object-contain" style={{ transform: "scale(2)" }} />
                      Image
                    </button>
                    <button
                      className={`bg-[#282828] border border-[#373737] text-xs px-2 py-0.5 rounded flex items-center gap-1 leading-none font-codec ${
                        allow ? "text-[#9e9e9e] hover:opacity-90" : "text-[#5a5a5a] opacity-60 cursor-not-allowed"
                      }`}
                      onClick={() => allow && downloadProduct(item.id, "file")}
                      disabled={!allow}
                      title={allow ? "Tải 3D model" : "Hãy mua trước để tải"}
                    >
                      <img src="/arrowdown.svg" alt="icon" className="w-4 h-4 object-contain" style={{ transform: "scale(2)" }} />
                      File
                    </button>
                  </div>
                  {/* divider + nút X ở CUỐI */}
                  <button
                    className="text-[#888] bg-transparent hover:text-white transition-colors p-0"
                    onClick={() => handleRemoveProduct(item.id)}
                    aria-label="Xoá"
                    title="Xoá khỏi giỏ"
                  >
                    <FaTimes size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="h-px bg-[#1e1d1e] mb-4"></div>

        {/* Discounts */}
        <div className="px-4">
          <div className="overflow-x-auto mt-2 mb-4 pb-2 pl-1 custom-scroll pr-1 font-codec">
            <div className="flex gap-3 min-w-max pr-2">
              {discounts.map((item) => {
                const isApplied = applied?.id === item._id;
                return (
                  <div
                    key={item._id}
                    className={`w-[162px] h-[130px] bg-[#1c1c1c] border rounded-md text-white shrink-0 flex flex-col justify-start gap-y-[2px] ${
                      isApplied ? "border-[#8f120d]" : "border-[#4d4d4d]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-swiss font-bold text-[28px] text-[#8f120d] pl-1 p-0">{item.percent}%</p>
                      <img src="/giamgia.svg" alt="discount icon" className="w-11 object-contain" />
                    </div>
                    <p className="text-[10px] min-h-[40px] max-h-[42px] overflow-hidden pl-2 text-[#9e9e9e] font-codec whitespace-pre-line">
                      {item.text}
                    </p>
                    <button
                      className={`rounded w-[158px] py-1 ml-[1.6px] mb-[2px]  font-codec border ${
                        isApplied ? "bg-[#8f120d] text-white border-[#8f120d]" : "bg-[#282828] text-[#9e9e9e] border-[#373737] hover:bg-[#8f120d]"
                      }`}
                      onClick={() => handleApplyDiscount(item)}
                      disabled={applyingId === item._id && !isApplied}
                    >
                      {applyingId === item._id && !isApplied ? "" : isApplied ? "Đã áp dụng" : "Áp dụng"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Payment methods */}
          <div className="mb-2 text-white/80 font-source">Phương thức thanh toán :</div>
          <div className="flex gap-3 mb-4 justify-center">
            <button
              onClick={() => setPayMethod("wallet")}
              className={[
                "h-12 rounded-md px-4 flex items-center gap-3 border transition bg-black/20 min-w-[254px]",
                payMethod === "wallet" ? "border-white/60 bg-white/10 text-white" : "border-white/15 hover:border-white/30 text-white/80",
              ].join(" ")}
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-md border border-white/40">
                <FaWallet className="text-white/90" />
              </div>
              <span className="font-source">Ví ({nf.format(walletBalance)})</span>
            </button>

            <button
              onClick={() => setPayMethod("points")}
              className={[
                "h-12 rounded-md px-4 flex items-center gap-3 border transition bg-black/20 min-w-[254px]",
                payMethod === "points" ? "border-white/60 bg-white/10 text-white" : "border-white/15 hover:border-white/30 text-white/80",
              ].join(" ")}
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full border border-white/40">
                <FaRegStar className="text-white/90" />
              </div>
              <span className="font-source">Điểm thưởng ({nf.format(points)})</span>
            </button>
          </div>

          {/* Gợi ý tỷ lệ khi chọn thanh toán bằng điểm */}
          {payMethod === "points" && (
            <div className="text-[11px] text-white/70 px-2 mb-2 font-source">
              1 điểm (thanh toán) = <b>{nf.format(pointRatePay)}</b> VND
            </div>
          )}
        </div>

        {/* Totals & Buy */}
        <div className="px-4 mb-[12px]">
          <div className="flex flex-wrap md:flex-nowrap items-center justify-between gap-2 bg-[#1e1e1e] px-2 py-2 rounded border border-[#373737] text-[#9e9e9e] font-codec text-base">
            <div className="flex items-center">
              Models: <span className="text-white font-bold text-2xl pl-2">{String(selectedIds.size).padStart(2, "0")}</span>
            </div>
            <div className="w-px h-8 bg-[#373737] mx-2"></div>

            <div className="flex flex-col items-end leading-tight">
              <div className="flex items-center gap-1">
                <span>Total cost:</span>
                <span className="text-white font-bold text-2xl px-2 tabular-nums">
                  {payMethod === "points" ? nf.format(requiredPoints) : nf.format(shownTotal)}
                </span>
              </div>
            </div>

            <div className="w-px h-8 bg-[#373737] mx-2"></div>

            <button
              onClick={handleBuy}
              disabled={buying || products.length === 0 || selectedIds.size === 0 || lacksFunds}
              className="bg-[#8f120d] hover:bg-[#a91410] disabled:opacity-60 text-[#cfcfcf] px-4 py-1.5 rounded font-italic text-lg transition flex-shrink-0 min-w-fit"
              title={
                selectedIds.size === 0
                  ? "Hãy chọn ít nhất 1 sản phẩm"
                  : lacksFunds
                  ? (payMethod === "wallet" ? "Số dư ví không đủ" : "Điểm thưởng không đủ")
                  : ""
              }
            >
              {buying ? "Đang mua…" : "Buy Model"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // ===== Mobile layout (GIỮ NGUYÊN GIAO DIỆN + checkbox + X ở sau grid tải) =====
  const MobileLayout = () => (
    <div className="fixed inset-0 z-[999] font-codec" aria-modal="true" role="dialog">
      {/* overlay */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* sheet */}
      <div
        ref={popupRef}
        className="
          absolute inset-x-0 bottom-0
          bg-[linear-gradient(to_bottom,_#0c0002_65%,_#290602_100%)]
          border-t border-[#2D2D2D]
          rounded-t-2xl shadow-lg
          max-h-[88vh] min-h-[72vh]
          flex flex-col
        "
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 10px)" }}
      >
        {/* header */}
        <div className="relative px-4 pt-3 pb-2">
          <div className="mx-auto h-1.5 w-12 rounded-full bg-white/25 mb-3" />
          <div className="flex items-center justify-end">
            <button className="text-white/80 active:scale-95 bg-transparent" onClick={onClose} aria-label="Đóng" title="Đóng">
              <FaTimes size={18} />
            </button>
          </div>
        </div>

        <div className="h-px bg-[#1e1e1e]" />

        {/* body scroll */}
        <div className="flex-1 custom-scroll overflow-y-auto px-3 pb-2">
          {/* thanh chọn tất cả + count + xóa all */}
          <div className="flex items-center justify-between mb-2 mt-2">
            <label className="flex items-center gap-2 text-white/80 text-[13px]">
              <input
                type="checkbox"
                className="accent-[#8f120d] w-4 h-4 cursor-pointer"
                checked={selectedIds.size === unownedAll.length && unownedAll.length > 0}
                onChange={toggleSelectAll}
              />
              <span className="font-source">Chọn tất cả</span>
            </label>

            <div className="flex items-center gap-3">
              <span className="text-[#9e9e9e] text-[12px] font-source">
                Đã chọn: <b className="text-white">{selectedIds.size}</b> / {unownedAll.length}
              </span>
              <button
                className="text-[11px] text-[#bbb] bg-[#282828] border border-[#373737] px-2 py-1 rounded"
                onClick={handleRemoveAll}
              >
                <FaTimes size={10} className="mt-[3px] inline-block mr-1" />
                all
              </button>
            </div>
          </div>

          {/* products list */}
          <div className="space-y-2">
            {products.map((item) => {
              const allow = canDownload(item);
              const isFree = Number(item.price || 0) === 0;
              const isOwned = purchasedIds.has(String(item.id));
              const selectable = !isOwned && !isFree;

              return (
                <div key={item.id} className="flex flex-col p-2 rounded-lg border border-[#2D2D2D] bg-black/20">
                  <div className="flex gap-3">
                    <div className="pt-1">
                      <input
                        type="checkbox"
                        className="accent-[#8f120d] w-4 h-4 cursor-pointer"
                        disabled={!selectable}
                        checked={selectable ? isSelected(item.id) : false}
                        onChange={() => selectable && toggleSelect(item.id)}
                        title={selectable ? "Chọn sản phẩm để thanh toán" : (isOwned ? "Đã mua" : "Miễn phí")}
                      />
                    </div>

                    <img
                      src={buildUrl(item.previewImagePath || item.image)}
                      alt={item.name}
                      className="w-16 h-14 object-cover rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate" title={item.name}>
                        {item.name}
                      </p>

                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[11px] text-[#9e9e9e]">ID: {item.id}</span>
                        <span className="text-sm">
                          {isFree ? (
                            <span className="text-green-400">Free</span>
                          ) : isOwned ? (
                            <span className="text-emerald-400 font-medium font-source">Đã mua</span>
                          ) : (
                            <span className="text-white">{nf.format(item.price)}</span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* nút tải */}
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <button
                      className={`text-xs px-2 py-2 rounded border ${
                        allow ? "bg-[#282828] border-[#373737] text-[#e0e0e0] active:scale-[.98]" : "bg-[#1a1a1a] border-[#333] text-[#5a5a5a] opacity-60"
                      }`}
                      onClick={() => allow && downloadProduct(item.id, "image")}
                      disabled={!allow}
                      title={allow ? "Tải ảnh preview" : "Hãy mua trước để tải"}
                    >
                      <div className="flex items-center justify-center gap-2">
                        <img src="/arrowdown.svg" alt="" className="w-4 h-4 object-contain" />
                        Image
                      </div>
                    </button>
                    <button
                      className={`text-xs px-2 py-2 rounded border ${
                        allow ? "bg-[#282828] border-[#373737] text-[#e0e0e0] active:scale-[.98]" : "bg-[#1a1a1a] border-[#333] text-[#5a5a5a] opacity-60"
                      }`}
                      onClick={() => allow && downloadProduct(item.id, "file")}
                      disabled={!allow}
                      title={allow ? "Tải 3D model" : "Hãy mua trước để tải"}
                    >
                      <div className="flex items-center justify-center gap-2">
                        <img src="/arrowdown.svg" alt="" className="w-4 h-4 object-contain" />
                        File
                      </div>
                    </button>
                  </div>

                  {/* nút X ở SAU cùng */}
                  <div className="mt-2 flex justify-end">
                    <button
                      className="text-[#888] bg-transparent hover:text-white transition-colors"
                      onClick={() => handleRemoveProduct(item.id)}
                      aria-label="Xoá"
                      title="Xoá khỏi giỏ"
                    >
                      <FaTimes size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* discounts */}
          <div className="mt-4">
            <div className="text-white/80 mb-2 text-sm font-source">Mã giảm giá</div>
            <div className="overflow-x-auto custom-scroll">
              <div className="flex gap-3 min-w-max pb-1">
                {discounts.map((item) => {
                  const isApplied = applied?.id === item._id;
                  return (
                    <div
                      key={item._id}
                      className={`w-[144px] h-[112px] bg-[#1c1c1c] border rounded-md text-white shrink-0 flex flex-col justify-start ${
                        isApplied ? "border-[#8f120d]" : "border-[#4d4d4d]"
                      }`}
                    >
                      <div className="flex items-center justify-between px-2 pt-1">
                        <p className="font-swiss font-bold text-[24px] text-[#8f120d]">{item.percent}%</p>
                        <img src="/giamgia.svg" alt="" className="w-9 object-contain" />
                      </div>
                      <p className="text-[10px] leading-tight px-2 text-[#9e9e9e] line-clamp-2">
                        {item.text}
                      </p>
                      <div className="mt-auto p-1.5">
                        <button
                          className={`w-full rounded py-1 text-[12px] border ${
                            isApplied ? "bg-[#8f120d] text-white border-[#8f120d]" : "bg-[#282828] text-[#9e9e9e] border-[#373737]"
                          }`}
                          onClick={() => handleApplyDiscount(item)}
                          disabled={applyingId === item._id && !isApplied}
                        >
                          {applyingId === item._id && !isApplied ? "Đang áp…" : isApplied ? "Huỷ áp dụng" : "Áp dụng"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* pay methods */}
          <div className="mt-4">
            <div className="mb-2 text-white/80 text-sm font-source">Phương thức thanh toán</div>
            <div className="space-y-2">
              <button
                onClick={() => setPayMethod("wallet")}
                className={[
                  "w-full h-12 rounded-md px-4 flex items-center justify-between border transition bg-black/20",
                  payMethod === "wallet" ? "border-white/60 bg-white/10 text-white" : "border-white/15 text-white/80",
                ].join(" ")}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md border border-white/40">
                    <FaWallet className="text-white/90" />
                  </div>
                  <span className="font-source">Ví</span>
                </div>
                <span className="tabular-nums">{nf.format(walletBalance)}</span>
              </button>

              <button
                onClick={() => setPayMethod("points")}
                className={[
                  "w-full h-12 rounded-md px-4 flex items-center justify-between border transition bg-black/20",
                  payMethod === "points" ? "border-white/60 bg-white/10 text-white" : "border-white/15 text-white/80",
                ].join(" ")}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full border border-white/40">
                    <FaRegStar className="text-white/90" />
                  </div>
                  <span className="font-source">Điểm thưởng</span>
                </div>
                <span className="tabular-nums">{nf.format(points)}</span>
              </button>

              {payMethod === "points" && (
                <div className="text-[11px] text-white/70 px-1 font-source">
                  ≈ <span className="text-white font-semibold">{nf.format(requiredPoints)}</span> điểm
                  <span className="opacity-70 ml-1">(1 điểm = {nf.format(pointRatePay)})</span>
                </div>
              )}
            </div>
          </div>

          <div className="h-24" /> {/* spacer cho thanh checkout cố định dưới */}
        </div>

        {/* sticky checkout bar */}
        <div className="sticky bottom-0 inset-x-0">
          <div className="mx-3 mb-3 rounded-xl bg-[#1e1e1e] border border-[#373737] px-3 py-3 text-[#cfcfcf]">
            {selectedIds.size === 0 && (
              <div className="text-[11px] text-white/70 mb-2 font-source">Hãy chọn ít nhất 1 sản phẩm để thanh toán.</div>
            )}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-white/70">Total</div>
                <div className="text-2xl font-bold tabular-nums">{nf.format(shownTotal)}</div>
              </div>
              <button
                onClick={handleBuy}
                disabled={buying || products.length === 0 || selectedIds.size === 0 || lacksFunds}
                className="min-w-[140px] h-11 rounded-lg bg-[#8f120d] hover:bg-[#a91410] disabled:opacity-60 text-white text-base active:scale-[.99]"
                title={
                  selectedIds.size === 0
                    ? "Hãy chọn ít nhất 1 sản phẩm"
                    : lacksFunds
                    ? (payMethod === "wallet" ? "Số dư ví không đủ" : "Điểm thưởng không đủ")
                    : ""
                }
              >
                {buying ? "Đang mua…" : "Buy Model"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return isMobile ? <MobileLayout /> : <DesktopLayout />;
}
