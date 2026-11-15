import { useEffect, useState } from 'react';
import { applyPluginUpdate, checkPluginUpdate } from './integrations/3dsmax/bridge.js';

const RECHECK_MS = 10 * 60 * 1000;

// Tu cap nhat plugin: thay ban moi thi tai + cai ngay (khong can bam), hien thong bao o cuoi cot loc, cung cho voi Hang doi.
// Cai xong, Max tu hien hop thoai Luu/Khong luu roi khoi dong lai; neu nguoi dung Huy thi thong bao "da cai" van o lai.
// phase: applying | installed | failed. Khong co gi de bao (ban moi nhat / dang kiem tra / host tu choi) thi khong render.
export function UpdateNotice() {
  const [state, setState] = useState(null);
  useEffect(() => {
    let alive = true, busy = false;
    const set = (next) => alive && setState(next);
    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await checkPluginUpdate();
        if (r.restartRequired) return set({ phase: 'installed', latest: r.latest });
        if (!r.updateAvailable) return;
        set({ phase: 'applying', latest: r.latest, pct: null });
        await applyPluginUpdate(({ receivedBytes, totalBytes }) =>
          set({ phase: 'applying', latest: r.latest, pct: totalBytes ? Math.min(100, Math.round(receivedBytes * 100 / totalBytes)) : null }));
        set({ phase: 'installed', latest: r.latest });
      } catch (e) {
        if (e.code === 'UPDATE_BUSY') return set(null); // cua so khac / nut trong popup Thiet bi dang cap nhat
        if (e.code === 'UPDATE_RESTART_REQUIRED') return set({ phase: 'installed' });
        if (e.code === 'UPDATE_NOT_NEEDED') return set(null);
        if (e.code === 'UPDATE_CANCELLED') return set(null);
        set({ phase: 'failed', message: e.message || 'Cập nhật thất bại.' }); // lan kiem tra ke tiep se thu lai
      } finally { busy = false; }
    };
    run();
    const timer = setInterval(run, RECHECK_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  if (!state) return null;
  return (
    <section className="border-t border-line p-3 text-xs" data-testid="update-notice" role={state.phase === 'failed' ? 'alert' : 'status'}>
      {state.phase === 'applying' && <p>
        Có bản cập nhật mới{state.latest ? ` ${state.latest}` : ''}. {state.pct === null ? 'Đang chuẩn bị…' : state.pct < 100 ? `Đang tải… ${state.pct}%` : 'Đang cài đặt…'}
      </p>}
      {state.phase === 'installed' && <p>Đã cài bản mới{state.latest ? ` ${state.latest}` : ''}. Hãy lưu scene nếu được hỏi; 3ds Max sẽ khởi động lại. Nếu bạn đã hủy, hãy tự đóng và mở lại 3ds Max để dùng bản mới.</p>}
      {state.phase === 'failed' && <p className="text-red-400">{state.message} Sẽ thử lại sau.</p>}
    </section>
  );
}
