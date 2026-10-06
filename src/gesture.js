// カメラで検出した顔・手の点（ランドマーク）から「向き」を判定する計算。
// 画面は鏡のように左右反転して表示するので、ここでも左右反転した座標で考えます。
// （あなたが自分の左を向く／指すと、画面の左＝ 'left' になる）

// MediaPipe Face Landmarker の点番号
const FACE = { noseTip: 1, forehead: 10, chin: 152, cheekA: 234, cheekB: 454 };
// MediaPipe Hand Landmarker の点番号
const HAND = { wrist: 0, indexMcp: 5, indexTip: 8, middleMcp: 9, middleTip: 12 };

// 正面からどれだけずれたら「向いた」とみなすか（顔の幅・高さに対する割合）
export const FACE_THRESHOLD = { horizontal: 0.1, vertical: 0.07 };

const mirrorX = (p) => 1 - p.x;

// 顔の向きを表す2つの数値を返す。
// horizontal: 負なら画面の左、正なら右。vertical: 負なら上、正なら下。
export function faceFeatures(landmarks) {
  const nose = landmarks[FACE.noseTip];
  const a = landmarks[FACE.cheekA];
  const b = landmarks[FACE.cheekB];
  const top = landmarks[FACE.forehead];
  const chin = landmarks[FACE.chin];
  if (!nose || !a || !b || !top || !chin) return null;

  const width = Math.abs(mirrorX(b) - mirrorX(a));
  const height = Math.abs(chin.y - top.y);
  if (width < 1e-6 || height < 1e-6) return null;

  const centerX = (mirrorX(a) + mirrorX(b)) / 2;
  const centerY = (top.y + chin.y) / 2;
  return {
    horizontal: (mirrorX(nose) - centerX) / width,
    vertical: (nose.y - centerY) / height,
  };
}

// 正面を向いたときの値（baseline）との差から上下左右を決める。どちらでもなければ null。
export function faceDirection(features, baseline = { horizontal: 0, vertical: 0 }, threshold = FACE_THRESHOLD) {
  if (!features) return null;
  const h = (features.horizontal - baseline.horizontal) / threshold.horizontal;
  const v = (features.vertical - baseline.vertical) / threshold.vertical;
  if (Math.abs(h) < 1 && Math.abs(v) < 1) return null;
  if (Math.abs(h) >= Math.abs(v)) return h < 0 ? 'left' : 'right';
  return v < 0 ? 'up' : 'down';
}

export function averageFeatures(samples) {
  const valid = samples.filter(Boolean);
  if (valid.length === 0) return null;
  const sum = valid.reduce(
    (acc, f) => ({ horizontal: acc.horizontal + f.horizontal, vertical: acc.vertical + f.vertical }),
    { horizontal: 0, vertical: 0 },
  );
  return { horizontal: sum.horizontal / valid.length, vertical: sum.vertical / valid.length };
}

// 人差し指の向きを判定する。aspect は映像の 幅÷高さ（縦横の縮尺をそろえるため）。
// 指が伸びていない・カメラの方を指している（短く見える）・手を開いている → null
export function fingerDirection(landmarks, aspect = 4 / 3) {
  const pt = (i) => {
    const p = landmarks[i];
    return p ? { x: mirrorX(p) * aspect, y: p.y } : null;
  };
  const wrist = pt(HAND.wrist);
  const indexMcp = pt(HAND.indexMcp);
  const indexTip = pt(HAND.indexTip);
  const middleMcp = pt(HAND.middleMcp);
  const middleTip = pt(HAND.middleTip);
  if (!wrist || !indexMcp || !indexTip || !middleMcp || !middleTip) return null;

  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const palm = dist(wrist, middleMcp);
  const indexLen = dist(indexMcp, indexTip);
  if (palm < 1e-6) return null;
  if (indexLen < palm * 0.5) return null; // 人差し指が伸びていない
  if (dist(middleMcp, middleTip) > indexLen * 0.7) return null; // 手を開いている（指差しではない）

  const dx = indexTip.x - indexMcp.x;
  const dy = indexTip.y - indexMcp.y;
  // ななめは判定しない（はっきりした方向だけ）
  if (Math.abs(dx) > Math.abs(dy) * 1.2) return dx < 0 ? 'left' : 'right';
  if (Math.abs(dy) > Math.abs(dx) * 1.2) return dy < 0 ? 'up' : 'down';
  return null;
}

// 1フレームだけの誤判定を防ぐため、同じ向きが frames 回続いたら確定する。
export class DirectionStabilizer {
  constructor(frames = 3) {
    this.frames = frames;
    this.reset();
  }

  reset() {
    this.candidate = null;
    this.count = 0;
  }

  push(dir) {
    if (dir === this.candidate) {
      this.count += 1;
    } else {
      this.candidate = dir;
      this.count = 1;
    }
    return this.candidate !== null && this.count >= this.frames ? this.candidate : null;
  }
}
