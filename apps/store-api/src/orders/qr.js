// P5.3: noi dung ma VietQR (EMVCo Merchant-Presented, the 38 cua NAPAS "chuyen nhanh 24/7 den tai khoan").
// [CHUA KIEM CHUNG] voi tai lieu NAPAS chinh thuc va app ngan hang that — cau truc theo cac thu vien/bai viet cong dong
// (GUID A000000727, dich vu QRIBFTTA, tien te 704, CRC-16/CCITT-FALSE). Phai quet thu bang app ngan hang truoc khi phat hanh (plan P5.3).
// Tu choi dau vao xau: mot ma QR sai co the chuyen tien nham cho.
const fail = (what) => Object.assign(new Error(`VietQR: ${what}`), { code: 'VIETQR_INVALID' });

export function crc16(text) {
  let crc = 0xffff;
  for (const byte of Buffer.from(text, 'latin1')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const tlv = (tag, value) => `${tag}${String(value.length).padStart(2, '0')}${value}`;

/** Doc TLV phang (khong de quy): [{tag, value}]. Nem loi khi cat cut hoac do dai khong phai so. */
export function parseTlv(text) {
  const out = [];
  for (let i = 0; i < text.length;) {
    const tag = text.slice(i, i + 2), len = text.slice(i + 2, i + 4);
    if (tag.length < 2 || !/^\d{2}$/.test(len)) throw new Error('TLV malformed');
    const end = i + 4 + Number(len);
    if (end > text.length) throw new Error('TLV truncated');
    out.push({ tag, value: text.slice(i + 4, end) });
    i = end;
  }
  return out;
}

export function transferContent(code) {
  if (typeof code !== 'string' || !/^[A-Z0-9]{1,25}$/.test(code)) throw fail('transfer content must be 1-25 uppercase letters or digits');
  return code;
}

export function buildVietQr({ bankBin, accountNo, amountVnd, content }) {
  if (typeof bankBin !== 'string' || !/^\d{6}$/.test(bankBin)) throw fail('bank BIN must be 6 digits');
  if (typeof accountNo !== 'string' || !/^\d{6,19}$/.test(accountNo)) throw fail('account number must be 6-19 digits');
  if (!Number.isSafeInteger(amountVnd) || amountVnd < 1 || amountVnd > 9_999_999_999) throw fail('amount must be a whole number of VND');
  transferContent(content);
  const payload = tlv('00', '01') + tlv('01', '12')
    + tlv('38', tlv('00', 'A000000727') + tlv('01', tlv('00', bankBin) + tlv('01', accountNo)) + tlv('02', 'QRIBFTTA'))
    + tlv('53', '704') + tlv('54', String(amountVnd)) + tlv('58', 'VN')
    + tlv('62', tlv('08', content)) + '6304';
  return payload + crc16(payload);
}
