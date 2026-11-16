// Drag card thumbnail: small JPEG data URL under the bridge budget, smaller fallback, nothing when it cannot be drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div></div>');
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
const { dragThumbnail } = await import('./plugin-components.jsx');

const card = (img) => ({ querySelector: () => img });
const loaded = { complete: true, naturalWidth: 400, naturalHeight: 200 };
function fakeCanvas(urlFor) {
  const sizes = [];
  dom.window.HTMLCanvasElement.prototype.getContext = function () { return { fillRect() {}, drawImage() {}, set fillStyle(_) {} }; };
  dom.window.HTMLCanvasElement.prototype.toDataURL = function (type, quality) { sizes.push([this.width, type, quality]); return urlFor(this.width); };
  return sizes;
}

test('dragThumbnail: 96px JPEG when it fits the bridge budget', () => {
  const sizes = fakeCanvas(() => 'data:image/jpeg;base64,' + 'A'.repeat(5000));
  assert.match(dragThumbnail(card(loaded)), /^data:image\/jpeg;base64,/);
  assert.deepEqual(sizes, [[96, 'image/jpeg', 0.75]]);
});

test('dragThumbnail: falls back to 64px when 96px is too large, and gives up when both are', () => {
  let sizes = fakeCanvas((w) => 'data:image/jpeg;base64,' + 'A'.repeat(w === 96 ? 20000 : 4000));
  assert.ok(dragThumbnail(card(loaded)).length <= 12000);
  assert.deepEqual(sizes.map((s) => s[0]), [96, 64]);
  sizes = fakeCanvas(() => 'data:image/jpeg;base64,' + 'A'.repeat(20000));
  assert.equal(dragThumbnail(card(loaded)), undefined);
});

test('dragThumbnail: nothing when the image is missing, not loaded, the canvas is blocked or the browser returns another format', () => {
  fakeCanvas(() => 'data:image/jpeg;base64,AAAA');
  assert.equal(dragThumbnail(card(null)), undefined);
  assert.equal(dragThumbnail(card({ complete: false, naturalWidth: 0 })), undefined);
  assert.equal(dragThumbnail(undefined), undefined);
  dom.window.HTMLCanvasElement.prototype.toDataURL = () => { throw new Error('tainted'); };
  assert.equal(dragThumbnail(card(loaded)), undefined);
  fakeCanvas(() => 'data:image/png;base64,AAAA');
  assert.equal(dragThumbnail(card(loaded)), undefined, 'only JPEG is accepted by the host');
});
