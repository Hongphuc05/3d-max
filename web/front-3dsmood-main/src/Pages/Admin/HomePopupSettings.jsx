import React from 'react';
import axios from 'axios';
import Sidebar from "../Admin/Sidebar/Sidebar";

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

function useToken() {
  try {
    const raw = localStorage.getItem('token');
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return typeof obj === 'string' ? obj : obj?.token ?? raw;
  } catch {
    return localStorage.getItem('token');
  }
}

export default function HomePopupSettings() {
  const token = useToken();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const [form, setForm] = React.useState({
    enabled: true,
    title: 'Home Banner',
    href: '#',
    image: '',
    widthPx: 560,
    devices: 'all',
    startAt: '',
    endAt: '',
  });

  const [file, setFile] = React.useState(null);
  const [preview, setPreview] = React.useState('');

  const ax = React.useMemo(
    () => axios.create({ baseURL: API, headers: token ? { Authorization: `Bearer ${token}` } : {} }),
    [token]
  );

  React.useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const { data } = await ax.get('/api/admin/home-popup');
        setForm({
          enabled: !!data.enabled,
          title: data.title || 'Home Banner',
          href: data.href || '#',
          image: data.image || '',
          widthPx: data.widthPx || 560,
          devices: data.devices || 'all',
          startAt: data.startAt ? new Date(data.startAt).toISOString().slice(0, 16) : '',
          endAt: data.endAt ? new Date(data.endAt).toISOString().slice(0, 16) : '',
        });
        setPreview(data.image || '');
      } catch (e) {
        setError(e?.response?.data?.error || 'Load failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [ax]);

  // Thu gọn object URL khi đổi file/huỷ component để tránh leak
  React.useEffect(() => {
    return () => {
      if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const onChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
  };

  const onFile = (e) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    if (f) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    }
  };

  const onSave = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError('');
      const fd = new FormData();
      fd.append('enabled', String(!!form.enabled));
      fd.append('title', form.title || '');
      fd.append('href', form.href || '');
      fd.append('widthPx', String(form.widthPx || 560));
      fd.append('devices', form.devices || 'all');
      if (form.startAt) fd.append('startAt', new Date(form.startAt).toISOString());
      if (form.endAt) fd.append('endAt', new Date(form.endAt).toISOString());
      if (file) fd.append('image', file);
      else if (form.image && !form.image.startsWith('/uploads/') && /^https?:/i.test(form.image)) {
        fd.append('imageUrl', form.image);
      }

      const { data } = await ax.put('/api/admin/home-popup', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setForm((f) => ({ ...f, image: data?.config?.image || f.image }));
      if (!file && data?.config?.image) setPreview(data.config.image);
      alert('Đã lưu cấu hình popup');
    } catch (e) {
      setError(e?.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };
    const DEFAULT_FALLBACK = "/product1-1.jpg";
    const ASSET_BASE = (import.meta.env.VITE_ASSET_BASE_URL || API).replace(/\/+$/, "");

  const buildUrl = (path, fallback = DEFAULT_FALLBACK) => {
    try {
      if (path == null) return fallback;
      if (Array.isArray(path)) return buildUrl(path.find(Boolean), fallback);
      if (typeof path === "object") {
        const candidate = path.path ?? path.url ?? path.src ?? "";
        return buildUrl(candidate, fallback);
      }
      const s = String(path).trim();
      if (!s) return fallback;
      if (/^(https?:)?\/\//i.test(s) || /^data:/i.test(s) || /^blob:/i.test(s)) return s;
      const clean = s.replace(/^\/+/, "");
      return clean ? `${ASSET_BASE}/${clean}` : fallback;
    } catch {
      return fallback;
    }
  };

  if (loading) return <div className="p-6 text-slate-700">Đang tải...</div>;

  const inputBase =
    'w-full bg-white border border-gray-300 rounded px-3 py-2 text-slate-900 placeholder:text-slate-400 ' +
    'focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 shadow-sm';

  return (
    <div className="flex min-h-screen w-screen overflow-hidden bg-white text-slate-900">
    <Sidebar activeKey="popup"/>
    <main className="flex-1 min-w-0 overflow-x-auto bg-gray-50">
    <div className="max-w-3xl mx-auto p-6 bg-white text-slate-900">
      <h1 className="text-2xl font-semibold mb-4">Cấu hình Popup trang chủ</h1>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 text-red-800 rounded">
          {error}
        </div>
      )}

      <form onSubmit={onSave} className="space-y-5">
        <div className="flex items-center gap-3">
          <input
            id="enabled"
            name="enabled"
            type="checkbox"
            checked={!!form.enabled}
            onChange={onChange}
            className="h-4 w-4 accent-slate-900"
          />
          <label htmlFor="enabled" className="cursor-pointer text-slate-800">
            Bật popup
          </label>
        </div>

        <div>
          <label className="block text-sm mb-1 text-slate-700">Tiêu đề</label>
          <input name="title" value={form.title} onChange={onChange} className={inputBase} />
        </div>

        <div>
          <label className="block text-sm mb-1 text-slate-700">Liên kết (href)</label>
          <input
            name="href"
            value={form.href}
            onChange={onChange}
            placeholder="https://... hoặc #"
            className={inputBase}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1 text-slate-700">Chiều rộng (px)</label>
            <input
              name="widthPx"
              type="number"
              value={form.widthPx}
              onChange={onChange}
              className={inputBase}
            />
          </div>
          <div>
            <label className="block text-sm mb-1 text-slate-700">Thiết bị</label>
            <select
              name="devices"
              value={form.devices}
              onChange={onChange}
              className={inputBase}
            >
              <option value="all">Tất cả</option>
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1 text-slate-700">Bắt đầu (tuỳ chọn)</label>
            <input
              type="datetime-local"
              name="startAt"
              value={form.startAt}
              onChange={onChange}
              className={inputBase}
            />
          </div>
          <div>
            <label className="block text-sm mb-1 text-slate-700">Kết thúc (tuỳ chọn)</label>
            <input
              type="datetime-local"
              name="endAt"
              value={form.endAt}
              onChange={onChange}
              className={inputBase}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1 text-slate-700">Ảnh (tải lên)</label>
            <input type="file" accept="image/*" onChange={onFile} className="w-full text-slate-800" />
            <p className="text-xs text-slate-500 mt-1">Hoặc dùng URL ảnh bên phải</p>
          </div>
          {/* <div>
            <label className="block text-sm mb-1 text-slate-700">URL ảnh (CDN / ngoài)</label>
            <input
              name="image"
              value={form.image}
              onChange={onChange}
              placeholder="https://cdn...jpg"
              className={inputBase}
            />
          </div> */}
        </div>

        {preview && (
          <div className="mt-2">
            <label className="block text-sm mb-2 text-slate-700">Xem trước</label>
            <img
              src={buildUrl(preview)}
              alt="preview"
              className="max-h-[280px] rounded border border-gray-200 bg-white"
            />
          </div>
        )}

        <div className="pt-2">
          <button
            disabled={saving}
            className="px-4 py-2 rounded bg-slate-900 text-white border border-slate-900 hover:bg-slate-800 transition disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {saving ? 'Đang lưu...' : 'Lưu cấu hình'}
          </button>
        </div>
      </form>
    </div>
    </main>
    </div>
  );
}
