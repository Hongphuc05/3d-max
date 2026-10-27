import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createPrivateKey } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeys, issueLicense } from './owner.mjs';

test('owner-issued Node signature activates the native .NET Framework verifier', () => {
  const directory = mkdtempSync(join(tmpdir(), 'max-owner-native-'));
  try {
    const privatePath = join(directory, 'private.pem');
    const publicPath = join(directory, 'public.xml');
    const tokenPath = join(directory, 'license.txt');
    generateKeys(privatePath, publicPath);
    const machine = `MAX-${'C'.repeat(64)}`;
    writeFileSync(tokenPath, issueLicense(createPrivateKey(readFileSync(privatePath)), machine, 'interop-test'));
    const executable = fileURLToPath(new URL('../../plugin-csharp/tests/bin/OfflineLicenseTests.exe', import.meta.url));
    assert.match(execFileSync(executable, [publicPath, tokenPath, machine], { encoding: 'utf8' }), /PASS Node owner signature/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
