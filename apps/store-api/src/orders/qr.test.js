// P5.3: noi dung VietQR (EMVCo MPM + the NAPAS 38). CHUA KIEM CHUNG voi app ngan hang that: cau truc theo tai lieu cong dong,
// can quet thu bang app ngan hang truoc khi phat hanh (plan P5.3). Test nay chi chung minh: TLV dung, CRC16-CCITT dung, dau vao xau bi tu choi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVietQr, crc16, parseTlv, transferContent } from './qr.js';

test('crc16 is CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF): the standard check value of "123456789" is 29B1', () => {
  assert.equal(crc16('123456789'), '29B1');
  assert.equal(crc16(''), 'FFFF');
});

test('a payload is well-formed TLV, ordered, ends with a valid CRC and carries bank BIN, account, amount, VND and the transfer content', () => {
  const qr = buildVietQr({ bankBin: '970436', accountNo: '0123456789012', amountVnd: 15000, content: '3DMK7Q2XA' });
  const tags = parseTlv(qr);
  assert.deepEqual(tags.map((t) => t.tag), ['00', '01', '38', '53', '54', '58', '62', '63'], 'tags in ascending order');
  const get = (tag) => tags.find((t) => t.tag === tag).value;
  assert.equal(get('00'), '01'); assert.equal(get('01'), '12', 'dynamic QR (one amount)');
  assert.equal(get('53'), '704'); assert.equal(get('54'), '15000'); assert.equal(get('58'), 'VN');
  const bank = parseTlv(get('38'));
  assert.deepEqual(bank.map((t) => t.tag), ['00', '01', '02']);
  assert.equal(bank[0].value, 'A000000727'); assert.equal(bank[2].value, 'QRIBFTTA');
  assert.deepEqual(parseTlv(bank[1].value).map((t) => [t.tag, t.value]), [['00', '970436'], ['01', '0123456789012']]);
  assert.deepEqual(parseTlv(get('62')).map((t) => [t.tag, t.value]), [['08', '3DMK7Q2XA']]);
  assert.equal(get('63').length, 4);
  assert.equal(qr.slice(-8, -4), '6304'); assert.equal(crc16(qr.slice(0, -4)), qr.slice(-4), 'CRC covers everything up to and including "6304"');
  assert.match(qr, /^[\x20-\x7e]+$/, 'printable ASCII only');
});

test('every field length byte is right even for long values (account number up to 19 digits)', () => {
  const qr = buildVietQr({ bankBin: '970415', accountNo: '1234567890123456789', amountVnd: 99_999_999, content: '3DMABCDEFG' });
  const walk = (s) => { for (const t of parseTlv(s)) if (t.tag === '38') { parseTlv(t.value); } return true; };
  assert.ok(walk(qr));
  assert.equal(parseTlv(qr).find((t) => t.tag === '54').value, '99999999');
});

test('invalid inputs are refused instead of producing a QR that moves money to the wrong place', () => {
  const ok = { bankBin: '970436', accountNo: '0123456789', amountVnd: 15000, content: '3DMK7Q2XA' };
  for (const bad of [{ bankBin: '97043' }, { bankBin: '9704360' }, { bankBin: 'abcdef' }, { bankBin: undefined }, { accountNo: '12345' }, { accountNo: '1'.repeat(20) }, { accountNo: '12a456789' }, { accountNo: '' },
    { amountVnd: 0 }, { amountVnd: -1 }, { amountVnd: 1.5 }, { amountVnd: '15000' }, { amountVnd: 10 ** 10 }, { amountVnd: undefined },
    { content: '' }, { content: 'a b' }, { content: 'x'.repeat(26) }, { content: 'tiếng việt' }, { content: undefined }])
    assert.throws(() => buildVietQr({ ...ok, ...bad }), /VietQR/, JSON.stringify(bad));
  assert.doesNotThrow(() => buildVietQr(ok));
});

test('transfer content is the order code, uppercased alphanumerics only', () => {
  assert.equal(transferContent('3DMK7Q2XA'), '3DMK7Q2XA');
  for (const bad of ['', 'abc def', '3DM-K7', null, undefined, 'x'.repeat(40)]) assert.throws(() => transferContent(bad), /VietQR/);
});

test('parseTlv rejects truncated or malformed data', () => {
  assert.throws(() => parseTlv('0002'), /TLV/);
  assert.throws(() => parseTlv('00ab01'), /TLV/);
  assert.throws(() => parseTlv('0005ab'), /TLV/);
  assert.deepEqual(parseTlv(''), []);
});
