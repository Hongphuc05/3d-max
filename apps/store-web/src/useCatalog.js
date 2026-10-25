import { useEffect, useState } from 'react';
import { getAllProducts, getCatalogVersion, getCategories } from './api.js';
import { watchCatalog } from './catalog-refresh.js';

export function useCatalog(reloadKey) {
  const [snapshot, setSnapshot] = useState({ products: [], categories: [] });
  const [status, setStatus] = useState(null);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  useEffect(() => watchCatalog({
    fetchVersion: getCatalogVersion,
    fetchSnapshot: async signal => {
      const [categories, products] = await Promise.all([getCategories(signal), getAllProducts(signal)]);
      return { categories, products };
    },
    onStatus: value => { setStatus(value); setError(''); },
    onSnapshot: value => { setSnapshot(value); setError(''); setState('ready'); },
    onError: failure => {
      setError(failure.code === 'CATALOG_UNAVAILABLE'
        ? 'Catalog chưa sẵn sàng. Kiểm tra cấu hình nguồn catalog trên backend. My License vẫn dùng được.'
        : 'Không cập nhật được catalog. Hãy kiểm tra kết nối backend và database.');
      setState(previous => previous === 'loading' ? 'error' : previous);
    },
  }), [reloadKey]);
  return { ...snapshot, status, state, error };
}
