import test from 'node:test';
import assert from 'node:assert/strict';
import { fitViewport, MIN_WIDTH, MIN_HEIGHT } from '../lib/reader.js';

// The immersive layout asks the reader for >=90% of the panel's usable area. That request
// must never fall below the reader's own minimums, i.e. fitViewport must return it unchanged.
function immersiveViewport({ panelWidth, panelHeight }) {
  // 90% of each usable dimension, rounded: the lower bound on what the immersive layout requests.
  // Text mode asks for a taller page still (TEXT_RENDER_SCALE in web/panel.html), so this is the
  // floor the viewport must satisfy rather than the exact request.
  return { width: Math.round(panelWidth * 0.9), height: Math.round(panelHeight * 0.9) };
}

test('immersive viewport at the default 640x900 passes fitViewport unchanged', () => {
  const v = immersiveViewport({ panelWidth: 640, panelHeight: 900 });
  assert.deepEqual(fitViewport(v), v, 'default immersive viewport is above the reader minimums');
});

test('immersive viewport at the smallest panel the reader permits passes fitViewport unchanged', () => {
  // The smallest panel that keeps 90% above both reader minimums: width >= MIN_WIDTH/0.9,
  // height >= MIN_HEIGHT/0.9. At that floor the 90% request equals the minimum and is unchanged.
  const panelWidth = Math.ceil(MIN_WIDTH / 0.9);   // 534
  const panelHeight = Math.ceil(MIN_HEIGHT / 0.9); // 445
  const v = immersiveViewport({ panelWidth, panelHeight });
  const fit = fitViewport(v);
  assert.ok(v.width >= MIN_WIDTH && v.height >= MIN_HEIGHT, 'the floor keeps 90% above the minimums');
  assert.deepEqual(fit, v, 'immersive viewport at the floor is not enlarged by fitViewport');
});
