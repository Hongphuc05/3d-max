import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

function authHeaders() {
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const ASSET_BASE = (import.meta.env.VITE_ASSET_BASE_URL || API).replace(/\/+$/, "");
const DEFAULT_FALLBACK = "/product1-1.jpg";

// Chuẩn hoá URL ảnh preview (giữ nguyên nếu absolute)
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

// Chuẩn hoá mảng id (string hoá)
const toIdArray = (arr) =>
  (arr || []).map((x) => (typeof x === "string" ? x : x?._id || x)).filter(Boolean);

export default function EditProductModal({ open, product, onClose, onUpdated }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // options
  const [catTree, setCatTree] = useState(null);
  const [styles, setStyles] = useState([]);
  const [colors, setColors] = useState([]);
  const [forms, setForms] = useState([]);
  const [materials, setMaterials] = useState([]);

  // form state (giống form thêm, file optional)
  const [form, setForm] = useState({
    name: "",
    description: "",
    price: "",
    order: 0,            // 👈 NEW: order
    categoryIds: [],
    colors: [],
    styles: [],
    form: [],
    materials: [],
    displayhome: false,
    modelFile: null,
    previewImage: null,
    currentPreview: "",
  });

  // --- CATEGORY GROUP (level2) + CHIP CHILDREN (level3) ---
  const [activeGroupId, setActiveGroupId] = useState(null);
  const currentGroup = useMemo(() => {
    if (!catTree?.children) return null;
    return catTree.children.find((g) => String(g._id) === String(activeGroupId)) || null;
  }, [catTree, activeGroupId]);

  useEffect(() => {
    if (!activeGroupId && catTree?.children?.length) {
      setActiveGroupId(String(catTree.children[0]._id));
    }
  }, [catTree, activeGroupId]);

  // nạp dữ liệu khi mở
  useEffect(() => {
    if (!open || !product?._id) return;
    let cancelled = false;

    async function loadAll() {
      setMsg("");
      setLoading(true);
      try {
        const [cat, st, co, fo, ma] = await Promise.all([
          axios.get(`${API}/api/categories/tree/3dmodel`, { headers: authHeaders() }),
          axios.get(`${API}/api/styles`, { headers: authHeaders() }),
          axios.get(`${API}/api/colors`, { headers: authHeaders() }),
          axios.get(`${API}/api/forms`, { headers: authHeaders() }),
          axios.get(`${API}/api/materials`, { headers: authHeaders() }),
        ]);
        if (cancelled) return;
        setCatTree(cat.data || null);
        setStyles(st.data || []);
        setColors(co.data || []);
        setForms(fo.data || []);
        setMaterials(ma.data || []);

        const detail = await axios.get(`${API}/api/products/${product._id}`, {
          headers: authHeaders(),
        });
        if (cancelled) return;
        const p = detail.data?.product || detail.data || {};
        setForm({
          name: p.name || "",
          description: p.description || "",
          price: Number.isFinite(p.price) ? p.price : "",
          order: Number.isFinite(p.order) ? p.order : 0,   // 👈 NEW: nạp order
          categoryIds: toIdArray(p.categoryIds),
          colors: toIdArray(p.color || p.colors),
          styles: toIdArray(p.styles),
          form: toIdArray(p.form),
          materials: toIdArray(p.materials),
          displayhome: !!(p.displayhome ?? p.displayHome),
          modelFile: null,
          previewImage: null,
          currentPreview: p.previewImagePath || "",
        });
      } catch (e) {
        if (!cancelled) setMsg(`Lỗi nạp dữ liệu: ${e.message || e}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [open, product?._id]);

  // map id -> node để cascade
  const idToNode = useMemo(() => {
    const m = new Map();
    const walk = (n) => {
      if (!n) return;
      m.set(String(n._id), n);
      (n.children || []).forEach(walk);
    };
    (catTree?.children || []).forEach(walk);
    return m;
  }, [catTree]);

  const getDescendants = (node) => {
    const out = [];
    const dfs = (n) => {
      (n.children || []).forEach((c) => {
        out.push(String(c._id));
        dfs(c);
      });
    };
    dfs(node);
    return out;
  };

  const toggleCategoryCascade = (id) => {
    const node = idToNode.get(String(id));
    if (!node) return;
    const selected = new Set(form.categoryIds);
    const isChecked = selected.has(String(id));
    if (isChecked) {
      selected.delete(String(id));
      getDescendants(node).forEach((cid) => selected.delete(cid));
    } else {
      selected.add(String(id));
      getDescendants(node).forEach((cid) => selected.add(cid));
    }
    setForm((s) => ({ ...s, categoryIds: Array.from(selected) }));
  };

  // input handlers
  const onText = (e) => setForm((s) => ({ ...s, [e.target.name]: e.target.value }));
  const onNumber = (e) => {
    const v = e.target.value;
    setForm((s) => ({ ...s, [e.target.name]: v === "" ? "" : Math.max(0, Number(v)) }));
  };
  const toggleIn = (key, id) =>
    setForm((s) => ({
      ...s,
      [key]: s[key].includes(id) ? s[key].filter((x) => x !== id) : [...s[key], id],
    }));
  const onModelFile = (e) => setForm((s) => ({ ...s, modelFile: e.target.files?.[0] || null }));
  const onPreviewImage = (e) => setForm((s) => ({ ...s, previewImage: e.target.files?.[0] || null }));

  const previewURL = useMemo(
    () => (form.previewImage ? URL.createObjectURL(form.previewImage) : null),
    [form.previewImage]
  );
  const composedPreview = previewURL || buildUrl(form.currentPreview);

  // validate nhẹ (giữ nguyên)
  const validate = () => {
    if (!form.name.trim()) return "Vui lòng nhập tên sản phẩm";
    if (form.price === "" || Number.isNaN(Number(form.price))) return "Giá không hợp lệ";
    if ((form.categoryIds || []).length === 0) return "Chọn ít nhất 1 category";
    // if ((form.form || []).length === 0) return "Chọn ít nhất 1 form";
    return "";
  };

  // submit
  const onSubmit = async (e) => {
    e.preventDefault();
    setMsg("");
    const v = validate();
    if (v) {
      setMsg(v);
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("name", form.name);
      fd.append("description", form.description || "");
      fd.append("price", String(form.price));
      fd.append("order", String(form.order ?? 0));            // 👈 NEW: gửi order
      form.colors.forEach((id) => fd.append("colors[]", id));
      form.form.forEach((id) => fd.append("form[]", id));
      form.categoryIds.forEach((id) => fd.append("categoryIds[]", id));
      form.styles.forEach((id) => fd.append("styles[]", id));
      form.materials.forEach((id) => fd.append("materials[]", id));
      fd.append("displayhome", String(!!form.displayhome));
      if (form.modelFile) fd.append("modelFile", form.modelFile);
      if (form.previewImage) fd.append("previewImage", form.previewImage);

      const res = await fetch(`${API}/api/products/${product._id}`, {
        method: "PUT",
        headers: authHeaders(),
        body: fd,
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || "Cập nhật thất bại");
      }
      const data = await res.json();
      const updated = data.product || data;
      setMsg("✅ Cập nhật thành công!");
      onUpdated && onUpdated(updated);
      onClose && onClose();
    } catch (err) {
      setMsg(`❌ ${err.message || "Đã có lỗi xảy ra"}`);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true">
      {/* overlay */}
      <div className="absolute inset-0 bg-black/50" onClick={saving ? undefined : onClose} />

      {/* modal */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-5xl max-h-[90vh] overflow-hidden bg-white rounded-2xl shadow-xl flex flex-col">
          {/* Header */}
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-lg font-semibold">Sửa sản phẩm 3D</h2>
            <button onClick={onClose} className="px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200" disabled={saving}>
              Đóng
            </button>
          </div>

          {/* Message */}
          {msg && (
            <div
              className={`mx-4 mt-4 px-3 py-2 rounded ${
                msg.startsWith("✅")
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : msg.startsWith("❌")
                  ? "bg-red-50 text-red-700 border border-red-200"
                  : "bg-blue-50 text-blue-700 border border-blue-200"
              }`}
            >
              {msg}
            </div>
          )}

          {/* Body scroll */}
          <div className="overflow-auto p-6">
            {loading ? (
              <p className="text-gray-500">Đang tải dữ liệu…</p>
            ) : (
              <form onSubmit={onSubmit} className="bg-white rounded-2xl p-0 max-w-6xl mx-auto">
                {/* Top bar: Category group select + chips + upload zone */}
                <div className="flex flex-col lg:flex-row gap-6">
                  {/* Left: Category group + chips */}
                  <div className="flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <select
                        value={activeGroupId || ""}
                        onChange={(e) => setActiveGroupId(e.target.value)}
                        className="border rounded-lg px-3 py-2"
                      >
                        {(catTree?.children || []).map((g) => (
                          <option key={g._id} value={g._id}>
                            {g.name}
                          </option>
                        ))}
                      </select>

                      {/* Chips là con của group đang chọn */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {(currentGroup?.children || []).map((c) => {
                          const active = form.categoryIds.includes(String(c._id));
                          return (
                            <button
                              type="button"
                              key={c._id}
                              onClick={() => toggleCategoryCascade(c._id)}
                              className={`px-3 py-1 rounded-full text-sm border transition ${
                                active
                                  ? "bg-red-600 border-red-600 text-white"
                                  : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"
                              }`}
                              title={c.name}
                            >
                              {c.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Right: Upload preview + model */}
                  <div className="w-full lg:w-64 shrink-0">
                    <div className="flex items-start gap-4">
                      {/* Cột preview ảnh */}
                      <div className="w-28 shrink-0">
                        <div className="w-28 h-28 border rounded-lg overflow-hidden bg-gray-50 flex items-center justify-center">
                          {composedPreview ? (
                            <img src={buildUrl(composedPreview)} alt="preview" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-xs text-gray-400 p-2 text-center">Preview image</span>
                          )}
                        </div>
                        {/* tên file preview ảnh */}
                        {form.previewImage && (
                          <div className="text-[11px] text-gray-600 mt-1 truncate max-w-[7rem]">
                            {form.previewImage.name}
                          </div>
                        )}
                      </div>

                      {/* Khu chọn file */}
                      <div className="flex-1 space-y-2">
                        <div>
                          <input
                            id="pickPreviewEdit"
                            type="file"
                            accept="image/*"
                            onChange={onPreviewImage}
                            className="hidden"
                          />
                          <label
                            htmlFor="pickPreviewEdit"
                            className="inline-block bg-white border rounded-lg px-4 py-2 text-sm cursor-pointer hover:bg-gray-50"
                          >
                            Upload image
                          </label>
                        </div>
                        <div>
                          <input
                            id="pickModelEdit"
                            type="file"
                            accept=".zip,.glb,.fbx,.obj,.blend"
                            onChange={onModelFile}
                            className="hidden"
                          />
                          <label
                            htmlFor="pickModelEdit"
                            className="inline-block bg-white border rounded-lg px-4 py-2 text-sm cursor-pointer hover:bg-gray-50"
                          >
                            Upload file
                          </label>
                          {!form.modelFile && (
                            <div className="text-[11px] text-gray-500 mt-1 max-w-[14rem]">
                              {product?.modelFileName || product?.modelName
                                ? `Hiện có: ${product.modelFileName || product.modelName}`
                                : "Đã có file model trên server (không bắt buộc đổi)"}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Divider */}
                <div className="my-5 border-t" />

                {/* Name */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1">Name</label>
                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={onText}
                    placeholder="VD: Freedom Curvo Modular Sofa"
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>

                {/* Price + Presets */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1">Price</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      name="price"
                      value={form.price}
                      onChange={onNumber}
                      min={0}
                      placeholder="0 = Free"
                      className="w-44 border rounded-lg px-3 py-2"
                    />
                    <button
                      type="button"
                      onClick={() => setForm((s) => ({ ...s, price: 0 }))}
                      className={`px-3 py-2 rounded-lg text-sm border ${
                        Number(form.price) === 0 ? "bg-red-600 text-white border-red-600" : "bg-white hover:bg-gray-50"
                      }`}
                    >
                      Free
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm((s) => ({ ...s, price: 15000 }))}
                      className={`px-3 py-2 rounded-lg text-sm border ${
                        Number(form.price) === 15000 ? "bg-red-600 text-white border-red-600" : "bg-white hover:bg-gray-50"
                      }`}
                    >
                      15.000
                    </button>
                  </div>
                </div>

                {/* Order (NEW) */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1">Order (thứ tự)</label>
                  <input
                    type="number"
                    name="order"
                    value={form.order}
                    onChange={onNumber}
                    min={0}
                    placeholder="0 = mặc định"
                    className="w-44 border rounded-lg px-3 py-2"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Dùng để ưu tiên hiển thị theo sắp xếp của bạn (giữ nguyên logic backend).
                  </p>
                </div>

                {/* Style chips */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2">Style</label>
                  <div className="flex flex-wrap gap-2">
                    {styles.map((style) => {
                      const active = form.styles.includes(style._id);
                      return (
                        <button
                          type="button"
                          key={style._id}
                          onClick={() => toggleIn("styles", style._id)}
                          className={`px-3 py-1 rounded-full text-sm border ${
                            active ? "bg-red-600 border-red-600 text-white" : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"
                          }`}
                        >
                          {style.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Form thumbnails */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2">Form</label>
                  <div className="flex flex-wrap gap-3">
                    {forms.map((f) => {
                      const active = form.form.includes(f._id);
                      return (
                        <span
                          key={f._id}
                          onClick={() => toggleIn("form", f._id)}
                          className={`w-12 h-12 rounded-lg border flex items-center justify-center bg-white hover:bg-gray-50 ${
                            active ? "border-red-600 ring-2 ring-red-200" : "border-gray-300"
                          }`}
                          title={f.name}
                          role="button"
                        >
                          {f.image ? (
                            <img src={f.image} alt={f.name} className="object-contain invert" />
                          ) : (
                            <span className="text-xs text-gray-500">{(f.name || "").slice(0, 2)}</span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Material chips */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2">Material</label>
                  <div className="flex flex-wrap gap-2">
                    {materials.map((m) => {
                      const active = form.materials.includes(m._id);
                      return (
                        <button
                          type="button"
                          key={m._id}
                          onClick={() => toggleIn("materials", m._id)}
                          className={`px-3 py-1 rounded-full text-sm border ${
                            active ? "bg-red-600 border-red-600 text-white" : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"
                          }`}
                        >
                          {m.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Color dots */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2">Color</label>
                  <div className="flex flex-wrap gap-3 items-center">
                    {colors.map((c) => {
                      const active = form.colors.includes(c._id);
                      return (
                        <button
                          type="button"
                          key={c._id}
                          onClick={() => toggleIn("colors", c._id)}
                          className={`w-8 h-8 rounded-full border-2 p-[2px] bg-white`}
                          style={{ borderColor: active ? "#000" : "transparent" }}
                          title={c.name}
                        >
                          <span className="block w-full h-full rounded-full" style={{ backgroundColor: c.code }} />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Description */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1">Description</label>
                  <textarea
                    name="description"
                    value={form.description}
                    onChange={onText}
                    className="w-full border rounded-lg px-3 py-2 h-28"
                    placeholder="Mô tả ngắn gọn về sản phẩm..."
                    maxLength={2000}
                  />
                  <div className="text-xs text-gray-500 mt-1">{form.description.length}/2000</div>
                </div>

                {/* Bottom bar */}
                <div className="flex items-center justify-between mt-6">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.displayhome}
                      onChange={(e) => setForm((s) => ({ ...s, displayhome: e.target.checked }))}
                      className="accent-blue-600 h-4 w-4"
                    />
                    <span className="text-sm">Thêm vào TOP PRODUCT</span>
                  </label>

                  <div className="flex items-center gap-2">
                    <button type="button" onClick={onClose} className="px-5 py-2 rounded-lg border bg-white hover:bg-gray-50" disabled={saving}>
                      Hủy
                    </button>
                    <button type="submit" disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg disabled:opacity-60">
                      {saving ? "Đang lưu..." : "Cập nhật"}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
