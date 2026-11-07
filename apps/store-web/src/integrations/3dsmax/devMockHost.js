// CHI DUNG KHI DEV: mo http://localhost:5173/?mockMax=1 de xem giao dien nhu dang chay trong 3ds Max
// Gia lap license/catalog/import qua bridge.js; du lieu mau chi ton tai trong DEV.
// Khong co trong ban build production (main.jsx chi import khi import.meta.env.DEV).
export function installMockHost() {
  const listeners = new Set();
  let objects = 0;
  let models = JSON.parse(localStorage.getItem('3dsmood.mock.downloads') || '[]');
  let downloadDirectory = localStorage.getItem('3dsmood.mock.directory') || 'D:\\3DS Mood';
  let sceneDownloadDirectory = localStorage.getItem('3dsmood.mock.sceneDirectory') || 'D:\\3DS Mood\\Scenes';
  const send = (data, delay) => setTimeout(() => listeners.forEach((f) => f({ data })), delay);

  window.chrome = window.chrome || {};
  window.chrome.webview = {
    addEventListener: (type, f) => type === 'message' && listeners.add(f),
    postMessage({ id, method, params }) {
      const ok = (result, delay = 120) => send({ id, ok: true, result }, delay);
      const fail = (code, message, delay = 120) => send({ id, ok: false, error: { code, message } }, delay);
      switch (method) {
        case 'library.status':
          return ok({ machineCode: 'DEMO-MACHINE-NOT-A-REAL-CODE', licensed: false });
        case 'library.activate':
          return params.license === 'demo' ? ok({ machineCode: 'DEMO-MACHINE-NOT-A-REAL-CODE', licensed: true })
            : fail('LICENSE_INVALID', 'Bản demo: nhập demo để thử giao diện.');
        case 'library.refresh':
          return ok({ items: [{ id: 'demo-chair', name: 'Ghế minh họa (DEV)', category: 'Demo' }], offline: false,
            message: 'Dữ liệu minh họa DEV; không phải model thật từ Drive.' });
        case 'library.downloads': return ok({ models });
        case 'library.importOptions':
          if (!models.some(m => m.modelId === params.modelId)) return fail('MODEL_NOT_DOWNLOADED', 'Model chưa có trên máy.');
          return ok({ options: [{ optionId: 'a'.repeat(64), label: 'model.max', relativePath: 'model.max', format: 'max' }] });
        case 'library.settings': return ok({ downloadDirectory, sceneDownloadDirectory });
        case 'library.chooseDownloadDirectory':
          if (params.contentDomain === '3dscenes') {
            sceneDownloadDirectory = 'E:\\Scenes';
            localStorage.setItem('3dsmood.mock.sceneDirectory', sceneDownloadDirectory);
          } else {
            downloadDirectory = 'E:\\3DS Mood';
            localStorage.setItem('3dsmood.mock.directory', downloadDirectory);
          }
          return ok({ downloadDirectory, sceneDownloadDirectory });
        case 'host.getInfo':
          return ok({ host: '3dsmax', hostVersion: '3ds Max (mock)', pluginVersion: '0.0.0-mock', protocolVersion: 1 });
        case 'scene.getInfo':
          return ok({ objects, selected: 0, units: 'cm', renderer: 'Corona (mock)' });
        case 'asset.download': {
          const record = { modelId: params.modelId, name: 'Model minh họa (DEV)', downloadedAt: new Date().toISOString() };
          models = [...models.filter(m => m.modelId !== record.modelId), record];
          localStorage.setItem('3dsmood.mock.downloads', JSON.stringify(models));
          send({ event: 'library.downloadsChanged', data: {} }, 900);
          return ok(record, 900);
        }
        case 'asset.import': {
          if (!models.some(m => m.modelId === params.modelId)) return fail('MODEL_NOT_DOWNLOADED', 'Model chưa có trên máy.');
          if (params.optionId !== 'a'.repeat(64)) return fail('IMPORT_OPTION_INVALID', 'File đã chọn không còn hợp lệ.');
          objects += 5;
          return ok({ imported: 5, file: 'mock.max' }, 120);
        }
        default:
          return fail('UNKNOWN_METHOD', 'Method not allowed: ' + method);
      }
    },
  };
  console.info('[mockMax] dang gia lap host 3ds Max');
}
