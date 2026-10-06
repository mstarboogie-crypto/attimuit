// 効果音（音声ファイルを使わず、ブラウザで音を合成する）

let ctx = null;
let muted = false;

export function setMuted(value) {
  muted = value;
}

export function isMuted() {
  return muted;
}

// ブラウザは「ユーザーが操作したあと」でないと音を鳴らせないので、最初のクリックで呼ぶ
export function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx ??= new AC();
  if (ctx.state === 'suspended') ctx.resume();
}

function tone(freq, start, duration, type = 'square', volume = 0.08) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t = ctx.currentTime + start;
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration);
}

const SOUNDS = {
  chant: () => tone(523, 0, 0.15),
  hoi: () => tone(880, 0, 0.25),
  hit: () => [784, 988, 1175].forEach((f, i) => tone(f, i * 0.08, 0.2, 'triangle', 0.12)),
  safe: () => [392, 330].forEach((f, i) => tone(f, i * 0.1, 0.18, 'sine', 0.12)),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.3, 'triangle', 0.12)),
  lose: () => [392, 349, 311, 262].forEach((f, i) => tone(f, i * 0.15, 0.3, 'sine', 0.12)),
};

export function play(name) {
  if (muted || !ctx) return;
  SOUNDS[name]?.();
}
