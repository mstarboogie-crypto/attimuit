// 画面の切り替えと試合の流れ

import {
  DIFFICULTIES,
  DIRECTION_ARROW,
  DIRECTION_LABEL,
  CpuBrain,
  createMatch,
  currentTurn,
  playTurn,
  isMatchOver,
  matchWinner,
  emptyStats,
  updateStats,
} from './game.js';
import { averageFeatures } from './gesture.js';
import { Tracker } from './camera.js';
import * as sound from './sound.js';

const $ = (id) => document.getElementById(id);
const POINT_EMOJI = { up: '👆', down: '👇', left: '👈', right: '👉' };

// ---------- 保存（ブラウザの localStorage。使えない環境でも動くように） ----------

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 保存できなくてもゲームは続ける */
    }
  },
};

const KEYS = { settings: 'attimuit-settings', stats: 'attimuit-stats', muted: 'attimuit-muted' };

const state = {
  settings: { rounds: '3', order: 'first', difficulty: 'easy', input: 'camera', ...store.get(KEYS.settings, {}) },
  stats: store.get(KEYS.stats, {}),
  inputMode: 'buttons', // 実際に使っている操作方法
  tracker: null,
  calibrated: false,
  controller: null, // 試合や準備を途中でやめるための AbortController
  onPadInput: null,
};

class Aborted extends Error {}

function newSession() {
  state.controller?.abort();
  state.controller = new AbortController();
  return state.controller.signal;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Aborted());
    const id = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new Aborted());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// ---------- 画面 ----------

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  window.scrollTo(0, 0);
}

function placeCamera(slotId) {
  const box = $('cam-box');
  if (slotId) $(slotId).appendChild(box);
  else document.body.appendChild(box);
  box.classList.toggle('shown', Boolean(slotId));
}

function goTitle() {
  newSession();
  state.tracker?.stop();
  placeCamera(null);
  renderTitleStats();
  showScreen('title');
}

// ---------- カメラの表示（向きのバッジ） ----------

function onCameraFrame(e) {
  const dir = e.dir ?? e.rawDir;
  $('cam-dir').textContent = dir ? (e.mode === 'hand' ? POINT_EMOJI[dir] : DIRECTION_ARROW[dir]) : '';
  $('cam-dir').classList.toggle('locked', Boolean(e.dir));
  let note = '';
  if (e.mode === 'face' && !e.found) note = '顔が見つかりません';
  if (e.mode === 'hand' && !e.found) note = '手が見つかりません';
  $('cam-note').textContent = note;
}

function ensureTracker() {
  if (!state.tracker) {
    state.tracker = new Tracker($('cam-video'), $('cam-overlay'));
    state.tracker.onFrame(onCameraFrame);
  }
  return state.tracker;
}

// ---------- 正面の登録（キャリブレーション） ----------

async function calibrate(signal, say) {
  const tracker = ensureTracker();
  tracker.setMode('face');
  for (;;) {
    for (const n of [3, 2, 1]) {
      say(`正面を向いて、じっとしてね… ${n}`);
      await sleep(600, signal);
    }
    const samples = [];
    const unsubscribe = tracker.onFrame((e) => e.features && samples.push(e.features));
    say('登録中…');
    try {
      await sleep(1000, signal);
    } finally {
      unsubscribe();
    }
    if (samples.length >= 5) {
      tracker.setBaseline(averageFeatures(samples));
      state.calibrated = true;
      return;
    }
    say('顔が見つかりません。明るい場所で、顔全体が映るようにしてね');
    await sleep(2000, signal);
  }
}

// ---------- カメラ準備画面 ----------

async function goSetup() {
  const signal = newSession();
  showScreen('setup');
  const status = $('setup-status');
  const say = (msg) => (status.textContent = msg);
  $('setup-test').hidden = true;
  $('recalibrate-btn').hidden = true;
  $('setup-start-btn').hidden = true;
  placeCamera('setup-cam-slot');

  try {
    await ensureTracker().start(say);
    // 読み込み中に「ボタン操作で遊ぶ」「タイトルへ」が押されたら、カメラを止めて終わる
    if (signal.aborted) {
      if (state.inputMode !== 'camera' || !$('screen-game').classList.contains('active')) state.tracker.stop();
      return;
    }
    if (!state.calibrated) await calibrate(signal, say);
  } catch (err) {
    if (err instanceof Aborted) return;
    placeCamera(null);
    say(`${err.message}。ボタン操作で遊べます。`);
    return;
  }

  say('準備OK！ 顔や指を動かして、向きが正しく出るか確かめてね');
  $('setup-test').hidden = false;
  $('recalibrate-btn').hidden = false;
  $('setup-start-btn').hidden = false;
  state.tracker.setMode(document.querySelector('input[name="test"]:checked').value);
}

