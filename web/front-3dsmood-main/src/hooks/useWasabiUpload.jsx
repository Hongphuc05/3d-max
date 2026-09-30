// src/hooks/useWasabiUpload.js
export async function uploadFileToWasabiMultipart(file, {
    baseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000",
    partSize = 16 * 1024 * 1024,
    concurrency = 8,
    onProgress = () => {},
    signal,
  } = {}) {
    const initRes = await fetch(`${baseUrl}/api/uploads/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream" }),
      signal,
    }).then(r => r.json());
    if (!initRes.uploadId) throw new Error("init failed");
    const { key, uploadId } = initRes;
  
    const total = file.size;
    const parts = [];
    let partNo = 1;
    for (let start = 0; start < total; start += partSize) {
      const end = Math.min(start + partSize, total);
      parts.push({ PartNumber: partNo++, start, end, ETag: null });
    }
  
    const urlRes = await fetch(`${baseUrl}/api/uploads/parts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, uploadId, partNumbers: parts.map(p => p.PartNumber) }),
      signal,
    }).then(r => r.json());
    const urlMap = new Map(urlRes.urls.map(u => [u.partNumber, u.url]));
  
    let uploaded = 0;
    const queue = [...parts];
  
    async function worker() {
      while (queue.length && !signal?.aborted) {
        const p = queue.shift();
        const blob = file.slice(p.start, p.end);
        const resp = await fetch(urlMap.get(p.PartNumber), {
          method: "PUT",
          headers: { "Content-Length": String(blob.size) },
          body: blob,
          signal,
        });
        if (!resp.ok) throw new Error(`Upload part ${p.PartNumber} failed`);
        p.ETag = (resp.headers.get("ETag") || "").replace(/"/g, "");
        uploaded += blob.size;
        onProgress(uploaded, total);
      }
    }
  
    await Promise.all(Array.from({ length: concurrency }, worker));
  
    const completeRes = await fetch(`${baseUrl}/api/uploads/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, uploadId, parts }),
      signal,
    }).then(r => r.json());
  
    if (!completeRes.ok) throw new Error("complete failed");
  
    return { key: completeRes.key, url: completeRes.url, etag: completeRes.etag, size: completeRes.size };
  }
  