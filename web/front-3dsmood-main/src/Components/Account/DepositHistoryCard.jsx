// components/DepositHistoryCard.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";

const nf = new Intl.NumberFormat("vi-VN");

const Eye = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M12 5C6.5 5 2 9.2 2 12s4.5 7 10 7 10-4.2 10-7-4.5-7-10-7zm0 12c-4.4 0-8-3.4-8-5 0-1.6 3.6-5 8-5s8 3.4 8 5c0 1.6-3.6 5-8 5zm0-8a3 3 0 100 6 3 3 0 000-6z"/>
  </svg>
);

function readToken() {
  const raw = localStorage.getItem("token");
  if (!raw) return "";
  try {
    const maybeObj = JSON.parse(raw);
    return typeof maybeObj === "string" ? maybeObj : (maybeObj?.token ?? "");
  } catch {
    return raw;
  }
}

function fmtDateParts(iso) {
  try {
    const d = new Date(iso);
    const time = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
    const date = d.toLocaleDateString("vi-VN"); // dd/mm/yyyy
    return { time, date };
  } catch {
    return { time: "", date: "" };
  }
}

// Các trạng thái được tính là đã thanh toán
const PAID_STATES = new Set([
  "success",
  "succeeded",
  "completed",
  "complete",
  "paid",
  "success_vnpay",
  "done",
]);

function isPaidStatus(status) {
  if (!status) return false;
  const s = String(status).trim().toLowerCase();
  return PAID_STATES.has(s);
}

// Badge trạng thái
function StatusPill({ status }) {
  const s = String(status || "").trim().toLowerCase();

  let label = status || "—";
  let cls =
    "px-2 py-0.5 rounded-full text-xs border inline-flex items-center justify-center";

  if (isPaidStatus(s)) {
    label = "Thành công";
    cls += " bg-emerald-500/10 text-emerald-300 border-emerald-400/30";
  } else if (["pending", "processing", "created", "unpaid"].includes(s)) {
    label = "Pending";
    cls += " bg-amber-500/10 text-amber-300 border-amber-400/30";
  } else if (["failed", "cancelled", "canceled", "error", "expired", "void"].includes(s)) {
    label = "Thất bại";
    cls += " bg-rose-500/10 text-rose-300 border-rose-400/30";
  } else {
    // trạng thái lạ/không map
    cls += " bg-zinc-600/10 text-zinc-300 border-zinc-400/30";
  }

  return <span className={cls}>{label}</span>;
}

