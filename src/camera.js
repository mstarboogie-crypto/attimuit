// カメラ映像を MediaPipe（Google の顔・手認識ライブラリ）で解析し、向きを通知する。

import {
  faceFeatures,
  faceDirection,
  fingerDirection,
  DirectionStabilizer,
} from './gesture.js';

const MP_VERSION = '1.0.1';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// GPU が使えない端末もあるので、失敗したら CPU で作り直す
async function createWithFallback(Task, fileset, modelAssetPath, options) {
  try {
    return await Task.createFromOptions(fileset, {
      baseOptions: { modelAssetPath, delegate: 'GPU' },
      ...options,
    });
  } catch {
    return Task.createFromOptions(fileset, {
      baseOptions: { modelAssetPath, delegate: 'CPU' },
      ...options,
    });
  }
}

export class Tracker {
  constructor(video, overlay) {
    this.video = video;
    this.overlay = overlay;
    this.ctx = overlay.getContext('2d');
    this.mode = 'off'; // 'face' | 'hand' | 'off'
    this.baseline = { horizontal: 0, vertical: 0 };
    this.stabilizer = new DirectionStabilizer(3);
    this.listeners = new Set();
    this.lastVideoTime = -1;
    this.running = false;
  }

  // カメラを起動し、初回だけ認識モデルを読み込む。2回目以降はカメラを再開するだけ。
  async start(onProgress = () => {}) {
    if (!window.isSecureContext) {
      throw new Error('カメラは https のページでしか使えません');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('このブラウザではカメラが使えません');
    }
    if (!this.stream) {
      onProgress('カメラを起動しています…');
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch (err) {
        if (err.name === 'NotAllowedError') throw new Error('カメラの使用が許可されませんでした');
        if (err.name === 'NotFoundError') throw new Error('カメラが見つかりませんでした');
        throw new Error('カメラを起動できませんでした');
      }
      this.video.srcObject = this.stream;
      await this.video.play();
    }

    if (!this.face) {
      onProgress('顔と手の認識モデルを読み込んでいます…（初回は少し時間がかかります）');
      try {
        const { FilesetResolver, FaceLandmarker, HandLandmarker } = await import(
          `${MP_BASE}/vision_bundle.mjs`
        );
        const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
        const [face, hand] = await Promise.all([
          createWithFallback(FaceLandmarker, fileset, FACE_MODEL, { runningMode: 'VIDEO', numFaces: 1 }),
          createWithFallback(HandLandmarker, fileset, HAND_MODEL, { runningMode: 'VIDEO', numHands: 1 }),
        ]);
        this.face = face;
        this.hand = hand;
      } catch {
        this.stop();
        throw new Error('認識モデルを読み込めませんでした。インターネット接続を確認してください');
      }
    }

    if (!this.running) {
      this.running = true;
      requestAnimationFrame(() => this.loop());
    }
  }

  // 'face' のときは顔だけ、'hand' のときは手だけ解析する（スマホでも重くならないように）
  setMode(mode) {
    if (mode !== this.mode) this.stabilizer.reset();
    this.mode = mode;
  }

  setBaseline(baseline) {
    this.baseline = baseline;
  }

  // 毎フレーム { mode, dir（確定した向き）, rawDir, features, found } を受け取る
  onFrame(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  loop() {
    if (!this.running) return;
    const v = this.video;
    if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      this.analyze(performance.now());
    }
    requestAnimationFrame(() => this.loop());
  }

  analyze(now) {
    const { video, overlay, ctx } = this;
    if (overlay.width !== video.videoWidth) {
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
    }
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    let found = false;
    let rawDir = null;
    let features = null;
    if (this.mode === 'face') {
      const lm = this.face.detectForVideo(video, now).faceLandmarks?.[0];
      if (lm) {
        found = true;
        features = faceFeatures(lm);
        rawDir = faceDirection(features, this.baseline);
        this.drawPoints(lm, [1, 10, 152, 234, 454], '#ff5d8f');
      }
    } else if (this.mode === 'hand') {
      const lm = this.hand.detectForVideo(video, now).landmarks?.[0];
      if (lm) {
        found = true;
        rawDir = fingerDirection(lm, video.videoWidth / video.videoHeight);
        this.drawPoints(lm, [5, 6, 7, 8], '#3fa9f5', true);
      }
    }

    const dir = this.stabilizer.push(rawDir);
    const event = { mode: this.mode, dir, rawDir, features, found };
    this.listeners.forEach((fn) => fn(event));
  }

  // 認識した点を映像の上に描く（映像は CSS で左右反転しているのでそのままの座標でよい）
  drawPoints(lm, indexes, color, connect = false) {
    const { ctx, overlay } = this;
    const pts = indexes.map((i) => ({ x: lm[i].x * overlay.width, y: lm[i].y * overlay.height }));
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    if (connect) {
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }
    pts.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // カメラを止める（読み込んだモデルは残すので、次の start は速い）
  stop() {
    this.running = false;
    this.setMode('off');
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }
}
