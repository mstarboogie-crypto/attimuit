import test from 'node:test';
import assert from 'node:assert/strict';
import { faceFeatures, faceDirection, fingerDirection, DirectionStabilizer } from '../src/gesture.js';

// テスト用の顔：カメラの生映像の座標（左右反転前）で点を置く
function face({ noseX = 0.5, noseY = 0.5 } = {}) {
  const lm = [];
  lm[1] = { x: noseX, y: noseY };
  lm[10] = { x: 0.5, y: 0.3 };
  lm[152] = { x: 0.5, y: 0.7 };
  lm[234] = { x: 0.35, y: 0.5 };
  lm[454] = { x: 0.65, y: 0.5 };
  return lm;
}

test('正面なら向きなし', () => {
  assert.equal(faceDirection(faceFeatures(face())), null);
});

test('鼻が生映像の右に寄る＝本人の左を向く＝鏡表示の左', () => {
  assert.equal(faceDirection(faceFeatures(face({ noseX: 0.56 }))), 'left');
  assert.equal(faceDirection(faceFeatures(face({ noseX: 0.44 }))), 'right');
});

test('上下の向き', () => {
  assert.equal(faceDirection(faceFeatures(face({ noseY: 0.45 }))), 'up');
  assert.equal(faceDirection(faceFeatures(face({ noseY: 0.55 }))), 'down');
});

test('正面の登録（baseline）を基準にする', () => {
  const base = faceFeatures(face({ noseY: 0.53 }));
  assert.equal(faceDirection(faceFeatures(face({ noseY: 0.53 })), base), null);
  assert.equal(faceDirection(faceFeatures(face({ noseY: 0.55 }))), 'down');
  assert.equal(faceDirection(faceFeatures(face({ noseY: 0.55 })), base), null);
});

// テスト用の手：手首から人差し指の付け根、そこから指先を (dx, dy) の向きに伸ばす
function hand({ dx, dy, open = false }) {
  const lm = [];
  lm[0] = { x: 0.5, y: 0.8 };
  lm[5] = { x: 0.5, y: 0.6 };
  lm[9] = { x: 0.52, y: 0.6 };
  lm[8] = { x: 0.5 + dx, y: 0.6 + dy };
  lm[12] = open ? { x: 0.52, y: 0.4 } : { x: 0.53, y: 0.63 };
  return lm;
}

test('指の向き（生映像で右に伸ばす＝鏡表示の左）', () => {
  assert.equal(fingerDirection(hand({ dx: 0.15, dy: 0 })), 'left');
  assert.equal(fingerDirection(hand({ dx: -0.15, dy: 0 })), 'right');
  assert.equal(fingerDirection(hand({ dx: 0, dy: -0.15 })), 'up');
  assert.equal(fingerDirection(hand({ dx: 0, dy: 0.15 })), 'down');
});

test('指が短く見える（カメラを指している）・ななめ・手を開いている → 判定しない', () => {
  assert.equal(fingerDirection(hand({ dx: 0.02, dy: 0.02 })), null);
  assert.equal(fingerDirection(hand({ dx: 0.12, dy: -0.12 }), 1), null);
  assert.equal(fingerDirection(hand({ dx: 0, dy: -0.15, open: true })), null);
});

test('同じ向きが続いたら確定', () => {
  const s = new DirectionStabilizer(3);
  assert.equal(s.push('up'), null);
  assert.equal(s.push('up'), null);
  assert.equal(s.push('up'), 'up');
  assert.equal(s.push('left'), null);
  assert.equal(s.push(null), null);
});