export default function DepositHistoryCard() {
  const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
  const token = readToken();

  const PAGE_SIZE = 7;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Phân trang
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [hasNextFallback, setHasNextFallback] = useState(false);

  // Bộ lọc trạng thái: '' | 'paid' | 'pending'
  const [statusFilter, setStatusFilter] = useState("");

  // Tổng theo ngữ cảnh bộ lọc
  const [totalAmount, setTotalAmount] = useState(0);
  const [totalLoading, setTotalLoading] = useState(false);
  const serverTotalUsedRef = useRef(false); // đã lấy được totalAmount từ server (áp dụng khi all/paid)

  // ====== FETCH LIST CHO TRANG HIỆN TẠI (7 dòng) ======
  useEffect(() => {
    let cancelled = false;

    async function fetchList() {
      setLoading(true);
      setErr("");

      try {
        const { data } = await axios.get(`${API}/api/me/deposits`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          params: {
            page: currentPage,
            limit: PAGE_SIZE,
            sort: "createdAt",
            dir: "desc",
            status: statusFilter || undefined,
          },
        });

        if (cancelled) return;

        const items = Array.isArray(data?.items) ? data.items : [];

        const mapped = items.map((it) => {
          const { time, date } = fmtDateParts(it.createdAt || it.date || it.created_at);
          return {
            time,
            date,
            orderId: it.orderCode || it.code || it.order_id || it._id || "",
            amount: Number(it.total ?? it.amount ?? it.value ?? it.price ?? 0) || 0,
            id: it.id || it._id || it.orderId || "",
            status: it.status ?? it.paymentStatus ?? it.state ?? "",
          };
        });

        setRows(mapped);

        // Phân trang nếu server có trả
        const _totalItems = Number(
          data?.totalItems ?? data?.totalCount ?? data?.count ?? data?.total ?? 0
        );
        const _totalPages =
          Number(data?.totalPages ?? data?.pages ?? 0) ||
          (_totalItems > 0 ? Math.ceil(_totalItems / PAGE_SIZE) : 0);

        setTotalItems(_totalItems);
        setTotalPages(_totalPages);

        // Fallback còn trang sau không nếu không biết totalPages
        setHasNextFallback(items.length === PAGE_SIZE);

        // Nếu đang lọc "" (tất cả) hoặc "paid": ưu tiên dùng server totalAmount (tổng paid)
        const serverTotal = Number(data?.totalAmount ?? 0) || 0;
        if ((statusFilter === "" || statusFilter === "paid") && serverTotal > 0) {
          setTotalAmount(serverTotal);
          serverTotalUsedRef.current = true;
        } else {
          serverTotalUsedRef.current = false; // để effect tính thủ công
        }
      } catch (e) {
        console.error(e);
        setErr("Không tải được lịch sử nạp.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchList();
    return () => {
      cancelled = true;
    };
  }, [API, token, currentPage, statusFilter]);

  // ====== FETCH TỔNG THEO BỘ LỌC (khi cần tự tính) ======
  useEffect(() => {
    let cancelled = false;

    async function fetchTotalAccordingToFilter() {
      // Trường hợp dùng serverTotal: chỉ khi (status = "" hoặc "paid") và server có trả
      if ((statusFilter === "" || statusFilter === "paid") && serverTotalUsedRef.current) return;

      setTotalLoading(true);
      try {
        const BIG_LIMIT = 200;
        let page = 1;
        let acc = 0;

        // Lấy meta trước
        const first = await axios.get(`${API}/api/me/deposits`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          params: {
            page: 1,
            limit: 1,
            sort: "createdAt",
            dir: "desc",
            status: statusFilter || undefined,
          },
        });
        if (cancelled) return;

        // Nếu là all/paid và server có totalAmount → dùng luôn (chỉ tổng paid)
        if ((statusFilter === "" || statusFilter === "paid")) {
          const sTotal = Number(first?.data?.totalAmount ?? first?.data?.total ?? 0) || 0;
          if (sTotal > 0) {
            setTotalAmount(sTotal);
            serverTotalUsedRef.current = true;
            setTotalLoading(false);
            return;
          }
        }

        // Tự cộng theo filter hiện tại
        const totalItemsMeta = Number(
          first?.data?.totalItems ?? first?.data?.totalCount ?? first?.data?.count ?? 0
        );
        const totalPagesMeta =
          Number(first?.data?.totalPages ?? first?.data?.pages ?? 0) ||
          (totalItemsMeta > 0 ? Math.ceil(totalItemsMeta / BIG_LIMIT) : 0);

        const fetchPage = async (p) => {
          const { data } = await axios.get(`${API}/api/me/deposits`, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            params: {
              page: p,
              limit: BIG_LIMIT,
              sort: "createdAt",
              dir: "desc",
              status: statusFilter || undefined,
            },
          });
          const items = Array.isArray(data?.items) ? data.items : [];
          // Nếu đang ở filter "" (all): chỉ cộng các đơn đã thanh toán
          // Nếu filter "paid": server đã lọc → cộng hết
          // Nếu filter "pending": server đã lọc → cộng hết (tổng giá trị các đơn pending)
          const pageSum =
            statusFilter === ""
              ? items.reduce((sum, it) => {
                  const amt = Number(it.total ?? it.amount ?? it.value ?? it.price ?? 0) || 0;
                  return isPaidStatus(it.status ?? it.paymentStatus ?? it.state ?? "")
                    ? sum + amt
                    : sum;
                }, 0)
              : items.reduce((sum, it) => {
                  const amt = Number(it.total ?? it.amount ?? it.value ?? it.price ?? 0) || 0;
                  return sum + amt;
                }, 0);

          return { items, pageSum };
        };

        if (totalPagesMeta > 0) {
          for (page = 1; page <= totalPagesMeta; page++) {
            const { items, pageSum } = await fetchPage(page);
            if (cancelled) return;
            acc += pageSum;
          }
        } else {
          while (true) {
            const { items, pageSum } = await fetchPage(page);
            if (cancelled) return;
            acc += pageSum;
            if (items.length < BIG_LIMIT) break;
            page += 1;
          }
        }

        setTotalAmount(acc);
      } catch (e) {
        console.error(e);
        // im lặng
      } finally {
        if (!cancelled) setTotalLoading(false);
      }
    }

    fetchTotalAccordingToFilter();
    return () => {
      cancelled = true;
    };
  }, [API, token, statusFilter]);

  // Reset về trang 1 khi đổi bộ lọc
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter]);

  const total = useMemo(() => totalAmount, [totalAmount]);

  // ==== Helpers phân trang (UI) — kiểu OrdersUsedCard ====
  const knownTotalPages = totalPages > 0;
  const canGoPrev = currentPage > 1;
  const canGoNext = knownTotalPages ? currentPage < totalPages : hasNextFallback;

  function handlePageChange(p) {
    if (p < 1) return;
    if (knownTotalPages && p > totalPages) return;
    setCurrentPage(p);
  }

  // Hiển thị tối đa 5 nút trang
  const getVisiblePages = (current, total, max = 5) => {
    if (total <= max) return Array.from({ length: total }, (_, i) => i + 1);
    let start = Math.max(1, current - Math.floor(max / 2));
    let end = Math.min(total, start + max - 1);
    if (end - start + 1 < max) start = Math.max(1, end - max + 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  };

  // Khi không biết totalPages, ước lượng để UI mượt:
  const uiTotalPages = knownTotalPages
    ? totalPages
    : Math.max(currentPage, currentPage + (hasNextFallback ? 1 : 0));

  const visiblePages = getVisiblePages(currentPage, uiTotalPages);

  const goToPage = (p) => {
    if (p === currentPage) return;
    if (!knownTotalPages) {
      if (p === currentPage + 1 && hasNextFallback) return handlePageChange(p);
      if (p < currentPage) return handlePageChange(p);
      return;
    }
    handlePageChange(p);
  };

  // UI chip cho filter
  const FilterChip = ({ active, onClick, children }) => (
    <button
      onClick={onClick}
      className={
        `px-3 py-1.5 rounded-lg border text-sm font-source transition ` +
        (active
          ? "bg-white/10 text-white border-white/30"
          : "bg-black/40 text-zinc-300 border-[#4d4d4d] hover:bg-white/5")
      }
    >
      {children}
    </button>
  );

  return (
    <div className="">
      {/* Thanh filter + Tổng */}
      <div className="border-b border-[#4d4d4d]">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 px-3 py-2">
          {/* Bộ lọc trạng thái */}
          <div className="flex items-center gap-2">
            <FilterChip active={statusFilter === ""} onClick={() => setStatusFilter("")}>
              Tất cả
            </FilterChip>
            <FilterChip active={statusFilter === "paid"} onClick={() => setStatusFilter("paid")}>
              Thành công
            </FilterChip>
            <FilterChip active={statusFilter === "pending"} onClick={() => setStatusFilter("pending")}>
              Pending
            </FilterChip>
          </div>

          {/* Tổng theo ngữ cảnh */}
          <span className="inline-flex items-center gap-2 rounded-md border border-[#4d4d4d] bg-[#131313] px-3 py-1 text-sm text-zinc-200 font-codec font-source self-end md:self-auto">
            {statusFilter === "pending" ? "Tổng giá trị (Pending)" :
             statusFilter === "paid" ? "Tổng số tiền đã nạp" : "Tổng số tiền đã nạp (Paid)"}
            <span className="ml-2 rounded-md px-2 py-0.5 text-white font-codec">
              {totalLoading ? "…" : nf.format(total)}
            </span>
          </span>
        </div>
      </div>

      <div className="divide-y divide-[#4d4d4d]" />

      {/* Header */}
      <div className="grid grid-cols-4 text-zinc-300 text-sm">
        {["Thời gian", "Đơn hàng", "Số tiền nạp", "Trạng thái"].map((h, i, arr) => (
          <div
            key={h}
            className="relative px-4 py-3 flex items-center justify-center text-center font-codec"
          >
            <span>{h}</span>
            {i !== arr.length - 1 && (
              <span className="absolute right-0 top-1/2 -translate-y-1/2 h-5 w-px bg-[#4d4d4d]" />
            )}
          </div>
        ))}
      </div>
      <div className="h-px w-full bg-[#4d4d4d] font-codec" />

      {/* Rows */}
      {loading && <div className=""></div>}

      {err && !loading && (
        <div className="px-4 py-6 text-center text-red-400 font-codec">{err}</div>
      )}

      {!loading && !err && (
        <>
          <div className="divide-y divide-[#4d4d4d]">
            {rows.map((r, idx) => (
              <div key={r.id || idx} className="grid grid-cols-4 items-center text-sm font-codec">
                {/* Thời gian */}
                <div className="px-4 py-3 text-zinc-300 flex items-center justify-center gap-4 font-codec">
                  <span>{r.time}</span>
                  <span className="text-zinc-400">{r.date}</span>
                </div>

                {/* Đơn hàng + eye */}
                <div className="px-4 py-3 flex items-center justify-center gap-3 text-zinc-300 font-codec">
                  <span>{r.orderId}</span>
                  {/* <a href={`/account/deposits/${r.id}`} title="Xem chi tiết" className="inline-flex">
                    <Eye className="h-4 w-4 text-zinc-400" />
                  </a> */}
                </div>

                {/* Số tiền nạp */}
                <div className="px-4 py-3 text-zinc-200 text-center font-codec">
                  <span>+{nf.format(r.amount)}</span>
                </div>

                {/* Trạng thái */}
                <div className="px-4 py-3 text-center">
                  <StatusPill status={r.status} />
                </div>
              </div>
            ))}

            {rows.length === 0 && (
              <div className="px-4 py-6 text-center text-zinc-400 font-source">
                Chưa có giao dịch.
              </div>
            )}
          </div>

          {/* Pagination */}
          {(knownTotalPages ? totalPages > 1 : hasNextFallback || currentPage > 1) && (
            <div className="px-3 py-3 border-t border-[#4d4d4d] flex items-center justify-between gap-2 font-source text-sm mt-4">
              <div className="text-sm text-zinc-400">
                Trang {currentPage} / {uiTotalPages} • Tổng bản ghi: {nf.format(totalItems || 0)}
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={!canGoPrev}
                  className={`text-sm px-3 py-1.5 rounded-md border font-source ${
                    !canGoPrev
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
                    className={`text-sm px-3 py-1.5 rounded-md border ${
                      p === currentPage
                        ? "bg-white/10 text-white border-white/30"
                        : "bg-black/40 text-zinc-300 border-[#4d4d4d] hover:bg-white/5"
                    }`}
                  >
                    {p}
                  </button>
                ))}

                <button
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={!canGoNext}
                  className={`text-sm px-3 py-1.5 rounded-md border font-source ${
                    !canGoNext
                      ? "text-zinc-500 border-[#3a3a3a] cursor-not-allowed"
                      : "text-zinc-200 border-[#4d4d4d] hover:bg-white/5 bg-black/40"
                  }`}
                >
                  Sau
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
