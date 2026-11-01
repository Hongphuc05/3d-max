// Mock may chu cho test Get-PreviewSeed.ps1: node seed-server.mjs <mode>. In "PORT <n>" roi phuc vu den khi bi kill.
import http from 'node:http';
import { createHash } from 'node:crypto';

const mode = process.argv[2] || 'ok';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const images = Array.from({ length: 5 }, (_, i) => Buffer.from(`RIFF-fake-image-${i}-`.repeat(20 + i)));
const entry = (b, i) => ({ modelId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, variant: i % 2 ? 'lg' : 'sm', url: `/previews/${sha(b)}.webp`, sha256: sha(b), version: 1, fileSize: b.length, width: 1, height: 1 });
let previews = images.map(entry);
if (mode === 'duplicate') previews = [...previews, entry(images[0], 9)];
if (mode === 'empty') previews = [];
if (mode === 'badsize') previews[2].fileSize += 1;
if (mode === 'badurl') previews[1].url = '/previews/other.webp';
if (mode === 'traversal') previews[1].sha256 = '../../x';

const server = http.createServer((req, res) => {
  if (req.url === '/api/v1/previews/manifest') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ catalogVersion: 7, previews })); }
  const m = /^\/previews\/([0-9a-f]{64})\.webp$/.exec(req.url);
  const image = m && images.find((b) => sha(b) === m[1]);
  if (!image) { res.statusCode = 404; return res.end('no'); }
  if (mode === 'missing' && m[1] === sha(images[3])) { res.statusCode = 404; return res.end('gone'); }
  if (mode === 'corrupt' && m[1] === sha(images[2])) return res.end(Buffer.from('tampered'.repeat(40)));
  if (mode === 'redirect' && m[1] === sha(images[1])) { res.statusCode = 302; res.setHeader('location', 'https://evil.test/x'); return res.end(); }
  res.end(image);
});
server.listen(0, '127.0.0.1', () => console.log('PORT ' + server.address().port));
