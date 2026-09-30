import axios from "axios";
const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

const authHeaders = () => {
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export async function fetchCollections(productId) {
  const res = await axios.get(`${API}/api/collections`, {
    params: productId ? { productId } : {},
    headers: authHeaders(),
  });
  return res.data.collections || [];
}

export async function createCollection(name) {
  const res = await axios.post(
    `${API}/api/collections`,
    { name },
    { headers: authHeaders() }
  );
  return res.data.collection;
}

export async function addItemToCollection(collectionId, productId) {
  const res = await axios.post(
    `${API}/api/collections/${collectionId}/items`,
    { productId },
    { headers: authHeaders() }
  );
  return res.data;
}
export async function getCollectionItems(collectionId, { skip = 0, limit = 200 } = {}) {
    const res = await axios.get(`${API}/api/collections/${collectionId}/items`, {
      params: { skip, limit },
      headers: authHeaders(),
    });
    return res.data; // { total, items }
  }
  
  // Map Product -> cấu trúc DownloadPopup cần
  export function mapProductsToDownloadItems(items = []) {
    return items.map((p) => ({
      id: p._id || p.id,
      name: p.name || p.title || "Untitled",
      image: Array.isArray(p.images) ? p.images[0] : (p.image || p.previewImagePath || ""),
      previewImagePath: p.previewImagePath,
      price: Number(p.price || 0),
      categoryId: p.categoryId || (p.category?._id ?? null),
    }));
  }