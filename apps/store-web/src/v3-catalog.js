// P4.4: bien catalog v3 (GET /api/v1/catalog + categories + previews/manifest) thanh dang ma cac component UI-1 da dung
// (id, name, info, thumb/image, folderIds...) va cay danh muc {id,name,count,children}. Ham thuan, khong goi mang.
const MB = 1024 * 1024;
export const previewUrl = (sha256, contentDomain) => "/previews/" + (contentDomain ? contentDomain + "/" : "") + sha256 + ".webp";

const manifestPreviewUrl = (preview) => /^\/previews\/(?:3dmodels\/|3dscenes\/)?[a-f0-9]{64}\.webp$/i.test(preview.url || "")
  ? preview.url : previewUrl(preview.sha256, preview.contentDomain);

export function buildCategoryTree(categories, products) {
  const byId = new Map((categories || []).map((c) => [c.id, { id: c.id, name: c.name, contentDomain: c.contentDomain || "3dmodels", count: c.subtreeModelCount ?? c.modelCount ?? 0, parentId: c.parentId ?? null, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parentId && byId.get(node.parentId);
    // cha khong ton tai hoac tu tro ve minh -> dua len goc, khong mat danh muc
    if (parent && parent !== node) parent.children.push(node); else roots.push(node);
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  const sortTree = (list) => { list.sort(byName); list.forEach((n) => sortTree(n.children)); return list; };
  // chu trinh (A cha cua B, B cha cua A) khong co goc -> khong node nao duoc dua len goc; vot not de van hien thi
  const reachable = new Set();
  const walk = (n) => { if (reachable.has(n.id)) return; reachable.add(n.id); n.children.forEach(walk); };
  roots.forEach(walk);
  for (const node of byId.values()) {
    if (reachable.has(node.id)) continue;
    const parent = byId.get(node.parentId);
    if (parent) parent.children = parent.children.filter((c) => c !== node); // cat vong: node nay tro thanh goc
    roots.push(node); walk(node);
  }
  if (products) for (const node of byId.values()) node.count = products.filter(p => p.folderIds.includes(node.id)).length;
  return sortTree(roots);
}

function ancestorsOf(id, byId) {
  const ids = []; const seen = new Set();
  for (let c = byId.get(id); c && !seen.has(c.id); c = c.parentId ? byId.get(c.parentId) : null) { seen.add(c.id); ids.push(c.id); }
  return ids;
}

export function buildCatalog({ catalog, categories, manifest }) {
  const cats = new Map((categories || []).map((c) => [c.id, c]));
  const previews = new Map();
  for (const p of manifest?.previews || []) previews.set(`${p.modelId}|${p.variant}`, p);
  const products = (catalog?.models || []).filter((m) => m.status === 'PUBLISHED').map((m) => {
    const cat = cats.get(m.categoryId);
    const sm = previews.get(`${m.id}|sm`), lg = previews.get(`${m.id}|lg`);
    const thumb = sm || lg, image = lg || sm;
    return {
      id: m.id, slug: m.id, name: m.name, contentDomain: m.contentDomain || "3dmodels",
      categoryId: m.categoryId, categoryIds: [...new Set([m.categoryId, ...(m.categoryIds || [])].filter(Boolean))],
      category: cat ? (cat.fullPath || cat.name).split(' / ')[0] : 'Khác', subcategory: cat?.name ?? '',
      folderPath: cat?.fullPath ?? '', folderIds: [...new Set([m.categoryId, ...(m.categoryIds || [])].flatMap(id => ancestorsOf(id, cats)))],
      thumb: thumb ? manifestPreviewUrl(thumb) : null, image: image ? manifestPreviewUrl(image) : null,
      info: { sizeMB: Number.isFinite(m.sizeBytes) ? Math.max(0.1, Math.round((m.sizeBytes / MB) * 10) / 10) : null, renderers: [], formats: m.fileType ? [m.fileType] : [], hasTextures: false },
      // Ngay sua file tren Drive (ISO) de sap xep Moi nhat/Cu nhat; null neu may chu chua gui.
      modifiedAt: Number.isFinite(Date.parse(m.modifiedAt)) ? m.modifiedAt : null,
      downloadable: true, status: 'ready',
    };
  });
  return { products, tree: buildCategoryTree(categories, products) };
}

// Quyen (D28.1): mot license ca thu vien cho thiet bi (allModels). `null`/undefined = chua biet.
export const owns = (entitlements) => Boolean(entitlements?.allModels);

/** Trang thai nut hanh dong cua mot model (thuan; component chi ve theo ket qua).
 * entitlements: undefined = dang tai, null = khong xac minh duoc, object = quyen cua thiet bi nay. "owned" = owns(entitlements, id). */
export function actionState({ max, entitlements, owned, offline, job }) {
  if (!max) return { kind: 'view', label: 'Trong plugin 3ds Max', disabled: true };
  if (job?.status === 'queued') return { kind: 'queued', label: 'Trong hàng đợi', disabled: true };
  if (job?.status === 'running') return { kind: 'running', label: 'Đang tải…', disabled: true };
  if (entitlements === undefined) return { kind: 'wait', label: 'Đang xác minh quyền…', disabled: true };
  if (entitlements === null) return { kind: 'wait', label: offline ? 'Cần Internet để xác minh quyền' : 'Chưa xác minh được quyền', disabled: true };
  if (!owned) return { kind: 'locked', label: '🔒 Cần license thư viện', disabled: true };
  if (job?.status === 'failed') return { kind: 'failed', label: 'Lỗi · Thử lại', disabled: false };
  if (job?.status === 'done') return { kind: 'done', label: 'Đã tải · Xem', disabled: false };
  if (offline) return { kind: 'offline', label: 'Cần Internet để tải', disabled: true };
  return { kind: 'download', label: 'Download', disabled: false };
}
