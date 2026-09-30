import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "../Sidebar/Sidebar";
import Header from "../Header/Header";
import axios from "axios";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

export default function ProductForm3dmodel() {
  // -------------------- FORM STATE --------------------
  const [form, setForm] = useState({
    name: "",
    description: "",
    price: "",
    categoryIds: [],
    styles: [],
    modelFile: null,
    previewImage: null,
    extraImages: [],
    displayHome: false,
    render: "",
    lighting: "",
    cameraType: "",
  });

  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const previewURL = useMemo(
    () => (form.previewImage ? URL.createObjectURL(form.previewImage) : null),
    [form.previewImage]
  );

  const extraPreviewURLs = useMemo(
    () => (form.extraImages || []).map((f) => URL.createObjectURL(f)),
    [form.extraImages]
  );
  useEffect(() => {
    return () => {
      extraPreviewURLs.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [extraPreviewURLs]);

  // -------------------- CATEGORY TREE --------------------
  const [catTree, setCatTree] = useState(null);
  const [catLoading, setCatLoading] = useState(true);
  const [catError, setCatError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setCatLoading(true);
        const res = await fetch(`${API}/api/categories/tree/3dscenes`);
        if (!res.ok) throw new Error("Không lấy được categories");
        const data = await res.json();
        if (!cancelled) setCatTree(data);
      } catch (e) {
        if (!cancelled) setCatError(e.message || "Lỗi category");
      } finally {
        if (!cancelled) setCatLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // === NEW FOR CHIP UI: group dropdown + chips (không thêm field nào khác) ===
  const [activeGroupId, setActiveGroupId] = useState(null);
  useEffect(() => {
    if (!activeGroupId && catTree?.children?.length) {
      setActiveGroupId(String(catTree.children[0]._id));
    }
  }, [catTree, activeGroupId]);

  const currentGroup = useMemo(() => {
    if (!catTree?.children) return null;
    return catTree.children.find((g) => String(g._id) === String(activeGroupId)) || null;
  }, [catTree, activeGroupId]);

  // -------------------- STYLES --------------------
  const [styleOptions, setStyleOptions] = useState([]);
  useEffect(() => {
    axios
      .get(`${API}/api/styles`)
      .then((res) => setStyleOptions(res.data || []))
      .catch((err) => console.error("Lỗi lấy styles:", err));
  }, []);

  const toggleStyle = (id) => {
    setForm((s) => {
      const exists = s.styles.includes(id);
      return { ...s, styles: exists ? s.styles.filter((x) => x !== id) : [...s.styles, id] };
    });
  };

  // ---- Map id -> node để cascade nhanh (giữ nguyên logic) ----
  const idToNode = useMemo(() => {
    const m = new Map();
    const walk = (n) => {
      if (!n) return;
      m.set(String(n._id), n);
      (n.children || []).forEach(walk);
    };
    (catTree?.children || []).forEach(walk); // không add root
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

    // Clear lỗi khi user chọn
    setErrors((prev) => {
      if (!prev.categoryIds) return prev;
      const { categoryIds, ...rest } = prev;
      return rest;
    });
  };

  // -------------------- INPUT HANDLERS --------------------
  const onTextChange = (e) => {
    const { name, value } = e.target;
    setForm((s) => ({ ...s, [name]: value }));
  };

  const onNumberChange = (e) => {
    const { name, value } = e.target;
    setForm((s) => ({
      ...s,
      [name]: value === "" ? "" : Math.max(0, Number(value)),
    }));
  };

  const onFileChange = (e) =>
    setForm((s) => ({ ...s, modelFile: e.target.files?.[0] || null }));

  const onPreviewChange = (e) =>
    setForm((s) => ({ ...s, previewImage: e.target.files?.[0] || null }));

  const onExtraImagesChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setForm((s) => ({ ...s, extraImages: [...(s.extraImages || []), ...files] }));
    e.target.value = "";
  };

  const removeExtraAt = (idx) => {
    setForm((s) => {
      const next = [...(s.extraImages || [])];
      next.splice(idx, 1);
      return { ...s, extraImages: next };
    });
  };

  // -------------------- VALIDATE & SUBMIT --------------------
  const validate = () => {
    const err = {};
    if (!form.name.trim()) err.name = "Vui lòng nhập tên sản phẩm";
    if (form.price === "" || isNaN(Number(form.price))) err.price = "Giá không hợp lệ";
    if (!form.modelFile) err.modelFile = "Chưa chọn file mô hình";
    if (!form.previewImage) err.previewImage = "Chưa chọn ảnh preview";
    if (!form.categoryIds.length) err.categoryIds = "Chọn ít nhất 1 category";
    setErrors(err);
    return Object.keys(err).length === 0;
  };

  const authHeaders = () => {
    const t = localStorage.getItem("token");
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    if (!validate()) {
      setMessage("Vui lòng điền đủ: Tên, Giá, Category, chọn file model + ảnh preview.");
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("name", form.name);
      fd.append("description", form.description || "");
      fd.append("price", String(form.price));
      fd.append("categoryIds", JSON.stringify(form.categoryIds));
      (form.styles || []).forEach((id) => fd.append("styles[]", id));
      fd.append("displayHome", String(form.displayHome));
      fd.append("render", form.render || "");
      fd.append("lighting", form.lighting || "");
      fd.append("cameraType", form.cameraType || "");
      if (form.modelFile)    fd.append("modelFile", form.modelFile);
      if (form.previewImage) fd.append("previewImage", form.previewImage);
      (form.extraImages || []).forEach((file) => fd.append("extraImages", file));

      const res = await fetch(`${API}/api/product-scenes`, {
        method: "POST",
        body: fd,
        headers: authHeaders(),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Request failed");
      }

      setMessage("✅ Thêm sản phẩm thành công!");
      setForm({
        name: "",
        description: "",
        price: "",
        categoryIds: [],
        styles: [],
        modelFile: null,
        previewImage: null,
        extraImages: [],
        displayHome: false,
        render: "",
        lighting: "",
        cameraType: "",
      });
      setErrors({});
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setMessage(`❌ ${err.message || "Có lỗi xảy ra"}`);
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------- UI --------------------
  return (
    <div className="flex min-h-screen w-screen overflow-hidden bg-white">
      <Sidebar activeKey="product.3dscenes" />
      <main className="flex-1 min-w-0 bg-gray-100">
        <div className="p-6">
          <form onSubmit={onSubmit} className="bg-white rounded-2xl shadow p-6 max-w-6xl mx-auto space-y-6">
            <h1 className="text-xl font-semibold">Thêm sản phẩm</h1>

            {message && (
              <div
                className={`px-3 py-2 rounded ${
                  message.startsWith("✅")
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : "bg-red-50 text-red-700 border border-red-200"
                }`}
              >
                {message}
              </div>
            )}

            {/* TOP ROW: Category chips (left) + Upload (right) */}
            <div className="flex flex-col lg:flex-row gap-6">
              {/* Category chips panel */}
              <div className="flex-1">
                <div className="border rounded-xl p-4 bg-white space-y-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="font-semibold">Category</h2>
                    {catLoading && <span className="text-xs text-gray-500">Đang tải…</span>}
                  </div>

                  {catError && <p className="text-red-600 text-sm">Lỗi: {catError}</p>}

                  {!catLoading && !catError && (
                    <div className="space-y-3">
                      {/* Dropdown Group cấp 1 */}
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

                      {/* Chips = con của group đang chọn (cascade tất cả hậu duệ) */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {(currentGroup?.children || []).map((c) => {
                          const active = form.categoryIds.includes(String(c._id));
                          return (
                            <button
                              type="button"
                              key={c._id}
                              onClick={() => toggleCategoryCascade(c._id)}
                              className={`px-3 py-1 rounded-full text-sm border transition
                                ${active ? "bg-gray-900 border-gray-900 text-white" : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"}
                              `}
                              title={c.name}
                            >
                              {c.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {errors.categoryIds && <p className="text-red-600 text-xs mt-2">{errors.categoryIds}</p>}
                </div>
              </div>

              {/* Upload panel */}
              <div className="w-full lg:w-72 shrink-0">
                <div className="border rounded-xl p-4 bg-white space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="w-28 h-28 border rounded-lg overflow-hidden bg-gray-50 flex items-center justify-center">
                      {previewURL ? (
                        <img src={previewURL} alt="preview" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs text-gray-400 p-2 text-center">Preview image</span>
                      )}
                    </div>
                    <div className="flex-1 space-y-3">
                      <div>
                        <input id="pickPreview" type="file" accept="image/*" onChange={onPreviewChange} className="hidden" />
                        <label
                          htmlFor="pickPreview"
                          className="inline-block bg-white border rounded-lg px-4 py-2 text-sm cursor-pointer hover:bg-gray-50"
                        >
                          Upload image
                        </label>
                        {errors.previewImage && <p className="text-red-600 text-xs mt-1">{errors.previewImage}</p>}
                      </div>

                      <div>
                        <input id="pickModel" type="file" accept=".zip,.glb,.fbx,.obj,.blend,.rar" onChange={onFileChange} className="hidden" />
                        <label
                          htmlFor="pickModel"
                          className="inline-block bg-white border rounded-lg px-4 py-2 text-sm cursor-pointer hover:bg-gray-50"
                        >
                          Upload file
                        </label>
                        {form.modelFile && (
                          <div className="text-xs text-gray-600 mt-1 truncate max-w-[12rem]">{form.modelFile.name}</div>
                        )}
                        {errors.modelFile && <p className="text-red-600 text-xs mt-1">{errors.modelFile}</p>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t" />

            {/* Name */}
            <div>
              <label className="block font-semibold mb-1">Tên sản phẩm</label>
              <input
                type="text"
                name="name"
                value={form.name}
                onChange={onTextChange}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="VD: Freedom Curvo Modular Sofa"
              />
              {errors.name && <p className="text-red-600 text-sm mt-1">{errors.name}</p>}
            </div>

            {/* Description */}
            <div>
              <label className="block font-semibold mb-1">Mô tả</label>
              <textarea
                name="description"
                value={form.description}
                onChange={onTextChange}
                className="w-full border rounded-lg px-3 py-2 h-28"
                placeholder="Mô tả ngắn gọn về sản phẩm..."
                maxLength={2000}
              />
              <div className="text-xs text-gray-500 mt-1">{form.description.length}/2000</div>
            </div>

            {/* Price */}
            <div>
              <label className="block font-semibold mb-1">Giá sản phẩm</label>
              <input
                type="number"
                name="price"
                value={form.price}
                onChange={onNumberChange}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="0 = Free"
                min={0}
              />
              {errors.price && <p className="text-red-600 text-sm mt-1">{errors.price}</p>}
            </div>

            {/* Render / Lighting / Camera */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block font-semibold mb-1">Render</label>
                <input
                  type="text"
                  name="render"
                  value={form.render}
                  onChange={onTextChange}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="VD: V-Ray / Cycles / Eevee"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Lighting</label>
                <input
                  type="text"
                  name="lighting"
                  value={form.lighting}
                  onChange={onTextChange}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="VD: HDRI studio, 3-point light"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Camera type</label>
                <input
                  type="text"
                  name="cameraType"
                  value={form.cameraType}
                  onChange={onTextChange}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="VD: 35mm, Orthographic"
                />
              </div>
            </div>

            {/* Style */}
            <div>
              <label className="block font-semibold mb-2">Style</label>
              {styleOptions.length === 0 ? (
                <p className="text-sm text-gray-500">Chưa có style nào.</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {styleOptions.map((st) => (
                    <label key={st._id} className="px-3 py-1 rounded-full text-sm border bg-gray-100 text-gray-700 hover:bg-gray-200 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={form.styles.includes(st._id)}
                        onChange={() => toggleStyle(st._id)}
                        className="mr-2 align-middle cursor-pointer"
                      />
                      <span className="align-middle">{st.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Extra Images */}
            <div>
              <label className="block font-semibold mb-1">Ảnh phụ (Extra Images)</label>
              <input
                type="file"
                multiple
                onChange={onExtraImagesChange}
                className="w-full"
                accept="image/*"
              />
              {form.extraImages?.length > 0 && (
                <>
                  <div className="text-xs text-gray-500 mt-2">
                    Đã chọn {form.extraImages.length} ảnh.
                  </div>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {extraPreviewURLs.map((src, idx) => (
                      <div key={idx} className="relative">
                        <img
                          src={src}
                          alt={`extra-${idx}`}
                          className="w-full object-cover rounded border"
                        />
                        <button
                          type="button"
                          onClick={() => removeExtraAt(idx)}
                          title="Xóa ảnh này"
                          className="absolute rounded-full bg-black/60 text-white text-sm leading-7 text-center"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Display home + Submit */}
            <div className="flex items-center justify-between">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.displayHome}
                  onChange={(e) => setForm((s) => ({ ...s, displayHome: e.target.checked }))}
                  className="accent-blue-600 h-4 w-4"
                />
                <span className="text-sm">Hiển thị sản phẩm trên Trang chủ</span>
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-6 py-2 rounded-lg"
              >
                {submitting ? "Đang lưu..." : "Thêm sản phẩm"}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
