import React, { useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "../Sidebar/Sidebar";
// import Header from "../Header/Header"; // nếu dùng thì mở lại
const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

/** ---------- Utilities ---------- */
const useAuthHeaders = () => {
  return useMemo(() => {
    const t = localStorage.getItem("token");
    return t ? { Authorization: `Bearer ${t}` } : {};
  }, []);
};

const joinUrl = (base, rel) => {
  if (!rel) return "";
  return `${base}${rel.startsWith("/") ? rel : `/${rel}`}`;
};

const flattenCategories = (tree) => {
  const out = [];
  const walk = (node, depth = 0) => {
    if (!node) return;
    if (node._id && depth > 0) {
      out.push({ _id: String(node._id), name: node.name, depth });
    }
    (node.children || []).forEach((c) => walk(c, depth + 1));
  };
  if (tree) (tree.children || []).forEach((c) => walk(c, 0));
  return out;
};

/** ---------- PRESIGNED MULTIPART UPLOADER (đặt ngay trong file) ---------- */
async function uploadFileToWasabiMultipart(
  file,
  {
    baseUrl = API,
    headers = {},
    partSize = 16 * 1024 * 1024, // 16MB
    concurrency = 8, // 6–10 là ổn
    onProgress = () => {},
    signal,
  } = {}
) {
  // 1) INIT
  const initResp = await fetch(`${baseUrl}/api/uploads/init`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
    }),
    signal,
  });
  if (!initResp.ok) throw new Error(await initResp.text());
  const initRes = await initResp.json();
  if (!initRes?.uploadId) throw new Error("Không khởi tạo được phiên upload");
  const { key, uploadId } = initRes;

  // 2) Build parts
  const total = file.size;
  const parts = [];
  let partNo = 1;
  for (let start = 0; start < total; start += partSize) {
    const end = Math.min(start + partSize, total);
    parts.push({ PartNumber: partNo++, start, end, ETag: null });
  }

  // 3) Presigned URLs
  const partsResp = await fetch(`${baseUrl}/api/uploads/parts`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ key, uploadId, partNumbers: parts.map((p) => p.PartNumber) }),
    signal,
  });
  if (!partsResp.ok) throw new Error(await partsResp.text());
  const urlRes = await partsResp.json();
  const urlMap = new Map((urlRes.urls || []).map((u) => [u.partNumber, u.url]));
  if (!urlMap.size) throw new Error("Không lấy được presigned URLs");

  // 4) Upload parts song song
  let uploaded = 0;
  const queue = [...parts];

  async function worker() {
    while (queue.length && !signal?.aborted) {
      const p = queue.shift();
      const blob = file.slice(p.start, p.end);
      const resp = await fetch(urlMap.get(p.PartNumber), {
        method: "PUT",
        // LƯU Ý: KHÔNG gắn Authorization ở đây (presigned đã đủ)
        headers: { "Content-Length": String(blob.size) },
        body: blob,
        signal,
      });
      if (!resp.ok) throw new Error(`Upload part ${p.PartNumber} thất bại`);
      p.ETag = (resp.headers.get("ETag") || "").replace(/"/g, "");
      uploaded += blob.size;
      onProgress(uploaded, total);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  // 5) COMPLETE
  const completeResp = await fetch(`${baseUrl}/api/uploads/complete`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ key, uploadId, parts }),
    signal,
  });
  if (!completeResp.ok) throw new Error(await completeResp.text());
  const completeRes = await completeResp.json();
  if (!completeRes?.ok) throw new Error("Hoàn tất multipart thất bại");

  return {
    key: completeRes.key,
    url: completeRes.url,
    etag: completeRes.etag,
    size: completeRes.size,
  };
}

