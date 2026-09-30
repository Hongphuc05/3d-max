// src/pages/admin/Discounts.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Sidebar from "../Sidebar/Sidebar";
import Header from "../Header/Header";

const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL });

const emptyForm = {
  text: "",
  percent: 10,
  couponCode: "",
  status: "active",
  startDate: "",
  endDate: "",
  priority: 0,
  icon: "",
};

function Input({ label, ...props }) {
  return (
    <label className="block text-sm mb-3">
      <span className="block text-gray-600 mb-1">{label}</span>
      <input {...props} className="w-full rounded-lg border px-3 py-2 outline-none focus:ring" />
    </label>
  );
}
function Select({ label, children, ...props }) {
  return (
    <label className="block text-sm mb-3">
      <span className="block text-gray-600 mb-1">{label}</span>
      <select {...props} className="w-full rounded-lg border px-3 py-2 outline-none focus:ring">
        {children}
      </select>
    </label>
  );
}
function TextArea({ label, ...props }) {
  return (
    <label className="block text-sm mb-3">
      <span className="block text-gray-600 mb-1">{label}</span>
      <textarea {...props} className="w-full rounded-lg border px-3 py-2 outline-none min-h-[80px] focus:ring" />
    </label>
  );
}

export default function DiscountsPage() {

  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [openForm, setOpenForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const authHeaders = () => {
    const t = localStorage.getItem("token");
    return t ? { Authorization: `Bearer ${t}` } : {};
  };
  const fetchList = async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/discounts",{ headers: authHeaders() }, { params: { q } });
      setItems(res.data || []);
    } catch {
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchList(); }, []);

  const filtered = useMemo(() => {
    if (!q) return items;
    const s = q.toLowerCase();
    return items.filter((x) => x.text?.toLowerCase().includes(s) || x.couponCode?.toLowerCase().includes(s));
  }, [items, q]);

  const onOpenCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setOpenForm(true);
  };
  const onOpenEdit = (row) => {
    setEditingId(row._id);
    setForm({
      ...emptyForm,
      ...row,
      startDate: row.startDate ? row.startDate.substring(0, 10) : "",
      endDate: row.endDate ? row.endDate.substring(0, 10) : "",
    });
    setError("");
    setOpenForm(true);
  };
  const onDelete = async (id) => {
    if (!confirm("Xóa discount này?")) return;
    await api.delete(`/api/discounts/${id}`);
    fetchList();
  };
  const onToggle = async (id) => {
    await api.patch(`/api/discounts/${id}/toggle`);
    fetchList();
  };
  const onSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    const payload = {
      ...form,
      percent: Number(form.percent),
      priority: Number(form.priority),
      couponCode: form.couponCode?.trim() || "",
      startDate: form.startDate ? new Date(form.startDate) : null,
      endDate: form.endDate ? new Date(form.endDate) : null,
    };

    try {
      if (editingId) await api.put(`/api/discounts/${editingId}`, payload, {headers: authHeaders()});
      else await api.post(`/api/discounts`, payload, {headers: authHeaders()});
      setOpenForm(false);
      fetchList();
    } catch (e) {
      setError(e?.response?.data?.message || "Lưu thất bại");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen w-screen overflow-hidden bg-white">
    <Sidebar activeKey="discount" />
    <main className="flex-1 min-w-0 bg-gray-100">
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Quản lý Discount</h1>
        <button onClick={onOpenCreate} className="px-4 py-2 rounded-xl bg-black text-white">+ Tạo</button>
      </div>

      <div className="mb-4 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo nội dung / couponCode"
               className="w-80 rounded-lg border px-3 py-2 outline-none focus:ring" />
        <button onClick={fetchList} className="px-3 py-2 rounded-lg border">Tải lại</button>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-3 text-left">Text</th>
              <th className="p-3 text-right">%</th>
              <th className="p-3 text-left">Coupon</th>
              <th className="p-3 text-left">Thời gian</th>
              <th className="p-3 text-left">Trạng thái</th>
              <th className="p-3 text-right">Ưu tiên</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td className="p-4" colSpan={7}>Đang tải…</td></tr> :
              filtered.length === 0 ? <tr><td className="p-4" colSpan={7}>Trống</td></tr> :
              filtered.map((x) => (
                <tr key={x._id} className="border-t">
                  <td className="p-3">{x.text}</td>
                  <td className="p-3 text-right">{x.percent}%</td>
                  <td className="p-3">{x.couponCode || "—"}</td>
                  <td className="p-3">
                    {x.startDate ? new Date(x.startDate).toLocaleDateString() : "—"} → {x.endDate ? new Date(x.endDate).toLocaleDateString() : "—"}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-xs ${x.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-700"}`}>{x.status}</span>
                  </td>
                  <td className="p-3 text-right">{x.priority}</td>
                  <td className="p-3">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => onOpenEdit(x)} className="px-3 py-1 rounded border">Sửa</button>
                      <button onClick={() => onToggle(x._id)} className="px-3 py-1 rounded border">{x.status === "active" ? "Tắt" : "Bật"}</button>
                      <button onClick={() => onDelete(x._id)} className="px-3 py-1 rounded border text-red-600">Xóa</button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {openForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-7xl rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">{editingId ? "Sửa Discount" : "Tạo Discount"}</h2>
              <button onClick={() => setOpenForm(false)}>✕</button>
            </div>
            {error && <div className="mb-3 text-red-600 text-sm">{error}</div>}

            <form onSubmit={onSave} className="grid grid-cols-2 gap-4">
              <TextArea label="Text hiển thị" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
              <Input label="Phần trăm (%)" type="number" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} />

              <Input label="Coupon code (tuỳ chọn)" value={form.couponCode} onChange={(e) => setForm({ ...form, couponCode: e.target.value })} />
              <Select label="Trạng thái" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </Select>

              <Input label="Bắt đầu" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              <Input label="Kết thúc" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />

              <Input label="Ưu tiên (số lớn hiển thị trước)" type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
              <Input label="Icon (URL, tuỳ chọn)" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} />

              <div className="col-span-2 flex justify-end gap-2">
                <button type="button" onClick={() => setOpenForm(false)} className="px-4 py-2 rounded-lg border">Hủy</button>
                <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-black text-white">{saving ? "Đang lưu…" : "Lưu"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    </main>
    </div>
  );
}
