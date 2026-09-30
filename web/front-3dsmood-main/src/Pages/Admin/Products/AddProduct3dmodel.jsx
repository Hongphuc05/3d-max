import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "../Sidebar/Sidebar";
import Header from "../Header/Header";
import axios from "axios";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

/** ---------- PRESIGNED MULTIPART UPLOADER ---------- */
async function uploadFileToWasabiMultipart(file, {
  baseUrl = API,
  headers = {},
  partSize = 16 * 1024 * 1024,   // 16MB
  concurrency = 8,
  onProgress = () => {},
  signal,
} = {}) {
  // 1) INIT
  const init = await fetch(`${baseUrl}/api/uploads/init`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
    }),
    signal,
  });
  if (!init.ok) throw new Error(await init.text() || "Không khởi tạo được multipart upload");
  const { uploadId, key } = await init.json();

  // 2) Tách parts
  const total = file.size;
  const parts = [];
  let partNo = 1;
  for (let start = 0; start < total; start += partSize) {
    const end = Math.min(start + partSize, total);
    parts.push({ PartNumber: partNo++, start, end, ETag: null });
  }

  // 3) Lấy presigned URLs cho từng part
  const pres = await fetch(`${baseUrl}/api/uploads/parts`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ key, uploadId, partNumbers: parts.map(p => p.PartNumber) }),
    signal,
  });
  if (!pres.ok) throw new Error(await pres.text() || "Không lấy được presigned URLs");
  const { urls } = await pres.json();
  const urlMap = new Map((urls || []).map(u => [u.partNumber, u.url]));
  if (!urlMap.size) throw new Error("Thiếu presigned URLs");

  // 4) Upload các part song song
  let uploaded = 0;
  const queue = [...parts];

  async function worker() {
    while (queue.length && !signal?.aborted) {
      const p = queue.shift();
      const blob = file.slice(p.start, p.end);
      const resp = await fetch(urlMap.get(p.PartNumber), {
        method: "PUT",
        headers: { "Content-Length": String(blob.size) }, // KHÔNG gửi Authorization
        body: blob,
        signal,
      });
      if (!resp.ok) throw new Error(`Upload part ${p.PartNumber} thất bại`);
      p.ETag = (resp.headers.get("ETag") || "").replace(/"/g, "");
      uploaded += blob.size;
      onProgress(uploaded, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, parts.length) }, worker));

  // 5) COMPLETE
  const done = await fetch(`${baseUrl}/api/uploads/complete`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ key, uploadId, parts }),
    signal,
  });
  if (!done.ok) throw new Error(await done.text() || "Hoàn tất multipart thất bại");
  const complete = await done.json();
  if (!complete.ok) throw new Error("Multipart complete trả về thất bại");

  return {
    key: complete.key,
    url: complete.url,
    etag: complete.etag,
    size: complete.size,
  };
}

