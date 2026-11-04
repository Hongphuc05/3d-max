// SDK trung tâm cho bridge 3ds Max. Component KHÔNG gọi window.chrome.webview trực tiếp — chỉ import từ đây.
// Ngoài 3ds Max (browser thường) mọi call reject với code HOST_UNSUPPORTED.

const wv = () => (typeof window !== "undefined" ? window.chrome?.webview : undefined);

export const isMaxHost = () => !!wv();

const pending = new Map(); // id -> { resolve, reject, timer }
const hostListeners = new Map(); // ten su kien -> Set<handler>
let listening = false;

function listen() {
  if (listening || !wv()) return;
  listening = true;
  wv().addEventListener("message", (e) => {
    const m = e.data;
    if (m && typeof m.event === 'string' && m.id === undefined) { // thong bao tu host, khong gan voi yeu cau nao
      for (const f of [...(hostListeners.get(m.event) || [])]) { try { f(m.data); } catch { /* handler loi khong chan cac handler khac */ } }
      return;
    }
    const p = m && pending.get(m.id);
    if (!p) return;
    if (m.type === 'asset.progress') {
      if (Number.isFinite(m.receivedBytes) && m.receivedBytes >= 0) p.onProgress?.({receivedBytes:m.receivedBytes,totalBytes:m.totalBytes});
      return;
    }
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.result);
    else p.reject(Object.assign(new Error(m.error?.message || "Bridge error"), { code: m.error?.code }));
  });
}

export function call(method, params = {}, timeoutMs = 15000, onProgress) {
  if (!wv()) {
    return Promise.reject(Object.assign(new Error("Chức năng này chỉ có trong 3ds Max"), { code: "HOST_UNSUPPORTED" }));
  }
  listen();
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Object.assign(new Error("Hết thời gian chờ 3ds Max"), { code: "TIMEOUT" }));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer, onProgress });
    wv().postMessage({ id, version: 1, method, params });
  });
}

// ticket = đoạn cuối của link /api/downloads/stream/<ticket> mà backend cấp (một lần dùng, TTL ngắn).
// Native tự dựng URL từ ApiBase đã cấu hình; web không gửi URL/đường dẫn.
// Su kien host -> web (library.updated, library.offline, library.previewProgress). Ngoai 3ds Max: khong lam gi.
export function onHostEvent(type, handler) {
  if (!wv()) return () => {};
  listen();
  if (!hostListeners.has(type)) hostListeners.set(type, new Set());
  hostListeners.get(type).add(handler);
  return () => hostListeners.get(type)?.delete(handler);
}

// v3: web chi gui UUID cua model; native tu xin phien tai tu backend (khong co ticket/URL/Drive ID o phia web).
export const importModel = (modelId, onProgress) => call("asset.import", { modelId }, 31 * 60 * 1000, onProgress);

export const getLibraryStatus = () => call('library.status', {}, 20000);
export const activateLibrary = (license) => call('library.activate', { license }, 60000);
export const refreshLibrary = () => call('library.refresh', {}, 60000);

export const importAsset = (assetId, ticket, onProgress) => call("asset.import", { assetId, ticket }, 31 * 60 * 1000, onProgress);

export const getHostInfo = () => call("host.getInfo", {}, 5000);
export const getSceneInfo = () => call("scene.getInfo", {}, 5000);

// The native key never crosses this bridge. Only public identity and scoped proof do.
export const getDeviceIdentity = () => call('device.getIdentity', {}, 30000);
export const signDeviceChallenge = (challengeId, message) => call('device.signChallenge', { challengeId, message }, 30000);
