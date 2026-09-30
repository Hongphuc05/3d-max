import React, { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, RefreshCw, Search, CheckCircle2, XCircle, Image as ImageIcon } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

// Helpers <input type="datetime-local">
function toLocalInputValue(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
function fromLocalToISO(v) {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}

export default function BackgroundManager() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("accessToken") || "";

  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

  const load = async () => {
    setLoading(true);
    const res = await fetch(`${API_BASE}/api/backgrounds`, {
      headers: { ...authHeader },
      credentials: "include",
    });
    const data = await res.json();
    setItems(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // --- Create form state ---
  const [file, setFile] = useState(null);
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [order, setOrder] = useState(0);
  const [creating, setCreating] = useState(false);

  const onCreate = async (e) => {
    e.preventDefault();
    try {
      setCreating(true);
      const fd = new FormData();
      if (file) fd.append("image", file);
      // nếu không upload file, bạn có thể fd.append("imageUrl", "https://...") thay thế
      fd.append("startAt", fromLocalToISO(startAt));
      fd.append("endAt", fromLocalToISO(endAt));
      fd.append("isActive", String(isActive));
      fd.append("order", String(order));

      const res = await fetch(`${API_BASE}/api/backgrounds`, {
        method: "POST",
        headers: { ...authHeader },
        body: fd,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Create failed");
      await load();
      // reset
      setFile(null);
      setStartAt("");
      setEndAt("");
      setIsActive(true);
      setOrder(0);
    } catch (err) {
      console.error(err);
      alert(err.message);
    } finally {
      setCreating(false);
    }
  };

  const onDelete = async (id) => {
    if (!confirm("Xóa ảnh nền này?")) return;
    const res = await fetch(`${API_BASE}/api/backgrounds/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...authHeader },
      credentials: "include",
    });
    if (res.ok) load();
    else alert("Delete failed");
  };

  const onUpdate = async (id, patch) => {
    const fd = new FormData();
    if (patch.file) fd.append("image", patch.file);
    if ("startAt" in patch) fd.append("startAt", patch.startAt ? fromLocalToISO(patch.startAt) : "");
    if ("endAt" in patch) fd.append("endAt", patch.endAt ? fromLocalToISO(patch.endAt) : "");
    if ("isActive" in patch) fd.append("isActive", String(patch.isActive));
    if ("order" in patch) fd.append("order", String(patch.order));

    const res = await fetch(`${API_BASE}/api/backgrounds/${id}`, {
      method: "PUT",
      headers: { ...authHeader },
      body: fd,
      credentials: "include",
    });
    if (res.ok) load();
    else alert("Update failed");
  };

  const filtered = useMemo(() => {
    if (!q) return items;
    const qq = q.toLowerCase();
    return items.filter((i) =>
      (i.imageUrl || "").toLowerCase().includes(qq)
    );
  }, [q, items]);

  return (
    <div className="p-4 text-sm text-zinc-200">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Quản lý ảnh nền</h2>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 px-3 py-1 rounded-md border border-zinc-700 hover:bg-white/5"
          title="Tải lại"
        >
          <RefreshCw size={16} /> Reload
        </button>
      </div>

      {/* Create */}
      <form onSubmit={onCreate} className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 p-3 border border-zinc-700 rounded-xl bg-black/50">
        <label className="flex flex-col gap-1">
          <span className="text-zinc-400">Chọn ảnh</span>
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-400">Bắt đầu</span>
          <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="bg-transparent border border-zinc-700 rounded px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-400">Kết thúc</span>
          <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className="bg-transparent border border-zinc-700 rounded px-2 py-1" />
        </label>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span>Kích hoạt</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <span>Thứ tự</span>
            <input type="number" value={order} onChange={(e) => setOrder(+e.target.value)} className="w-20 bg-transparent border border-zinc-700 rounded px-2 py-1" />
          </label>
          <button
            type="submit"
            disabled={creating}
            className="ml-auto inline-flex items-center gap-2 px-3 py-1 rounded-md bg-[#8f120d] hover:bg-[#7a0f0b]"
          >
            <Plus size={16} /> Thêm
          </button>
        </div>
      </form>

      {/* Search */}
      <div className="mt-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2" size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm theo đường dẫn ảnh…"
            className="w-full bg-transparent border border-zinc-700 rounded pl-8 pr-3 py-2"
          />
        </div>
      </div>

      {/* List */}
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {loading ? (
          <div className="opacity-70">Đang tải…</div>
        ) : filtered.length === 0 ? (
          <div className="opacity-70">Chưa có ảnh nền</div>
        ) : (
          filtered.map((it) => (
            <div key={it._id} className="rounded-xl border border-zinc-700 p-3 bg-black/40">
              <div className="flex gap-3">
                <div className="w-40 h-24 bg-zinc-900 rounded overflow-hidden flex items-center justify-center">
                  {it.imageUrlAbs ? (
                    <img src={it.imageUrlAbs} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon />
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <div className="text-xs text-zinc-400 break-all">{it.imageUrl}</div>
                  <div className="flex flex-wrap gap-3 text-xs">
                    <span>Bắt đầu: {it.startAt ? toLocalInputValue(it.startAt).replace("T", " ") : "—"}</span>
                    <span>Kết thúc: {it.endAt ? toLocalInputValue(it.endAt).replace("T", " ") : "—"}</span>
                    <span>Thứ tự: {it.order}</span>
                    <span className={`inline-flex items-center gap-1 ${it.isActive ? "text-green-400" : "text-zinc-400"}`}>
                      {it.isActive ? <CheckCircle2 size={14}/> : <XCircle size={14}/>} {it.isActive ? "Đang bật" : "Tắt"}
                    </span>
                  </div>

                  {/* Inline edit controls */}
                  <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <label className="flex flex-col gap-1">
                      <span className="text-zinc-400">Bắt đầu</span>
                      <input
                        type="datetime-local"
                        defaultValue={toLocalInputValue(it.startAt)}
                        onBlur={(e) => onUpdate(it._id, { startAt: e.target.value })}
                        className="bg-transparent border border-zinc-700 rounded px-2 py-1"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-zinc-400">Kết thúc</span>
                      <input
                        type="datetime-local"
                        defaultValue={toLocalInputValue(it.endAt)}
                        onBlur={(e) => onUpdate(it._id, { endAt: e.target.value })}
                        className="bg-transparent border border-zinc-700 rounded px-2 py-1"
                      />
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        defaultChecked={it.isActive}
                        onChange={(e) => onUpdate(it._id, { isActive: e.target.checked })}
                      />
                      <span>Kích hoạt</span>
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <span>Thứ tự</span>
                      <input
                        type="number"
                        defaultValue={it.order}
                        onBlur={(e) => onUpdate(it._id, { order: +e.target.value })}
                        className="w-20 bg-transparent border border-zinc-700 rounded px-2 py-1"
                      />
                    </label>
                    <label className="flex flex-col gap-1 col-span-2 md:col-span-4">
                      <span className="text-zinc-400">Đổi ảnh</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) onUpdate(it._id, { file: f });
                        }}
                      />
                    </label>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => onDelete(it._id)}
                    className="text-red-400 hover:text-red-300"
                    title="Xóa"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
