import React, { useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "../Sidebar/Sidebar";
import Header from "../Header/Header";
import axios from "axios";

// ====== ENV ======
const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

// ====== HELPERS ======
const nf = new Intl.NumberFormat("vi-VN");
const df = new Intl.DateTimeFormat("vi-VN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

// định dạng điểm
const pf = (n) => `${nf.format(Number(n || 0))} điểm`;

// hiển thị số tiền/điểm theo hình thức thanh toán
function renderAmount(order, moneyField = "finalTotal") {
  const isPoints = order?.paymentMethod === "points";
  if (isPoints) {
    // theo yêu cầu: cả Tạm tính và Thanh toán đều hiển thị pointsUsed
    const pts = order?.pointsUsed ?? 0;
    return <span className="whitespace-nowrap">{pf(pts)}</span>;
  }
  return <span className="whitespace-nowrap">{nf.format(order?.[moneyField] ?? 0)}</span>;
}

function readToken() {
  const raw = localStorage.getItem("token");
  if (!raw) return null;
  try {
    const may = JSON.parse(raw);
    return typeof may === "string" ? may : (may?.token ?? null);
  } catch {
    return raw;
  }
}

function StatusBadge({ status }) {
  const base = "px-2 py-1 rounded-full text-xs font-medium";
  if (status === "paid") return <span className={`${base} bg-green-100 text-green-700`}>Đã thanh toán</span>;
  if (status === "failed") return <span className={`${base} bg-red-100 text-red-700`}>Thất bại</span>;
  return <span className={`${base} bg-gray-100 text-gray-600`}>{String(status || "-")}</span>;
}

// ====== MAIN COMPONENT ======
export default function AdminOrderPage() {
  // Query state
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [method, setMethod] = useState("all");
  const [from, setFrom] = useState(""); // YYYY-MM-DD
  const [to, setTo] = useState("");   // YYYY-MM-DD

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

  // Data
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Detail drawer
  const [openDetail, setOpenDetail] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const qDebounce = useRef();

  // Axios instance
  const api = useMemo(() => {
    const instance = axios.create({ baseURL: API });
    instance.interceptors.request.use((cfg) => {
      const token = readToken();
      if (token) cfg.headers.Authorization = `Bearer ${token}`;
      return cfg;
    });
    return instance;
  }, []);

  const pages = Math.max(1, Math.ceil(total / limit));

  // Build query params
  const buildParams = () => {
    const params = { page, limit };
    if (q.trim()) params.q = q.trim();
    if (status !== "all") params.status = status;
    if (method !== "all") params.method = method;
    if (from) params.from = from; // inclusive
    if (to) params.to = to;       // inclusive
    params.sort = "createdAt:-1";
    params.populate = "1"; // yêu cầu server populate user + items.product + discountId
    return params;
  };

  // Robust list fetcher: try /api/orders/admin -> fallback /api/orders
  async function fetchList() {
    setLoading(true);
    setError("");
    try {
      const params = buildParams();
      let res;
      try {
        res = await api.get("/api/orders/admin", { params });
      } catch (e) {
        // fallback nếu chưa có route admin riêng
        res = await api.get("/api/orders", { params });
      }
      const data = res.data || {};
      const items = data.items || data.rows || [];
      setRows(Array.isArray(items) ? items : []);
      setTotal(Number(data.total || data.count || items.length || 0));
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.message || e?.message || "Lỗi tải danh sách đơn hàng");
    } finally {
      setLoading(false);
    }
  }

  // Detail fetcher
  async function fetchDetail(orderId) {
    setDetailLoading(true);
    setOpenDetail(true);
    setDetail(null);
    try {
      let res;
      try {
        res = await api.get(`/api/orders/${orderId}`, { params: { populate: 1 } });
      } catch (e) {
        // fallback: một số backends dùng /api/orders/admin/:id
        res = await api.get(`/api/orders/admin/${orderId}`, { params: { populate: 1 } });
      }
      setDetail(res.data || null);
    } catch (e) {
      console.error(e);
      setDetail({ error: e?.response?.data?.message || e?.message || "Không đọc được chi tiết đơn" });
    } finally {
      setDetailLoading(false);
    }
  }

  // Update status
  async function updateStatus(orderId, nextStatus) {
    try {
      await api.patch(`/api/orders/${orderId}/status`, { status: nextStatus });
    } catch {
      // fallback: /api/orders/admin/:id/status
      await api.patch(`/api/orders/admin/${orderId}/status`, { status: nextStatus });
    }
    await fetchList();
    await fetchDetail(orderId);
  }

  // Export CSV
  function exportCSV() {
    const headers = [
      "_id",
      "createdAt",
      "user",
      "itemsCount",
      "subtotal",
      "discount",
      "finalTotal",
      "paymentMethod",
      "couponCode",
      "status",
      "balanceAfter",
    ];

    const lines = [headers.join(",")];
    for (const o of rows) {
      const coupon = o.couponCode || o.discountId?.couponCode || "";
      const line = [
        JSON.stringify(o._id || ""),
        JSON.stringify(o.createdAt || ""),
        JSON.stringify(o.user?.email || o.user?.username || o.user || ""),
        JSON.stringify((o.items?.length) ?? 0),
        JSON.stringify(o.subtotal ?? 0),
        JSON.stringify(o.discount ?? 0),
        JSON.stringify(o.finalTotal ?? 0),
        JSON.stringify(o.paymentMethod || ""),
        JSON.stringify(coupon),
        JSON.stringify(o.status || ""),
        JSON.stringify(o.balanceAfter ?? ""),
      ].join(",");
      lines.push(line);
    }

    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Effects
  useEffect(() => {
    // debounce search
    clearTimeout(qDebounce.current);
    qDebounce.current = setTimeout(() => {
      setPage(1);
      fetchList();
    }, 300);
    return () => clearTimeout(qDebounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, method, from, to, limit]);

  useEffect(() => { fetchList(); }, [page]);

  // ====== RENDER ======
  return (
    <div className="flex min-h-screen w-screen overflow-hidden bg-white">
      <Sidebar />
      <main className="flex-1 p-6 bg-gray-100 min-w-0 overflow-x-auto">
        <div className="flex">
          <div className="flex-1">
            <div className="p-4 md:p-6">
              <div className="flex items-center justify-between mb-4">
                <h1 className="text-xl font-semibold">Quản lý đơn hàng</h1>
                <div className="flex items-center gap-2">
                  <button
                    className="px-3 py-2 rounded-lg bg-white border hover:bg-gray-50"
                    onClick={fetchList}
                    title="Làm mới"
                  >
                    Làm mới
                  </button>
                  <button
                    className="px-3 py-2 rounded-lg bg-white border hover:bg-gray-50"
                    onClick={exportCSV}
                    title="Xuất CSV"
                  >
                    Xuất CSV
                  </button>
                </div>
              </div>

              {/* Filters */}
              <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-4">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Tìm theo email, username, mã coupon, mã đơn..."
                  className="md:col-span-2 w-full px-3 py-2 rounded-lg border bg-white outline-none"
                />

                <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-white">
                  <option value="all">Tất cả trạng thái</option>
                  <option value="paid">Đã thanh toán</option>
                  <option value="failed">Thất bại</option>
                </select>

                <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-white">
                  <option value="all">Tất cả hình thức</option>
                  <option value="coins">Ví coins</option>
                  <option value="points">Points</option>
                </select>

                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-white" />
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-white" />
              </div>

              {/* Table */}
              <div className="overflow-auto rounded-xl border bg-white">
                <table className="min-w-[980px] w-full text-sm">
                  <thead className="bg-gray-100/60">
                    <tr className="text-left">
                      <th className="px-3 py-2">Thời gian</th>
                      <th className="px-3 py-2">Người dùng</th>
                      <th className="px-3 py-2">Sản phẩm</th>
                      <th className="px-3 py-2 text-right">Tạm tính</th>
                      <th className="px-3 py-2 text-right">Giảm</th>
                      <th className="px-3 py-2 text-right">Thanh toán</th>
                      <th className="px-3 py-2">Hình thức</th>
                      <th className="px-3 py-2">Trạng thái</th>
                      <th className="px-3 py-2">Mã coupon</th>
                      <th className="px-3 py-2 text-right">Số dư sau</th>
                      <th className="px-3 py-2">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr>
                        <td className="px-3 py-3" colSpan={11}>
                          <div className="animate-pulse h-6 rounded bg-gray-100 w-1/2" />
                        </td>
                      </tr>
                    )}

                    {!loading && rows.length === 0 && (
                      <tr>
                        <td className="px-3 py-4 text-gray-500" colSpan={11}>Không có đơn hàng phù hợp.</td>
                      </tr>
                    )}

                    {!loading && rows.map((o) => (
                      <tr key={o._id} className="border-t">
                        <td className="px-3 py-2 whitespace-nowrap">{o.createdAt ? df.format(new Date(o.createdAt)) : "-"}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col">
                            <span className="font-medium">{o.user?.username || "(n/a)"}</span>
                            <span className="text-gray-500 text-xs">{o.user?.email || ""}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">{o.items?.length ?? 0}</td>

                        {/* Tạm tính: pointsUsed nếu trả bằng points, ngược lại VNĐ subtotal */}
                        <td className="px-3 py-2 text-right">{renderAmount(o, "subtotal")}</td>

                        {/* Giảm: vẫn giữ VNĐ nếu bạn chưa có quy đổi điểm cho giảm */}
                        <td className="px-3 py-2 text-right">{nf.format(o.discount ?? 0)}</td>

                        {/* Thanh toán: pointsUsed nếu trả bằng points, ngược lại VNĐ finalTotal */}
                        <td className="px-3 py-2 text-right font-semibold">{renderAmount(o, "finalTotal")}</td>

                        <td className="px-3 py-2 whitespace-nowrap">{o.paymentMethod || "coins"}</td>
                        <td className="px-3 py-2 whitespace-nowrap"><StatusBadge status={o.status} /></td>
                        <td className="px-3 py-2 whitespace-nowrap">{o.couponCode || o.discountId?.couponCode || "-"}</td>
                        <td className="px-3 py-2 text-right">{o.balanceAfter != null ? nf.format(o.balanceAfter) : "-"}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <button
                              className="px-2 py-1 rounded border bg-white hover:bg-gray-50"
                              onClick={() => fetchDetail(o._id)}
                            >
                              Xem
                            </button>
                            {o.status !== "paid" && (
                              <button
                                className="px-2 py-1 rounded border bg-white hover:bg-gray-50"
                                onClick={() => updateStatus(o._id, "paid")}
                              >
                                Đánh dấu Paid
                              </button>
                            )}
                            {/* {o.status !== "failed" && (
                              <button
                                className="px-2 py-1 rounded border bg-white hover:bg-gray-50"
                                onClick={() => updateStatus(o._id, "failed")}
                              >
                                Đánh dấu Failed
                              </button>
                            )} */}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Footer: pagination + page size */}
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2 text-sm">
                  <span>Tổng: </span>
                  <span className="font-medium">{nf.format(total)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="px-3 py-1.5 rounded border bg-white disabled:opacity-50"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >Trước</button>
                  <span className="text-sm">Trang {page}/{pages}</span>
                  <button
                    className="px-3 py-1.5 rounded border bg-white disabled:opacity-50"
                    onClick={() => setPage((p) => Math.min(pages, p + 1))}
                    disabled={page >= pages}
                  >Sau</button>

                  <select
                    className="ml-2 px-2 py-1.5 rounded border bg-white text-sm"
                    value={limit}
                    onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
                  >
                    {[10,20,30,50,100].map(n => <option key={n} value={n}>{n}/trang</option>)}
                  </select>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="mt-3 p-3 border border-red-200 bg-red-50 text-red-700 rounded-lg text-sm">
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Detail Drawer */}
        {openDetail && (
          <div className="fixed inset-0 z-50 flex">
            <div className="flex-1 bg-black/30" onClick={() => setOpenDetail(false)} />
            <div className="w-full max-w-xl bg-white h-full shadow-2xl p-5 overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Chi tiết đơn</h2>
                <button className="px-3 py-1.5 rounded border bg-white" onClick={() => setOpenDetail(false)}>Đóng</button>
              </div>

              {detailLoading && <div className="animate-pulse h-6 rounded bg-gray-100 w-1/2" />}
              {!detailLoading && detail?.error && (
                <div className="p-3 border border-red-200 bg-red-50 text-red-700 rounded-lg text-sm">{detail.error}</div>
              )}

              {!detailLoading && detail && !detail.error && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-gray-500">Mã đơn</div>
                      <div className="font-medium break-all">{detail._id}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Thời gian</div>
                      <div className="font-medium">{detail.createdAt ? df.format(new Date(detail.createdAt)) : "-"}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Người dùng</div>
                      <div className="font-medium">{detail.user?.username || "(n/a)"}</div>
                      <div className="text-gray-500">{detail.user?.email || ""}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Hình thức</div>
                      <div className="font-medium">{detail.paymentMethod}</div>
                    </div>
                  </div>

                  <div className="border rounded-xl">
                    <div className="px-3 py-2 border-b bg-gray-50 font-medium">Sản phẩm ({detail.items?.length || 0})</div>
                    <div>
                      {(detail.items || []).map((it, idx) => (
                        <div key={idx} className="flex items-center justify-between px-3 py-2 border-t text-sm">
                          <div className="flex-1 pr-3">
                            <div className="font-medium">{it.product?.name || it.product?._id || "(product)"}</div>
                            {it.product?.sku && <div className="text-xs text-gray-500">SKU: {it.product.sku}</div>}
                          </div>
                          <div className="whitespace-nowrap">{nf.format(it.price ?? 0)}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-gray-500">Tạm tính</div>
                      <div className="font-semibold">
                        {renderAmount(detail, "subtotal")}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500">Giảm</div>
                      <div className="font-semibold">{nf.format(detail.discount ?? 0)}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Thanh toán</div>
                      <div className="font-semibold">
                        {renderAmount(detail, "finalTotal")}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500">Số dư sau</div>
                      <div className="font-semibold">{detail.balanceAfter != null ? nf.format(detail.balanceAfter) : '-'}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Mã coupon</div>
                      <div className="font-medium">{detail.couponCode || detail.discountId?.couponCode || '-'}</div>
                    </div>

                    {detail.discountId && (
                      <>
                        <div>
                          <div className="text-gray-500">Nội dung Discount</div>
                          <div className="font-medium">{detail.discountId.text || '-'}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">Phần trăm</div>
                          <div className="font-medium">{typeof detail.discountId.percent === 'number' ? `${detail.discountId.percent}%` : '-'}</div>
                        </div>
                      </>
                    )}

                    <div>
                      <div className="text-gray-500">Trạng thái</div>
                      <div className="font-medium"><StatusBadge status={detail.status} /></div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {detail.status !== "paid" && (
                      <button
                        className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                        onClick={() => updateStatus(detail._id, "paid")}
                      >Đánh dấu Paid</button>
                    )}
                    {detail.status !== "failed" && (
                      <button
                        className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                        onClick={() => updateStatus(detail._id, "failed")}
                      >Đánh dấu Failed</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
