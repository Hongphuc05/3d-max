import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { issueLicense, publicKeyXml, generateKeys, runCli } from './owner.mjs';

test('owner issues permanent license that verifies with public RSA key', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const machine = `MAX-${'A'.repeat(64)}`;
  const token = issueLicense(privateKey, machine, 'customer-123');
  const [prefix, body, signature] = token.split('.');
  assert.equal(prefix, 'MXL1');
  assert.deepEqual(JSON.parse(Buffer.from(body, 'base64url')), { version: 1, product: '3dsmood-library', machineCode: machine, licenseId: 'customer-123' });
  assert.ok(verify('RSA-SHA256', Buffer.from(body, 'base64url'), publicKey, Buffer.from(signature, 'base64url')));
  assert.match(publicKeyXml(publicKey), /^<RSAKeyValue><Modulus>.+<\/Modulus><Exponent>AQAB<\/Exponent><\/RSAKeyValue>$/);
});
test('reject invalid machine codes and license IDs', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => issueLicense(privateKey, 'bad', 'customer'));
  assert.throws(() => issueLicense(privateKey, `MAX-${'A'.repeat(64)}`, '../bad'));
});
test('generate external key pair; refuse overwrite and repo private paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'max-owner-test-'));
  try {
    const privatePath = join(directory, 'private.pem');
    const publicPath = join(directory, 'public.xml');
    generateKeys(privatePath, publicPath);
    assert.match(readFileSync(privatePath, 'utf8'), /BEGIN PRIVATE KEY/);
    assert.doesNotMatch(readFileSync(publicPath, 'utf8'), /PRIVATE|<D>/);
    assert.throws(() => generateKeys(privatePath, publicPath), /exist/i);
    assert.throws(() => generateKeys(resolve('forbidden-private.pem'), join(directory, 'another-public.xml')), /outside/i);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('dot-dot-prefixed child directory cannot bypass private-key containment', () => {
  const directory = mkdtempSync(resolve('..keys-test-'));
  try { assert.throws(() => generateKeys(join(directory, 'private.pem'), join(directory, 'public.xml')), /outside/); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});
test('CLI keygen and issue accept only supported argument pairs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'max-owner-cli-'));
  try {
    const privatePath = join(directory, 'private.pem');
    const publicPath = join(directory, 'public.xml');
    const outputPath = join(directory, 'license.txt');
    const lines = [];
    const print = line => lines.push(line);
    runCli(['keygen', '--private', privatePath, '--public', publicPath], print);
    runCli(['issue', '--private', privatePath, '--machine', `MAX-${'A'.repeat(64)}`, '--out', outputPath], print);
    assert.match(readFileSync(outputPath, 'utf8'), /^MXL1\./);
    runCli(['issue', '--private', privatePath, '--machine', `MAX-${'B'.repeat(64)}`], print);
    assert.match(lines[1], /^MXL1\./);
    for (const args of [[], ['keygen', '--bad', 'x'], ['keygen', '--private'], ['keygen', '--private', 'a', '--private', 'b'], ['keygen', '--machine', 'x'], ['issue', '--public', publicPath], ['issue'], ['keygen', '--private', join(directory, 'new.pem')]])
      assert.throws(() => runCli(args, print));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
