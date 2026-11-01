// P4.1: xac minh license MXL1 cu o phia may chu. Ham thuan, khong can DB. Token tao bang khoa test (khong dung khoa that).
import test from 'node:test';
import assert from 'node:assert/strict';
import { constants, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { loadLegacyPublicKey, verifyLegacyLicense } from './mxl1.js';

const MACHINE = `MAX-${'A1'.repeat(32)}`;
const OTHER_MACHINE = `MAX-${'B2'.repeat(32)}`;
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const payloadOf = (over = {}) => ({ version: 1, product: '3dsmood-library', machineCode: MACHINE, licenseId: 'lic-001', ...over });
const issue = (payload = payloadOf(), key = privateKey) => {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = sign('RSA-SHA256', bytes, { key, padding: constants.RSA_PKCS1_PADDING });
  return `MXL1.${bytes.toString('base64url')}.${signature.toString('base64url')}`;
};
const pem = publicKey.export({ type: 'spki', format: 'pem' });
const der = publicKey.export({ type: 'spki', format: 'der' });
const jwk = publicKey.export({ format: 'jwk' });
const xml = `<RSAKeyValue><Modulus>${Buffer.from(jwk.n, 'base64url').toString('base64')}</Modulus><Exponent>${Buffer.from(jwk.e, 'base64url').toString('base64')}</Exponent></RSAKeyValue>`;
const b64 = (x) => Buffer.from(x).toString('base64');

test('the public key can be given as base64 of an XML key (what the plugin installer uses), a PEM, or a DER; all verify the same token', () => {
  for (const [name, value] of [['xml', b64(xml)], ['pem', b64(pem)], ['der', der.toString('base64')]]) {
    const key = loadLegacyPublicKey(value);
    assert.ok(key, name);
    assert.equal(verifyLegacyLicense(issue(), key, MACHINE), 'lic-001', name);
  }
});

test('unusable key material is refused (never silently accepted): empty, junk, private key, XML with private parts or entities, too-small key', () => {
  assert.equal(loadLegacyPublicKey(''), null);
  assert.equal(loadLegacyPublicKey(undefined), null);
  const privateXml = xml.replace('</RSAKeyValue>', '<P>AAAA</P><D>AAAA</D></RSAKeyValue>');
  const small = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey;
  for (const bad of [b64('not a key'), b64('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'), b64(privateXml), b64(`<!DOCTYPE x [<!ENTITY a "b">]>${xml}`),
    b64('<RSAKeyValue><Modulus>@@@</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>'), small.export({ type: 'spki', format: 'der' }).toString('base64')])
    assert.throws(() => loadLegacyPublicKey(bad), undefined, bad.slice(0, 30));
});

test('a valid token for THIS machine code verifies and returns its licence id', () => {
  const key = createPublicKey(pem);
  assert.equal(verifyLegacyLicense(issue(payloadOf({ licenseId: 'A_b-9' })), key, MACHINE), 'A_b-9');
});

test('every way a token can be wrong returns null (never throws, never partially accepts)', () => {
  const key = createPublicKey(pem);
  const good = issue();
  const [head, body, sig] = good.split('.');
  const flip = (s) => `${s.slice(0, 5)}${s[5] === 'A' ? 'B' : 'A'}${s.slice(6)}`;
  const cases = {
    'other machine': issue(payloadOf({ machineCode: OTHER_MACHINE })),
    'signed by another key': issue(payloadOf(), other.privateKey),
    'payload tampered by one char': `${head}.${flip(body)}.${sig}`,
    'signature tampered by one char': `${head}.${body}.${flip(sig)}`,
    'wrong version': issue(payloadOf({ version: 2 })),
    'wrong product': issue(payloadOf({ product: 'other' })),
    'bad licence id': issue(payloadOf({ licenseId: 'has space' })),
    'licence id too long': issue(payloadOf({ licenseId: 'x'.repeat(81) })),
    'missing licence id': issue({ version: 1, product: '3dsmood-library', machineCode: MACHINE }),
    'bad machine code format': issue(payloadOf({ machineCode: 'MAX-abc' })),
    'wrong prefix': good.replace('MXL1', 'MXL2'),
    'two pieces': `${head}.${body}`, 'four pieces': `${good}.x`, 'empty': '', 'spaces': ` ${good} `,
    'payload not json': `${head}.${Buffer.from('nope').toString('base64url')}.${sig}`,
    'payload is an array': `${head}.${Buffer.from('[]').toString('base64url')}.${sig}`,
    'non-base64url payload': `${head}.@@@@.${sig}`,
    'huge token': `${head}.${'A'.repeat(5000)}.${sig}`,
    'number': 12345, 'object': {}, 'null': null, 'undefined': undefined,
  };
  for (const [name, token] of Object.entries(cases)) assert.equal(verifyLegacyLicense(token, key, MACHINE), null, name);
  assert.equal(verifyLegacyLicense(good, null, MACHINE), null, 'no key configured');
  assert.equal(verifyLegacyLicense(good, key, 'MAX-abc'), null, 'bad expected machine code');
  assert.equal(verifyLegacyLicense(good, key, undefined), null);
});
