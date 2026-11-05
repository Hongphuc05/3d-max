const IMAGE = /\.(jpe?g|png|webp)$/i;
const ARCHIVE = /(\s*\.(jpe?g|png|webp|zip|rar|7z))+\s*$/i;
const META_FILE = /^(\.DS_Store|\._.+)$/i;

const pathKey = (value) => String(value ?? '').normalize('NFC').split('/').map((part) => part.trim().replace(/\s+/g, ' ').toLowerCase()).join('/');

export function buildAdminCategoryTree(items = []) {
  const nodes = new Map(items.map((item) => [item.id, { ...item, children: [], count: Number(item.modelCount) || 0 }]));
  const roots = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(node.parentId);
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (list) => list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const aggregate = (node) => {
    sort(node.children);
    node.count = (Number(node.modelCount) || 0) + node.children.reduce((sum, child) => sum + aggregate(child), 0);
    return node.count;
  };
  sort(roots);
  roots.forEach(aggregate);
  return roots;
}

/** Validate the whole selected directory before sending any image to the server. */
export function validatePreviewFolder(files, categories, { maxBytes = 15 * 1024 * 1024 } = {}) {
  const items = [];
  const errors = [];
  const ignored = [];
  const known = new Map();
  for (const category of categories ?? []) {
    const segments = String(category.fullPath ?? '').split(' / ');
    // The source folder is root category / subcategory / image.
    if (segments.length === 2) known.set(pathKey(segments.join('/')), segments.join('/'));
  }
  const stems = new Map();

  if (!files?.length) return { items, errors: ['Folder không có file nào.'], ignored };
  if (known.size === 0) return { items, errors: ['Chưa có cây danh mục để đối chiếu. Hãy quét đồng bộ Drive trước.'], ignored };

  for (const file of files) {
    const relative = String(file.webkitRelativePath ?? '');
    const parts = relative.split('/');
    if (META_FILE.test(file.name)) { ignored.push(relative || file.name); continue; }
    if (parts.length !== 4 || parts.some((part) => !part || part === '.' || part === '..' || /[\\\u0000-\u001f\u007f]/.test(part))) {
      errors.push(`${relative || file.name}: cần cấu trúc 3dsmood/Danh mục/Con/ảnh.jpg`);
      continue;
    }
    if (pathKey(parts[0]) !== '3dsmood') {
      errors.push(`${relative}: thư mục gốc phải tên là 3dsmood`);
      continue;
    }
    if (!IMAGE.test(file.name)) {
      errors.push(`${relative}: chỉ nhận JPG, JPEG, PNG hoặc WEBP`);
      continue;
    }
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > maxBytes) {
      errors.push(`${relative}: ảnh phải lớn hơn 0 và không vượt quá 15 MB`);
      continue;
    }
    const rawCategory = parts.slice(1, 3).join('/');
    const category = known.get(pathKey(rawCategory));
    if (!category) {
      errors.push(`${relative}: danh mục “${rawCategory.replace('/', ' / ')}” không có trong cây danh mục hiện tại`);
      continue;
    }

    const stem = file.name.normalize('NFC').replace(ARCHIVE, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!stem) {
      errors.push(`${relative}: tên ảnh không hợp lệ`);
      continue;
    }
    const previous = stems.get(stem);
    if (previous) {
      errors.push(`${relative}: trùng tên chuẩn hóa với ${previous}; không thể ghép ảnh duy nhất theo tên`);
      continue;
    }
    stems.set(stem, relative);
    items.push({ file, category });
  }

  if (items.length === 0 && errors.length === 0) errors.push('Folder không có ảnh hợp lệ để tải lên.');
  return { items: errors.length ? [] : items, errors, ignored };
}
