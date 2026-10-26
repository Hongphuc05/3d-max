export const subKey = (category, subcategory) => `${category}/${subcategory}`;
export const categoryKey = (category, parent = '') => category.path || category.id || (parent ? subKey(parent, category.name) : category.name);
export function categoryKeys(category, parent = '') {
  const key = categoryKey(category, parent);
  return [key, ...(category.children || []).flatMap(child => categoryKeys(child, key))];
}

export function matchesCategory(product, selected) {
  if (!selected.size) return true;
  const path = product.categoryPath || product.folderPath;
  const ancestors = path ? path.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/')) : [];
  const keys = [...(product.folderIds || [product.folderId, product.category, subKey(product.category, product.subcategory)]), ...ancestors];
  return keys.some(key => selected.has(key));
}

export function downloadedProducts(products, jobs) {
  return jobs.filter(job => job.status === 'done').map(job =>
    products.find(product => product.id === job.product?.id || product.slug === job.slug) || job.product).filter(Boolean);
}

export function catalogMessage(status) {
  if (!status) return '';
  const error = typeof status.error === 'object' ? status.error?.code : status.error;
  if (error) {
    if (/CONFIG|KEY_REQUIRED/.test(error)) return 'Cloudflare R2 chưa được cấu hình đầy đủ trên backend. My License vẫn dùng được.';
    return status.lastSuccessfulSync
      ? 'Đồng bộ Cloudflare R2 gặp lỗi. Đang hiển thị catalog từ lần đồng bộ thành công gần nhất.'
      : 'Không truy cập được Cloudflare R2. Kiểm tra trạng thái đồng bộ trên backend; My License vẫn dùng được.';
  }
  if (status.syncing || status.state === 'syncing') return 'Đang đồng bộ Cloudflare R2… Catalog thành công gần nhất vẫn có thể sử dụng.';
  if (['not_synced', 'pending', 'uninitialized', 'never_synced'].includes(status.state)) return 'Chưa đồng bộ catalog Cloudflare R2 lần đầu.';
  if (status.state === 'configuration_required') return 'Cloudflare R2 chưa được cấu hình đầy đủ trên backend. My License vẫn dùng được.';
  if (status.state === 'empty') return 'Catalog Cloudflare R2 đã đồng bộ thành công và hiện đang trống.';
  if (status.state === 'error') return 'Không truy cập được Cloudflare R2. Kiểm tra trạng thái đồng bộ trên backend.';
  return '';
}
