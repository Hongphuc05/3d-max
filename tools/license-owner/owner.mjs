#!/usr/bin/env node
// Owner-only tool. Never include this directory or the private key in customer packages.
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, basename, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { issueLicense, requireRsa } from '../../apps/license-admin/server/license-core.mjs';

export { issueLicense };

const repository = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));

function externalPrivatePath(path) {
  if (!path) throw new Error('Provide --private with a path outside the repository.');
  const absolute = resolve(path);
  const canonical = existsSync(absolute) ? realpathSync(absolute) : resolve(realpathSync(dirname(absolute)), basename(absolute));
  const child = relative(repository, canonical);
  if (!child || (!(child === '..' || child.startsWith('..' + sep)) && !isAbsolute(child)))
    throw new Error('The private key must remain outside the repository and installer staging directories.');
  return canonical;
}

export function publicKeyXml(key) {
  const publicKey = key.type === 'public' ? key : createPublicKey(key);
  requireRsa(publicKey);
  const jwk = publicKey.export({ format: 'jwk' });
  return `<RSAKeyValue><Modulus>${Buffer.from(jwk.n, 'base64url').toString('base64')}</Modulus><Exponent>${Buffer.from(jwk.e, 'base64url').toString('base64')}</Exponent></RSAKeyValue>`;
}

export function generateKeys(privatePath, publicPath) {
  const destination = externalPrivatePath(privatePath);
  if (!publicPath) throw new Error('Provide --public with the public XML output path.');
  if (existsSync(destination) || existsSync(publicPath)) throw new Error('Output already exists; keys are never overwritten.');
  if (resolve(publicPath) === destination) throw new Error('Private and public outputs must differ.');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
  // wx avoids accidental key rotation and races. Keep a protected offline backup.
  writeFileSync(destination, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
  writeFileSync(publicPath, publicKeyXml(publicKey) + '\n', { flag: 'wx' });
}

export function runCli(args, output = console.log) {
  const [command, ...flags] = args;
  const options = {};
  for (let index = 0; index < flags.length; index += 2) {
    const name = flags[index];
    if (!['--private', '--public', '--machine', '--id', '--out'].includes(name) || options[name] !== undefined || !flags[index + 1])
      throw new Error('Invalid arguments. Use keygen --private PATH --public PATH, or issue --private PATH --machine MAX-… [--id ID] [--out PATH].');
    options[name] = flags[index + 1];
  }
  if (command === 'keygen') {
    if (Object.keys(options).some(name => !['--private', '--public'].includes(name))) throw new Error('Unexpected keygen option.');
    generateKeys(options['--private'], options['--public']);
    output('Created owner private key and public verification XML. Back up the private key securely; ship only the public XML.');
  } else if (command === 'issue') {
    if (options['--public']) throw new Error('Unexpected issue option.');
    const privatePath = externalPrivatePath(options['--private']);
    const key = createPrivateKey(readFileSync(privatePath));
    const token = issueLicense(key, options['--machine'], options['--id']);
    if (options['--out']) writeFileSync(options['--out'], token + '\n', { flag: 'wx' });
    else output(token);
  } else throw new Error('Use keygen --private PATH --public PATH, or issue --private PATH --machine MAX-… [--id ID] [--out PATH].');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { runCli(process.argv.slice(2)); }
  catch (error) { console.error(`License tool: ${error.message}`); process.exitCode = 1; }
}
