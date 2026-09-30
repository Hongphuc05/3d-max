// =============================================
// File: src/pages/admin/DepositPacksAdmin.jsx
// Purpose: Single-file React admin UI (light theme, wide layout)
// =============================================

import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "../Admin/Sidebar/Sidebar";

/*************************
 * Config & Shared Utils  *
 *************************/
const DEPOSIT_API_BASE = (import.meta?.env?.VITE_API_BASE_URL || "http://localhost:5000")
  .toString()
  .replace(/\/+$/, "");
const nfVN = new Intl.NumberFormat("vi-VN");

function getAuthHeaders() {
  const tk =
    localStorage.getItem("token") ||
    localStorage.getItem("accessToken") ||
    sessionStorage.getItem("token") ||
    "";
  return tk ? { Authorization: `Bearer ${tk}` } : {};
}

async function apiFetch(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    let err = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.message) err = j.message;
    } catch {}
    throw new Error(err);
  }
  return res.json();
}

/****************
 * API (inline) *
 ****************/
async function apiList({ active = true, page = 1, limit = 20, all = false } = {}) {
  const qs = new URLSearchParams();
  if (active != null) qs.set("active", String(active ? 1 : 0));
  if (all) qs.set("all", "1");
  else {
    qs.set("page", String(page));
    qs.set("limit", String(limit));
  }
  const url = `${DEPOSIT_API_BASE}/api/deposit-packs?${qs.toString()}`;
  return apiFetch(url, { headers: { "Content-Type": "application/json", ...getAuthHeaders() } });
}

async function apiCreate(payload) {
  const url = `${DEPOSIT_API_BASE}/api/deposit-packs`;
  return apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(payload),
  });
}

async function apiUpdate(id, payload) {
  const url = `${DEPOSIT_API_BASE}/api/deposit-packs/${id}`;
  return apiFetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(payload),
  });
}

async function apiToggle(id, isActive) {
  const url = `${DEPOSIT_API_BASE}/api/deposit-packs/${id}/toggle`;
  return apiFetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ isActive: !!isActive }),
  });
}

async function apiReorder(orders) {
  const url = `${DEPOSIT_API_BASE}/api/deposit-packs/reorder`;
  return apiFetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ orders }),
  });
}

async function apiDelete(id, hard = false) {
  const url = new URL(`${DEPOSIT_API_BASE}/api/deposit-packs/${id}`);
  if (hard) url.searchParams.set("hard", "1");
  return apiFetch(url.toString(), { method: "DELETE", headers: { ...getAuthHeaders() } });
}

/*******************
 * Modal Component  *
 *******************/
