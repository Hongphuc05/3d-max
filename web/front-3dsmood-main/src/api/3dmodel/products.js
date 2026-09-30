// src/api/products.js
import http, { sendBeaconJson } from "./http";

/** Danh sách sản phẩm có filter server-side */
export const listProducts = async (params) => {
  const { data } = await http.get("/api/products", { params });
  const items = data?.items ?? data?.data ?? [];
  const total = Number(data?.total ?? 0);
  return { items, total };
};

/** Thêm vào giỏ hàng */
export const addToCart = async (productId, quantity = 1) => {
  const { data } = await http.post("/api/cart/add", { productId, quantity });
  return data; // kỳ vọng {ok, alreadyPurchased?, message?}
};

/** Lấy danh sách sản phẩm yêu thích của user */
export const getFavorites = async () => {
  const { data } = await http.get("/api/product-detail/favorites");
  return Array.isArray(data) ? data : [];
};

/** Kiểm tra đã mua theo lô id */
export const checkOwned = async (ids) => {
  if (!ids?.length) return { ownedIds: [] };
  const { data } = await http.post("/api/products/owned", { ids });
  return { ownedIds: data?.ownedIds?.map(String) ?? [] };
};

/** Ghi nhận lượt xem sản phẩm (không chặn UI) */
export const recordView = (productId) => {
  if (!productId) return false;
  return sendBeaconJson(`/api/products/${productId}/view`, {});
};
