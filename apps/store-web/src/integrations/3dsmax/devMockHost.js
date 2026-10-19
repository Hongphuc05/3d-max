// CHI DUNG KHI DEV: mo http://localhost:5173/?mockMax=1 de xem giao dien nhu dang chay trong 3ds Max
// (nut Download, hang doi, thanh trang thai) ngay tren trinh duyet. Gia lap window.chrome.webview nen
// di qua dung code bridge.js that. Ticket van xin tu backend that (can dang nhap), chi buoc tai/import la gia.
// Khong co trong ban build production (main.jsx chi import khi import.meta.env.DEV).
export function installMockHost() {
  const listeners = new Set();
  let objects = 0;
  const send = (data, delay) => setTimeout(() => listeners.forEach((f) => f({ data })), delay);

  window.chrome = window.chrome || {};
  window.chrome.webview = {
    addEventListener: (type, f) => type === 'message' && listeners.add(f),
    postMessage({ id, method }) {
      const ok = (result, delay = 120) => send({ id, ok: true, result }, delay);
      const fail = (code, message, delay = 120) => send({ id, ok: false, error: { code, message } }, delay);
      switch (method) {
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
