import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Sidebar from "../Admin/Sidebar/Sidebar";

export default function BgFilesAdmin() {
  const API = useMemo(() => (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000").replace(/\/+$/, ""), []);
  const http = useMemo(() => axios.create({ baseURL: API }), [API]);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);

  async function fetchList() {
    setLoading(true);
    try {
      const { data } = await http.get("/api/bg-files", { params: { page, limit, q, sort: "createdAt:desc" } });
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      alert("Load list failed: " + (e?.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchList(); }, [page, q]);

  function openCreate() {
    setEditing({ name: "", file: null, activeFrom: "", activeTo: "", status: true });
    setShowForm(true);
  }

  function openEdit(row) {
    setEditing({ ...row, file: null });
    setShowForm(true);
  }

  async function saveForm() {
    try {
      const fd = new FormData();
      if (editing.file) fd.append("file", editing.file);
      if (editing.name != null) fd.append("name", editing.name);
      if (editing.activeFrom) fd.append("activeFrom", editing.activeFrom);
      if (editing.activeTo) fd.append("activeTo", editing.activeTo);
      if (typeof editing.status !== "undefined") fd.append("status", editing.status ? "1" : "0");

      if (editing._id) {
        await http.put(`/api/bg-files/${editing._id}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      } else {
        await http.post(`/api/bg-files`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      }

      setShowForm(false);
      await fetchList();
    } catch (e) {
      alert("Save failed: " + (e?.response?.data?.error || e.message));
    }
  }

  async function toggleStatus(row) {
    try {
      const { data } = await http.patch(`/api/bg-files/${row._id}/toggle`);
      setItems(prev => prev.map(it => it._id === row._id ? data : it));
    } catch (e) {
      alert("Toggle failed: " + (e?.response?.data?.error || e.message));
    }
  }

  async function removeRow(row) {
    if (!confirm("Xoá mục này?")) return;
    try {
      await http.delete(`/api/bg-files/${row._id}`);
      await fetchList();
    } catch (e) {
      alert("Delete failed: " + (e?.response?.data?.error || e.message));
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="flex min-h-screen w-screen overflow-hidden bg-white text-slate-900">
    <Sidebar activeKey="background"/>
    <main className="flex-1 min-w-0 overflow-x-auto bg-gray-50">
    <div className="p-6 max-w-7xl mx-auto bg-white text-gray-800 min-h-screen">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold text-gray-900">Quản lý Background Files</h1>
        <button onClick={openCreate} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white">+ Thêm</button>
      </div>

      <div className="mb-4 flex gap-2 items-center">
        <input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Tìm theo tên" className="border rounded px-3 py-2 w-full max-w-sm focus:outline-none focus:ring focus:ring-blue-300" />
      </div>

      <div className="overflow-x-auto border rounded bg-white shadow">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100 text-gray-700">
            <tr className="text-left">
              <th className="px-3 py-2">Tên</th>
              <th className="px-3 py-2">Đường dẫn</th>
              <th className="px-3 py-2">Bắt đầu</th>
              <th className="px-3 py-2">Kết thúc</th>
              <th className="px-3 py-2">Trạng thái</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-3 py-3 text-center text-gray-500" colSpan={6}>Đang tải…</td></tr>
            ) : items.length === 0 ? (
              <tr><td className="px-3 py-3 text-center text-gray-500" colSpan={6}>Chưa có dữ liệu</td></tr>
            ) : (
              items.map((it) => (
                <tr key={it._id} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2">{it.name}</td>
                  <td className="px-3 py-2 break-all">
                    {it.filePath ? (
                      <a className="text-blue-600 underline" href={API + it.filePath} target="_blank" rel="noreferrer">{it.filePath}</a>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2">{it.activeFrom ? new Date(it.activeFrom).toLocaleString() : "—"}</td>
                  <td className="px-3 py-2">{it.activeTo ? new Date(it.activeTo).toLocaleString() : "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${it.status ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'}`}>
                      {it.status ? 'Bật' : 'Tắt'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right space-x-2">
                    <button onClick={()=>toggleStatus(it)} className="px-3 py-1 rounded border text-gray-700 hover:bg-gray-100">Toggle</button>
                    <button onClick={()=>openEdit(it)} className="px-3 py-1 rounded border text-gray-700 hover:bg-gray-100">Sửa</button>
                    <button onClick={()=>removeRow(it)} className="px-3 py-1 rounded border text-red-600 hover:bg-red-50">Xoá</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-3 text-sm text-gray-700">
        <span>Tổng: {total}</span>
        <div className="space-x-2">
          <button disabled={page<=1} onClick={()=>setPage(p=>p-1)} className="px-3 py-1 rounded border disabled:opacity-50">Prev</button>
          <span>{page} / {pageCount}</span>
          <button disabled={page>=pageCount} onClick={()=>setPage(p=>p+1)} className="px-3 py-1 rounded border disabled:opacity-50">Next</button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-4 w-full max-w-xl space-y-3 shadow-lg">
            <h2 className="text-lg font-semibold text-gray-900">{editing?._id ? "Chỉnh sửa" : "Thêm mới"}</h2>
            <div className="grid grid-cols-1 gap-3">
              <label className="block">
                <div className="text-sm mb-1">Tên</div>
                <input value={editing.name || ""} onChange={(e)=>setEditing({...editing, name:e.target.value})} className="border rounded px-3 py-2 w-full focus:outline-none focus:ring focus:ring-blue-300" />
              </label>

              <label className="block">
                <div className="text-sm mb-1">File</div>
                <input type="file" onChange={(e)=>setEditing({...editing, file:e.target.files?.[0] || null})} />
                {editing?._id && editing.filePath && (
                  <div className="text-xs text-gray-500 mt-1">File hiện tại: {editing.filePath}</div>
                )}
              </label>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block">
                  <div className="text-sm mb-1">Bắt đầu</div>
                  <input
                    type="datetime-local"
                    value={editing.activeFrom ? new Date(editing.activeFrom).toISOString().slice(0,16) : ""}
                    onChange={(e)=>setEditing({...editing, activeFrom:e.target.value})}
                    className="border rounded px-3 py-2 w-full focus:outline-none focus:ring focus:ring-blue-300"
                  />
                </label>
                <label className="block">
                  <div className="text-sm mb-1">Kết thúc</div>
                  <input
                    type="datetime-local"
                    value={editing.activeTo ? new Date(editing.activeTo).toISOString().slice(0,16) : ""}
                    onChange={(e)=>setEditing({...editing, activeTo:e.target.value})}
                    className="border rounded px-3 py-2 w-full focus:outline-none focus:ring focus:ring-blue-300"
                  />
                </label>
              </div>

              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={!!editing.status} onChange={(e)=>setEditing({...editing, status:e.target.checked})} />
                <span>Bật</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={()=>setShowForm(false)} className="px-4 py-2 rounded border text-gray-700 hover:bg-gray-100">Huỷ</button>
              <button onClick={saveForm} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white">Lưu</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </main>
    </div>
  );
}
