// CHI DUNG KHI DEV: mo http://localhost:5173/?mockMax=1 de xem giao dien nhu dang chay trong 3ds Max
// Gia lap license/catalog/import qua bridge.js; du lieu mau chi ton tai trong DEV.
// Khong co trong ban build production (main.jsx chi import khi import.meta.env.DEV).
export function installMockHost() {
  const listeners = new Set();
  let objects = 0;
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
          return params.license === 'demo' ? ok({ machineCode: 'DEMO-MACHINE-NOT-A-REAL-CODE', allModels: true })
            : fail('LIBRARY_INVALID', 'Bản demo: nhập demo để thử giao diện.');
        case 'library.refresh':
          return ok({ items: [{ id: 'demo-chair', name: 'Ghế minh họa (DEV)', category: 'Demo' }], offline: false,
            message: 'Dữ liệu minh họa DEV; không phải model thật từ Drive.' });
        case 'host.getInfo':
          return ok({ host: '3dsmax', hostVersion: '3ds Max (mock)', pluginVersion: '0.0.0-mock', protocolVersion: 1 });
        case 'scene.getInfo':
          return ok({ objects, selected: 0, units: 'cm', renderer: 'Corona (mock)' });
        case 'asset.import': {
          const d = 2000 + Math.random() * 3000;
          if (Math.random() < 0.25) return fail('ASSET_DOWNLOAD_FAILED', '(mock) Không tải được gói từ backend', d);
          objects += 5;
          return ok({ imported: 5, file: 'mock.max' }, d);
        }
        default:
          return fail('UNKNOWN_METHOD', 'Method not allowed: ' + method);
      }
    },
  };
  console.info('[mockMax] dang gia lap host 3ds Max');
}