async function recalibrate() {
  const signal = newSession();
  $('setup-start-btn').hidden = true;
  const say = (msg) => ($('setup-status').textContent = msg);
  try {
    await calibrate(signal, say);
  } catch (err) {
    if (err instanceof Aborted) return;
    throw err;
  }
  say('登録し直しました！');
  $('setup-start-btn').hidden = false;
  state.tracker.setMode(document.querySelector('input[name="test"]:checked').value);
}

// ---------- 試合 ----------

function setBanner(text, kind = '') {
  const el = $('banner');
  el.textContent = text;
  el.className = `banner ${kind}`;
  // 同じ文字でもアニメーションをやり直す
  void el.offsetWidth;
  el.classList.add('pop');
}

function setTimer(ratio) {
  $('timer-bar').style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;
}

function setCpuLook(dir) {
  $('cpu-face').dataset.look = dir ?? 'none';
}

function setCpuHand(content) {
  const hand = $('cpu-hand');
  hand.hidden = content === null;
  if (content !== null) hand.textContent = content;
}

function setPadSelected(dir) {
  document.querySelectorAll('#pad button').forEach((b) => b.classList.toggle('selected', b.dataset.dir === dir));
}

function updateScoreboard(match, turn) {
  $('score-player').textContent = match.scores.player;
  $('score-cpu').textContent = match.scores.cpu;
  if (turn) {
    $('round-label').textContent = `第${turn.round}回戦 / ${match.rounds}`;
    const attack = turn.attacker === 'player';
    $('role-label').textContent = attack ? 'あなたの攻め 👉' : 'あなたの守り 🙂';
    $('role-label').className = `role ${attack ? 'attack' : 'defend'}`;
  }
}

function bump(id) {
  const el = $(id);
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

// プレイヤーが向きを決めるのを待つ。時間切れなら null。
function waitForPlayerDir(signal, timeLimitMs) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    let raf = 0;
    let unsubscribe = () => {};
    const cleanup = () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      state.onPadInput = null;
      signal.removeEventListener('abort', onAbort);
    };
    const finish = (dir) => {
      cleanup();
      resolve(dir);
    };
    const onAbort = () => {
      cleanup();
      reject(new Aborted());
    };
    signal.addEventListener('abort', onAbort, { once: true });

    if (state.inputMode === 'camera') {
      unsubscribe = state.tracker.onFrame((e) => e.dir && finish(e.dir));
    } else {
      state.onPadInput = finish;
    }

    const tick = () => {
      const ratio = 1 - (performance.now() - start) / timeLimitMs;
      setTimer(ratio);
      if (ratio <= 0) finish(null);
      else raf = requestAnimationFrame(tick);
    };
    tick();
  });
}

// 「あっち向いて…」の間に動いたらフライング
async function chant(signal) {
  let early = false;
  if (state.inputMode === 'buttons') state.onPadInput = () => (early = true);
  let latest = null;
  const unsubscribe =
    state.inputMode === 'camera' ? state.tracker.onFrame((e) => (latest = e.dir)) : () => {};
  try {
    setTimer(1);
    setBanner('あっち向いて…', 'chant');
    sound.play('chant');
    await sleep(1000, signal);
  } finally {
    unsubscribe();
    state.onPadInput = null;
  }
  return early || latest !== null;
}