export default function ProductForm3dmodel() {
  // -------------------- FORM STATE --------------------
  const [form, setForm] = useState({
    name: "",
    description: "",
    price: "",
    order: 0,            // thứ tự hiển thị
    categoryIds: [],
    colors: [],
    styles: [],
    form: [],
    materials: [],
    modelFile: null,
    previewImage: null,
    displayhome: false,
  });

  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const previewURL = useMemo(
    () => (form.previewImage ? URL.createObjectURL(form.previewImage) : null),
    [form.previewImage]
  );

  // -------------------- CATEGORY TREE --------------------
  const [catTree, setCatTree] = useState(null);
  const [catLoading, setCatLoading] = useState(true);
  const [catError, setCatError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setCatLoading(true);
        const res = await fetch(`${API}/api/categories/tree/3dmodel`);
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

  // ---- nhóm cấp 1 để dropdown + chip con
  const [activeGroupId, setActiveGroupId] = useState(null);
  useEffect(() => {
    if (!activeGroupId && catTree?.children?.length) {
      setActiveGroupId(String(catTree.children[0]._id));
    }
  }, [catTree, activeGroupId]);

  // -------------------- TAXONOMIES --------------------
  const [styles, setStyles] = useState([]);
  useEffect(() => {
    axios.get(`${API}/api/styles`).then((r) => setStyles(r.data)).catch(console.error);
  }, []);

  const [colors, setColors] = useState([]);
  useEffect(() => {
    axios.get(`${API}/api/colors`).then((r) => setColors(r.data)).catch(console.error);
  }, []);

  const [forms, setForms] = useState([]);
  useEffect(() => {
    axios.get(`${API}/api/forms`).then((r) => setForms(r.data)).catch(console.error);
  }, []);

  const [materials, setMaterials] = useState([]);
  useEffect(() => {
    axios.get(`${API}/api/materials`).then((r) => setMaterials(r.data)).catch(console.error);
  }, []);

  // -------------------- CATEGORY HELPERS --------------------
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
    setErrors((prev) => {
      if (!prev.categoryIds) return prev;
      const { categoryIds, ...rest } = prev;
      return rest;
    });
  };

  const currentGroup = useMemo(() => {
    if (!catTree?.children) return null;
    return catTree.children.find((g) => String(g._id) === String(activeGroupId)) || null;
  }, [catTree, activeGroupId]);

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

  const toggleValueInArray = (key, value) => {
    setForm((s) => {
      const has = s[key].includes(value);
      return {
        ...s,
        [key]: has ? s[key].filter((x) => x !== value) : [...s[key], value],
      };
    });
  };

  const toggleColor = (id) => {
    setForm((prev) => {
      const exists = prev.colors.includes(id);
      return {
        ...prev,
        colors: exists ? prev.colors.filter((c) => c !== id) : [...prev.colors, id],
      };
    });
    setErrors((prev) => {
      if (!prev.colors) return prev;
      const { colors, ...rest } = prev;
      return rest;
    });
  };

  const onFileChange = (e) =>
    setForm((s) => ({ ...s, modelFile: e.target.files?.[0] || null }));

  const onPreviewChange = (e) =>
    setForm((s) => ({ ...s, previewImage: e.target.files?.[0] || null }));

  // -------------------- LIVE CLEAR ERRORS --------------------
  useEffect(() => {
    if (form.categoryIds.length > 0 && errors.categoryIds) {
      setErrors((prev) => {
        const { categoryIds, ...rest } = prev;
        return rest;
      });
    }
  }, [form.categoryIds, errors.categoryIds]);

  useEffect(() => {
    if (form.name.trim() && errors.name) {
      setErrors((p) => {
        const { name, ...r } = p;
        return r;
      });
    }
  }, [form.name, errors.name]);

  useEffect(() => {
    if (form.price !== "" && !isNaN(Number(form.price)) && errors.price) {
      setErrors((p) => {
        const { price, ...r } = p;
        return r;
      });
    }
  }, [form.price, errors.price]);

  useEffect(() => {
    if (form.order !== "" && !isNaN(Number(form.order)) && errors.order) {
      setErrors((p) => {
        const { order, ...r } = p;
        return r;
      });
    }
  }, [form.order, errors.order]);

  useEffect(() => {
    if (form.form.length > 0 && errors.form) {
      setErrors((p) => {
        const { form: _f, ...r } = p;
        return r;
      });
    }
  }, [form.form, errors.form]);

  useEffect(() => {
    if (form.modelFile && errors.modelFile) {
      setErrors((p) => {
        const { modelFile, ...r } = p;
        return r;
      });
    }
  }, [form.modelFile, errors.modelFile]);

  useEffect(() => {
    if (form.previewImage && errors.previewImage) {
      setErrors((p) => {
        const { previewImage, ...r } = p;
        return r;
      });
    }
  }, [form.previewImage, errors.previewImage]);

  // -------------------- VALIDATE & SUBMIT --------------------
  const validate = () => {
    const err = {};
    if (!form.name.trim()) err.name = "Vui lòng nhập tên sản phẩm";
    if (form.price === "" || isNaN(Number(form.price))) err.price = "Giá không hợp lệ";
    if (form.order !== "" && (isNaN(Number(form.order)) || Number(form.order) < 0)) {
      err.order = "Thứ tự (order) phải là số không âm";
    }
    if (!form.modelFile) err.modelFile = "Chưa chọn file mô hình";
    if (!form.previewImage) err.previewImage = "Chưa chọn ảnh preview";
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
      setMessage("Vui lòng điền đủ: Tên, Giá, Order, chọn file model + ảnh preview.");
      return;
    }
    setSubmitting(true);
    try {
      // 1) Upload model qua presigned multipart (giống 3dscenes)
      setMessage("Bắt đầu upload model…");
      const uploaded = await uploadFileToWasabiMultipart(form.modelFile, {
        baseUrl: API,
        headers: authHeaders(), // nếu backend yêu cầu token cho init/parts/complete
        partSize: 16 * 1024 * 1024,
        concurrency: 8,
        onProgress: (loaded, total) => {
          const pct = Math.round((loaded / total) * 100);
          setMessage(`Đang upload model… ${pct}%`);
        },
      });

      // 2) Gửi form tạo mới nhưng KHÔNG gửi modelFile nữa,
      //    thay bằng modelKey + modelFilePath (url)
      const fd = new FormData();
      fd.append("name", form.name);
      fd.append("description", form.description || "");
      fd.append("price", String(form.price));
      fd.append("order", String(form.order ?? 0));
      form.colors.forEach((id) => fd.append("colors[]", id));
      form.form.forEach((id) => fd.append("form[]", id));
      form.categoryIds.forEach((id) => fd.append("categoryIds[]", id));
      form.styles.forEach((id) => fd.append("styles[]", id));
      form.materials.forEach((id) => fd.append("materials[]", id));
      fd.append("displayhome", String(form.displayhome));
      if (form.previewImage) fd.append("previewImage", form.previewImage);

      // from-presigned fields:
      fd.append("modelKey", uploaded.key);
      fd.append("modelFilePath", uploaded.url);

      // NOTE: đổi endpoint nếu backend của bạn khác
      const res = await fetch(`${API}/api/products/`, {
        method: "POST",
        body: fd,
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());

      setMessage("✅ Thêm sản phẩm thành công!");
      setForm({
        name: "",
        description: "",
        price: "",
        order: 0,
        categoryIds: [],
        colors: [],
        styles: [],
        form: [],
        materials: [],
        modelFile: null,
        previewImage: null,
        displayhome: false,
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
    <div className="p-6">
      <form onSubmit={onSubmit} className="bg-white rounded-2xl shadow p-6 max-w-6xl mx-auto">
        {/* Top bar: Category group + chips + upload preview/file */}
        <div className="flex flex-col lg:flex-row gap-6">
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
                {catLoading && <span className="text-sm text-gray-500">Đang tải…</span>}
                {catError && <span className="text-sm text-red-600">Lỗi: {catError}</span>}
                {!catLoading &&
                  !catError &&
                  (currentGroup?.children || []).map((c) => {
                    const active = form.categoryIds.includes(String(c._id));
                    return (
                      <button
                        type="button"
                        key={c._id}
                        onClick={() => toggleCategoryCascade(c._id)}
                        className={`px-3 py-1 rounded-full text-sm border transition
                          ${active ? "bg-red-600 border-red-600 text-white" : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"}
                        `}
                      >
                        {c.name}
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>

          {/* Khu upload */}
          <div className="w-full lg:w-64 shrink-0">
            <div className="flex items-start gap-4">
              {/* Khung preview + tên file ảnh */}
              <div className="w-28 shrink-0">
                <div className="w-28 h-28 border rounded-lg overflow-hidden bg-gray-50 flex items-center justify-center">
                  {previewURL ? (
                    <img src={previewURL} alt="preview" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs text-gray-400 p-2 text-center">Preview image</span>
                  )}
                </div>
                {form.previewImage && (
                  <div className="text-xs text-gray-600 mt-1 truncate max-w-[7rem]">
                    {form.previewImage.name}
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-2">
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
                    <div className="text-xs text-gray-600 mt-1 truncate max-w-[14rem]">{form.modelFile.name}</div>
                  )}
                  {errors.modelFile && <p className="text-red-600 text-xs mt-1">{errors.modelFile}</p>}
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
            onChange={onTextChange}
            placeholder="VD: Freedom Curvo Modular Sofa"
            className="w-full border rounded-lg px-3 py-2"
          />
          {errors.name && <p className="text-red-600 text-sm mt-1">{errors.name}</p>}
        </div>

        {/* Price + preset */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Price</label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              name="price"
              value={form.price}
              onChange={onNumberChange}
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
                Number(form.price) === 15000 ? "bg-red-600 text-white border-red-900" : "bg-white hover:bg-gray-50"
              }`}
            >
              15.000
            </button>
          </div>
          {errors.price && <p className="text-red-600 text-sm mt-1">{errors.price}</p>}
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
                  onClick={() => toggleValueInArray("styles", style._id)}
                  className={`px-3 py-1 rounded-full text-sm border
                    ${active ? "bg-red-600 border-red-600 text-white" : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"}
                  `}
                >
                  {style.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Form (shapes) */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Form</label>
          <div className="flex flex-wrap gap-3">
            {forms.map((f) => {
              const active = form.form.includes(f._id);
              return (
                <span
                  key={f._id}
                  onClick={() => {
                    const isSelected = form.form.includes(f._id);
                    setForm((s) => ({
                      ...s,
                      form: isSelected ? s.form.filter((id) => id !== f._id) : [...s.form, f._id],
                    }));
                    setErrors((prev) => {
                      if (!prev.form) return prev;
                      const { form: _f, ...rest } = prev;
                      return rest;
                    });
                  }}
                  className={`w-12 h-12 rounded-lg border flex items-center justify-center bg-white hover:bg-gray-50
                    ${active ? "border-red-600 ring-2 ring-red-200" : "border-gray-300"}
                  `}
                  title={f.name}
                >
                  {f.image ? (
                    <img src={f.image} alt={f.name} className="object-contain invert" />
                  ) : (
                    <span className="text-xs text-gray-500">{f.name.slice(0, 2)}</span>
                  )}
                </span>
              );
            })}
          </div>
          {errors.form && <p className="text-red-600 text-sm mt-1">{errors.form}</p>}
        </div>

        {/* Material */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Material</label>
          <div className="flex flex-wrap gap-2">
            {materials.map((m) => {
              const active = form.materials.includes(m._id);
              return (
                <button
                  type="button"
                  key={m._id}
                  onClick={() => toggleValueInArray("materials", m._id)}
                  className={`px-3 py-1 rounded-full text-sm border
                    ${active ? "bg-red-600 border-red-600 text-white" : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"}
                  `}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Color */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Color</label>
          <div className="flex flex-wrap gap-3 items-center p-1">
            {colors.map((c) => {
              const active = form.colors.includes(c._id);
              return (
                <button
                  type="button"
                  key={c._id}
                  onClick={() => toggleColor(c._id)}
                  className={`w-8 h-8 rounded-full border-2 p-[2px] bg-white`}
                  style={{ borderColor: active ? "#000" : "transparent" }}
                  title={c.name}
                >
                  <span className="block w-full h-full rounded-full" style={{ backgroundColor: c.code }} />
                </button>
              );
            })}
          </div>
          {errors.colors && <p className="text-red-600 text-sm mt-1">{errors.colors}</p>}
        </div>

        {/* Description */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            name="description"
            value={form.description}
            onChange={onTextChange}
            className="w-full border rounded-lg px-3 py-2 h-28"
            placeholder="Mô tả ngắn gọn về sản phẩm..."
            maxLength={2000}
          />
        </div>
        <div className="text-xs text-gray-500 -mt-3 mb-4">{form.description.length}/2000</div>

        {/* Order */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Order (thứ tự)</label>
          <input
            type="number"
            name="order"
            value={form.order}
            onChange={onNumberChange}
            min={0}
            placeholder="0 = mặc định"
            className="w-44 border rounded-lg px-3 py-2"
          />
          {errors.order && <p className="text-red-600 text-sm mt-1">{errors.order}</p>}
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

          <button
            type="submit"
            disabled={submitting}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg disabled:opacity-60"
          >
            {submitting ? "Đang lưu..." : "Thêm sản phẩm"}
          </button>
        </div>

        {/* Message */}
        {message && (
          <div
            className={`mt-4 px-3 py-2 rounded ${
              message.startsWith("✅")
                ? "bg-green-50 text-green-700 border border-green-200"
                : message.startsWith("Đang upload model…")
                ? "bg-blue-50 text-blue-700 border border-blue-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}
          >
            {message}
          </div>
        )}
      </form>
    </div>
  );
}
