import { useSyncExternalStore } from 'react';
import { getImportOptions, importModel } from './integrations/3dsmax/bridge.js';
let imports = [];
const subscribers = new Set();
const update = (modelId, change) => {
  imports = [...imports.filter(item => item.modelId !== modelId), { modelId, ...change }];
  subscribers.forEach(notify => notify());
};
export const getImports = () => imports;
export const useImports = () => useSyncExternalStore(notify => { subscribers.add(notify); return () => subscribers.delete(notify); }, getImports);
const busy = item => item && ['loading-options', 'choosing', 'running'].includes(item.status);
const failure = (modelId, error) => update(modelId, { status: 'failed', error: error.message || 'Không import được model đã tải.' });
async function runImport(modelId, optionId) {
  update(modelId, { status: 'running', error: '' });
  try {
    await importModel(modelId, optionId);
    update(modelId, { status: 'done', finishedAt: Date.now(), error: '' });
  } catch (error) { failure(modelId, error); }
}
// Native owns file paths; the UI only chooses an opaque candidate ID.
export async function importDownloaded(modelId) {
  if (busy(imports.find(item => item.modelId === modelId))) return;
  update(modelId, { status: 'loading-options', error: '' });
  try {
    const result = await getImportOptions(modelId), options = result?.options;
    if (!Array.isArray(options) || options.some(option => !/^[a-f0-9]{64}$/i.test(option.optionId || '') || typeof option.relativePath !== 'string' || typeof option.label !== 'string')) throw new Error('Danh sách file import không hợp lệ. Đóng hộp chọn và thử lại.');
    if (!options.length) throw new Error('Không còn file import phù hợp trong model đã tải. Không tải lại tự động.');
    if (options.length === 1) return await runImport(modelId, options[0].optionId);
    update(modelId, { status: 'choosing', error: '', options, defaultOptionId: result.defaultOptionId });
  } catch (error) { failure(modelId, error); }
}
export async function confirmImport(modelId, optionId) {
  const current = imports.find(item => item.modelId === modelId);
  if (current?.status !== 'choosing') return;
  if (!current.options.some(option => option.optionId === optionId)) { failure(modelId, new Error('File đã chọn không hợp lệ. Hãy mở lại danh sách file.')); return; }
  await runImport(modelId, optionId);
}
export function cancelImport(modelId) {
  if (imports.find(item => item.modelId === modelId)?.status === 'choosing') update(modelId, { status: 'idle', error: '' });
}