async function playOneTurn(ctx, signal) {
  const { match, brain, difficulty } = ctx;
  const turn = currentTurn(match);
  const playerAttacks = turn.attacker === 'player';
  const camera = state.inputMode === 'camera';

  updateScoreboard(match, turn);
  setCpuLook(null);
  setCpuHand(playerAttacks ? null : '✊');
  setPadSelected(null);
  $('reveal').textContent = '';
  $('player-hint').textContent = camera
    ? playerAttacks
      ? 'グーで構えて、「ホイ！」で人差し指を上下左右に向けよう'
      : '正面を向いて、「ホイ！」で顔を上下左右に向けよう'
    : '「ホイ！」で矢印ボタン（または矢印キー）を押そう';
  setBanner(`第${turn.round}回戦　${playerAttacks ? 'あなたの攻め！' : 'あなたの守り！'}`, playerAttacks ? 'attack' : 'defend');
  if (camera) state.tracker.setMode(playerAttacks ? 'hand' : 'face');
  await sleep(1300, signal);

  let fouls = 0;
  while (await chant(signal)) {
    fouls += 1;
    setBanner('フライング！ もう一回', 'foul');
    sound.play('safe');
    await sleep(1300, signal);
    // 何度も続くときは、正面の登録がずれている可能性があるので登録し直す
    if (camera && !playerAttacks && fouls >= 3) {
      await calibrate(signal, (msg) => setBanner(msg, 'chant'));
      fouls = 0;
    }
  }

  const cpuDir = playerAttacks ? brain.chooseLook() : brain.choosePoint();
  setBanner('ホイ！', 'hoi');
  sound.play('hoi');
  $('cpu-face').classList.add('hoi');
  const playerDir = await waitForPlayerDir(signal, difficulty.timeLimitMs);
  $('cpu-face').classList.remove('hoi');
  if (camera) state.tracker.setMode('off');
  setPadSelected(playerDir);

  // CPU の手は、あなたが決めたあとに見せる（先に見えると有利になってしまうため）
  if (playerAttacks) setCpuLook(cpuDir);
  else setCpuHand(POINT_EMOJI[cpuDir]);

  const record = playTurn(
    match,
    playerAttacks ? { pointDir: playerDir, lookDir: cpuDir } : { pointDir: cpuDir, lookDir: playerDir },
  );
  if (playerDir) {
    if (playerAttacks) brain.observePlayerPoint(playerDir);
    else brain.observePlayerLook(playerDir);
  }

  const you = playerDir
    ? playerAttacks
      ? `${POINT_EMOJI[playerDir]} ${DIRECTION_LABEL[playerDir]}`
      : `${DIRECTION_ARROW[playerDir]} ${DIRECTION_LABEL[playerDir]}`
    : '⏰ 時間切れ';
  const cpu = playerAttacks
    ? `${DIRECTION_ARROW[cpuDir]} ${DIRECTION_LABEL[cpuDir]}`
    : `${POINT_EMOJI[cpuDir]} ${DIRECTION_LABEL[cpuDir]}`;
  $('reveal').textContent = `あなた ${you}　／　CPU ${cpu}`;

  let message;
  let good;
  if (playerAttacks) {
    good = record.hit;
    message = record.hit ? 'やった！ 1点！' : playerDir ? 'よけられた！' : '時間切れ…';
  } else {
    good = !record.hit;
    message = !record.hit ? 'セーフ！' : playerDir ? 'つられた！ CPUに1点' : '時間切れ！ CPUに1点';
  }
  setBanner(message, good ? 'good' : 'bad');
  sound.play(good ? 'hit' : 'safe');
  updateScoreboard(match);
  if (record.hit) bump(playerAttacks ? 'score-player' : 'score-cpu');
  await sleep(1800, signal);
}

async function startMatch(inputMode) {
  const signal = newSession();
  state.inputMode = inputMode;
  const { rounds, order, difficulty: diffKey } = state.settings;
  const difficulty = DIFFICULTIES[diffKey];
  const playerFirst = order === 'random' ? Math.random() < 0.5 : order === 'first';
  const ctx = {
    match: createMatch({ rounds: Number(rounds), playerFirst }),
    brain: new CpuBrain(difficulty.cpuSkill),
    difficulty,
    diffKey,
  };

  showScreen('game');
  const camera = inputMode === 'camera';
  placeCamera(camera ? 'game-cam-slot' : null);
  $('pad').hidden = camera;
  updateScoreboard(ctx.match, currentTurn(ctx.match));

  try {
    if (camera) await ensureTracker().start(() => {});
    setBanner(playerFirst ? 'あなたが先攻！' : 'あなたは後攻！');
    await sleep(1200, signal);
    while (!isMatchOver(ctx.match)) await playOneTurn(ctx, signal);
    showResult(ctx);
  } catch (err) {
    if (err instanceof Aborted) return;
    // カメラが途中で使えなくなったときなど
    setBanner(err.message, 'bad');
  }
}

// ---------- 結果 ----------

