export const subKey = (category, subcategory) => `${category}/${subcategory}`;
export const categoryKey = (category, parent = '') => category.id || (parent ? subKey(parent, category.name) : category.name);
export function categoryKeys(category, parent = '') {
  const key = categoryKey(category, parent);
  return [key, ...(category.children || []).flatMap(child => categoryKeys(child, key))];
}

export function matchesCategory(product, selected) {
  if (!selected.size) return true;
  const keys = product.folderIds || [product.folderId, product.category, subKey(product.category, product.subcategory)];
  return keys.some(key => selected.has(key));
}

export function downloadedProducts(products, jobs) {
  return jobs.filter(job => job.status === 'done').map(job =>
    products.find(product => product.id === job.product?.id || product.slug === job.slug) || job.product).filter(Boolean);
}

export function catalogMessage(status) {
  if (!status) return '';
  if (status.error === 'DRIVE_AUTOMATED_REQUESTS_BLOCKED') return 'Google tạm chặn yêu cầu tự động từ mạng máy chủ. Catalog cũ được giữ lại; backend sẽ thử lại theo lịch đồng bộ.';
  if (status.error === 'GOOGLE_DRIVE_API_DISABLED') return 'Google Drive API chưa được bật trong Google Cloud project. My License vẫn dùng được.';
  if (status.error === 'GOOGLE_DRIVE_API_KEY_RESTRICTED') return 'API Key đang bị giới hạn, chưa cho phép backend gọi Google Drive API. My License vẫn dùng được.';
  const error = typeof status.error === 'object' ? status.error?.code : status.error;
  if (error) {
    if (/CONFIG|API_KEY|KEY_REQUIRED/.test(error)) return 'Google Drive chưa được cấu hình API Key trên backend. My License vẫn dùng được.';
    return status.lastSuccessfulSync
      ? 'Đồng bộ Google Drive gặp lỗi. Đang hiển thị catalog từ lần đồng bộ thành công gần nhất.'
      : 'Không truy cập được Google Drive. Backend sẽ thử đồng bộ lại; My License vẫn dùng được.';
  }
  if (status.syncing || status.state === 'syncing') return 'Đang đồng bộ Google Drive… Catalog thành công gần nhất vẫn có thể sử dụng.';
  if (['not_synced', 'pending', 'uninitialized', 'never_synced'].includes(status.state)) return 'Chưa đồng bộ catalog Google Drive lần đầu.';
  if (status.state === 'configuration_required') return 'Google Drive chưa được cấu hình API Key trên backend. My License vẫn dùng được.';
  if (status.state === 'empty') return 'Catalog Google Drive đã đồng bộ thành công và hiện đang trống.';
  if (status.state === 'error') return 'Không truy cập được Google Drive. Backend sẽ thử đồng bộ lại.';
  return '';
}
