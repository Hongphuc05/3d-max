import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "../Sidebar/Sidebar";
import Header from "../Header/Header";
// ❌ Không cần useNavigate nữa vì không điều hướng
import EditProductModal from "./EditProductModel";
// Lưu ý: component form của bạn đang ở file ./AddProduct3dmodel
import ProductForm3dmodel from "./AddProduct3dmodel";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd"; // 🆕
import { decodeHtml } from "../../../utils/html";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

export default function ProductList3dmodel() {
  const [editing, setEditing] = useState(null);
// 🆕 Page jump input
  const [pageInput, setPageInput] = useState("");

  // Data
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  // ✅ hiển thị 50 sản phẩm / trang
  const [limit] = useState(50);

  // Filters
  const [q, setQ] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [selectedColors, setSelectedColors] = useState([]);
  const [selectedForms, setSelectedForms] = useState([]);
  const [selectedStyles, setSelectedStyles] = useState([]);
  const [selectedMaterials, setSelectedMaterials] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [sort, setSort] = useState("default");
  const [displayHome, setDisplayHome] = useState("");

  // Category cha (level2 theo tree 3D)
  const [parentCategory, setParentCategory] = useState("");

  const [filterOptions, setFilterOptions] = useState({
    colors: [],
    forms: [],
    styles: [],
    materials: [],
    categories: [],
  });

  // NEW: tree category cho 3D models
  const [catTree, setCatTree] = useState({ root: null, children: [] });

  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const nf = new Intl.NumberFormat("vi-VN");

  // 🔁 tick để ép reload sau khi tạo mới/xoá xong
  const [reloadTick, setReloadTick] = useState(0);

  // ===== Helpers
  const imageUrl = (path) => {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path; // absolute
    if (path.startsWith("/")) return `${API}${path}`; // absolute server path
    // "uploads/..." hoặc đường dẫn tương đối khác
    return `${API}/${String(path).replace(/^\/+/, "")}`;
  };

  const toggleInArray = (arr, value) =>
    arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value];

  const resetFilters = () => {
    setQ("");
    setMinPrice("");
    setMaxPrice("");
    setSelectedColors([]);
    setSelectedForms([]);
    setSelectedStyles([]);
    setSelectedMaterials([]);
    setSelectedCategories([]);
    setSort("default");
    setDisplayHome("");
    setParentCategory("");
    setPage(1);
  };

  const normalizeCode = (code) => {
    if (!code) return "#e5e7eb";
    if (/^[0-9a-fA-F]{6}$/.test(code)) return `#${code}`;
    return code;
  };
  const colorLabel = (code) => {
    if (!code) return "—";
    if (/^[0-9a-fA-F]{6}$/.test(code)) return `#${code.toUpperCase()}`;
    return code;
  };

  // Lookup maps
  const colorMap = useMemo(
    () => new Map((filterOptions.colors || []).map((c) => [String(c._id), c])),
    [filterOptions.colors]
  );
  const formMap = useMemo(
    () => new Map((filterOptions.forms || []).map((f) => [String(f._id), f])),
    [filterOptions.forms]
  );
  const styleMap = useMemo(
    () => new Map((filterOptions.styles || []).map((s) => [String(s._id), s])),
    [filterOptions.styles]
  );
  const materialMap = useMemo(
    () => new Map((filterOptions.materials || []).map((m) => [String(m._id), m])),
    [filterOptions.materials]
  );
  const categoryMap = useMemo(
    () => new Map((filterOptions.categories || []).map((c) => [String(c._id), c])),
    [filterOptions.categories]
  );

  const getName = (val, map) => {
    if (!val) return "—";
    if (typeof val === "string") return map.get(val)?.name ?? "—";
    return val.name ?? (val._id ? map.get(String(val._id))?.name ?? "—" : "—");
  };

  // ===== Category: lấy theo TREE (root -> level2 -> level3)
  const parentCats = catTree?.children || [];
  const currentChildren = useMemo(() => {
    if (!parentCategory) return [];
    const found = parentCats.find((p) => String(p._id) === String(parentCategory));
    return found?.children || [];
  }, [parentCats, parentCategory]);

  // ===== Query
  const categoriesForQuery = useMemo(() => {
    if (selectedCategories.length) return selectedCategories; // con
    if (parentCategory) return [parentCategory]; // nếu chưa chọn con, dùng cha
    return [];
  }, [selectedCategories, parentCategory]);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q.trim());
    if (minPrice !== "") p.set("minPrice", minPrice);
    if (maxPrice !== "") p.set("maxPrice", maxPrice);
    if (selectedColors.length) p.set("colors", selectedColors.join(","));
    if (selectedForms.length) p.set("forms", selectedForms.join(","));
    if (selectedStyles.length) p.set("styles", selectedStyles.join(","));
    if (selectedMaterials.length) p.set("materials", selectedMaterials.join(","));
    if (categoriesForQuery.length) p.set("categories", categoriesForQuery.join(","));
    if (sort) p.set("sort", sort);
    if (displayHome !== "") p.set("displayhome", displayHome);
    p.set("page", String(page));
    p.set("limit", String(limit)); // ✅ limit=50
    return p.toString();
  }, [
    q,
    minPrice,
    maxPrice,
    selectedColors,
    selectedForms,
    selectedStyles,
    selectedMaterials,
    categoriesForQuery,
    sort,
    page,
    limit,
    displayHome,
  ]);

  // ===== Fetch filters (colors/forms/styles/materials + categories)
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await fetch(`${API}/api/products/filters`);
        if (!res.ok) return;
        const data = await res.json();
        if (!ignore) setFilterOptions(data);
      } catch {}
    })();
    return () => (ignore = true);
  }, []);

  // ===== Fetch CATEGORY TREE 3D (root->level2->level3)
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await fetch(`${API}/api/categories/tree/3dmodel`);
        if (!res.ok) return;
        const data = await res.json();
        if (!ignore) setCatTree(data || { root: null, children: [] });
      } catch {}
    })();
    return () => (ignore = true);
  }, []);

  // ===== Fetch products (debounce) + lắng nghe reloadTick
  useEffect(() => {
    setError("");
    setFetching(true);
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/api/products/list?${queryString}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Không lấy được danh sách sản phẩm");
        const data = await res.json();
        const items = Array.isArray(data.items)
          ? data.items
          : Array.isArray(data)
          ? data
          : [];
        setProducts(items);
        setTotal(data.total ?? items.length);
        setPages(data.pages ?? 1);
      } catch (err) {
        if (err.name !== "AbortError")
          setError(err.message || "Lỗi khi tải sản phẩm");
      } finally {
        setLoading(false);
        setFetching(false);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [queryString, reloadTick]); // ✅ reload khi thêm/xoá

  // ===== Fallback (nếu cần): tự suy filters từ products
  useEffect(() => {
    if (
      filterOptions.colors.length ||
      filterOptions.forms.length ||
      filterOptions.styles.length ||
      filterOptions.materials.length ||
      filterOptions.categories.length
    )
      return;

    const uniqBy = (arr, key) => {
      const map = new Map();
      arr.forEach((x) => {
        const k = x?.[key] ?? x;
        if (!map.has(k)) map.set(k, x);
      });
      return Array.from(map.values());
    };

    const collect = (field) =>
      uniqBy((products || []).flatMap((p) => p?.[field] || []), "_id").map(
        (x) =>
          typeof x === "string"
            ? { _id: x }
            : {
                _id: x._id,
                name: x.name,
                code: x.code,
                hex: x.hex,
                image: x.image,
                parent: x.parent || null,
              }
      );

    if (products.length) {
      setFilterOptions((old) => ({
        colors: old.colors.length ? old.colors : collect("colors"), // ⚠️ ưu tiên 'colors'
        forms: old.forms.length ? old.forms : collect("form"),
        styles: old.styles.length ? old.styles : collect("styles"),
        materials: old.materials.length ? old.materials : collect("materials"),
        categories: old.categories.length
          ? old.categories
          : collect("categoryIds"),
      }));
    }
  }, [products, filterOptions]);

  // ===== Auth headers
  const useAuthHeaders = () => {
    return useMemo(() => {
      const t = localStorage.getItem("token");
      return t ? { Authorization: `Bearer ${t}` } : {};
    }, []);
  };
  const headers = useAuthHeaders();

  // ===== Deleting state
  const [deletingId, setDeletingId] = useState(null);

  // ===== Actions
  const deleteProduct = async (id) => {
    if (!confirm("Xoá sản phẩm này?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`${API}/api/product-scenes/${id}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) {
        // cố đọc message từ JSON, fallback sang text
        let errText = "";
        try {
          const j = await res.json();
          errText = j?.message || JSON.stringify(j);
        } catch {
          errText = await res.text();
        }
        throw new Error(errText || "Xoá thất bại");
      }

      // Xoá lạc quan trên UI
      setProducts((prev) => prev.filter((x) => x._id !== id));
      setTotal((t) => Math.max(0, t - 1));

      // Nếu xoá xong mà trang hiện tại không còn item nào & đang không phải trang 1 → lùi 1 trang
      setPage((p) => {
        const remainingRows = products.length - 1; // dùng snapshot hiện tại
        return remainingRows === 0 && p > 1 ? p - 1 : p;
      });

      setMessage("✅ Đã xoá sản phẩm");

      // Ép reload từ server để đồng bộ dữ liệu/phân trang
      setReloadTick((t) => t + 1);
    } catch (e) {
      setMessage(`❌ ${e.message || "Xoá thất bại"}`);
    } finally {
      setDeletingId(null);
    }
  };

  // ===== Render helpers
  const PriceCell = ({ price }) =>
    Number(price) === 0 ? (
      <span className="text-green-600 font-medium">Free</span>
    ) : (
      <span>{nf.format(Number(price))}</span>
    );

  const ColorDot = ({ c, idx = 0 }) => {
    const obj = typeof c === "string" ? colorMap.get(c) : c;
    const label = colorLabel(obj?.code || obj?.name);
    const bg = normalizeCode(obj?.hex || obj?.code);
    const key = typeof c === "string" ? c : (c?._id ?? `c-${idx}`);
    return (
      <span
        key={key}
        title={label}
        className="inline-block w-4 h-4 rounded-full border border-gray-200"
        style={{ backgroundColor: bg }}
      />
    );
  };

  const getFirstStyleName = (p) => {
    const s = (p.styles || [])[0];
    return getName(s, styleMap);
  };
  const getMaterialsJoined = (p) =>
    (p.materials || [])
      .map((m) => getName(m, materialMap))
      .filter(Boolean)
      .join(" + ") || "—";
  const getSizeText = (p) => {
    const mb =
      p.totalSizeMB ?? p.sizeMB ?? p.size_mb ?? p.size ?? p.filesize_mb ?? null;
    if (!mb) return "—";
    return `${mb} MB`;
  };
  const getShortDesc = (p) =>
    (p.shortDescription || p.description || "")
      .toString()
      .replace(/\s+/g, " ")
      .trim();

  // ===== Icons cho Form (ƯU TIÊN ẢNH TỪ form.image)
  const FormIcon = ({
    image,
    name = "",
    fallback = 0,
    className = "w-5 h-5 rounded border object-cover bg-white",
  }) => {
    if (image) {
      return <img src={image} alt={name || "form"} className={className} />;
    }
    const n = (name || "").toLowerCase();
    const type = n.includes("triangle") || n.includes("tam giác")
      ? "triangle"
      : n.includes("square") || n.includes("vuông")
      ? "square"
      : n.includes("circle") || n.includes("tròn")
      ? "circle"
      : ["triangle", "square", "circle"][fallback % 3];

    if (type === "triangle")
      return (
        <svg viewBox="0 0 24 24" className="w-5 h-5">
          <path d="M12 4l8 14H4z" fill="none" stroke="currentColor" />
        </svg>
      );
    if (type === "square")
      return (
        <svg viewBox="0 0 24 24" className="w-5 h-5">
          <rect x="5" y="5" width="14" height="14" fill="none" stroke="currentColor" />
        </svg>
      );
    return (
      <svg viewBox="0 0 24 24" className="w-5 h-5">
        <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" />
      </svg>
    );
  };

  // ===== UI selects
  const DropSelectParents = ({ value, onChange }) => (
    <select
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        setSelectedCategories([]); // đổi cha -> reset con
        setPage(1);
      }}
      className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-gray-800"
      title="Category"
    >
      <option value="">Category: Chọn danh mục cha</option>
      {(catTree?.children || []).map((c) => (
        <option key={c._id} value={c._id}>
          {c.name}
        </option>
      ))}
    </select>
  );

  const StyleSelectWithImages = ({ selected, setSelected, options, label = "Style" }) => (
    <div className="relative">
      <details className="group">
        <summary className="list-none h-10 inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm cursor-pointer select-none">
          <span className="text-gray-700">{label}</span>
          {selected.length > 0 && (
            <span className="flex items-center gap-1 ml-1">
              {selected.slice(0, 3).map((id) => {
                const s = styleMap.get(id);
                const img = s?.image;
                return img ? (
                  <img
                    key={id}
                    src={img}
                    alt={s?.name || "style"}
                    className="w-5 h-5 rounded border object-cover"
                  />
                ) : (
                  <span
                    key={id}
                    className="w-5 h-5 rounded border bg-gray-100 text-[10px] flex items-center justify-center"
                    title={s?.name}
                  >
                    {s?.name?.[0]?.toUpperCase?.() || "S"}
                  </span>
                );
              })}
              {selected.length > 3 && <span className="text-xs text-gray-500">+{selected.length - 3}</span>}
            </span>
          )}
          <svg className="w-4 h-4 ml-1" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke="currentColor" fill="none" /></svg>
        </summary>
        <div className="absolute z-20 mt-2 w-72 max-h-72 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg p-2">
          {options.length === 0 ? (
            <div className="text-sm text-gray-400 px-2 py-1">Không có dữ liệu</div>
          ) : (
            <ul className="space-y-1">
              {options.map((o) => {
                const checked = selected.includes(o._id);
                return (
                  <li
                    key={o._id}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer"
                    onClick={() =>
                      setSelected((prev) => {
                        const has = prev.includes(o._id);
                        const next = has ? prev.filter((x) => x !== o._id) : [...prev, o._id];
                        setPage(1);
                        return next;
                      })
                    }
                  >
                    <input type="checkbox" readOnly checked={checked} className="accent-gray-900" />
                    {o.image ? (
                      <img src={o.image} alt={o.name} className="w-7 h-7 rounded border object-cover" />
                    ) : (
                      <div className="w-7 h-7 rounded border bg-gray-100" />
                    )}
                    <span className="text-sm text-gray-800">{o.name}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {selected.length > 0 && (
            <div className="pt-2 mt-2 border-t flex justify-end">
              <button onClick={() => setSelected([])} className="text-xs text-gray-600 hover:text-gray-900">Bỏ chọn tất cả</button>
            </div>
          )}
        </div>
      </details>
    </div>
  );

  const ColorSelectWithCodes = ({ selected, setSelected, options }) => (
    <div className="relative">
      <details className="group">
        <summary className="list-none h-10 inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm cursor-pointer select-none">
          <span className="text-gray-700">Color</span>
          {selected.length > 0 && (
            <span className="flex items-center gap-2 ml-1">
              {selected.slice(0, 3).map((id) => {
                const c = colorMap.get(id);
                const code = (c?.code && c.code.toUpperCase?.()) || c?.name || "";
                const bg = normalizeCode(c?.hex || c?.code);
                return (
                  <span key={id} className="inline-flex items-center gap-1">
                    <span className="w-4 h-4 rounded-full border" style={{ backgroundColor: bg }} />
                    <span className="text-xs text-gray-700">{code}</span>
                  </span>
                );
              })}
              {selected.length > 3 && <span className="text-xs text-gray-500">+{selected.length - 3}</span>}
            </span>
          )}
          <svg className="w-4 h-4 ml-1" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke="currentColor" fill="none" /></svg>
        </summary>
        <div className="absolute z-20 mt-2 w-64 max-h-64 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg p-2">
          {options.length === 0 ? (
            <div className="text-sm text-gray-400 px-2 py-1">Không có dữ liệu</div>
          ) : (
            options.map((o) => {
              const checked = selected.includes(o._id);
              const code = (o.code && o.code.toUpperCase?.()) || o.name;
              return (
                <label key={o._id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    className="accent-gray-900"
                    checked={checked}
                    onChange={() =>
                      setSelected((prev) => {
                        const has = prev.includes(o._id);
                        const next = has ? prev.filter((x) => x !== o._id) : [...prev, o._id];
                        setPage(1);
                        return next;
                      })
                    }
                  />
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block w-4 h-4 rounded-full border" style={{ backgroundColor: normalizeCode(o.hex || o.code) }} />
                    <span>{code}</span>
                  </span>
                </label>
              );
            })
          )}
          {selected.length > 0 && (
            <div className="pt-2 mt-2 border-t flex justify-end">
              <button onClick={() => setSelected([])} className="text-xs text-gray-600 hover:text-gray-900">Bỏ chọn tất cả</button>
            </div>
          )}
        </div>
      </details>
    </div>
  );

  const FormSelectWithIcons = ({ selected, setSelected, options }) => (
    <div className="relative">
      <details className="group">
        <summary className="list-none h-10 inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm cursor-pointer select-none">
          <span className="text-gray-700">Form</span>
          {/* ✅ Hiển thị ảnh của các form đã chọn (ưu tiên form.image) */}
          {selected.length > 0 && (
            <span className="flex items-center gap-1 ml-1">
              {selected.slice(0, 4).map((id, idx) => {
                const f = formMap.get(id);
                return (
                  <FormIcon
                    key={id}
                    name={f?.name}
                    image={f?.image}
                    fallback={idx}
                    className="w-5 h-5 rounded border object-cover"
                  />
                );
              })}
              {selected.length > 4 && <span className="text-xs text-gray-500">+{selected.length - 4}</span>}
            </span>
          )}
          <svg className="w-4 h-4 ml-1" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke="currentColor" fill="none" /></svg>
        </summary>
        <div className="absolute z-20 mt-2 w-64 max-h-64 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg p-2">
          {options.length === 0 ? (
            <div className="text-sm text-gray-400 px-2 py-1">Không có dữ liệu</div>
          ) : (
            options.map((o, idx) => {
              const checked = selected.includes(o._id);
              return (
                <label key={o._id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    className="accent-gray-900"
                    checked={checked}
                    onChange={() =>
                      setSelected((prev) => {
                        const has = prev.includes(o._id);
                        const next = has ? prev.filter((x) => x !== o._id) : [...prev, o._id];
                        setPage(1);
                        return next;
                      })
                    }
                  />
                  <FormIcon
                    name={o.name}
                    image={o.image}
                    fallback={idx}
                    className="w-6 h-6 rounded border object-cover"
                  />
                  <span>{o.name}</span>
                </label>
              );
            })
          )}
          {selected.length > 0 && (
            <div className="pt-2 mt-2 border-t flex justify-end">
              <button onClick={() => setSelected([])} className="text-xs text-gray-600 hover:text-gray-900">Bỏ chọn tất cả</button>
            </div>
          )}
        </div>
      </details>
    </div>
  );

  const MaterialSelectWithNames = ({ selected, setSelected, options }) => (
    <div className="relative">
      <details className="group">
        <summary className="list-none h-10 inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm cursor-pointer select-none">
          <span className="text-gray-700">Material</span>
          {selected.length > 0 && (
            <span className="flex items-center gap-1 ml-1">
              {selected.slice(0, 3).map((id) => (
                <span key={id} className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 text-xs">
                  {materialMap.get(id)?.name || "Material"}
                </span>
              ))}
              {selected.length > 3 && <span className="text-xs text-gray-500">+{selected.length - 3}</span>}
            </span>
          )}
          <svg className="w-4 h-4 ml-1" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke="currentColor" fill="none" /></svg>
        </summary>
        <div className="absolute z-20 mt-2 w-64 max-h-64 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg p-2">
          {options.length === 0 ? (
            <div className="text-sm text-gray-400 px-2 py-1">Không có dữ liệu</div>
          ) : (
            options.map((o) => {
              const checked = selected.includes(o._id);
              return (
                <label key={o._id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    className="accent-gray-900"
                    checked={checked}
                    onChange={() =>
                      setSelected((prev) => {
                        const has = prev.includes(o._id);
                        const next = has ? prev.filter((x) => x !== o._id) : [...prev, o._id];
                        setPage(1);
                        return next;
                      })
                    }
                  />
                  <span>{o.name}</span>
                </label>
              );
            })
          )}
          {selected.length > 0 && (
            <div className="pt-2 mt-2 border-t flex justify-end">
              <button onClick={() => setSelected([])} className="text-xs text-gray-600 hover:text-gray-900">Bỏ chọn tất cả</button>
            </div>
          )}
        </div>
      </details>
    </div>
  );

  // ✅ state mở popup tạo mới
  const [adding, setAdding] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false); // 🆕

  // 🆕 hàm hoán vị mảng để áp dụng local ngay khi kéo-thả
  const reorderList = (list, startIndex, endIndex) => {
    const result = Array.from(list);
    const [removed] = result.splice(startIndex, 1);
    result.splice(endIndex, 0, removed);
    return result;
  };
  
  // 🆕 hàm build payload {id, order} theo index toàn cục
  const buildOrderPairs = (list) => {
    const base = (page - 1) * limit;
    return list.map((p, idx) => ({ id: p._id, order: base + idx }));
  };
  
  // 🆕 gọi API lưu bulk order
  const saveOrderPairs = async (pairs) => {
    setSavingOrder(true);

    try {
      const res = await fetch(`${API}/api/products/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ pairs }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || "Reorder failed");
      }
      setMessage("✅ Đã lưu thứ tự hiển thị");
      // ép reload để đồng bộ phân trang/tổng
      setReloadTick((t) => t + 1);
    } catch (e) {
      setMessage(`❌ Lưu thứ tự thất bại: ${e.message || "Lỗi"}`);
    } finally {
      setSavingOrder(false);
    }
  };
  
  // 🆕 handler khi kéo-thả kết thúc
  // const onDragEnd = async (result) => {

  //   if (!result.destination) return;
  //   if (result.destination.index === result.source.index) return;
  
  //   const newItems = reorderList(products, result.source.index, result.destination.index);

  //   setProducts(newItems); // cập nhật UI ngay
  //   // lưu bulk lên server
  //   const pairs = buildOrderPairs(newItems);
  //   saveOrderPairs(pairs);
  // };
    const bytesToMB = (b) => {
    if (!b || isNaN(b)) return "-";
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  // 🆕 handler khi kéo-thả kết thúc
const onDragEnd = async (result) => {
  if (!result.destination) return;

  const fromIndex = result.source.index;
  const toIndex = result.destination.index;

  if (fromIndex === toIndex) return;

  try {
    const movedItem = products[fromIndex];
    const targetItem = products[toIndex];

    const res = await fetch(`${API}/api/products/reorder-drag`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`
      },
      body: JSON.stringify({
        id: movedItem._id,
        from: movedItem.order,
        to: targetItem.order
      })
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || "Reorder failed");
    }

    // ✅ reload lại list từ server
    setReloadTick((t) => t + 1);

  } catch (err) {
    console.error("❌ Reorder failed:", err);
  }
};


  // 🆕 Jump to page with validation
const jumpToPage = () => {
  const n = parseInt(String(pageInput).trim(), 10);
  if (Number.isNaN(n)) {
    setPageInput("");
    return;
  }
  const next = Math.min(Math.max(1, n), pages || 1);
  setPage(next);
  // optional: clear hoặc giữ giá trị nhập, tùy gu:
  // setPageInput("");
};

  // ===== Render
  return (
    <div className="flex min-h-screen w-screen overflow-hidden bg-white">
      <Sidebar activeKey="product.3dmodels" />
      <main className="flex-1 min-w-0 bg-gray-50">
        {/* <Header /> */}

        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-semibold">Quản lý sản phẩm 3D Models</h1>

            {/* ✅ mở popup thay vì navigate */}
            <button
              onClick={() => setAdding(true)}
              className="h-10 px-4 bg-green-600 hover:bg-green-700 text-white rounded-md font-medium"
            >
              + Thêm sản phẩm
            </button>

          </div>

          {message && (
            <div
              className={`px-3 py-2 mb-4 rounded ${
                message.startsWith("✅")
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-red-50 text-red-700 border border-red-200"
              }`}
            >
              {message}
            </div>
          )}

          {/* FILTER BAR */}
          <div className="bg-white border rounded-lg p-3 mb-3">
            <div className="flex flex-wrap items-center gap-2">
              <DropSelectParents value={parentCategory} onChange={setParentCategory} />
              <StyleSelectWithImages selected={selectedStyles} setSelected={setSelectedStyles} options={filterOptions.styles} />
              <ColorSelectWithCodes selected={selectedColors} setSelected={setSelectedColors} options={filterOptions.colors} />
              <FormSelectWithIcons selected={selectedForms} setSelected={setSelectedForms} options={filterOptions.forms} />
              <MaterialSelectWithNames selected={selectedMaterials} setSelected={setSelectedMaterials} options={filterOptions.materials} />

              <select
                value={displayHome}
                onChange={(e) => {
                  setDisplayHome(e.target.value);
                  setPage(1);
                }}
                className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-gray-800"
                title="Hiển thị Trang chủ"
              >
                <option value="">Hiển thị: Tất cả</option>
                <option value="1">Chỉ hiển thị</option>
                <option value="0">Chỉ không hiển thị</option>
              </select>

              <div className="w-full md:w-80">
                <input
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Tìm kiếm tên, ID, thuộc tính…"
                  className="mt-2 md:mt-0 h-10 w-full rounded-md border border-gray-300 px-3 text-sm outline-none focus:ring-2 focus:ring-gray-800"
                />
              </div>

              <div className="flex items-center gap-2 ml-auto">
                <select
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value);
                    setPage(1);
                  }}
                  className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-gray-800"
                >
                  <option value="default">Mặc định</option>
                  <option value="newest">Mới nhất</option>
                  <option value="oldest">Cũ nhất</option>
                  <option value="price_asc">Giá tăng dần</option>
                  <option value="price_desc">Giá giảm dần</option>
                  <option value="name_asc">Tên A-Z</option>
                  <option value="name_desc">Tên Z-A</option>
                </select>
                <button
                  onClick={resetFilters}
                  className="h-10 px-3 rounded-md border text-sm bg-white hover:bg-gray-50"
                >
                  Xóa bộ lọc
                </button>
                <button
                onClick={() => saveOrderPairs(buildOrderPairs(products))}
                disabled={savingOrder}
                className="h-10 px-3 rounded-md bg-red-600 text-white text-sm hover:bg-black"
                title="Lưu thứ tự theo thứ tự đang hiển thị"
              >
                {savingOrder ? "Đang lưu…" : "Lưu thứ tự"}
              </button>
              </div>
            </div>

            {/* Category con (level3) theo cha đã chọn */}
            <div className="mt-3">
              {!parentCategory ? (
                <div className="text-sm text-gray-500">
                  Chọn danh mục cha để hiển thị danh mục con.
                </div>
              ) : currentChildren.length === 0 ? (
                <div className="text-sm text-gray-500">
                  Danh mục này chưa có danh mục con.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {currentChildren.map((c) => {
                    const active = selectedCategories.includes(c._id);
                    return (
                      <button
                        key={c._id}
                        type="button"
                        onClick={() => {
                          setSelectedCategories((prev) => toggleInArray(prev, c._id));
                          setPage(1);
                        }}
                        className={`px-3 py-1.5 rounded-full text-sm border transition ${
                          active
                            ? "bg-gray-900 text-white border-gray-900"
                            : "bg-white text-gray-700 border-gray-300 hover:border-gray-500"
                        }`}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {(loading || fetching) && (
            <div className="mb-3 text-sm text-gray-500">Đang tải dữ liệu…</div>
          )}
          {error && <p className="text-red-600 mb-3">{error}</p>}

          {/* TABLE */}
          <div className="overflow-x-auto bg-white border rounded-lg">
            <table className="min-w-full border-collapse border border-gray-300">
              <thead className="bg-gray-100 text-gray-800">
                <tr className="text-left">
                  <th className="px-2 py-3 border border-gray-300 w-8"> {/* 🆕 */}
                    ⇅
                  </th>
                  <th className="px-3 py-3 border border-gray-300 w-20">
                    STT
                  </th>
                  <th className="px-4 py-3 border border-gray-300">Image</th>
                  <th className="px-4 py-3 border border-gray-300">Name + ID</th>
                  <th className="px-4 py-3 border border-gray-300">Price</th>
                  <th className="px-4 py-3 border border-gray-300">Size</th>
                  <th className="px-4 py-3 border border-gray-300">Style</th>
                  <th className="px-4 py-3 border border-gray-300">Form</th>
                  <th className="px-4 py-3 border border-gray-300">Material</th>
                  <th className="px-4 py-3 border border-gray-300">Color</th>
                  <th className="px-4 py-3 border border-gray-300">Description</th>
                  <th className="px-4 py-3 border border-gray-300 text-right">Actions</th>
                </tr>
              </thead>
              <DragDropContext onDragEnd={onDragEnd}>
                <Droppable droppableId="table-body">
                  {(provided) => (
                    <tbody ref={provided.innerRef} {...provided.droppableProps}>
                      {products.length === 0 && !loading ? (
                        <tr>
                          <td
                            colSpan={11} // tăng thêm 1 cột handle
                            className="text-center py-8 text-gray-500 border border-gray-300"
                          >
                            Chưa có sản phẩm nào
                          </td>
                        </tr>
                      ) : (
                        products.map((p, i) => (
                          <Draggable key={p._id} draggableId={p._id} index={i}>
                            {(prov) => (
                              <tr
                                ref={prov.innerRef}
                                {...prov.draggableProps}
                                className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}
                              >
                                {/* 🆕 cột handle để kéo */}
                                <td
                                  className="px-2 py-3 align-top border border-gray-300 cursor-grab select-none"
                                  {...prov.dragHandleProps}
                                  title="Kéo để sắp xếp"
                                >
                                  ≡
                                </td>
                                {/* 🆕 cột Order / STT */}
                                <td className="px-3 py-3 align-top border border-gray-300">
                                  <div className="text-sm font-semibold text-gray-900">
                                  </div>
                                    <div className="text-xs text-gray-500">{String(p.order)}</div>
                                  {/* Nếu object trả về dùng field khác, có thể fallback:
                                +     {"displayOrder" in p && <div className="text-xs text-gray-500">#{p.displayOrder}</div>} */}
                                </td>

                                {/* ⬇️ giữ nguyên các ô còn lại như bạn đang render */}
                                <td className="px-4 py-3 align-top border border-gray-300">
                                  {p.previewImagePath ? (
                                    <img
                                      src={imageUrl(p.previewImagePath)}
                                      alt={p.name}
                                      className="w-16 h-16 object-cover rounded-md border"
                                    />
                                  ) : (
                                    <div className="w-16 h-16 rounded-md border bg-gray-100" />
                                  )}
                                </td>
                                <td className="px-4 py-3 align-top border border-gray-300">
                                  {/* <div className="font-medium text-gray-900">{p.name}</div> */}
                                  <div className="font-medium text-gray-900">{decodeHtml(p.name)}</div>
                                  <div className="mt-1 text-xs text-gray-500">
                                    ID: {p.customId || p.sku || p._id}
                                  </div>
                                  {Array.isArray(p.categoryIds) && p.categoryIds.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {p.categoryIds.map((c, idx) => {
                                        const key =
                                          typeof c === "string" ? c : c?._id ?? `${p._id}-cat-${idx}`;
                                        return (
                                          <span
                                            key={key}
                                            className="inline-block text-xs bg-gray-200 text-gray-800 px-2 py-0.5 rounded-full"
                                          >
                                            {getName(c, categoryMap)}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-3 align-top border border-gray-300">
                                  <PriceCell price={p.price} />
                                </td>
                                <td className="px-4 py-3 align-top border border-gray-300">
                                  {bytesToMB(p.modelSize)}
                                </td>
                                <td className="px-4 py-3 align-top border border-gray-300">
                                  {getFirstStyleName(p)}
                                </td>
                                <td className="px-4 py-3 align-top border border-gray-300">
                                  <div className="flex flex-wrap">
                                    {(p.form || []).slice(0, 3).map((f, idx) => {
                                      const obj = typeof f === "string" ? formMap.get(f) : f;
                                      return (
                                        <FormIcon
                                          key={obj?._id || idx}
                                          name={obj?.name}
                                          image={obj?.image}
                                          fallback={idx}
                                          className="w-8 h-8 rounded border object-cover bg-neutral-700"
                                        />
                                      );
                                    })}
                                  </div>
                                </td>
                                <td className="px-4 py-3 align-top border border-gray-300">
                                  {getMaterialsJoined(p)}
                                </td>
                                <td className="px-4 py-3 align-top border border-gray-300">
                                  <div className="flex items-center gap-2">
                                    {((p.colors || p.color) || []).slice(0, 3).map((c, idx) => (
                                      <ColorDot key={idx} c={c} idx={idx} />
                                    ))}
                                  </div>
                                </td>
                                <td className="px-4 py-3 align-top border border-gray-300">
                                  <div className="max-w-[150px] text-sm text-gray-600 truncate">
                                    {getShortDesc(p)}
                                  </div>
                                </td>
                                <td className="px-4 py-3 align-top border border-gray-300">
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      onClick={() => setEditing({ open: true, product: p })}
                                      className="px-3 py-1.5 rounded-md bg-yellow-400 text-white hover:bg-yellow-500 text-sm font-medium"
                                    >
                                      Sửa
                                    </button>
                                    <button
                                      onClick={() => deleteProduct(p._id)}
                                      disabled={deletingId === p._id}
                                      className={`px-3 py-1.5 rounded-md text-white text-sm font-medium ${
                                        deletingId === p._id
                                          ? "bg-red-400 cursor-not-allowed"
                                          : "bg-red-600 hover:bg-red-700"
                                      }`}
                                    >
                                      {deletingId === p._id ? "Đang xoá…" : "Xóa"}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Draggable>
                        ))
                      )}
                      {provided.placeholder}
                    </tbody>
                  )}
                </Droppable>
              </DragDropContext>
            </table>
          </div>

          <div className="flex items-center gap-2">
          <div className="text-sm text-gray-600">
            Tổng: <strong>{total}</strong> sản phẩm
          </div>
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={`px-3 h-9 rounded border text-sm ${
                page <= 1 ? "text-gray-400 bg-gray-100" : "bg-white hover:bg-gray-50"
              }`}
            >
              Trước
            </button>

            <span className="text-sm">
              Trang <strong>{page}</strong> / {pages}
            </span>

            {/* 🆕 Nhập số trang và Enter để nhảy */}
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={Math.max(1, pages)}
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") jumpToPage();
                }}
                placeholder="Nhập trang…"
                className="h-9 w-28 rounded border border-gray-300 px-2 text-sm outline-none focus:ring-2 focus:ring-gray-800"
                title={`Đi tới trang (1–${pages || 1})`}
              />
              <button
                onClick={jumpToPage}
                className="h-9 px-3 rounded-md border bg-white hover:bg-gray-50 text-sm"
                title="Chuyển tới trang đã nhập"
              >
                Tới
              </button>
            </div>

            <button
              disabled={page >= pages}
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              className={`px-3 h-9 rounded border text-sm ${
                page >= pages ? "text-gray-400 bg-gray-100" : "bg-white hover:bg-gray-50"
              }`}
            >
              Sau
            </button>
          </div>

        </div>
      </main>

      {/* Modal sửa */}
      {editing?.open && (
        <EditProductModal
          open={editing.open}
          product={editing.product}
          onClose={() => setEditing(null)}
          onUpdated={(updated) => {
            setProducts((prev) =>
              prev.map((x) => (x._id === updated._id ? { ...x, ...updated } : x))
            );
            setMessage("✅ Cập nhật sản phẩm thành công");
          }}
        />
      )}

      {/* ✅ Modal tạo mới */}
      {adding && (
        <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-5xl max-h-[90vh] rounded-2xl shadow-xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="font-semibold text-lg">Thêm sản phẩm 3D</h3>
              <button
                onClick={() => setAdding(false)}
                className="px-3 py-1 rounded-md hover:bg-gray-100"
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>
            <div className="overflow-auto p-4">
              <ProductForm3dmodel
                asModal
                onClose={() => setAdding(false)}
                onCreated={(created) => {
                  setAdding(false);
                  setMessage("✅ Thêm sản phẩm thành công");
                  // ép reload danh sách
                  setReloadTick((t) => t + 1);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
