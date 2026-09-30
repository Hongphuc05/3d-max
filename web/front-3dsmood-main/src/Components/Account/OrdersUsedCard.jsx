import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

// ====== Cấu hình & helper ======
const nf = new Intl.NumberFormat("vi-VN");

// ID Category dùng nhận diện SCENE (giữ đúng như BE)
const SCENE_CATEGORY_ID = "68a55296e06aee921714659e";
const ROUTE_SCENE_DETAIL = "/product-detail-scenes";
const ROUTE_MODEL_DETAIL = "/product-detail";

const Eye = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M12 5C6.5 5 2 9.2 2 12s4.5 7 10 7 10-4.2 10-7-4.5-7-10-7zm0 12c-4.4 0-8-3.4-8-5 0-1.6 3.6-5 8-5s8 3.4 8 5c0 1.6-3.6 5-8 5zm0-8a3 3 0 100 6 3 3 0 000-6z"/>
  </svg>
);

export default function OrdersUsedCard() {
  const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
  const ASSET_BASE = import.meta.env.VITE_ASSET_BASE_URL || API;

  const buildUrl = (path) => {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    return `${ASSET_BASE}/${String(path).replace(/^\/+/, "")}`;
  };

  const navigate = useNavigate();

  const readToken = () => {
    const raw = localStorage.getItem("token");
    if (!raw) return null;
    try {
      const maybeObj = JSON.parse(raw);
      return typeof maybeObj === "string" ? maybeObj : (maybeObj?.token ?? null);
    } catch {
      return raw;
    }
  };

  // ====== State danh sách đơn đã dùng ======
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [payment, setPayment] = useState(""); // "", "coins", "points"
  const PAGE_SIZE = 7;

  // ====== Tổng tất cả trang (chỉ cần khi payment === "") ======
  const [grand, setGrand] = useState({
    coins: 0,
    points: 0,
    loading: false,
    error: "",
  });

  // ====== Modal chi tiết ======
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detail, setDetail] = useState(null);

  // ====== Fetch danh sách phân trang ======
  const fetchPage = async (p = 1, pm = payment) => {
    try {
      const token = readToken();
      if (!token) throw new Error("Bạn chưa đăng nhập.");

      const url = new URL(`${API}/api/orders/used`);
      url.searchParams.set("limit", PAGE_SIZE);
      url.searchParams.set("page", p);
      if (pm) url.searchParams.set("payment", pm);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`HTTP ${res.status} – ${t || "Lỗi khi tải dữ liệu"}`);
      }
      const data = await res.json();
      const list = Array.isArray(data?.rows) ? data.rows : [];
      const totalNum = Number(data?.pagination?.total ?? 0);

      setRows(list);
      setTotal(totalNum);

      // Trả về để caller dùng ngay
      return { list, total: totalNum };
    } catch (e) {
      setErr(e.message || "Đã có lỗi xảy ra.");
      return { list: [], total: 0 };
    }
  };

  // ====== Tính tổng tất cả trang (coins & points) khi ở tab "Tất cả" ======
  const computeGrandTotals = async (knownTotal = null) => {
    setGrand((g) => ({ ...g, loading: true, error: "" }));
    const token = readToken();
    if (!token) {
      setGrand({ coins: 0, points: 0, loading: false, error: "Bạn chưa đăng nhập." });
      return;
    }

    // 1) Thử endpoint summary (nếu BE đã có)
    try {
      const resSum = await fetch(`${API}/api/orders/used/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resSum.ok) {
        const s = await resSum.json();
        const coins =
          Number(s?.coins ?? s?.totalCoins ?? s?.sumCoins ?? 0);
        const points =
          Number(s?.points ?? s?.totalPoints ?? s?.sumPoints ?? 0);
        setGrand({ coins, points, loading: false, error: "" });
        return;
      }
      // Nếu 404 hay không ok -> rơi xuống fallback
    } catch {
      // bỏ qua, fallback
    }

    // 2) Fallback: tự tải từng trang và cộng dồn
    try {
      const perPage = 200; // dùng page lớn để giảm lượt gọi
      // Lấy tổng bản ghi nếu chưa biết
      let totalCount = knownTotal;
      if (totalCount == null || !Number.isFinite(totalCount) || totalCount <= 0) {
        const u1 = new URL(`${API}/api/orders/used`);
        u1.searchParams.set("limit", 1);
        u1.searchParams.set("page", 1);
        const r1 = await fetch(u1.toString(), { headers: { Authorization: `Bearer ${token}` } });
        if (!r1.ok) throw new Error(await r1.text() || "Không lấy được tổng số bản ghi");
        const d1 = await r1.json();
        totalCount = Number(d1?.pagination?.total ?? 0);
      }
      const totalPagesForSum = Math.max(1, Math.ceil(totalCount / perPage));

      let sumCoins = 0;
      let sumPoints = 0;

      for (let p = 1; p <= totalPagesForSum; p++) {
        const u = new URL(`${API}/api/orders/used`);
        u.searchParams.set("limit", perPage);
        u.searchParams.set("page", p);
        // Không set payment để lấy tất cả
        const res = await fetch(u.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(await res.text() || `Lỗi tải trang ${p}`);
        const data = await res.json();
        const list = Array.isArray(data?.rows) ? data.rows : [];
        for (const r of list) {
          const method = String(r?.paymentMethod || "").toLowerCase();
          const amt = typeof r?.amount === "number" ? r.amount : 0;
          if (method === "points") sumPoints += amt;
          else sumCoins += amt; // coi mọi thứ khác "points" là coins
        }
      }

      setGrand({ coins: sumCoins, points: sumPoints, loading: false, error: "" });
    } catch (e) {
      setGrand({ coins: 0, points: 0, loading: false, error: e.message || "Không tính được tổng." });
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr("");
      setPage(1);
      const { total: newTotal } = await fetchPage(1, payment);
      setLoading(false);

      // Nếu đang ở "Tất cả" thì tính tổng coins/points mọi trang
      if (payment === "") {
        await computeGrandTotals(newTotal);
      } else {
        // Nếu bạn muốn cũng tính tổng mọi trang cho từng filter,
        // có thể gọi computeGrandTotals cho riêng filter tại đây.
        setGrand({ coins: 0, points: 0, loading: false, error: "" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment]);

  const totalPages = Math.max(1, Math.ceil((total || 0) / PAGE_SIZE));
  const fmt = (n) => (typeof n === "number" ? nf.format(n) : "—");
  const totalUsedPage = rows.reduce((s, r) => s + (r?.amount || 0), 0);

  const goToPage = async (p) => {
    if (p < 1 || p > totalPages || p === page) return;
    setPage(p);
    setLoading(true);
    setErr("");
    await fetchPage(p);
    setLoading(false);
  };

  const getVisiblePages = (current, total, max = 5) => {
    if (total <= max) return Array.from({ length: total }, (_, i) => i + 1);
    let start = Math.max(1, current - Math.floor(max / 2));
    let end = Math.min(total, start + max - 1);
    if (end - start + 1 < max) start = Math.max(1, end - max + 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  };
  const visiblePages = getVisiblePages(page, totalPages);

  // ====== Mở modal chi tiết order ======
  const openDetail = async (row) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError("");
    setDetail(null);

    const token = readToken();
    if (!token) {
      setDetailError("Bạn chưa đăng nhập.");
      setDetailLoading(false);
      return;
    }

    const id = row?.id || row?._id;
    if (!id) {
      setDetailError("Thiếu id đơn hàng trong danh sách. Vui lòng cập nhật API /api/orders/used để trả thêm id.");
      setDetailLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API}/api/orders/client/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setDetail(data);
    } catch (e) {
      setDetailError(e.message || "Không tải được chi tiết đơn hàng.");
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setDetailOpen(false);
    setDetail(null);
    setDetailError("");
  };

  // ====== Điều hướng sản phẩm từ item modal ======
  const toProductDetail = (prodObj, itemObj) => {
    if (!prodObj) return;
    const id =
      String(prodObj?._id || itemObj?.productId || prodObj?.id || "").trim();
    if (!id) return;

    const isSceneServer = prodObj?.isScene;
    const catIds = Array.isArray(prodObj?.catIds)
      ? prodObj.catIds.map(String)
      : [];

    const isScene = !!(isSceneServer || catIds.includes(SCENE_CATEGORY_ID));
    const path = `${isScene ? ROUTE_SCENE_DETAIL : ROUTE_MODEL_DETAIL}/${id}`;
    navigate(path);
  };

  // ====== UI ======
  if (loading) {
    return (
      <div className="rounded-xl border border-[#4d4d4d] bg-black/40 p-4 text-zinc-300 font-source">
        Đang tải đơn hàng…
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-black/40 overflow-hidden">
      {/* Top bar */}
      <div className="flex flex-col md:flex-row md:justify-between gap-2 px-3 py-2 border-b border-[#4d4d4d] font-codec">
        <span className="inline-flex items-center gap-2 text-sm text-zinc-200">
          <span className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_0_2px_rgba(34,197,94,.25)] font-source" />
          Đơn hàng đã hoàn thành
        </span>

        {/* Chip tổng */}
        {payment === "" ? (
          <span className="inline-flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-2 rounded-md border border-[#4d4d4d] bg-black/40 px-3 py-1 text-sm text-zinc-200 font-source">
              Coins (tất cả trang)
              <span className="ml-2 rounded-md bg-white/10 px-2 py-0.5 text-white">
                {grand.loading ? "…" : nf.format(grand.coins)}
              </span>
            </span>
            <span className="inline-flex items-center gap-2 rounded-md border border-[#4d4d4d] bg-black/40 px-3 py-1 text-sm text-zinc-200 font-source">
              Points (tất cả trang)
              <span className="ml-2 rounded-md bg-white/10 px-2 py-0.5 text-white">
                {grand.loading ? "…" : nf.format(grand.points)}
              </span>
            </span>
            {grand.error && (
              <span className="text-xs text-yellow-400 ml-2">
                {grand.error}
              </span>
            )}
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-md border border-[#4d4d4d] bg-black/40 px-3 py-1 text-sm text-zinc-200">
            {payment === "points" ? "Tổng points (trang hiện tại)" : "Tổng coins (trang hiện tại)"}
            <span className="ml-2 rounded-md bg-white/10 px-2 py-0.5 text-white">
              {nf.format(totalUsedPage)}
            </span>
          </span>
        )}
      </div>

      {/* Bộ lọc payment */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#4d4d4d]">
        <button
          onClick={() => setPayment("")}
          className={`font-source text-sm px-3 py-1.5 rounded-md border  ${
            payment === ""
              ? "bg-white/10 text-white border-white/30"
              : "bg-black/40 text-zinc-300 border-[#4d4d4d] hover:bg-white/5"
          }`}
        >
          Tất cả
        </button>
        <button
          onClick={() => setPayment("coins")}
          className={`font-codec text-sm px-3 py-1.5 rounded-md border ${
            payment === "coins"
              ? "bg-white/10 text-white border-white/30"
              : "bg-black/40 text-zinc-300 border-[#4d4d4d] hover:bg-white/5"
          }`}
        >
          Coins
        </button>
        <button
          onClick={() => setPayment("points")}
          className={`font-codec text-sm px-3 py-1.5 rounded-md border ${
            payment === "points"
              ? "bg-white/10 text-white border-white/30"
              : "bg-black/40 text-zinc-300 border-[#4d4d4d] hover:bg-white/5"
          }`}
        >
          Points
        </button>
      </div>

      {/* Header */}
      <div className="grid grid-cols-4 text-zinc-300 text-sm">
        {["Thời gian", "Đơn hàng", "Giá trị đơn hàng", "Số dư"].map(
          (h, i, arr) => (
            <div key={h} className="relative px-3 py-2 text-center font-codec">
              <span>{h}</span>
              {i !== arr.length - 1 && (
                <span className="absolute right-0 top-1/2 -translate-y-1/2 h-4 w-px bg-[#4d4d4d]" />
              )}
            </div>
          )
        )}
      </div>
      <div className="h-px w-full bg-[#4d4d4d]" />

      {/* Rows */}
      <div className="divide-y divide-[#4d4d4d]">
        {rows.map((r, idx) => (
          <div
            key={idx}
            className="grid grid-cols-4 items-center text-sm font-codec h-11"
          >
            {/* Thời gian */}
            <div className="px-3 py-1.5 text-zinc-300 text-center">
              <span className="mr-3 inline-block">{r.time}</span>
              <span className="text-zinc-400 inline-block">{r.date}</span>
            </div>

            {/* Đơn hàng + eye */}
            <div className="px-3 py-1.5 text-center">
              <span className="inline-flex items-center justify-center gap-2">
                <button
                  className="text-green-500 hover:underline bg-transparent"
                  onClick={() => openDetail(r)}
                  title="Xem chi tiết đơn"
                >
                  {r.orderId}
                </button>
                <button
                  className="bg-transparent"
                  onClick={() => openDetail(r)}
                  title="Xem chi tiết đơn"
                >
                  <Eye className="h-4 w-4 text-zinc-400" />
                </button>
              </span>
            </div>

            {/* Giá trị đơn hàng */}
            <div className="px-3 py-1.5 text-zinc-200 text-center">
              <span>{fmt(r.amount)}</span>
              {r.paymentMethod && (
                <span className="ml-2 align-middle text-[10px] uppercase px-1.5 py-0.5 rounded bg-white/10 text-zinc-300">
                  {r.paymentMethod}
                </span>
              )}
            </div>

            {/* Số dư */}
            <div className="px-3 py-1.5 text-zinc-200 text-center">
              {fmt(r.balance)}
            </div>
          </div>
        ))}
      </div>

      {/* Footer: lỗi + phân trang */}
      {err && (
        <div className="px-3 py-2 text-sm text-red-400 border-t border-[#4d4d4d] font-codec">
          {err}
        </div>
      )}

      <div className="px-3 py-3 border-t border-[#4d4d4d] flex items-center justify-between gap-2">
        <div className="text-sm text-zinc-400 font-source">
          Trang {page} / {totalPages} • Tổng bản ghi: {nf.format(total)}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            className={`font-source text-sm px-3 py-1.5 rounded-md border ${
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
              className={`font-codec text-sm px-3 py-1.5 rounded-md border ${
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
            className={`font-source text-sm px-3 py-1.5 rounded-md border ${
              page >= totalPages
                ? "text-zinc-500 border-[#3a3a3a] cursor-not-allowed"
                : "text-zinc-200 border-[#4d4d4d] hover:bg-white/5 bg-black/40"
            }`}
          >
            Sau
          </button>
        </div>
      </div>

      {/* ===== MODAL CHI TIẾT ===== */}
      {detailOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeDetail}
          />

          <div className="relative z-[61] w-[92vw] max-w-2xl rounded-2xl border border-[#4d4d4d] bg-[url('/back.svg')] text-zinc-200 shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#4d4d4d]">
              <div className="font-source text-base">
                Chi tiết đơn:{" "}
                <span className="text-green-400">
                  {detail?.orderId || "—"}
                </span>
              </div>
              <button
                onClick={closeDetail}
                className="px-2 py-1 rounded-md border border-[#4d4d4d] bg-black/40 hover:bg-white/5"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="px-4 py-3">
              {detailLoading && (
                <div className="text-sm text-zinc-400 font-source">Đang tải chi tiết…</div>
              )}

              {!detailLoading && (
                <>
                  {detailError && (
                    <div className="mb-3 text-sm text-yellow-400">
                      {detailError}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                      <span className="text-zinc-400 font-source">Thời gian:</span>{" "}
                      {detail?.createdAtText || "—"}
                    </div>
                    <div>
                      <span className="text-zinc-400 font-source">Phương thức:</span>{" "}
                      {detail?.paymentMethod || "—"}
                    </div>

                    <div>
                      <span className="text-zinc-400">
                        {detail?.paymentMethod === "points"
                          ? "Điểm đã dùng:"
                          : "Tổng tiền:"}
                      </span>{" "}
                      {typeof detail?.pointsUsed === "number" &&
                      detail?.paymentMethod === "points"
                        ? nf.format(detail.pointsUsed)
                        : typeof detail?.finalTotal === "number"
                        ? nf.format(detail.finalTotal)
                        : "—"}
                    </div>

                    <div>
                      <span className="text-zinc-400 font-source">Số dư sau thanh toán:</span>{" "}
                      {typeof detail?.balanceAfter === "number"
                        ? nf.format(detail.balanceAfter)
                        : "—"}
                    </div>

                    <div>
                      <span className="text-zinc-400 font-source">Mã giảm giá:</span>{" "}
                      {detail?.couponCode || "—"}
                    </div>
                    <div>
                      <span className="text-zinc-400 font-source">Giảm giá:</span>{" "}
                      {typeof detail?.discount === "number"
                        ? nf.format(detail.discount)
                        : "—"}
                    </div>

                    <div>
                      <span className="text-zinc-400 font-source">Tạm tính:</span>{" "}
                      {typeof detail?.subtotal === "number"
                        ? nf.format(detail.subtotal)
                        : "—"}
                    </div>
                    <div>
                      <span className="text-zinc-400 font-source">Điểm thưởng nhận:</span>{" "}
                      {typeof detail?.earnedPoints === "number"
                        ? nf.format(detail.earnedPoints)
                        : "—"}
                    </div>
                  </div>

                  {/* Items */}
                  <div className="mt-3 border-t border-[#2c2c2c] pt-3">
                    <div className="font-codec mb-2">
                      Sản phẩm ({detail?.items?.length || 0})
                    </div>

                    {detail?.items?.length ? (
                      <div className="space-y-2 max-h-56 overflow-auto pr-1">
                        {detail.items.map((it, i) => {
                          const p = it?.product || {};
                          const coverPath =
                            p.coverPath ||
                            p.previewImagePath ||
                            p.cover?.path ||
                            null;

                          return (
                            <div
                              key={i}
                              className="flex items-center gap-3 text-sm cursor-pointer hover:bg-white/5 rounded-md px-2 py-1"
                              onClick={() => toProductDetail(p, it)}
                              title="Xem chi tiết sản phẩm"
                            >
                              {coverPath && (
                                <img
                                  src={buildUrl(coverPath)}
                                  alt={p?.name || "product"}
                                  className="h-10 w-10 rounded-md object-cover border border-[#262626] flex-shrink-0"
                                />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="text-zinc-200 truncate">
                                  {p?.name || String(p?._id || "Sản phẩm")}
                                </div>
                                <div className="text-zinc-400 text-xs">
                                  Giá tại thời điểm mua:{" "}
                                  {typeof it?.price === "number"
                                    ? nf.format(it.price)
                                    : "—"}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-sm text-zinc-400 font-source">
                        Không có danh sách sản phẩm.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            {/* <div className="px-4 py-3 border-t border-[#2c2c2c] flex justify-end">
              <button
                onClick={closeDetail}
                className="font-codec text-sm px-3 py-1.5 rounded-md border border-[#4d4d4d] bg-black/40 hover:bg-white/5"
              >
                Đóng
              </button>
            </div> */}
          </div>
        </div>
      )}
    </div>
  );
}
