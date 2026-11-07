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
  const keys = [...(product.categoryIds || []), ...(product.folderIds || [product.folderId, product.category, subKey(product.category, product.subcategory)]), ...ancestors];
  return keys.some(key => selected.has(key));
}
