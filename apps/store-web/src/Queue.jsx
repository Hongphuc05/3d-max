import { useEffect, useState } from 'react';
import { mb } from './api.js';
import { Icon } from './icons.jsx';
import { enqueue, remove, useJobs } from './queue.js';

const secs = (ms) => `${Math.max(0, Math.round(ms / 1000))}s`;

// Hang doi o cuoi cot bo loc. Chi hien job dang cho / dang chay / loi; job xong nam o tab "Đã tải".
export function Queue() {
  const jobs = useJobs().filter((j) => j.status !== 'done');
  const running = jobs.some((j) => j.status === 'running');
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000); // dong ho thoi gian chay
    return () => clearInterval(t);
  }, [running]);

  return (
    <section className="border-t border-line p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold">
        <Icon name="download" className="size-3.5 text-brand" /> Hàng đợi
        <span className="ml-auto font-mono font-normal text-mute">{jobs.length} job</span>
      </div>
      {jobs.length === 0 && <p className="font-mono text-[11px] text-mute">Trống. Bấm Download trên một model.</p>}
      <ul className="max-h-56 space-y-2 overflow-auto">
        {jobs.map((j) => (
          <li key={j.slug} className="rounded-md border border-line bg-raised p-2">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold" title={j.name}>{j.name}</div>
                <div className="font-mono text-[10px] text-mute">
                  {j.status === 'queued' && `Đang chờ · ${mb(j.sizeMB)}`}
                  {j.status === 'running' && `Đang tải · ${j.progress?.totalBytes ? Math.min(100,Math.floor(j.progress.receivedBytes/j.progress.totalBytes*100))+'% · ' : ''}${mb(j.sizeMB)} · ${secs(Date.now() - j.startedAt)}`}
                  {j.status === 'failed' && <span className="text-danger">Lỗi: {j.error}</span>}
                </div>
              </div>
              {j.status === 'failed' && (
                <button onClick={() => enqueue(j.product || { slug: j.slug, name: j.name, info: { sizeMB: j.sizeMB } })} title="Thử lại"
                  className="rounded p-1 text-mute hover:bg-line hover:text-fg"><Icon name="refresh" className="size-3.5" /></button>
              )}
              {j.status !== 'running' && (
                <button onClick={() => remove(j.slug)} title="Bỏ khỏi hàng đợi" className="rounded p-1 text-mute hover:bg-line hover:text-fg">
                  <Icon name="close" className="size-3.5" />
                </button>
              )}
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded bg-line">
              {/* native chua gui % tien do: thanh chay khong xac dinh khi dang tai */}
              <div style={j.status === 'running' && j.progress?.totalBytes ? {width:`${Math.min(100,j.progress.receivedBytes/j.progress.totalBytes*100)}%`} : undefined}
                className={`h-full ${j.status === 'running' ? j.progress?.totalBytes ? 'bg-accent' : 'w-1/3 animate-pulse bg-accent' : j.status === 'failed' ? 'w-full bg-danger' : 'w-0'}`} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