function Modal({ isOpen, onClose, title, children, footer }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[1000]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white text-gray-900 shadow-2xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold">{title}</h3>
            <button
              className="px-2 py-1 text-sm hover:bg-gray-100 rounded"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && (
            <div className="px-5 py-4 border-t border-gray-200 bg-gray-50 rounded-b-2xl">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/******************************
 * Main Admin Page (Single-File)
 ******************************/
export default function DepositPacksAdmin() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const [onlyActive, setOnlyActive] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);

  const [dirtyOrder, setDirtyOrder] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    amount: "",
    discount: 0,
    title: "",
    note: "",
    isActive: true,
    sortOrder: 0,
    currency: "VND",
  });

  const pagesCount = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);

  const normalizeId = (x) => ({ ...x, id: x.id || x._id });

  async function loadData() {
    setLoading(true);
    try {
      const data = await apiList({ active: onlyActive, page, limit });
      const items = Array.isArray(data) ? data : data.items || [];
      setRows(items.map(normalizeId));
      setTotal(Array.isArray(data) ? items.length : data.pagination?.total ?? items.length);
      setDirtyOrder(false);
    } catch (e) {
      console.error(e);
      alert(`Không tải được dữ liệu: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyActive, page, limit]);

  function openCreate() {
    setEditing(null);
    setForm({
      amount: "",
      discount: 0,
      title: "",
      note: "",
      isActive: true,
      sortOrder: (rows[rows.length - 1]?.sortOrder ?? 0) + 1,
      currency: "VND",
    });
    setIsModalOpen(true);
  }

  function openEdit(row) {
    setEditing(row);
    setForm({
      amount: row.amount ?? "",
      discount: row.discount ?? 0,
      title: row.title || "",
      note: row.note || "",
      isActive: !!row.isActive,
      sortOrder: row.sortOrder ?? 0,
      currency: row.currency || "VND",
    });
    setIsModalOpen(true);
  }

  function onFormChange(e) {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      setForm((prev) => ({ ...prev, [name]: e.target.checked }));
      return;
    }
    if (["amount", "discount", "sortOrder"].includes(name)) {
      setForm((prev) => ({ ...prev, [name]: value === "" ? "" : Number(value) }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  }

  function validate() {
    const amount = Number(form.amount);
    if (!amount || Number.isNaN(amount) || amount < 1000) return "Số tiền phải ≥ 1000";
    const discount = Number(form.discount || 0);
    if (discount < 0 || discount > 100) return "% giảm phải trong 0..100";
    return null;
  }

  async function onSave() {
    const err = validate();
    if (err) return alert(err);

    const payload = {
      amount: Number(form.amount),
      discount: Number(form.discount || 0),
      title: (form.title || "").trim() || undefined,
      note: (form.note || "").trim() || undefined,
      isActive: !!form.isActive,
      sortOrder: Number(form.sortOrder || 0),
      currency: form.currency || "VND",
    };

    try {
      if (editing && editing.id) {
        await apiUpdate(editing.id, payload);
      } else {
        await apiCreate(payload);
      }
      setIsModalOpen(false);
      await loadData();
    } catch (e) {
      console.error(e);
      alert(`Lưu thất bại: ${e?.message || e}`);
    }
  }

  function moveRow(index, dir) {
    setRows((prev) => {
      const arr = [...prev];
      const j = index + dir;
      if (j < 0 || j >= arr.length) return prev;
      [arr[index], arr[j]] = [arr[j], arr[index]];
      return arr.map((it, i) => ({ ...it, sortOrder: i + 1 }));
    });
    setDirtyOrder(true);
  }

  async function saveOrder() {
    try {
      const orders = rows.map((it, i) => ({
        id: String(it.id || it._id),
        sortOrder: Number(it.sortOrder ?? i + 1),
      }));
      await apiReorder(orders);
      setDirtyOrder(false);
      await loadData();
    } catch (e) {
      console.error(e);
      alert(`Cập nhật thứ tự thất bại: ${e?.message || e}`);
    }
  }

  async function onToggle(row) {
    try {
      await apiToggle(String(row.id || row._id), !row.isActive);
      await loadData();
    } catch (e) {
      console.error(e);
      alert(`Không thể đổi trạng thái: ${e?.message || e}`);
    }
  }

  async function onDelete(row) {
    const isHard = window.confirm(
      "Xoá cứng? OK để xoá vĩnh viễn, Cancel để xoá mềm (đặt isActive=false)."
    );
    try {
      if (isHard) {
        await apiDelete(String(row.id || row._id), true);
      } else {
        await apiUpdate(String(row.id || row._id), { isActive: false });
      }
      await loadData();
    } catch (e) {
      console.error(e);
      alert(`Xoá thất bại: ${e?.message || e}`);
    }
  }

  return (
    <div className="flex min-h-screen w-screen overflow-hidden bg-white text-slate-900">
    <Sidebar activeKey="payment.card"/>
    <main className="flex-1 min-w-0 overflow-x-auto bg-gray-50">
    <div className="bg-white min-h-screen">
      <div className="mx-auto max-w-[1680px] px-4 md:px-6 py-4 md:py-6 text-gray-900">
        {/* Header */}
        <div className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <h1 className="text-2xl font-bold">Quản lý gói nạp</h1>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                checked={onlyActive}
                onChange={(e) => {
                  setPage(1);
                  setOnlyActive(e.target.checked);
                }}
              />
              <span>Chỉ hiển thị gói đang bật</span>
            </label>
            <button
              onClick={openCreate}
              className="px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
            >
              + Tạo gói
            </button>
            <button
              onClick={() => loadData()}
              className="px-3 py-2 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 shadow-sm"
            >
              Làm mới
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-gray-200 overflow-hidden bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-[1000px] w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="border-b border-gray-200 text-left text-gray-700">
                  <th className="px-3 py-3 w-[140px] font-semibold">Thứ tự</th>
                  <th className="px-3 py-3 font-semibold">Số tiền</th>
                  <th className="px-3 py-3 font-semibold">Giảm (%)</th>
                  <th className="px-3 py-3 font-semibold">Tiêu đề</th>
                  <th className="px-3 py-3 font-semibold">Ghi chú</th>
                  <th className="px-3 py-3 font-semibold">Trạng thái</th>
                  <th className="px-3 py-3 text-right font-semibold">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                      Đang tải…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                      Không có dữ liệu
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => (
                    <tr
                      key={String(row.id || row._id)}
                      className="border-t border-gray-100 hover:bg-gray-50"
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <button
                            className="px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100"
                            onClick={() => moveRow(idx, -1)}
                            disabled={idx === 0}
                            title="Lên"
                          >
                            ↑
                          </button>
                          <button
                            className="px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100"
                            onClick={() => moveRow(idx, +1)}
                            disabled={idx === rows.length - 1}
                            title="Xuống"
                          >
                            ↓
                          </button>
                          <span className="text-gray-600">{row.sortOrder ?? idx + 1}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-semibold">
                        {nfVN.format(row.amount)}{" "}
                        <span className="text-gray-500">{row.currency || "VND"}</span>
                      </td>
                      <td className="px-3 py-2">{row.discount || 0}%</td>
                      <td className="px-3 py-2">
                        {row.title || <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {row.note || <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`px-2 py-1 rounded text-xs border ${
                            row.isActive
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-gray-100 text-gray-700 border-gray-200"
                          }`}
                        >
                          {row.isActive ? "Đang bật" : "Đang ẩn"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            className="px-2 py-1 rounded bg-white border border-gray-300 hover:bg-gray-50"
                            onClick={() => openEdit(row)}
                          >
                            Sửa
                          </button>
                          <button
                            className="px-2 py-1 rounded bg-white border border-gray-300 hover:bg-gray-50"
                            onClick={() => onToggle(row)}
                          >
                            {row.isActive ? "Tắt" : "Bật"}
                          </button>
                          <button
                            className="px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700"
                            onClick={() => onDelete(row)}
                          >
                            Xoá
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer actions */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-3 px-3 py-3 border-t border-gray-200 bg-gray-50">
            <div className="flex items-center gap-2">
              <button
                className={`px-3 py-2 rounded-lg border shadow-sm ${
                  dirtyOrder
                    ? "bg-amber-500 text-white border-amber-500 hover:bg-amber-600"
                    : "bg-white border-gray-300 text-gray-400 cursor-not-allowed"
                }`}
                onClick={saveOrder}
                disabled={!dirtyOrder}
              >
                Lưu thứ tự
              </button>
              <button
                className="px-3 py-2 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 shadow-sm"
                onClick={() => {
                  setRows((prev) =>
                    prev
                      .slice()
                      .sort((a, b) => (a.amount ?? 0) - (b.amount ?? 0))
                      .map((it, i) => ({ ...it, sortOrder: i + 1 }))
                  );
                  setDirtyOrder(true);
                }}
              >
                Sắp xếp theo số tiền
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-sm text-gray-600">Tổng: {total}</div>
              <div className="flex items-center gap-2">
                <select
                  className="bg-white border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={limit}
                  onChange={(e) => {
                    setPage(1);
                    setLimit(Number(e.target.value));
                  }}
                >
                  {[10, 20, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}/trang
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1">
                  <button
                    className="px-2 py-1 rounded bg-white border border-gray-300 hover:bg-gray-50"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    Trước
                  </button>
                  <span className="px-2 text-gray-700">
                    {page}/{pagesCount}
                  </span>
                  <button
                    className="px-2 py-1 rounded bg-white border border-gray-300 hover:bg-gray-50"
                    onClick={() => setPage((p) => Math.min(pagesCount, p + 1))}
                    disabled={page >= pagesCount}
                  >
                    Sau
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Create/Edit Modal */}
        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={editing ? "Sửa gói nạp" : "Tạo gói nạp"}
          footer={
            <div className="flex items-center justify-end gap-2">
              <button
                className="px-3 py-2 rounded bg-white border border-gray-300 hover:bg-gray-50"
                onClick={() => setIsModalOpen(false)}
              >
                Huỷ
              </button>
              <button
                className="px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700"
                onClick={onSave}
              >
                {editing ? "Cập nhật" : "Tạo mới"}
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-sm text-gray-700">Số tiền (VND)</span>
              <input
                type="number"
                name="amount"
                value={form.amount}
                onChange={onFormChange}
                min={1000}
                className="bg-white border border-gray-300 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-xs text-gray-500">
                Hiển thị: {form.amount ? nfVN.format(Number(form.amount)) : 0} VND
              </span>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm text-gray-700">Giảm giá (%)</span>
              <input
                type="number"
                name="discount"
                value={form.discount}
                onChange={onFormChange}
                min={0}
                max={100}
                className="bg-white border border-gray-300 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-sm text-gray-700">Tiêu đề (tuỳ chọn)</span>
              <input
                type="text"
                name="title"
                value={form.title}
                onChange={onFormChange}
                className="bg-white border border-gray-300 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-sm text-gray-700">Ghi chú (tuỳ chọn)</span>
              <textarea
                name="note"
                value={form.note}
                onChange={onFormChange}
                rows={3}
                className="bg-white border border-gray-300 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="isActive"
                checked={!!form.isActive}
                onChange={onFormChange}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-gray-700">Bật gói</span>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm text-gray-700">Thứ tự</span>
              <input
                type="number"
                name="sortOrder"
                value={form.sortOrder}
                onChange={onFormChange}
                className="bg-white border border-gray-300 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm text-gray-700">Tiền tệ</span>
              <select
                name="currency"
                value={form.currency}
                onChange={onFormChange}
                className="bg-white border border-gray-300 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="VND">VND</option>
              </select>
            </label>
          </div>
        </Modal>
      </div>
    </div>
    </main>
    </div>
  );
}
