// src/admin/pages/HomeSlides.jsx (Light Theme)
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Sidebar from "../Admin/Sidebar/Sidebar";

/** ENV */
const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';
const ASSET_BASE = import.meta.env.VITE_ASSET_BASE_URL || API;

/** Helpers */
function readToken() {
  try {
    const raw = localStorage.getItem('token');
    if (!raw) return null;
    const may = JSON.parse(raw);
    return typeof may === 'string' ? may : may?.token ?? raw;
  } catch {
    return localStorage.getItem('token');
  }
}
function buildUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${ASSET_BASE}${String(path).startsWith('/') ? path : `/${path}`}`;
}
function toLocalInput(dt) {
  if (!dt) return '';
  try {
    const d = new Date(dt);
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  } catch {
    return '';
  }
}

function SlideForm({ open, onClose, initial }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [href, setHref] = useState(initial?.href || '');
  const [devices, setDevices] = useState(initial?.devices || 'all');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 0);
  const [startAt, setStartAt] = useState(toLocalInput(initial?.startAt));
  const [endAt, setEndAt] = useState(toLocalInput(initial?.endAt));

  const [imageUrl, setImageUrl] = useState(() => (initial?.imagePath?.startsWith('http') ? initial.imagePath : ''));
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(() => buildUrl(initial?.imagePath));

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!open) return null;
  const token = readToken();

  const submit = async (e) => {
    e.preventDefault();
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      if (initial?._id) {
        // UPDATE
        if (file) {
          const fd = new FormData();
          fd.append('file', file);
          fd.append('title', title);
          fd.append('href', href);
          fd.append('devices', devices);
          fd.append('enabled', String(enabled));
          fd.append('sortOrder', String(sortOrder));
          if (startAt) fd.append('startAt', new Date(startAt).toISOString());
          if (endAt) fd.append('endAt', new Date(endAt).toISOString());
          await axios.put(`${API}/api/home/slides/${initial._id}`, fd, { headers });
        } else {
          await axios.put(
            `${API}/api/home/slides/${initial._id}`,
            {
              title,
              href,
              devices,
              enabled,
              sortOrder,
              startAt: startAt ? new Date(startAt).toISOString() : undefined,
              endAt: endAt ? new Date(endAt).toISOString() : undefined,
              imageUrl: imageUrl || undefined,
            },
            { headers }
          );
        }
      } else {
        // CREATE
        if (file) {
          const fd = new FormData();
          fd.append('file', file);
          fd.append('title', title);
          fd.append('href', href);
          fd.append('devices', devices);
          fd.append('enabled', String(enabled));
          fd.append('sortOrder', String(sortOrder));
          if (startAt) fd.append('startAt', new Date(startAt).toISOString());
          if (endAt) fd.append('endAt', new Date(endAt).toISOString());
          await axios.post(`${API}/api/home/slides`, fd, { headers });
        } else {
          await axios.post(
            `${API}/api/home/slides`,
            {
              title,
              href,
              devices,
              enabled,
              sortOrder,
              startAt: startAt ? new Date(startAt).toISOString() : undefined,
              endAt: endAt ? new Date(endAt).toISOString() : undefined,
              imageUrl: imageUrl || undefined,
            },
            { headers }
          );
        }
      }
      onClose(true);
    } catch (e) {
      alert(e?.response?.data?.message || e.message);
    }
  };

  return (
    
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={() => onClose(false)} />
      <form
        onSubmit={submit}
        className="relative w-[840px] max-w-[95vw] bg-white text-gray-900 border border-gray-200 rounded-xl p-4 space-y-4 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{initial?._id ? 'Sửa slide' : 'Thêm slide'}</h3>
          <button
            type="button"
            onClick={() => onClose(false)}
            className="px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
          >
            Đóng
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm text-gray-700">Tiêu đề</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full mt-1 bg-white border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <label className="block">
              <span className="text-sm text-gray-700">URL (href)</span>
              <input
                value={href}
                onChange={(e) => setHref(e.target.value)}
                className="w-full mt-1 bg-white border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="https://... hoặc /3d-model?..."
              />
            </label>
            <label className="block">
              <span className="text-sm text-gray-700">Thiết bị</span>
              <select
                value={devices}
                onChange={(e) => setDevices(e.target.value)}
                className="w-full mt-1 bg-white border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">all</option>
                <option value="desktop">desktop</option>
                <option value="mobile">mobile</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-gray-700">Thứ tự</span>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                className="w-full mt-1 bg-white border border-gray-300 p-2 rounded text-right focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <label className="block">
              <span className="text-sm text-gray-700">Bắt đầu (tuỳ chọn)</span>
              <input
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="w-full mt-1 bg-white border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <label className="block">
              <span className="text-sm text-gray-700">Kết thúc (tuỳ chọn)</span>
              <input
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                className="w-full mt-1 bg-white border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <label className="block col-span-2">
              <span className="text-sm text-gray-700">Dán URL ảnh (tuỳ chọn)</span>
              <input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="w-full mt-1 bg-white border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="https://..."
              />
            </label>
            <label className="block col-span-2">
              <span className="text-sm text-gray-700">Hoặc tải file</span>
              <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full mt-1" />
            </label>
            <label className="inline-flex items-center gap-2 col-span-2">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span className="text-gray-700">Bật hiển thị</span>
            </label>
          </div>
          <div className="col-span-1">
            <div className="text-sm text-gray-700 mb-2">Xem trước</div>
            <div className="border border-gray-200 rounded-lg overflow-hidden aspect-video bg-gray-50 flex items-center justify-center">
              {preview ? (
                <img src={preview} alt="preview" className="w-full h-full object-cover" />
              ) : (
                <span className="text-gray-500 text-sm">Chưa có ảnh</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onClose(false)}
            className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-50"
          >
            Huỷ
          </button>
          <button
            type="submit"
            className="px-3 py-2 bg-indigo-600 text-white rounded border border-indigo-600 hover:bg-indigo-700"
          >
            Lưu
          </button>
        </div>
      </form>
    </div>
  );
}

export default function HomeSlidesAdmin() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const token = readToken();

  async function load(page = 1) {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/api/home/slides/admin`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        params: { limit: 200, page },
      });
      setItems(data?.items || []);
    } catch (e) {
      alert(e?.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleEnabled = async (it) => {
    try {
      await axios.put(
        `${API}/api/home/slides/${it._id}`,
        { enabled: !it.enabled },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      load();
    } catch (e) {
      alert(e?.response?.data?.message || e.message);
    }
  };

  const updateSort = async (it, val) => {
    try {
      await axios.put(
        `${API}/api/home/slides/${it._id}`,
        { sortOrder: Number(val) },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      load();
    } catch (e) {
      alert(e?.response?.data?.message || e.message);
    }
  };

  const del = async (it) => {
    if (!confirm('Xoá slide này?')) return;
    try {
      await axios.delete(`${API}/api/home/slides/${it._id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      load();
    } catch (e) {
      alert(e?.response?.data?.message || e.message);
    }
  };

  return (
    <div className="flex min-h-screen w-screen overflow-hidden bg-white">
    <Sidebar activeKey="slide" />
    <main className="flex-1 min-w-0 bg-gray-100">
    <div className="p-4 text-gray-900 bg-white min-h-screen">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Home Slides</h1>
        <button
          className="px-3 py-2 bg-indigo-600 text-white rounded border border-indigo-600 hover:bg-indigo-700"
          onClick={() => {
            setEditing(null);
            setOpenForm(true);
          }}
        >
          + Thêm slide
        </button>
      </div>

      {loading ? (
        <div className="text-gray-600">Đang tải…</div>
      ) : (
        <div className="overflow-auto border border-gray-200 rounded-lg shadow-sm">
          <table className="min-w-[960px] w-full text-sm">
            <thead>
              <tr className="bg-gray-100 text-gray-700">
                <th className="p-2 text-left font-medium">Ảnh</th>
                <th className="p-2 text-left font-medium">Tiêu đề</th>
                <th className="p-2 text-left font-medium">URL</th>
                <th className="p-2 font-medium">Thiết bị</th>
                <th className="p-2 font-medium">Thứ tự</th>
                <th className="p-2 font-medium">Thời gian</th>
                <th className="p-2 font-medium">Bật</th>
                <th className="p-2 font-medium">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it._id} className="border-t border-gray-200 align-top">
                  <td className="p-2">
                    <div className="w-36 h-20 overflow-hidden rounded border border-gray-200 bg-gray-50">
                      {it.imagePath && (
                        <img src={buildUrl(it.imagePath)} alt="slide" className="w-full h-full object-cover" />
                      )}
                    </div>
                  </td>
                  <td className="p-2">
                    <div className="font-medium text-gray-900">{it.title}</div>
                    <div className="text-xs text-gray-500">{it._id}</div>
                  </td>
                  <td className="p-2 max-w-[260px]">
                    <a
                      href={it.href}
                      className="text-blue-600 hover:underline break-all"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {it.href}
                    </a>
                  </td>
                  <td className="p-2 text-center text-gray-700">{it.devices}</td>
                  <td className="p-2 text-center">
                    <input
                      type="number"
                      defaultValue={it.sortOrder}
                      onBlur={(e) => updateSort(it, e.target.value)}
                      className="w-20 text-center bg-white border border-gray-300 rounded p-1 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </td>
                  <td className="p-2 text-xs whitespace-nowrap text-gray-700">
                    {it.startAt ? `Từ: ${toLocalInput(it.startAt).replace('T', ' ')}` : '—'}
                    <br />
                    {it.endAt ? `Đến: ${toLocalInput(it.endAt).replace('T', ' ')}` : '—'}
                  </td>
                  <td className="p-2 text-center">
                    <button
                      onClick={() => toggleEnabled(it)}
                      className={`px-2 py-1 rounded border transition-colors ${
                        it.enabled
                          ? 'bg-green-100 text-green-700 border-green-200 hover:bg-green-200'
                          : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200'
                      }`}
                    >
                      {it.enabled ? 'ON' : 'OFF'}
                    </button>
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50"
                        onClick={() => {
                          setEditing(it);
                          setOpenForm(true);
                        }}
                      >
                        Sửa
                      </button>
                      <button
                        className="px-2 py-1 bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100"
                        onClick={() => del(it)}
                      >
                        Xoá
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SlideForm
        open={openForm}
        onClose={(changed) => {
          setOpenForm(false);
          if (changed) load();
        }}
        initial={editing}
      />
    </div>
    </main>
    </div>
  );
}
