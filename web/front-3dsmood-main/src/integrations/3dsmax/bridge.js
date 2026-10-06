// SDK trung tâm cho bridge 3ds Max. Component KHÔNG gọi window.chrome.webview trực tiếp — chỉ import từ đây.
// Ngoài 3ds Max (browser thường) mọi call reject với code HOST_UNSUPPORTED.

const wv = () => (typeof window !== "undefined" ? window.chrome?.webview : undefined);

export const isMaxHost = () => !!wv();

const pending = new Map(); // id -> { resolve, reject, timer }
let listening = false;

function listen() {
  if (listening || !wv()) return;
  listening = true;
  wv().addEventListener("message", (e) => {
    const m = e.data;
    const p = m && pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.result);
    else p.reject(Object.assign(new Error(m.error?.message || "Bridge error"), { code: m.error?.code }));
  });
}

export function call(method, params = {}, timeoutMs = 15000) {
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
    pending.set(id, { resolve, reject, timer });
    wv().postMessage({ id, version: 1, method, params });
  });
}

// ticket = đoạn cuối của link /api/downloads/stream/<ticket> mà backend cấp (một lần dùng, TTL ngắn).
// Native tự dựng URL từ ApiBase đã cấu hình; web không gửi URL/đường dẫn.
export const importAsset = (assetId, ticket) => call("asset.import", { assetId, ticket }, 10 * 60 * 1000);
