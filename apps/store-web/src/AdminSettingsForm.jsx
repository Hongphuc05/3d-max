// P3.7 — Cai dat (plan §2.7, D25): thong tin ngan hang nhan tien, gia license thu vien (mot gia duy nhat), thoi han don, so don cho toi da.
// Kiem tra dinh dang o day giong may chu (may chu van la noi quyet dinh cuoi). Khong the luu khi chua tai duoc cai dat hien tai.
import { useState } from 'react';
import * as api from './api.js';
import { BANKS } from './bank-bins.js';
import { adminError, dateTime, inputClass, panel, primary, ResourceState, useAdminResource } from './AdminShared.jsx';

const TEXT = ['bankName', 'bankBin', 'accountNo', 'accountName'];
const NUMBERS = ['libraryPriceVnd', 'orderTtlMinutes', 'maxPendingOrdersPerDevice'];
const toForm = (s) => Object.fromEntries([...TEXT.map((k) => [k, s[k] ?? '']), ...NUMBERS.map((k) => [k, String(s[k])])]);
const sameForm = (a, b) => [...TEXT, ...NUMBERS].every((k) => String(a[k]).trim() === String(b[k]).trim());

function validate(form) {
  const body = {};
  for (const key of TEXT) {
    const value = form[key].trim();
    if (value.length > 100) return { error: 'Tối đa 100 ký tự.' };
    body[key] = value === '' ? null : value;
  }
  if (body.bankBin !== null && !/^\d{6}$/.test(body.bankBin)) return { error: 'Mã BIN gồm đúng 6 chữ số.' };
  if (body.accountNo !== null && !/^\d{6,19}$/.test(body.accountNo)) return { error: 'Số tài khoản gồm 6–19 chữ số.' };
  const rules = { libraryPriceVnd: [1, 100_000_000, 'Giá license thư viện phải là số nguyên từ 1 đến 100.000.000.'],
    orderTtlMinutes: [1, 43200, 'Thời hạn đơn từ 1 đến 43.200 phút.'], maxPendingOrdersPerDevice: [1, 20, 'Số đơn chờ từ 1 đến 20.'] };
  for (const key of NUMBERS) {
    const [min, max, message] = rules[key];
    const raw = form[key].trim();
    const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(value) || value < min || value > max) return { error: message };
    body[key] = value;
  }
  return { body };
}

const labels = { bankName: 'Tên ngân hàng', bankBin: 'Mã BIN ngân hàng (chọn ngân hàng)', accountNo: 'Số tài khoản', accountName: 'Tên chủ tài khoản',
  libraryPriceVnd: 'Giá license thư viện (₫)', orderTtlMinutes: 'Thời hạn đơn (phút)', maxPendingOrdersPerDevice: 'Số đơn chờ tối đa mỗi thiết bị' };

const help = {
  bankName: 'Tên ngân hàng hiện cho khách trong hộp thoại thanh toán. Chọn ngân hàng ở ô Mã BIN sẽ tự điền nếu ô này trống.',
  bankBin: 'Mã 6 số định danh ngân hàng theo chuẩn VietQR (không phải mã PIN, không bí mật). Dùng để tạo mã QR chuyển khoản.',
  accountNo: 'Số tài khoản nhận tiền (6–19 chữ số). Nằm trong mã QR khách quét.',
  accountName: 'Tên chủ tài khoản, hiện cho khách đối chiếu trước khi chuyển.',
  libraryPriceVnd: 'Giá một license cả thư viện: mua một lần, dùng vĩnh viễn trên 1 máy, gồm cả model thêm sau. Đơn đã tạo giữ giá cũ.',
  orderTtlMinutes: 'Đơn chờ khách chuyển khoản được bao lâu (phút) thì tự hết hạn. Ví dụ 1440 = 24 giờ. Khách đã bấm "Tôi đã chuyển khoản" thì bạn vẫn xác nhận được sau khi hết hạn.',
  maxPendingOrdersPerDevice: 'Mỗi máy được giữ tối đa bao nhiêu đơn đang chờ cùng lúc, chống tạo đơn hàng loạt. Đơn hết hạn không bị tính.',
};
const Help = ({ text }) => <span title={text} aria-label={text} tabIndex={0}
  className="ml-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line text-[10px] text-mute hover:border-accent hover:text-accent">?</span>;

function Form({ initial }) {
  const [base, setBase] = useState({ form: toForm(initial), updatedAt: initial.updatedAt });
  const [form, setForm] = useState(base.form);
  const [state, setState] = useState({ busy: false, error: '', done: false });
  const dirty = !sameForm(form, base.form);
  const bankIncomplete = TEXT.some((key) => form[key].trim() === '');

  const edit = (key, value) => { setForm((f) => ({ ...f, [key]: value })); setState((s) => ({ ...s, done: false, error: '' })); };
  async function submit(event) {
    event.preventDefault();
    if (state.busy || !dirty) return;
    const { body, error } = validate(form);
    if (error) return setState({ busy: false, error, done: false });
    setState({ busy: true, error: '', done: false });
    try {
      const saved = await api.adminSaveSettings(body);
      const next = { form: toForm(saved), updatedAt: saved.updatedAt };
      setBase(next); setForm(next.form); setState({ busy: false, error: '', done: true });
    } catch (e) { setState({ busy: false, error: adminError(e), done: false }); }
  }

  return <form className={`${panel} space-y-4`} onSubmit={submit}>
    <div><h3 className="font-bold">Thông tin nhận tiền và đơn hàng</h3>
      <p className="mt-1 text-xs text-mute">{base.updatedAt ? `Lần lưu gần nhất: ${dateTime(base.updatedAt)}` : 'Chưa lưu lần nào: đang dùng giá trị mặc định.'}</p></div>
    <div className="grid gap-3 md:grid-cols-2">
      {[...TEXT, ...NUMBERS].map((key) => <label key={key} className="block text-sm"><span className="text-mute">{labels[key]}</span><Help text={help[key]} />
        {key === 'bankBin' ? <select className={`${inputClass} mt-1`} name={key} value={form.bankBin}
          onChange={(event) => { const bin = event.target.value; edit('bankBin', bin);
            const bank = BANKS.find(([b]) => b === bin); if (bank && !form.bankName.trim()) edit('bankName', bank[1]); }}>
          <option value="">— Chọn ngân hàng —</option>
          {form.bankBin && !BANKS.some(([b]) => b === form.bankBin) && <option value={form.bankBin}>{form.bankBin}</option>}
          {BANKS.map(([bin, name]) => <option key={bin} value={bin}>{name} — {bin}</option>)}
        </select> : <input className={`${inputClass} mt-1`} name={key} autoComplete="off" inputMode={TEXT.includes(key) && key !== 'bankName' && key !== 'accountName' || NUMBERS.includes(key) ? 'numeric' : 'text'}
          value={form[key]} onChange={(event) => edit(key, event.target.value)} />}</label>)}
    </div>
    {bankIncomplete && <p className="text-xs text-warn">Điền đủ cả 4 thông tin ngân hàng thì mới tạo được đơn thanh toán.</p>}
    {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    {state.done && <p role="status" className="text-sm text-accent">Đã lưu cài đặt.</p>}
    <button type="submit" className={primary} disabled={!dirty || state.busy}>Lưu cài đặt</button>
  </form>;
}

export default function AdminSettingsForm() {
  const [version, setVersion] = useState(0);
  const resource = useAdminResource(api.adminSettings, [version]);
  return <>
    <ResourceState {...resource} retry={() => setVersion((value) => value + 1)} />
    {resource.data && <Form key={version} initial={resource.data} />}
  </>;
}
