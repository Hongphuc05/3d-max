import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "../Admin/Sidebar/Sidebar";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

/**
 * TopPurchasedProducts (client-side pagination)
 * Backend: /api/products/top-purchased?limit=all&displayhome=1|0
 */
export default function TopPurchasedProducts({
  limit = 50,               // số item / trang
  displayHomeOnly = false,  // lọc hiển thị trang chủ
}) {
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  const nf = useMemo(() => new Intl.NumberFormat("vi-VN"), []);

  const buildImageUrl = (imagePath) => {
    if (!imagePath) return "";
    if (/^https?:\/\//i.test(imagePath)) return imagePath;
    const rel = imagePath.startsWith("/") ? imagePath : `/${imagePath}`;
    return `${API}${rel}`;
  };

  // Fetch TẤT CẢ (limit=all) mỗi khi đổi bộ lọc displayHomeOnly
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setError("");
      setFetching(true);
      setPage(1); // quay về trang 1 khi đổi filter
      try {
        const qs = new URLSearchParams();
        qs.set("limit", "all");
        if (displayHomeOnly) qs.set("displayhome", "1");

        const url = `${API}/api/products/top-purchased?${qs.toString()}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error("Không lấy được dữ liệu Top bán chạy");
        const data = await res.json();

        const arr = Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data)
          ? data
          : [];

        setAllItems(arr);
        const grandTotal = Number(data?.total || arr.length);
        setTotal(grandTotal);
        setPages(Math.max(1, Math.ceil(grandTotal / limit)));
      } catch (e) {
        if (e.name !== "AbortError") setError(e.message || "Lỗi tải dữ liệu");
      } finally {
        setFetching(false);
      }
    })();
    return () => controller.abort();
    // chỉ refetch khi đổi filter; limit thay đổi chỉ ảnh hưởng slice bên dưới
  }, [displayHomeOnly]);

  // Tính item cho trang hiện tại (client-side slice)
  useEffect(() => {
    const grandTotal = allItems.length;
    const newPages = Math.max(1, Math.ceil(grandTotal / limit));
    setPages(newPages);
    // đảm bảo page không vượt quá tổng trang khi đổi limit
    const safePage = Math.min(page, newPages);
    if (safePage !== page) setPage(safePage);

    const start = (safePage - 1) * limit;
    const end = start + limit;
    setItems(allItems.slice(start, end));
    setTotal(grandTotal);
  }, [allItems, limit, page]);

  const Price = ({ value }) =>
    Number(value) === 0 ? (
      <span className="text-green-600 font-medium">Free</span>
    ) : (
      <span>{nf.format(Number(value))}</span>
    );

  const canPrev = page > 1;
  const canNext = page < pages;

  if (fetching) {
    return <div className="p-4 text-sm text-gray-500">Đang tải Top bán chạy…</div>;
  }
  if (error) {
    return <div className="p-4 text-red-600 text-sm">❌ {error}</div>;
  }

  return (
    <div className="flex min-h-screen w-screen overflow-hidden bg-white text-slate-900">
    <Sidebar activeKey="topmodel"/>
    <main className="flex-1 min-w-0 overflow-x-auto bg-gray-50">
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Top sản phẩm bán chạy</h2>
          <p className="text-sm text-gray-500">
            Trang <strong>{page}</strong> / {pages} • {limit}/trang
            {displayHomeOnly ? " • chỉ sản phẩm bật trang chủ" : ""}
          </p>
        </div>

        {/* Điều khiển phân trang */}
        <div className="flex items-center gap-2">
          <button
            disabled={!canPrev}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className={`h-9 px-3 rounded border text-sm ${
              canPrev ? "bg-white hover:bg-gray-50" : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            Trước
          </button>
          <span className="text-sm">Trang</span>
          <input
            type="number"
            min={1}
            max={pages}
            value={page}
            onChange={(e) => {
              const n = parseInt(e.target.value || "1", 10);
              if (!Number.isNaN(n)) setPage(Math.min(Math.max(1, n), pages));
            }}
            className="h-9 w-16 rounded border border-gray-300 px-2 text-sm outline-none focus:ring-2 focus:ring-gray-800"
          />
          <button
            disabled={!canNext}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            className={`h-9 px-3 rounded border text-sm ${
              canNext ? "bg-white hover:bg-gray-50" : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            Sau
          </button>
        </div>
      </div>

      {/* BẢNG 4 CỘT */}
      <div className="overflow-x-auto bg-white border rounded-lg">
        <table className="min-w-full border-collapse border border-gray-300">
          <thead className="bg-gray-100 text-gray-800">
            <tr className="text-left">
              <th className="px-4 py-3 border border-gray-300 w-20">Image</th>
              <th className="px-4 py-3 border border-gray-300">Name + customId</th>
              <th className="px-4 py-3 border border-gray-300">Price</th>
              <th className="px-4 py-3 border border-gray-300">Purchased</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-8 text-gray-500 border border-gray-300">
                  Không có dữ liệu
                </td>
              </tr>
            ) : (
              items.map((p, i) => (
                <tr key={p._id || `${p.customId}-${i}`} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                  <td className="px-4 py-3 align-top border border-gray-300">
                    {p.image ? (
                      <img
                        src={buildImageUrl(p.image)}
                        alt={p.name || ""}
                        className="w-16 h-16 object-cover rounded-md border"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-md border bg-gray-100" />
                    )}
                  </td>
                  <td className="px-4 py-3 align-top border border-gray-300">
                    <div className="font-medium text-gray-900">{p.name || "—"}</div>
                    <div className="mt-1 text-xs text-gray-500">customId: {p.customId || "—"}</div>
                  </td>
                  <td className="px-4 py-3 align-top border border-gray-300">
                    <Price value={p.price} />
                  </td>
                  <td className="px-4 py-3 align-top border border-gray-300">
                    {nf.format(Number(p.purchasedCount || 0))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer nhỏ: tổng */}
      <div className="mt-3 text-sm text-gray-600">
        Tổng: <strong>{nf.format(total)}</strong> sản phẩm
      </div>
    </div>
    </main>
    </div>
  );
}
