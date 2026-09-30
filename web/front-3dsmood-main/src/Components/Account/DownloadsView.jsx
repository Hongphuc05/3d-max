import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";

export default function Downloads() {
  const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
  const ASSET_BASE = import.meta.env.VITE_ASSET_BASE_URL || API;
  const buildUrl = (path) => {
    if (!path) return "/product1-1.jpg"; // ảnh mặc định
    if (typeof path === "object") {
      console.warn("Path is an object:", path);
      return `${ASSET_BASE}${path?.path || "/product1-1.jpg"}`;
    }
    if (/^https?:\/\//i.test(path)) return path;
    return `${ASSET_BASE}/${String(path).replace(/^\/+/, "")}`;
  };
  const navigate = useNavigate();

  // ====== Điều hướng theo điều kiện category ======
  const SCENE_CATEGORY_ID = "68a55296e06aee921714659e"; // ID bạn yêu cầu
  const ROUTE_SCENE_DETAIL = "/product-detail-scenes";  // ví dụ: /scenes/:id
  const ROUTE_MODEL_DETAIL = "/product-detail";         // ví dụ: /models/:id
  function getDetailPath(itemId, isScene) {
    return `${isScene ? ROUTE_SCENE_DETAIL : ROUTE_MODEL_DETAIL}/${itemId}`;
  }
  const handleCardClick = (e, item) => {
    if (e.ctrlKey || e.metaKey) {
      // Giữ Ctrl/Cmd để chỉ chọn/bỏ chọn (không điều hướng)
      toggleSelect(item._id); // giả định đã có ở nơi khác; giữ nguyên theo code của bạn
      return;
    }
    const isScene = Array.isArray(item.categoryIds) && item.categoryIds.includes(SCENE_CATEGORY_ID);
    navigate(getDetailPath(item._id, isScene));
  };
  const readToken = () => {
    const raw = localStorage.getItem("token");
    if (!raw) return null;
    try {
      const maybeObj = JSON.parse(raw);
      return typeof maybeObj === "string" ? maybeObj : (maybeObj?.token ?? null);
    } catch {
      return raw;
    }
  };

  const toArray = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []);

  // Helpers trích xuất id/slug/name
  const pickId = (obj) => {
    if (!obj) return null;
    if (typeof obj === "string") return obj;
    return obj._id || obj.id || obj.categoryId || obj.cat || null;
  };
  const pickSlug = (obj) => {
    if (!obj || typeof obj === "string") return null;
    return obj.slug || obj.categorySlug || obj.catSlug || null;
  };
  const pickName = (obj) => (typeof obj === "string" ? obj : obj?.name || null);
  const nodeKey = (node) =>
    node?._id ? String(node._id) : node?.slug ? String(node.slug) : null;

  // -------------------- Lấy nhiều category từ sản phẩm --------------------
  const CHILD_FIELDS = [
    "category", "cat", "categoryId",
    "subCat", "subCategory",
    "sceneCategory", "sceneCategoryId", "sceneCat",
    "roomCategory", "room",
    "categories", "subCategories", "sceneCategories", "roomCategories",
  ];

  const TOP_FIELDS = [
    "topCategory", "top",
    "group", "sceneGroup",
    "parentCategory",
    "groups", "topCategories", "sceneGroups",
  ];

  const childrenFromProduct = (p) => {
    const out = [];
    for (const f of CHILD_FIELDS) out.push(...toArray(p?.[f]));
    return out.filter(Boolean);
  };

  const topsFromProduct = (p) => {
    const out = [];
    for (const f of TOP_FIELDS) out.push(...toArray(p?.[f]));
    return out.filter(Boolean);
  };

  // -------------------- Category Tree (sidebar) --------------------
  const [tree, setTree] = useState(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [errorTree, setErrorTree] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingTree(true);
        setErrorTree(null);

        // Ưu tiên route gộp
        const r1 = await fetch(`${API}/api/categories/tree/both?merge=1`, { credentials: "include" });

        let mergedChildren = [];
        if (r1.ok) {
          const data = await r1.json();
          if (Array.isArray(data?.children)) mergedChildren = data.children;
          else if (Array.isArray(data?.trees)) mergedChildren = data.trees.flatMap(t => t?.children || []);
        } else if (r1.status !== 404) {
          const txt = await r1.text().catch(() => "");
          throw new Error(txt || `HTTP ${r1.status}`);
        }

        // Fallback: 3dmodel + 3dscenes (+ số ít 3dscene)
        if (!mergedChildren.length) {
          const settled = await Promise.allSettled([
            fetch(`${API}/api/categories/tree/3dmodel`, { credentials: "include" }),
            fetch(`${API}/api/categories/tree/3dscenes`, { credentials: "include" }),
            fetch(`${API}/api/categories/tree/3dscene`, { credentials: "include" }),
          ]);
          const safe = async (s) => {
            if (s.status !== "fulfilled") return { children: [] };
            const r = s.value; if (!r.ok) return { children: [] };
            try { return await r.json(); } catch { return { children: [] }; }
          };
          const [a, b, c] = await Promise.all(settled.map(safe));
          mergedChildren = [...(a.children||[]), ...(b.children||[]), ...(c.children||[])];
        }

        if (!cancelled) setTree({ root: null, children: mergedChildren });
      } catch (e) {
        if (!cancelled) setErrorTree(e.message || "Error");
      } finally {
        if (!cancelled) setLoadingTree(false);
      }
    })();
    return () => { cancelled = true; };
  }, [API]);

  // -------------------- Sidebar UI state --------------------
  const [expanded, setExpanded] = useState(new Set());
  const [activeTop, setActiveTop] = useState(null);
  const [activeChild, setActiveChild] = useState(null);

  const toggle = (key) => {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  };

  // -------------------- Downloads data --------------------
  const [downloads, setDownloads] = useState({
    items: [],
    counts: [],      // counts của lần fetch hiện tại (KHÔNG dùng để prune)
    total: 0,
    page: 1,
    limit: 8,        // 🔹 đổi 24 -> 8
    hasMore: false,
  });
  const [sidebarCounts, setSidebarCounts] = useState([]); // ✅ GLOBAL counts để prune sidebar
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");

  const fetchDownloads = useCallback(async ({ top, cat, q, page = 1, limit = 8 }) => { // 🔹 mặc định 8
    const token = readToken();
    const params = new URLSearchParams({ page, limit });
    if (top) params.set("top", top);
    if (cat) params.set("cat", cat);
    if (q) params.set("q", q);

    const urls = [
      `${API}/api/downloads/me/downloads?${params.toString()}`,
      `${API}/api/me/downloads?${params.toString()}`,
    ];

    let lastStatus = null;
    let lastBody = "";
    for (const url of urls) {
      try {
        const r = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: "include",
        });
        lastStatus = r.status;
        if (!r.ok) {
          try { lastBody = await r.text(); } catch {}
          if (r.status === 404 || r.status === 500) continue;
          throw new Error(lastBody || `HTTP ${r.status}`);
        }
        return await r.json();
      } catch (e) {
        lastBody = String(e?.message || e);
      }
    }
    throw new Error(lastBody || `HTTP ${lastStatus || "?"}`);
  }, [API]);

  // Lần đầu: lấy TẤT CẢ purchased (không filter) + LƯU counts cho sidebar (GLOBAL)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const res = await fetchDownloads({ page: 1, limit: 8 }); // 🔹 8
        if (!cancelled) {
          setDownloads(res);
          setSidebarCounts(res.counts || []); // ✅ cố định counts dùng để prune sidebar
        }
      } catch (e) {
        if (!cancelled) setErr(e.message || "Error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Khi filter/search: chỉ cập nhật items, KHÔNG đụng sidebarCounts → sidebar không đổi
  const searchRef = useRef(null);
  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => {
      (async () => {
        try {
          setLoading(true);
          setErr(null);
          const res = await fetchDownloads({
            top: activeTop || undefined,
            cat: activeChild || undefined,
            q: q || undefined,
            page: 1,
            limit: 8, // 🔹 8
          });
          setDownloads(res); // ❌ không setSidebarCounts tại đây
        } catch (e) {
          setErr(e.message || "Error");
        } finally {
          setLoading(false);
        }
      })();
    }, 300);
    return () => clearTimeout(searchRef.current);
  }, [q, activeTop, activeChild, fetchDownloads]);

  const handlePage = async (nextPage) => {
    try {
      setLoading(true);
      const res = await fetchDownloads({
        top: activeTop || undefined,
        cat: activeChild || undefined,
        q: q || undefined,
        page: nextPage,
        limit: downloads.limit || 8, // 🔹 fallback 8
      });
      setDownloads(res); // ❌ không setSidebarCounts tại đây
    } catch (e) {
      setErr(e.message || "Error");
    } finally {
      setLoading(false);
    }
  };

  // -------------------- INDEX TREE --------------------
  const catIndex = useMemo(() => {
    const groupByKey = new Map();
    for (const g of tree?.children ?? []) {
      const gKey = nodeKey(g) || g.name;
      groupByKey.set(gKey, g);
    }
    return { groupByKey };
  }, [tree]);

  // -------------------- GLOBAL COUNTS → PRUNE SIDEBAR --------------------
  const countsByIdGlobal = useMemo(() => {
    const m = new Map();
    for (const c of sidebarCounts || []) {
      if (c?._id) m.set(String(c._id), c.count || 0);
    }
    return m;
  }, [sidebarCounts]);

  const getLeafCountGlobal = useCallback(
    (leaf) => {
      if (!leaf?._id) return 0;
      return countsByIdGlobal.get(String(leaf._id)) || 0;
    },
    [countsByIdGlobal]
  );

  const visibleGroups = useMemo(() => {
    const out = [];
    for (const [gKey, gNode] of catIndex.groupByKey.entries()) {
      const leaves = gNode.children || [];
      theKept: {
        // filter leaves theo GLOBAL counts
      }
      const keptLeaves = leaves.filter((leaf) => getLeafCountGlobal(leaf) > 0);
      const groupCount = keptLeaves.reduce((s, leaf) => s + getLeafCountGlobal(leaf), 0);

      if (groupCount > 0) {
        out.push({
          mode: "leaves",
          groupKey: gKey,
          group: gNode,
          children: keptLeaves,
          count: groupCount,
        });
      }
    }
    return out.sort((a, b) => String(a.group?.name || "").localeCompare(String(b.group?.name || "")));
  }, [catIndex, getLeafCountGlobal]);

  const totalPages = Math.max(1, Math.ceil((downloads.total || 0) / (downloads.limit || 8)));

  // ===== Helpers phân trang kiểu OrdersUsedCard =====
  const getVisiblePages = (current, total, max = 5) => {
    if (total <= max) return Array.from({ length: total }, (_, i) => i + 1);
    let start = Math.max(1, current - Math.floor(max / 2));
    let end = Math.min(total, start + max - 1);
    if (end - start + 1 < max) start = Math.max(1, end - max + 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  };
  const currentPage = downloads.page || 1;
  const visiblePages = getVisiblePages(currentPage, totalPages);

  const goToPage = (p) => {
    if (p < 1 || p > totalPages || p === currentPage || loading) return;
    handlePage(p);
  };
  // ================================================

  // -------------------- Render --------------------
  return (
    <div className="mx-auto max-w-7xl">
      <div className="rounded-2xl ">
        <div className="flex">
          {/* ---------- Sidebar ---------- */}
          <aside className="w-56 shrink-0 border-r border-[#4d4d4d] bg-black/30 font-codec">
            <div className="p-2">
              {loadingTree && <div className="text-xs text-zinc-400 px-2 py-1 font-source">Đang tải danh mục…</div>}
              {errorTree && <div className="text-xs text-red-400 px-2 py-1">{errorTree}</div>}

              {(!visibleGroups.length) && !loadingTree && (
                <div className="text-xs text-zinc-400 px-2 py-1 font-source">
                  Không có danh mục (chỉ hiển thị bậc có sản phẩm).
                </div>
              )}

              {visibleGroups.map((entry) => {
                const g = entry.group;
                const gKey = entry.groupKey;
                const keyHighlight = gKey || g.name;
                const isOpen = expanded.has(keyHighlight);
                const isActive = !activeChild && activeTop === gKey;

                return (
                  <div key={gKey} className="mb-1">
                    {/* Group row — TOGGLE chọn/bỏ chọn (sidebar KHÔNG đổi) */}
                    <button
                      onClick={() => {
                        const sameGroupSelected = activeTop === gKey && !activeChild;
                        if (sameGroupSelected) {
                          setActiveTop(null);
                          setActiveChild(null);
                        } else {
                          setActiveTop(gKey);
                          setActiveChild(null);
                          setExpanded((s) => {
                            const n = new Set(s);
                            n.add(keyHighlight);
                            return n;
                          });
                        }
                      }}
                      className={`group w-full flex items-center justify-between px-2 py-0.5 rounded-md transition bg-transparent ${
                        isActive ? "text-white" : "text-zinc-300"
                      }`}
                      title={g.name}
                    >
                      <span className="truncate">
                        {g.name}
                        <span className="ml-1 text-xs opacity-70">({entry.count})</span>
                      </span>

                      <span
                        className="ml-2 inline-flex items-center"
                        onClick={(e) => { e.stopPropagation(); toggle(keyHighlight); }}
                        title={isOpen ? "Thu gọn" : "Mở rộng"}
                      >
                        <svg viewBox="0 0 24 24" className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : "rotate-0"}`} fill="currentColor">
                          <path d="M12 15.5a1 1 0 0 1-.7-.29l-5-5a1 1 0 0 1 1.4-1.42L12 13.09l4.3-4.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-.7.29Z" />
                        </svg>
                      </span>
                    </button>

                    {/* Children: giữ nguyên, số đếm dùng GLOBAL counts */}
                    {isOpen && (
                      <ul className="pl-4 py-1 space-y-1 text-zinc-400 bg-transparent">
                        {(entry.children).map((child) => {
                          const cKey = nodeKey(child) || child.name;
                          const childActive = activeChild === cKey;
                          const cnt = getLeafCountGlobal(child) || 0;
                          return (
                            <li key={cKey}>
                              <button
                                onClick={() => {
                                  const same = activeChild === cKey;
                                  if (same) {
                                    setActiveChild(null);
                                    setActiveTop(null);
                                  } else {
                                    setActiveTop(gKey);
                                    setActiveChild(cKey);
                                  }
                                  setExpanded((s) => {
                                    const n = new Set(s);
                                    n.add(keyHighlight);
                                    return n;
                                  });
                                }}
                                className={`w-full text-left px-2 py-1 rounded bg-transparent ${childActive ? "text-white" : ""}`}
                              >
                                {child.name}
                                <span className="ml-1 text-xs opacity-70">({cnt})</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>

          {/* ---------- Main ---------- */}
          <section className="flex-1 p-2">
            {/* Search + meta */}
            <div className="mb-2 flex items-center gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tìm theo tên sản phẩm đã mua…"
                className="w-full bg-transparent border border-[#4d4d4d] rounded-xl px-3 py-2 text-sm outline-none focus:border-zinc-400"
              />
              <div className="text-xs text-zinc-400 whitespace-nowrap font-source">{downloads.total} kết quả</div>
            </div>

            {err && <div className="text-sm text-red-400">{err}</div>}

            {!loading && !err && downloads.items.length === 0 && (
              <div className="text-sm text-zinc-400 py-6 text-center font-source">
                Chưa có sản phẩm nào phù hợp bộ lọc hoặc bạn chưa mua gì.
              </div>
            )}

            {/* Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-2 font-codec">
              {downloads.items.map((p) => (
                <div
                  key={p._id}
                  className="group relative rounded-lg bg-white/5 border border-[#4d4d4d] overflow-hidden"
                  onClick={(e) => handleCardClick(e, p)}
                >
                  <img src={buildUrl(p.cover || p.image)} alt={p.name} className="w-full aspect-square object-cover" />
                </div>
              ))}
            </div>

            {/* Pagination kiểu OrdersUsedCard */}
            <div className="px-3 py-3 border-t border-[#2D2D2D] flex items-center justify-between gap-2 font-source mt-3">
              <div className="text-sm text-zinc-400">
                Trang {currentPage} / {totalPages} • Tổng sản phẩm: {new Intl.NumberFormat("vi-VN").format(downloads.total || 0)}
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1 || loading}
                  className={`text-sm px-3 py-1.5 rounded-md border font-source ${
                    currentPage <= 1 || loading
                      ? "text-zinc-500 border-[#3a3a3a] cursor-not-allowed"
                      : "text-zinc-200 border-[#4d4d4d] hover:bg-white/5 bg-black/40"
                  }`}
                >
                  Trước
                </button>

                {visiblePages.map((p) => (
                  <button
                    key={p}
                    onClick={() => goToPage(p)}
                    disabled={loading}
                    className={`text-sm px-3 py-1.5 rounded-md border ${
                      p === currentPage
                        ? "bg-white/10 text-white border-white/30"
                        : "bg-black/40 text-zinc-300 border-[#4d4d4d] hover:bg-white/5"
                    }`}
                  >
                    {p}
                  </button>
                ))}

                <button
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= totalPages || (!downloads.hasMore && currentPage === totalPages) || loading}
                  className={`text-sm px-3 py-1.5 rounded-md border font-source ${
                    currentPage >= totalPages || (!downloads.hasMore && currentPage === totalPages) || loading
                      ? "text-zinc-500 border-[#3a3a3a] cursor-not-allowed"
                      : "text-zinc-200 border-[#4d4d4d] hover:bg-white/5 bg-black/40"
                  }`}
                >
                  Sau
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
