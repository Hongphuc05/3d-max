import React, { useEffect, useState, useCallback } from "react";

const nf = new Intl.NumberFormat("vi-VN");
const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

// Helper đọc token từ localStorage (hỗ trợ cả dạng JSON string hoặc raw string)
function readToken() {
  const raw = localStorage.getItem("token");
  if (!raw) return null;
  try {
    const maybe = JSON.parse(raw);
    return typeof maybe === "string" ? maybe : (maybe?.token ?? null);
  } catch {
    return raw;
  }
}

export default function PointsView() {
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(8); // 8 hàng mỗi trang
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const fetchHistory = useCallback(
    async (p = 1) => {
      setLoading(true);
      setErr("");
      try {
        const token = readToken();
        const res = await fetch(`${API}/api/points/history?page=${p}&limit=${limit}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        // API shape: items[], page, total, hasMore?
        const items = Array.isArray(data.items) ? data.items : [];
        const currentPage = data.page || p;
        const totalItems = Number(data.total || 0);

        setRows(items);
        setPage(currentPage);
        setTotal(totalItems);

        // Fallback nếu BE không trả hasMore
        const computedHasMore = currentPage * limit < totalItems;
        setHasMore(
          typeof data.hasMore === "boolean" ? data.hasMore : computedHasMore
        );
      } catch (e) {
        setErr(typeof e?.message === "string" ? e.message : "Lỗi tải dữ liệu");
      } finally {
        setLoading(false);
      }
    },
    [limit]
  );

  useEffect(() => {
    fetchHistory(1);
  }, [fetchHistory]);

  // ====== Phân trang kiểu OrdersUsedCard ======
  const totalPages = Math.max(1, Math.ceil((total || 0) / limit));
  const getVisiblePages = (current, total, max = 5) => {
    if (total <= max) return Array.from({ length: total }, (_, i) => i + 1);
    let start = Math.max(1, current - Math.floor(max / 2));
    let end = Math.min(total, start + max - 1);
    if (end - start + 1 < max) start = Math.max(1, end - max + 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  };
  const visiblePages = getVisiblePages(page, totalPages);

  const goToPage = async (p) => {
    if (p < 1 || p > totalPages || p === page) return;
    await fetchHistory(p);
  };

  return (
    <div className="rounded-2xl bg-black bg-opacity-50 overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-4 text-zinc-300 text-sm font-codec text-center">
        {["Thời gian", "Đơn hàng", "Điểm thưởng", "Số dư"].map((h, i, arr) => (
          <div key={h} className="relative px-4 py-3 font-codec">
            <span>{h}</span>
            {i !== arr.length - 1 && (
              <span className="absolute right-0 top-1/2 -translate-y-1/2 h-5 w-px bg-black bg-opacity-50 font-codec" />
            )}
          </div>
        ))}
      </div>

      <div className="h-px w-full bg-[#2D2D2D]" />

      {/* Rows */}
      {loading ? (
        <div className="px-4 py-6 text-center text-zinc-400 text-sm font-source">
          Đang tải lịch sử điểm…
        </div>
      ) : err ? (
        <div className="px-4 py-6 text-center text-red-400 text-sm font-source">
          {err}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-zinc-400 text-sm font-source">
          Chưa có lịch sử điểm thưởng.
        </div>
      ) : (
        <div className="divide-y divide-[#2D2D2D]">
          {rows.map((r) => (
            <div
              key={r._id || r.orderId}
              className="grid grid-cols-4 items-center text-sm text-center"
            >
              <div className="px-4 py-3 text-zinc-300">
                <span className="mr-4 font-codec">{r.time}</span>
                <span className="text-zinc-400 font-codec">{r.date}</span>
              </div>
              <div className="px-4 py-3 text-zinc-300 font-codec">{r.orderId}</div>
              <div className="px-4 py-3 font-codec">
                <span className={r.points >= 0 ? "text-green-500" : "text-red-500"}>
                  {r.points >= 0 ? `+${r.points}` : r.points}
                </span>
              </div>
              <div className="px-4 py-3 text-zinc-300 font-codec">
                {r.points > 0
                  ? (typeof r.pointsAfter === "number" ? nf.format(r.pointsAfter) : "—")
                  : (typeof r.balance === "number" ? nf.format(r.balance) : "—")}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer: thông tin + phân trang kiểu OrdersUsedCard */}
      {!loading && (
        <div className="px-3 py-3 border-t border-[#2D2D2D] flex items-center justify-between gap-2">
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
                className={`font-source text-sm px-3 py-1.5 rounded-md border ${
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
              disabled={page >= totalPages || (!hasMore && page === totalPages)}
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
      )}
    </div>
  );
}
