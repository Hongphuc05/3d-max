// Hang doi Download (trong 3ds Max): moi san pham 1 job. Download = xin ticket -> host tai goi -> import vao scene.
// ponytail: chay tuan tu 1 job/lan, chi luu trong RAM cua trang (F5 la mat), khong co % tien do vi native chua
// gui event tien do. Nang cap: xem docs/download-queue-plan.md (native gui event, chay song song, huy, nho lich su).
import { useSyncExternalStore } from 'react';
import { importModel } from './integrations/3dsmax/bridge.js';

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
  R2_OBJECT_NOT_FOUND: 'File nguồn không còn khả dụng. Catalog đang được cập nhật.',
  MODEL_NOT_READY: 'Model chưa có đủ preview và archive hợp lệ để tải.',
  R2_UNAVAILABLE: 'Kho model tạm thời không khả dụng. Hãy thử lại sau.',
  DOWNLOAD_BUSY: 'Máy chủ đang đủ lượt tải đồng thời. Hãy thử lại sau.',
  NOT_ENTITLED: 'Thiết bị này chưa có quyền tải model này.',
  MODEL_NOT_AVAILABLE: 'Model này hiện không có sẵn để tải.',
  SESSION_INVALID: 'Phiên tải đã hết hạn. Hãy bấm tải lại.',
  STORAGE_DOWNLOAD_FAILED: 'Máy chủ chưa lấy được file model. Thử lại sau.',
  RATE_LIMITED: 'Bạn thao tác quá nhanh. Thử lại sau ít phút.',
  SERVER_UNAVAILABLE: 'Không kết nối được máy chủ. Kiểm tra Internet rồi thử lại.',
  DOWNLOAD_VERIFICATION_FAILED: 'File tải về bị lỗi. Hãy thử lại.',
  DEVICE_BLOCKED: 'Thiết bị này đã bị chặn. Liên hệ nhà cung cấp.',
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
    // v3: slug = UUID cua model. Native tu xin phien tai (dung 1 lan) tu backend; thu lai thi xin phien moi.
    const result = await importModel(job.slug, progress => patch(job.slug, {progress}));
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
