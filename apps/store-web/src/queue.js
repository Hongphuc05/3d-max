// Hang doi Download (trong 3ds Max): moi san pham 1 job. Download = xin ticket -> host tai goi -> import vao scene.
// ponytail: chay tuan tu 1 job/lan, chi luu trong RAM cua trang (F5 la mat), khong co % tien do vi native chua
// gui event tien do. Nang cap: xem docs/download-queue-plan.md (native gui event, chay song song, huy, nho lich su).
import { useSyncExternalStore } from 'react';
import { importTicket } from './api.js';
import { importAsset } from './integrations/3dsmax/bridge.js';

let jobs = []; // [{ slug, name, sizeMB, status: queued|running|done|failed, error, startedAt, finishedAt, result }]
const subs = new Set();
const update = (next) => { jobs = next; subs.forEach((f) => f()); };
const patch = (slug, p) => update(jobs.map((j) => (j.slug === slug ? { ...j, ...p } : j)));

const MESSAGES = {
  UNAUTHENTICATED: 'Phiên đăng nhập đã hết, hãy đăng nhập lại.',
  NOT_FOUND: 'Sản phẩm không còn tồn tại.',
  TIMEOUT: 'Quá thời gian chờ 3ds Max.',
  HOST_UNSUPPORTED: 'Chỉ tải được trong plugin 3ds Max.',
  MODEL_DOWNLOAD_RESTRICTED: 'Model này hiện không được phép tải từ nguồn.',
  DRIVE_DOWNLOAD_RESTRICTED: 'Chủ sở hữu Drive đang giới hạn tải file này.',
  DRIVE_QUOTA_EXCEEDED: 'Google Drive đang giới hạn lượt tải. Hãy thử lại sau.',
  DRIVE_AUTOMATED_REQUESTS_BLOCKED: 'Google tạm chặn yêu cầu tự động từ mạng máy chủ. Hãy chờ rồi thử lại.',
  DRIVE_FILE_OR_RESOURCE_KEY_NOT_FOUND: 'File nguồn không còn khả dụng. Catalog sẽ được cập nhật trong lần đồng bộ tiếp theo.',
  DOWNLOAD_BUSY: 'Máy chủ đang đủ lượt tải đồng thời. Hãy thử lại sau.',
};
const errorText = (e) => MESSAGES[e.code] || e.message || 'Có lỗi xảy ra.';

let busy = false;
async function pump() {
  if (busy) return;
  const job = jobs.find((j) => j.status === 'queued');
  if (!job) return;
  busy = true;
  patch(job.slug, { status: 'running', startedAt: Date.now(), error: null });
  try {
    const { assetId, ticket } = await importTicket(job.slug); // ticket dung 1 lan nen moi lan thu lai xin ticket moi
    const result = await importAsset(assetId, ticket, progress => patch(job.slug, {progress}));
    patch(job.slug, { status: 'done', finishedAt: Date.now(), result });
  } catch (e) {
    patch(job.slug, { status: 'failed', finishedAt: Date.now(), error: errorText(e) });
  } finally {
    busy = false;
    pump();
  }
}

// Bam lien tuc / 2 nut cung luc khong tao 2 job cho cung 1 san pham.
export function enqueue(p) {
  const cur = jobs.find((j) => j.slug === p.slug);
  if (cur && (cur.status === 'queued' || cur.status === 'running')) return;
  const job = { slug: p.slug, name: p.name, sizeMB: p.info.sizeMB, product: { ...p, info: { ...p.info } }, status: 'queued', error: null, result: null };
  update([...jobs.filter((j) => j.slug !== p.slug), job]);
  pump();
}

// Job dang chay khong huy duoc (native chua ho tro huy) -> chi bo job dang cho hoac da loi.
export function remove(slug) {
  update(jobs.filter((j) => !(j.slug === slug && j.status !== 'running')));
}

export const getJobs = () => jobs;
export const useJobs = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), getJobs);
export const useJob = (slug) => useJobs().find((j) => j.slug === slug);
