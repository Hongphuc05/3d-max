// src/api/http.js
import axios from "axios";

export const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
export const ASSET_BASE = import.meta.env.VITE_ASSET_BASE_URL || API_BASE;

/** Đọc token từ localStorage (hỗ trợ dạng string hoặc JSON) */
export function readToken() {
  try {
    const raw = localStorage.getItem("token");
    if (!raw) return null;
    const maybe = JSON.parse(raw);
    return typeof maybe === "string" ? maybe : (maybe?.token ?? raw);
  } catch {
    return localStorage.getItem("token");
  }
}

/** Axios instance dùng chung cho toàn app */
const http = axios.create({
  baseURL: API_BASE,
  withCredentials: false,
  timeout: 20000,
});

/** Gắn Authorization nếu có token */
http.interceptors.request.use((config) => {
  const token = readToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Helper build URL ảnh/tệp tĩnh */
export const buildUrl = (path) => {
  if (!path) return "/product1-1.jpg";
  if (/^https?:\/\//i.test(path)) return path;
  return `${ASSET_BASE}/${String(path).replace(/^\/+/, "")}`;
};

/** Gửi POST nhẹ qua sendBeacon (fallback fetch keepalive) */
export function sendBeaconJson(urlPath, payload = {}) {
  const url = urlPath.startsWith("http")
    ? urlPath
    : `${API_BASE}${urlPath.startsWith("/") ? urlPath : `/${urlPath}`}`;
  try {
    if (navigator?.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      navigator.sendBeacon(url, blob);
      return true;
    }
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify(payload),
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export default http;
