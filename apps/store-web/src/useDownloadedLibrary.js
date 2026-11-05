import { useEffect, useState } from 'react';
import { getDownloadedModels, isMaxHost, onHostEvent } from './integrations/3dsmax/bridge.js';

// The native index is the source of truth, including after restarting the panel.
export function useDownloadedLibrary(reloadKey, completed) {
  const [models, setModels] = useState([]);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => onHostEvent('library.downloadsChanged', () => setTick(n => n + 1)), []);
  useEffect(() => {
    if (!isMaxHost()) return;
    let active = true;
    getDownloadedModels().then(result => {
      if (!active) return;
      setModels(Array.isArray(result?.models) ? result.models : []);
      setError('');
    }, () => { if (active) setError('Không đọc được danh sách đã tải. Bấm Làm mới để thử lại.'); });
    return () => { active = false; };
  }, [reloadKey, completed, tick]);
  return { models, error };
}

export function downloadedProducts(models, products) {
  const catalog = new Map(products.map(p => [p.id, p]));
  return models.map(model => {
    const modelId = model.modelId;
    const current = catalog.get(modelId);
    return current || model.product || {
      id: modelId, slug: modelId, name: model.name || modelId,
      category: model.category || 'Đã tải', subcategory: model.category || '',
      folderPath: model.folderPath || '', folderIds: [],
      thumb: model.thumb || (model.thumbSha256 ? `/previews/${model.thumbSha256}.webp` : null),
      image: model.thumb || (model.thumbSha256 ? `/previews/${model.thumbSha256}.webp` : null),
      info: { sizeMB: model.sizeBytes ? model.sizeBytes / 1048576 : null, renderers: [], formats: model.fileType ? [model.fileType] : [] },
    };
  });
}