function showResult({ match, diffKey }) {
  state.tracker?.setMode('off');
  const winner = matchWinner(match);
  state.stats[diffKey] = updateStats(state.stats[diffKey] ?? emptyStats(), winner);
  store.set(KEYS.stats, state.stats);

  const view = {
    player: { emoji: '🎉', title: 'あなたの勝ち！', sound: 'win' },
    cpu: { emoji: '😵', title: 'CPUの勝ち…', sound: 'lose' },
    draw: { emoji: '🤝', title: '引き分け！', sound: 'safe' },
  }[winner];
  $('result-emoji').textContent = view.emoji;
  $('result-heading').textContent = view.title;
  $('result-score').textContent = `あなた ${match.scores.player} － ${match.scores.cpu} CPU`;
  sound.play(view.sound);

  const s = state.stats[diffKey];
  $('result-stats').innerHTML = `
    <p class="stats-title">${DIFFICULTIES[diffKey].label}のきろく</p>
    <div class="stat-row">
      <div><span class="num">${s.streak}</span><span>連勝中</span></div>
      <div><span class="num">${s.bestStreak}</span><span>最高連勝</span></div>
      <div><span class="num">${s.wins}<small>勝</small>${s.losses}<small>敗</small>${s.draws}<small>分</small></span><span>通算</span></div>
    </div>`;

  const items = match.history.map((h) => {
    const who = h.attacker === 'player' ? 'あなたの攻め' : 'あなたの守り';
    const point = h.pointDir ? `${POINT_EMOJI[h.pointDir]}${DIRECTION_LABEL[h.pointDir]}` : '⏰';
    const look = h.lookDir ? `${DIRECTION_ARROW[h.lookDir]}${DIRECTION_LABEL[h.lookDir]}` : '⏰';
    const li = document.createElement('li');
    li.textContent = `第${h.round}回戦 ${who}：指 ${point} ／ 顔 ${look} → ${h.hit ? '当たり' : 'はずれ'}`;
    return li;
  });
  $('result-history').replaceChildren(...items);
  showScreen('result');
}

function renderTitleStats() {
  const rows = Object.entries(DIFFICULTIES)
    .map(([key, d]) => {
      const s = { ...emptyStats(), ...state.stats[key] };
      return `<tr><th>${d.label}</th><td>${s.streak}</td><td>${s.bestStreak}</td><td>${s.wins}勝${s.losses}敗${s.draws}分</td></tr>`;
    })
    .join('');
  $('title-stats').innerHTML = `
    <p class="stats-title">きろく</p>
    <table><thead><tr><th></th><th>連勝中</th><th>最高連勝</th><th>通算</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------- 操作の受け付け ----------

function readSettings() {
  const data = new FormData($('settings'));
  state.settings = Object.fromEntries(['rounds', 'order', 'difficulty', 'input'].map((k) => [k, data.get(k)]));
  store.set(KEYS.settings, state.settings);
}

function applySettings() {
  for (const [name, value] of Object.entries(state.settings)) {
    const input = document.querySelector(`#settings input[name="${name}"][value="${value}"]`);
    if (input) input.checked = true;
  }
}

function setupEvents() {
  $('settings').addEventListener('submit', (e) => {
    e.preventDefault();
    sound.unlockAudio();
    readSettings();
    if (state.settings.input === 'camera') goSetup();
    else startMatch('buttons');
  });

  $('setup-start-btn').addEventListener('click', () => startMatch('camera'));
  $('setup-buttons-btn').addEventListener('click', () => {
    state.tracker?.stop();
    startMatch('buttons');
  });
  $('recalibrate-btn').addEventListener('click', recalibrate);
  document.querySelectorAll('input[name="test"]').forEach((r) =>
    r.addEventListener('change', () => state.tracker?.setMode(r.value)),
  );

  document.querySelectorAll('.back-btn').forEach((b) => b.addEventListener('click', goTitle));
  $('quit-btn').addEventListener('click', goTitle);
  $('again-btn').addEventListener('click', () => {
    sound.unlockAudio();
    startMatch(state.inputMode);
  });

  $('pad').addEventListener('click', (e) => {
    const dir = e.target.closest('button')?.dataset.dir;
    if (dir) state.onPadInput?.(dir);
  });

  const KEY_DIR = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
  };
  document.addEventListener('keydown', (e) => {
    const dir = KEY_DIR[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!dir || state.inputMode !== 'buttons' || !$('screen-game').classList.contains('active')) return;
    e.preventDefault();
    state.onPadInput?.(dir);
  });

  const muteBtn = $('mute-btn');
  const renderMute = () => {
    muteBtn.textContent = sound.isMuted() ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', sound.isMuted() ? '音を出す' : '音を消す');
  };
  sound.setMuted(store.get(KEYS.muted, false));
  renderMute();
  muteBtn.addEventListener('click', () => {
    sound.unlockAudio();
    sound.setMuted(!sound.isMuted());
    store.set(KEYS.muted, sound.isMuted());
    renderMute();
  });
}

applySettings();
renderTitleStats();
setupEvents();
