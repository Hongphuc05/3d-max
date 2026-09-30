// src/pages/PaymentsAdmin.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import Sidebar from "../Sidebar/Sidebar";

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';
const nf = new Intl.NumberFormat('vi-VN');

function cls(...xs) { return xs.filter(Boolean).join(' '); }

function useAxios() {
  return useMemo(() => {
    const ax = axios.create({ baseURL: API_BASE });
    ax.interceptors.request.use((config) => {
      const token = localStorage.getItem('token');
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
    return ax;
  }, []);
}

export default function PaymentsAdmin() {
  const ax = useAxios();

  // Filters
  const [q, setQ] = useState(''); // search orderCode contains q
  const [status, setStatus] = useState('');
  const [currency, setCurrency] = useState('');
  const [minTotal, setMinTotal] = useState('');
  const [maxTotal, setMaxTotal] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState('createdAt');
  const [dir, setDir] = useState('desc');

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [expanded, setExpanded] = useState(null); // orderCode đang mở chi tiết
  const [autoPoll, setAutoPoll] = useState(false);
  const pollRef = useRef(null);

  const query = useMemo(() => ({ q, status, currency, minTotal, maxTotal, from, to, page, limit, sort, dir }), [q,status,currency,minTotal,maxTotal,from,to,page,limit,sort,dir]);

  useEffect(() => { fetchList(); /* eslint-disable-next-line */ }, [q,status,currency,minTotal,maxTotal,from,to,page,limit,sort,dir]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!autoPoll) return;
    pollRef.current = setInterval(() => {
      fetchList(true);
    }, 5000);
    return () => clearInterval(pollRef.current);
  }, [autoPoll]);

  async function fetchList(silent = false) {
    if (!silent) setLoading(true);
    setError('');
    try {
      const { data } = await ax.get('/api/admin/deposits', { params: query });
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      setError(e?.response?.data?.message || e.message || 'Load thất bại');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  function resetFilters() {
    setQ(''); setStatus(''); setCurrency(''); setMinTotal(''); setMaxTotal(''); setFrom(''); setTo(''); setPage(1);
  }

  async function refreshOne(orderCode) {
    try {
      // Kết hợp sepay status route để kiểm tra trạng thái gần realtime
      const { data } = await ax.get(`/api/sepay/deposit/${orderCode}/status`);
      // Cập nhật trong list
      setItems(prev => prev.map(it => it.orderCode === orderCode ? { ...it, status: data.status, confirmedAt: data.paidAt || it.confirmedAt } : it));
    } catch (e) {
      alert(e?.response?.data?.message || e.message);
    }
  }

  async function markPaid(idOrCode) {
    if (!confirm('Đánh dấu Paid và cộng coin (nếu chưa)?')) return;
    try {
      const { data } = await ax.post(`/api/admin/deposits/${idOrCode}/mark-paid`);
      setItems(prev => prev.map(it => (it._id === data._id ? data : (it.orderCode === data.orderCode ? data : it))));
    } catch (e) {
      alert(e?.response?.data?.message || e.message);
    }
  }

  async function cancelOrder(idOrCode) {
    if (!confirm('Huỷ đơn này? Chỉ áp dụng khi đang pending.')) return;
    try {
      const { data } = await ax.post(`/api/admin/deposits/${idOrCode}/cancel`);
      setItems(prev => prev.map(it => (it._id === data._id ? data : (it.orderCode === data.orderCode ? data : it))));
    } catch (e) {
      alert(e?.response?.data?.message || e.message);
    }
  }

  async function revokeCredit(idOrCode) {
    if (!confirm('Thu hồi coin khỏi user (nếu đủ số dư) và bỏ credited?')) return;
    try {
      const { data } = await ax.post(`/api/admin/deposits/${idOrCode}/revoke-credit`);
      setItems(prev => prev.map(it => (it._id === data._id ? data : (it.orderCode === data.orderCode ? data : it))));
    } catch (e) {
      alert(e?.response?.data?.message || e.message);
    }
  }

  async function downloadCSV() {
    try {
      const { data } = await ax.get('/api/admin/deposits/export.csv', { params: query, responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url; a.download = 'deposits.csv';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e?.response?.data?.message || e.message || 'Không tải được CSV');
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="flex min-h-screen w-screen overflow-hidden bg-white">
    <Sidebar activeKey="payment" />
    <main className="flex-1 min-w-0 bg-gray-100">
    <div className="min-h-screen bg-white text-neutral-900 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between mb-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-neutral-900">Quản lý thanh toán (Deposit Orders)</h1>
            <p className="text-neutral-600 text-sm">Lọc, tra cứu, cập nhật trạng thái, xuất CSV.</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                className="accent-blue-600"
                checked={autoPoll}
                onChange={(e)=>setAutoPoll(e.target.checked)}
              />
              Auto refresh 5s
            </label>
            <button
              onClick={downloadCSV}
              className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm transition"
            >
              Xuất CSV
            </button>
          </div>
        </header>

        {/* Filters */}
        <div className="bg-white border border-neutral-200 rounded-2xl p-4 mb-4 shadow-sm">
          <div className="grid lg:grid-cols-4 gap-3">
            <input
              value={q}
              onChange={(e)=>{setQ(e.target.value); setPage(1);}}
              placeholder="Tìm mã đơn (q)"
              className="bg-white border border-neutral-300 rounded-lg px-3 py-2 outline-none placeholder:text-neutral-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            />

            <select
              value={status}
              onChange={(e)=>{setStatus(e.target.value); setPage(1);}}
              className="bg-white border border-neutral-300 rounded-lg px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            >
              <option value="">Trạng thái (all)</option>
              <option value="pending">pending</option>
              <option value="paid">paid</option>
              <option value="cancelled">cancelled</option>
            </select>

            <select
              value={currency}
              onChange={(e)=>{setCurrency(e.target.value); setPage(1);}}
              className="bg-white border border-neutral-300 rounded-lg px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            >
              <option value="">Tiền tệ (all)</option>
              <option value="VND">VND</option>
            </select>

            <div className="grid grid-cols-2 gap-2">
              <input
                type="number" min={0} value={minTotal}
                onChange={(e)=>{setMinTotal(e.target.value); setPage(1);}}
                placeholder="Min total"
                className="bg-white border border-neutral-300 rounded-lg px-3 py-2 outline-none placeholder:text-neutral-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
              />
              <input
                type="number" min={0} value={maxTotal}
                onChange={(e)=>{setMaxTotal(e.target.value); setPage(1);}}
                placeholder="Max total"
                className="bg-white border border-neutral-300 rounded-lg px-3 py-2 outline-none placeholder:text-neutral-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
              />
            </div>

            <input
              type="datetime-local" value={from}
              onChange={(e)=>{setFrom(e.target.value); setPage(1);}}
              className="bg-white border border-neutral-300 rounded-lg px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            />
            <input
              type="datetime-local" value={to}
              onChange={(e)=>{setTo(e.target.value); setPage(1);}}
              className="bg-white border border-neutral-300 rounded-lg px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            />

            <div className="grid grid-cols-3 gap-2">
              <select
                value={sort}
                onChange={(e)=>{setSort(e.target.value); setPage(1);}}
                className="bg-white border border-neutral-300 rounded-lg px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
              >
                <option value="createdAt">createdAt</option>
                <option value="total">total</option>
                <option value="status">status</option>
              </select>
              <select
                value={dir}
                onChange={(e)=>{setDir(e.target.value); setPage(1);}}
                className="bg-white border border-neutral-300 rounded-lg px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
              >
                <option value="desc">desc</option>
                <option value="asc">asc</option>
              </select>
              <select
                value={limit}
                onChange={(e)=>{setLimit(Number(e.target.value)); setPage(1);}}
                className="bg-white border border-neutral-300 rounded-lg px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={()=>{fetchList();}}
                className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm transition"
              >
                Áp dụng
              </button>
              <button
                onClick={resetFilters}
                className="px-3 py-2 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm transition border border-neutral-200"
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-4 py-2 text-sm text-neutral-700 border-b border-neutral-200 flex items-center justify-between bg-white">
            <div>{loading ? 'Đang tải...' : `${total} đơn`}</div>
            <div className="flex items-center gap-2">
              <button
                disabled={page<=1}
                onClick={()=>setPage(p=>Math.max(1,p-1))}
                className="px-2 py-1 rounded border border-neutral-300 bg-white disabled:opacity-50 hover:bg-neutral-50"
              >
                Prev
              </button>
              <span className="text-neutral-500 text-sm">{page}/{totalPages}</span>
              <button
                disabled={page>=totalPages}
                onClick={()=>setPage(p=>Math.min(totalPages,p+1))}
                className="px-2 py-1 rounded border border-neutral-300 bg-white disabled:opacity-50 hover:bg-neutral-50"
              >
                Next
              </button>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="text-left bg-neutral-50">
              <tr className="border-b border-neutral-200">
                <th className="px-4 py-2 font-medium text-neutral-700">Mã đơn</th>
                <th className="px-4 py-2 font-medium text-neutral-700">Tổng</th>
                <th className="px-4 py-2 font-medium text-neutral-700">Trạng thái</th>
                <th className="px-4 py-2 font-medium text-neutral-700">Tạo lúc</th>
                <th className="px-4 py-2 font-medium text-neutral-700">Xác nhận</th>
                <th className="px-4 py-2 font-medium text-neutral-700">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <React.Fragment key={it._id || it.orderCode}>
                  <tr className="border-b border-neutral-200 hover:bg-neutral-50">
                    <td className="px-4 py-2">
                      <div className="font-mono text-xs sm:text-sm text-neutral-900">{it.orderCode}</div>
                      <div className="text-neutral-500 text-xs">
                        {it.currency} · {nf.format(it.amountPerPack)} x {it.quantity} (-{it.discount}%)
                      </div>
                    </td>
                    <td className="px-4 py-2 font-semibold text-neutral-900">{nf.format(it.total)} đ</td>
                    <td className="px-4 py-2">
                      <span
                        className={cls(
                          'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
                          it.status==='paid' && 'bg-green-50 text-green-700 border-green-200',
                          it.status==='pending' && 'bg-amber-50 text-amber-700 border-amber-200',
                          it.status==='cancelled' && 'bg-rose-50 text-rose-700 border-rose-200'
                        )}
                      >
                        {it.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-neutral-700">{it.createdAt ? new Date(it.createdAt).toLocaleString() : '—'}</td>
                    <td className="px-4 py-2 text-neutral-700">{it.confirmedAt ? new Date(it.confirmedAt).toLocaleString() : '—'}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={()=>refreshOne(it.orderCode)}
                          className="px-2 py-1 rounded border border-neutral-300 bg-white text-xs hover:bg-neutral-50"
                        >
                          Làm mới
                        </button>
                        <button
                          onClick={()=>setExpanded(expanded===it.orderCode?null:it.orderCode)}
                          className="px-2 py-1 rounded border border-neutral-300 bg-white text-xs hover:bg-neutral-50"
                        >
                          Chi tiết
                        </button>
                        {it.status!=='paid' && (
                          <button
                            onClick={()=>markPaid(it._id || it.orderCode)}
                            className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs"
                          >
                            Đánh dấu Paid
                          </button>
                        )}
                        {it.status==='pending' && (
                          <button
                            onClick={()=>cancelOrder(it._id || it.orderCode)}
                            className="px-2 py-1 rounded border border-neutral-300 bg-white text-xs hover:bg-neutral-50"
                          >
                            Huỷ
                          </button>
                        )}
                        {it.credited && (
                          <button
                            onClick={()=>revokeCredit(it._id || it.orderCode)}
                            className="px-2 py-1 rounded border border-neutral-300 bg-white text-xs hover:bg-neutral-50"
                          >
                            Thu hồi coin
                          </button>
                        )}
                        <button
                          onClick={()=>navigator.clipboard.writeText(it.orderCode)}
                          className="px-2 py-1 rounded border border-neutral-300 bg-white text-xs hover:bg-neutral-50"
                        >
                          Copy mã
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === it.orderCode && (
                    <tr className="border-b border-neutral-200 bg-neutral-50/70">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="grid md:grid-cols-2 gap-4">
                          <div className="space-y-1 text-xs sm:text-sm">
                            <div><span className="text-neutral-500">User:</span> {it.userId || '—'}</div>
                            <div><span className="text-neutral-500">Credited:</span> {String(!!it.credited)} ({nf.format(it.creditedCoins||0)} coin)</div>
                            <div><span className="text-neutral-500">Bank:</span> {(it.bank?.nameOrCode)||'—'} · {(it.bank?.accountNo)||'—'}</div>
                            <div><span className="text-neutral-500">QR:</span> {it.qr?.provider||'—'}</div>
                            {it.sepay?.gateway && <div><span className="text-neutral-500">Gateway:</span> {it.sepay.gateway}</div>}
                            {it.sepay?.transactionId && <div><span className="text-neutral-500">TxnId:</span> {it.sepay.transactionId}</div>}
                            {it.sepay?.transferAmount && <div><span className="text-neutral-500">Transfer:</span> {nf.format(it.sepay.transferAmount)} đ</div>}
                          </div>
                          <div className="flex items-center justify-center">
                            {it.qr?.url ? (
                              <img
                                src={it.qr.url}
                                alt="QR"
                                className="w-56 h-56 object-contain bg-white rounded border border-neutral-200 shadow-sm"
                              />
                            ) : (
                              <div className="text-neutral-500 text-sm">Không có QR</div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {error && <div className="mt-3 text-rose-600 text-sm">{error}</div>}
      </div>
    </div>
    </main>
    </div>
  );
}