/** ---------- Category Chips (multi) - dùng cho FILTER phía trên bảng ---------- */
function CategoryChips({ options, selected, onToggle, onSelectAll, onClear }) {
  return (
    <div className="flex items-center gap-2 flex-wrap bg-gray-50 rounded px-3 py-2">
      {options.map((opt) => {
        const active = selected.includes(opt._id);
        return (
          <button
            type="button"
            key={opt._id}
            onClick={() => onToggle(opt._id)}
            className={[
              "h-8 px-3 rounded-full border text-sm transition",
              active
                ? "bg-red-600 text-white border-red-600 shadow-sm"
                : "bg-gray-100 border-transparent text-gray-600 hover:text-gray-900",
            ].join(" ")}
            title={opt.name}
          >
            {opt.name}
          </button>
        );
      })}
      <span className="mx-1 text-gray-300">|</span>
      <button type="button" className="text-xs underline" onClick={onSelectAll}>
        Tất cả
      </button>
      <button type="button" className="text-xs underline" onClick={onClear}>
        Bỏ chọn
      </button>
    </div>
  );
}

/** ---------- Style Multi-Select Dropdown (chips in control) - dùng cho FILTER ---------- */
function MultiSelect({ options, selected, onChange, placeholder = "Chọn style…" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const toggle = (id) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const selectAll = () => onChange(options.map((o) => o._id));
  const clear = () => onChange([]);

  const labels = options.filter((o) => selected.includes(o._id)).map((o) => o.name);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="min-w-[260px] max-w-[480px] flex items-center gap-2 border rounded px-3 py-2 bg-white"
      >
        {labels.length ? (
          <div className="flex flex-wrap gap-1">
            {labels.map((lb, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded-full px-2 py-1"
                title={lb}
              >
                {lb}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-gray-500 text-sm">{placeholder}</span>
        )}
        <svg className="ml-auto h-4 w-4 opacity-70" viewBox="0 0 20 20" fill="currentColor">
          <path d="M5.5 7l4.5 4.5L14.5 7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-30 mt-2 w-[360px] max-h-64 overflow-auto bg-white border rounded shadow">
          <div className="flex items-center justify-between px-2 py-1 border-b">
            <button type="button" className="text-xs underline" onClick={selectAll}>
              Chọn tất cả
            </button>
            <button type="button" className="text-xs underline" onClick={clear}>
              Bỏ chọn
            </button>
          </div>
          <ul className="p-2">
            {options.map((o) => (
              <li key={o._id} className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  className="accent-blue-600"
                  checked={selected.includes(o._id)}
                  onChange={() => toggle(o._id)}
                />
                <span className="text-sm">{o.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** ---------- Shared form (Create/Edit) - giao diện GIỐNG form thêm sản phẩm ---------- */
function SceneFormModal({
  mode, // 'create' | 'edit'
  open,
  onClose,
  onSaved,
  headers,
  categories, // tree {children: [...]}
  styleOptions, // [{_id, name}]
  product, // khi edit
}) {
  const isEdit = mode === "edit";

  // ---------- Khóa body scroll khi modal mở ----------
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    const prevPad = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPad;
    };
  }, [open]);

  // ---------- FORM STATE ----------
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
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadPct, setUploadPct] = useState(0);
  const abortRef = useRef(null);

  // Hủy upload khi đóng modal
  useEffect(() => {
    if (!open && abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {}
      abortRef.current = null;
      setUploadPct(0);
    }
  }, [open]);

  // preview hiện tại (khi edit)
  const currentPreviewPath = useMemo(
    () => (product?.previewImagePath ? joinUrl(API, product.previewImagePath) : null),
    [product]
  );

  // preview URL mới (khi chọn file)
  const previewURL = useMemo(
    () => (form.previewImage ? URL.createObjectURL(form.previewImage) : null),
    [form.previewImage]
  );

  // extra preview
  const extraPreviewURLs = useMemo(
    () => (form.extraImages || []).map((f) => URL.createObjectURL(f)),
    [form.extraImages]
  );
  useEffect(() => {
    return () => {
      extraPreviewURLs.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [extraPreviewURLs]);

  // ---------- CATEGORY: group dropdown + chips con ----------
  const [activeGroupId, setActiveGroupId] = useState(null);
  useEffect(() => {
    if (!open) return;
    if (!activeGroupId && categories?.children?.length) {
      setActiveGroupId(String(categories.children[0]._id));
    }
  }, [open, categories, activeGroupId]);

  const currentGroup = useMemo(() => {
    if (!categories?.children) return null;
    return categories.children.find((g) => String(g._id) === String(activeGroupId)) || null;
  }, [categories, activeGroupId]);

  // Map id -> node để cascade
  const idToNode = useMemo(() => {
    const m = new Map();
    const walk = (n) => {
      if (!n) return;
      m.set(String(n._id), n);
      (n.children || []).forEach(walk);
    };
    (categories?.children || []).forEach(walk); // không add root
    return m;
  }, [categories]);

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
    // clear lỗi
    setErrors((prev) => {
      if (!prev.categoryIds) return prev;
      const { categoryIds, ...rest } = prev;
      return rest;
    });
  };

  // ---------- INIT when open ----------
  useEffect(() => {
    if (!open) return;
    if (isEdit && product) {
      setForm({
        name: product.name || "",
        description: product.description || "",
        price: product.price ?? "",
        categoryIds: (product.categoryIds || []).map(String),
        styles: (product.styles || []).map(String),
        modelFile: null,
        previewImage: null,
        extraImages: [],
        displayHome: Boolean(product.displayHome),
        render: product.render || "",
        lighting: product.lighting || "",
        cameraType: product.cameraType || "",
      });
      setMessage("");
      setErrors({});
      setUploadPct(0);
    }
    if (!isEdit) {
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
      setMessage("");
      setErrors({});
      setUploadPct(0);
    }
  }, [open, isEdit, product]);

  // ---------- INPUT HANDLERS ----------
  const onTextChange = (e) => {
    const { name, value } = e.target;
    setForm((s) => ({ ...s, [name]: value }));
  };
  const onNumberChange = (e) => {
    const { name, value } = e.target;
    setForm((s) => ({ ...s, [name]: value === "" ? "" : Math.max(0, Number(value)) }));
  };
  const toggleStyle = (id) => {
    setForm((s) => {
      const exists = s.styles.includes(id);
      return { ...s, styles: exists ? s.styles.filter((x) => x !== id) : [...s.styles, id] };
    });
  };
  const onFileChange = (e) => setForm((s) => ({ ...s, modelFile: e.target.files?.[0] || null }));
  const onPreviewChange = (e) => setForm((s) => ({ ...s, previewImage: e.target.files?.[0] || null }));
  const onExtraImagesChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
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

  // ---------- VALIDATE ----------
  const validate = () => {
    const err = {};
    if (!form.name.trim()) err.name = "Vui lòng nhập tên sản phẩm";
    if (form.price === "" || isNaN(Number(form.price))) err.price = "Giá không hợp lệ";
    if (!isEdit && !form.modelFile) err.modelFile = "Chưa chọn file mô hình";
    if (!isEdit && !form.previewImage) err.previewImage = "Chưa chọn ảnh preview";
    if (!form.categoryIds.length) err.categoryIds = "Chọn ít nhất 1 category";
    setErrors(err);
    return Object.keys(err).length === 0;
  };

  // ---------- SUBMIT ----------
  const submit = async () => {
    setMessage("");
    if (!validate()) {
      setMessage(
        isEdit
          ? "Vui lòng điền đủ: Tên, Giá, Category. (File/ảnh chỉ cần nếu muốn thay)"
          : "Vui lòng điền đủ: Tên, Giá, Category, chọn file model + ảnh preview."
      );
      return;
    }
    setSaving(true);
    try {
      if (!isEdit) {
        // ====== CREATE: dùng presigned multipart ======
        if (!form.modelFile) throw new Error("Thiếu modelFile");
        setMessage("Bắt đầu upload model…");
        setUploadPct(0);

        const controller = new AbortController();
        abortRef.current = controller;

        const uploadedModel = await uploadFileToWasabiMultipart(form.modelFile, {
          baseUrl: API,
          headers, // Authorization nếu backend yêu cầu
          partSize: 16 * 1024 * 1024,
          concurrency: 8,
          onProgress: (loaded, total) => {
            const pct = Math.round((loaded / total) * 100);
            setMessage(`Đang upload model… ${pct}%`);
            setUploadPct(pct);
          },
          signal: controller.signal,
        });

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
        if (form.previewImage) fd.append("previewImage", form.previewImage);
        (form.extraImages || []).forEach((file) => fd.append("extraImages", file));

        // model đã trên Wasabi:
        fd.append("modelKey", uploadedModel.key);
        fd.append("modelFilePath", uploadedModel.url);

        const res = await fetch(`${API}/api/product-scenes`, {
          method: "POST",
          body: fd,
          headers, // Authorization
        });
        if (!res.ok) throw new Error(await res.text());

        setMessage("✅ Lưu thành công!");
        setUploadPct(0);
        onSaved?.();
        onClose();
      } else {
        // ====== EDIT: giữ nguyên luồng cũ (upload trực tiếp nếu đổi file) ======
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
        if (form.modelFile) fd.append("modelFile", form.modelFile);
        if (form.previewImage) fd.append("previewImage", form.previewImage);
        (form.extraImages || []).forEach((file) => fd.append("extraImages", file));

        const url = `${API}/api/product-scenes/${product._id}`;
        const res = await fetch(url, { method: "PATCH", body: fd, headers });
        if (!res.ok) throw new Error(await res.text());

        setMessage("✅ Lưu thành công!");
        onSaved?.();
        onClose();
      }
    } catch (e) {
      setMessage(`❌ ${e.message || "Có lỗi xảy ra"}`);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      {/* Scroll container cho toàn overlay */}
      <div className="relative z-10 overflow-y-auto overscroll-contain">
        <div className="min-h-full flex items-center justify-center p-4">
          {/* Panel: header/footer cố định, content cuộn */}
          <div className="w-full max-w-5xl bg-white rounded-2xl shadow-xl flex flex-col max-h-[85vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
              <h3 className="text-lg font-semibold">{isEdit ? "Sửa sản phẩm" : "Thêm sản phẩm"}</h3>
              <button onClick={onClose} className="text-gray-600 hover:text-black">
                ✕
              </button>
            </div>

            {/* Message + Progress */}
            {message && (
              <div
                className={`mx-6 mt-4 px-3 py-2 rounded ${
                  message.startsWith("✅")
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : message.startsWith("❌")
                    ? "bg-red-50 text-red-700 border border-red-200"
                    : "bg-blue-50 text-blue-700 border border-blue-200"
                }`}
              >
                {message}
              </div>
            )}
            {uploadPct > 0 && uploadPct < 100 && (
              <div className="mx-6 mt-2 h-2 w-[280px] bg-gray-200 rounded overflow-hidden">
                <div className="h-full bg-blue-600" style={{ width: `${uploadPct}%` }} />
              </div>
            )}

            {/* CONTENT (cuộn) */}
            <div className="flex-1 min-h-0 overflow-y-auto p-6">
              {/* TOP ROW: Category chips (left) + Upload (right) */}
              <div className="flex flex-col lg:flex-row gap-6">
                {/* Category chips panel */}
                <div className="flex-1">
                  <div className="border rounded-xl p-4 bg-white space-y-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h2 className="font-semibold">Category</h2>
                    </div>
                    {!categories ? (
                      <p className="text-sm text-gray-500">Đang tải categories…</p>
                    ) : (
                      <div className="space-y-3">
                        {/* Dropdown Group cấp 1 */}
                        <select
                          value={activeGroupId || ""}
                          onChange={(e) => setActiveGroupId(e.target.value)}
                          className="border rounded-lg px-3 py-2"
                        >
                          {(categories?.children || []).map((g) => (
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
                                  ${
                                    active
                                      ? "bg-red-600 border-red-600 text-white"
                                      : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"
                                  }
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
                    {errors.categoryIds && (
                      <p className="text-red-600 text-xs mt-2">{errors.categoryIds}</p>
                    )}
                  </div>
                </div>

                {/* Upload panel */}
                <div className="w-full lg:w-72 shrink-0">
                  <div className="border rounded-xl p-4 bg-white space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="w-28 h-28 border rounded-lg overflow-hidden bg-gray-50 flex items-center justify-center">
                        {previewURL ? (
                          <img src={previewURL} alt="preview" className="w-full h-full object-cover" />
                        ) : currentPreviewPath && isEdit ? (
                          <img src={currentPreviewPath} alt="current" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xs text-gray-400 p-2 text-center">Preview image</span>
                        )}
                      </div>
                      <div className="flex-1 space-y-3">
                        <div>
                          <input
                            id="pickPreview"
                            type="file"
                            accept="image/*"
                            onChange={onPreviewChange}
                            className="hidden"
                          />
                          <label
                            htmlFor="pickPreview"
                            className="inline-block bg-white border rounded-lg px-4 py-2 text-sm cursor-pointer hover:bg-gray-50"
                          >
                            Upload image
                          </label>

                          {/* Hiển thị tên file ảnh nếu có */}
                          {form.previewImage && (
                            <div className="text-xs text-gray-600 mt-1 truncate max-w-[12rem]">
                              {form.previewImage.name}
                            </div>
                          )}

                          {!isEdit && errors.previewImage && (
                            <p className="text-red-600 text-xs mt-1">{errors.previewImage}</p>
                          )}
                        </div>
                        <div>
                          <input
                            id="pickModel"
                            type="file"
                            accept=".zip,.glb,.fbx,.obj,.blend,.rar"
                            onChange={onFileChange}
                            className="hidden"
                          />
                          <label
                            htmlFor="pickModel"
                            className="inline-block bg-white border rounded-lg px-4 py-2 text-sm cursor-pointer hover:bg-gray-50"
                          >
                            Upload file
                          </label>
                          {form.modelFile && (
                            <div className="text-xs text-gray-600 mt-1 truncate max-w-[12rem]">
                              {form.modelFile.name}
                            </div>
                          )}
                          {!isEdit && errors.modelFile && (
                            <p className="text-red-600 text-xs mt-1">{errors.modelFile}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t my-4" />

              {/* Name */}
              <div className="mb-3">
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
              <div className="mb-3">
                <label className="block font-semibold mb-1">Mô tả</label>
                <textarea
                  name="description"
                  value={form.description}
                  onChange={onTextChange}
                  className="w-full border rounded-lg px-3 py-2 h-28"
                  placeholder="Mô tả ngắn gọn về sản phẩm..."
                  maxLength={2000}
                />
                <div className="text-xs text-gray-500 mt-1">
                  {(form.description || "").length}/2000
                </div>
              </div>

              {/* Price */}
              <div className="mb-3">
                <label className="block font-semibold mb-1">Giá sản phẩm</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    name="price"
                    value={form.price}
                    onChange={onNumberChange}
                    className="flex-1 border rounded-lg px-3 py-2"
                    placeholder="0 = Free"
                    min={0}
                  />
                  {/* Buttons quick-set */}
                  <button
                    type="button"
                    onClick={() => setForm((s) => ({ ...s, price: 0 }))}
                    className={`px-3 py-2 rounded border text-sm transition ${
                      form.price === 0
                        ? "bg-red-600 border-red-600 text-white"
                        : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    Free
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((s) => ({ ...s, price: 15000 }))}
                    className={`px-3 py-2 rounded border text-sm transition ${
                      form.price === 15000
                        ? "bg-red-600 border-red-600 text-white"
                        : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    15.000
                  </button>
                </div>
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
              <div className="mt-4">
                <label className="block font-semibold mb-2">Style</label>
                {!styleOptions || styleOptions.length === 0 ? (
                  <p className="text-sm text-gray-500">Chưa có style nào.</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {styleOptions.map((st) => {
                      const active = form.styles.includes(st._id);
                      return (
                        <button
                          type="button"
                          key={st._id}
                          onClick={() => toggleStyle(st._id)}
                          className={`px-3 py-1 rounded-full text-sm border
                            ${
                              active
                                ? "bg-red-600 border-red-600 text-white"
                                : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"
                            }
                          `}
                        >
                          {st.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Ảnh phụ */}
              <div className="mt-4">
                <label className="block font-semibold mb-1">Ảnh phụ (Extra Images)</label>
                <input type="file" multiple onChange={onExtraImagesChange} className="w-full" accept="image/*" />
                {form.extraImages?.length > 0 && (
                  <>
                    <div className="text-xs text-gray-500 mt-2">Đã chọn {form.extraImages.length} ảnh.</div>
                    <div className="mt-3 overflow-auto pr-1">
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {extraPreviewURLs.map((src, idx) => (
                          <div key={idx} className="relative">
                            <img src={src} alt={`extra-${idx}`} className="w-full object-cover rounded border" />
                            <button
                              type="button"
                              onClick={() => removeExtraAt(idx)}
                              className="absolute -top-1 right-1 rounded-full bg-black/60 text-white text-sm leading-7 mt-2 text-center"
                              title="Xoá ảnh này"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t flex items-center justify-between flex-shrink-0">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.displayHome}
                  onChange={(e) => setForm((s) => ({ ...s, displayHome: e.target.checked }))}
                  className="accent-blue-600 h-4 w-4"
                />
                <span className="text-sm">Hiển thị sản phẩm trên Trang chủ</span>
              </label>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    // nếu đang upload thì hủy
                    if (abortRef.current) {
                      try {
                        abortRef.current.abort();
                      } catch {}
                      abortRef.current = null;
                      setUploadPct(0);
                    }
                    onClose();
                  }}
                  className="px-4 py-2 border rounded"
                >
                  Huỷ
                </button>
                <button
                  disabled={saving}
                  onClick={submit}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
                >
                  {saving ? "Đang lưu…" : isEdit ? "Lưu thay đổi" : "Thêm sản phẩm"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** ---------- Main Manager Page ---------- */
export default function ProductScenesManager() {
  const headers = useAuthHeaders();

  // list state
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  // filters
  const [search, setSearch] = useState("");
  const [categories, setCategories] = useState(null);
  const [flatCats, setFlatCats] = useState([]);
  const [filterCats, setFilterCats] = useState([]); // nhiều category
  const [styleOptions, setStyleOptions] = useState([]);
  const [filterStyles, setFilterStyles] = useState([]); // nhiều style

  // create/edit modals
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  // ref để auto-fetch khi đổi filter (tránh chạy lần đầu)
  const firstFiltersRun = useRef(false);

  // map id -> name cho styles & categories
  const styleMap = useMemo(() => {
    const m = Object.create(null);
    (styleOptions || []).forEach((s) => (m[String(s._id)] = s.name));
    return m;
  }, [styleOptions]);

  const catMap = useMemo(() => {
    const m = Object.create(null);
    (flatCats || []).forEach((c) => (m[String(c._id)] = c.name));
    return m;
  }, [flatCats]);

  const namesFromIds = (map, arr) =>
    (arr || [])
      .map((x) => (x && typeof x === "object" ? x._id : x))
      .filter(Boolean)
      .map(String)
      .map((id) => map[id])
      .filter(Boolean);

  // load categories
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/api/categories/tree/3dscenes`, { headers });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setCategories(data);
        setFlatCats(flattenCategories(data));
      } catch (e) {
        console.error("Load categories error", e);
      }
    })();
  }, [headers]);

  // load styles
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/api/styles`, { headers });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setStyleOptions(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error("Load styles error", e);
      }
    })();
  }, [headers]);

  const fetchList = async () => {
    setLoading(true);
    setMsg("");
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search.trim()) qs.set("search", search.trim());

      // nhiều category & styles (CSV)
      if (filterCats.length) {
        qs.set("categories", filterCats.join(","));
        if (filterCats.length === 1) {
          qs.set("category", filterCats[0]); // tương thích BE cũ
        }
      }
      if (filterStyles.length) qs.set("styles", filterStyles.join(","));

      const res = await fetch(`${API}/api/product-scenes?${qs.toString()}`, { headers });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      setMsg(`Lỗi: ${e.message || "Không tải được danh sách"}`);
    } finally {
      setLoading(false);
    }
  };

  // fetch theo trang/limit
  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit]);

  const onSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    fetchList();
  };

  const clearFilters = () => {
    setSearch("");
    setFilterCats([]);
    setFilterStyles([]);
    setPage(1);
    fetchList();
  };

  const toggleCatFilter = (id) => {
    setFilterCats((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // 🔄 Auto-fetch khi đổi Category/Style
  useEffect(() => {
    if (!firstFiltersRun.current) {
      firstFiltersRun.current = true;
      return; // bỏ qua lần mount đầu
    }
    if (page !== 1) {
      setPage(1); // effect của page sẽ fetchList
    } else {
      fetchList(); // đang ở trang 1 thì fetch ngay
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCats, filterStyles]);

  const deleteRow = async (id) => {
    if (!confirm("Xoá sản phẩm này?")) return;
    try {
      const res = await fetch(`${API}/api/product-scenes/${id}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg("✅ Đã xoá sản phẩm");
      fetchList();
    } catch (e) {
      setMsg(`❌ ${e.message || "Xoá thất bại"}`);
    }
  };

  const openEdit = (row) => {
    setEditing(row);
    setEditOpen(true);
  };

  const openCreate = () => setCreateOpen(true);

  return (
    <div className="flex min-h-screen w-screen overflow-hidden bg-white">
      <Sidebar activeKey="product.3dscenes" />
      <main className="flex-1 min-w-0 bg-gray-100">
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold">Quản lý 3D Scenes</h1>
            <button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">
              + Thêm sản phẩm
            </button>
          </div>

          {/* Filters */}
          <div className="bg-white rounded shadow p-4 space-y-3">
            <form onSubmit={onSearchSubmit} className="flex gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm theo tên/mô tả…"
                className="border rounded px-3 py-2 w-full bg-white"
              />
              <button className="px-4 py-2 bg-gray-900 text-white rounded">Tìm</button>
            </form>

            <div className="flex items-center gap-4 flex-wrap">
              {/* Category pills (multi) */}
              <CategoryChips
                options={flatCats}
                selected={filterCats}
                onToggle={toggleCatFilter}
                onSelectAll={() => setFilterCats(flatCats.map((c) => c._id))}
                onClear={() => setFilterCats([])}
              />

              {/* Styles multi-select (selected chips show in control) */}
              <MultiSelect options={styleOptions} selected={filterStyles} onChange={setFilterStyles} />

              <button onClick={fetchList} className="px-3 py-2 border rounded">
                Áp dụng lọc
              </button>
              <button onClick={clearFilters} className="px-3 py-2 border rounded">
                Xoá lọc
              </button>
            </div>
          </div>

          {msg && (
            <div
              className={`px-3 py-2 rounded ${
                msg.startsWith("✅")
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : msg.startsWith("❌")
                  ? "bg-red-50 text-red-700 border border-red-200"
                  : "bg-gray-50 text-gray-700 border border-gray-200"
              }`}
            >
              {msg}
            </div>
          )}

          {/* Table */}
          <div className="bg-white rounded shadow overflow-x-auto">
            <table className="min-w-max border-collapse">
              <thead className="bg-gray-50 whitespace-nowrap">
                <tr className="text-left text-sm">
                  <th className="px-3 py-2 border-b">Preview</th>
                  <th className="px-3 py-2 border-b">Tên</th>
                  <th className="px-3 py-2 border-b">Giá</th>
                  <th className="px-3 py-2 border-b">Styles</th>
                  <th className="px-3 py-2 border-b">Categories</th>
                  {/* NEW columns */}
                  <th className="px-3 py-2 border-b">Render</th>
                  <th className="px-3 py-2 border-b">Lighting</th>
                  <th className="px-3 py-2 border-b">Camera</th>
                  <th className="px-3 py-2 border-b">Tạo lúc</th>
                  <th className="px-3 py-2 border-b w-40 sticky right-0 bg-white z-10">Hành động</th>
                </tr>
              </thead>
              <tbody className="whitespace-nowrap">
                {loading ? (
                  <tr>
                    <td className="px-3 py-4" colSpan={10}>
                      Đang tải…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4" colSpan={10}>
                      Không có dữ liệu
                    </td>
                  </tr>
                ) : (
                  items.map((it) => {
                    const preview = it.previewImagePath || it.images?.[0]?.path || "";
                    const styleNames = namesFromIds(styleMap, it.styles);
                    const catNames = namesFromIds(catMap, it.categoryIds);

                    return (
                      <tr key={it._id} className="border-b">
                        <td className="px-3 py-2">
                          {preview ? (
                            <img
                              src={joinUrl(API, preview)}
                              alt={it.name}
                              className="w-16 h-16 object-cover rounded border"
                              onError={(e) => {
                                e.currentTarget.src = "/product1-1.jpg";
                              }}
                            />
                          ) : (
                            <div className="w-16 h-16 rounded bg-gray-100 border" />
                          )}
                        </td>

                        <td className="px-3 py-2">
                          <div className="font-medium">{it.name}</div>
                          <div className="text-xs text-gray-500 truncate max-w-[320px]">{it.description}</div>
                        </td>

                        <td className="px-3 py-2">{Number(it.price || 0).toLocaleString("vi-VN")}</td>

                        <td className="px-3 py-2 text-xs text-gray-600">
                          <div className="max-w-[320px] truncate" title={styleNames.join(", ")}>
                            {styleNames.length ? styleNames.join(", ") : "—"}
                          </div>
                        </td>

                        <td className="px-3 py-2 text-xs text-gray-600">
                          <div className="max-w-[320px] truncate" title={catNames.join(", ")}>
                            {catNames.length ? catNames.join(", ") : "—"}
                          </div>
                        </td>

                        {/* NEW: cột Render */}
                        <td className="px-3 py-2 text-xs text-gray-600">
                          <div className="max-w-[220px] truncate" title={it.render || ""}>
                            {it.render || "—"}
                          </div>
                        </td>

                        {/* NEW: cột Lighting */}
                        <td className="px-3 py-2 text-xs text-gray-600">
                          <div className="max-w-[220px] truncate" title={it.lighting || ""}>
                            {it.lighting || "—"}
                          </div>
                        </td>

                        {/* NEW: cột Camera */}
                        <td className="px-3 py-2 text-xs text-gray-600">
                          <div className="max-w-[160px] truncate" title={it.cameraType || ""}>
                            {it.cameraType || "—"}
                          </div>
                        </td>

                        <td className="px-3 py-2 text-sm text-gray-500">
                          {it.createdAt ? new Date(it.createdAt).toLocaleString("vi-VN") : ""}
                        </td>

                        <td className="px-3 py-2 sticky right-0 bg-white z-10">
                          <div className="flex gap-2">
                            <button
                              onClick={() => openEdit(it)}
                              className="px-3 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white"
                            >
                              Sửa
                            </button>
                            <button
                              onClick={() => deleteRow(it._id)}
                              className="px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white"
                            >
                              Xóa
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Trang {page}/{Math.max(1, Math.ceil(total / limit))} • Tổng {total} sản phẩm
            </div>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                ←
              </button>
              <button
                disabled={page >= Math.max(1, Math.ceil(total / limit))}
                onClick={() =>
                  setPage((p) => Math.min(Math.max(1, Math.ceil(total / limit)), p + 1))
                }
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                →
              </button>
            </div>
          </div>
        </div>

        {/* CREATE MODAL */}
        <SceneFormModal
          mode="create"
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSaved={fetchList}
          headers={headers}
          categories={categories}
          styleOptions={styleOptions}
        />

        {/* EDIT MODAL (UI giống create) */}
        <SceneFormModal
          mode="edit"
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={fetchList}
          headers={headers}
          categories={categories}
          styleOptions={styleOptions}
          product={editing}
        />
      </main>
    </div>
  );
}
