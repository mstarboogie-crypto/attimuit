import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMatch,
  currentTurn,
  judge,
  playTurn,
  isMatchOver,
  matchWinner,
  CpuBrain,
  updateStats,
  emptyStats,
} from '../src/game.js';

test('先攻なら最初は自分が攻め、そのあと交代する', () => {
  const m = createMatch({ rounds: 3, playerFirst: true });
  assert.equal(m.totalTurns, 6);
  assert.deepEqual(currentTurn(m), { round: 1, attacker: 'player', defender: 'cpu' });
  playTurn(m, { pointDir: 'up', lookDir: 'down' });
  assert.deepEqual(currentTurn(m), { round: 1, attacker: 'cpu', defender: 'player' });
  playTurn(m, { pointDir: 'up', lookDir: 'down' });
  assert.equal(currentTurn(m).round, 2);
  assert.equal(currentTurn(m).attacker, 'player');
});

test('後攻なら最初は CPU が攻め', () => {
  const m = createMatch({ rounds: 5, playerFirst: false });
  assert.equal(currentTurn(m).attacker, 'cpu');
});

test('判定：同じ向きなら当たり、時間切れのルール', () => {
  assert.equal(judge('left', 'left'), true);
  assert.equal(judge('left', 'right'), false);
  assert.equal(judge(null, 'left'), false); // 攻めの時間切れは得点なし
  assert.equal(judge('up', null), true); // 守りの時間切れは攻めの得点
});

test('得点・試合終了・勝者', () => {
  const m = createMatch({ rounds: 3, playerFirst: true });
  playTurn(m, { pointDir: 'up', lookDir: 'up' }); // あなた +1
  playTurn(m, { pointDir: 'up', lookDir: 'left' });
  playTurn(m, { pointDir: 'right', lookDir: 'right' }); // あなた +1
  playTurn(m, { pointDir: 'down', lookDir: 'down' }); // CPU +1
  assert.equal(isMatchOver(m), false);
  playTurn(m, { pointDir: 'left', lookDir: 'up' });
  playTurn(m, { pointDir: 'left', lookDir: 'up' });
  assert.equal(isMatchOver(m), true);
  assert.deepEqual(m.scores, { player: 2, cpu: 1 });
  assert.equal(matchWinner(m), 'player');
  assert.equal(m.history.length, 6);
});

test('引き分け', () => {
  const m = createMatch({ rounds: 3, playerFirst: true });
  assert.equal(matchWinner(m), 'draw');
});

test('CPU（賢さ 1）はあなたがよく向く方向を指し、よく指す方向を避ける', () => {
  const cpu = new CpuBrain(1, () => 0);
  for (let i = 0; i < 5; i++) cpu.observePlayerLook('left');
  assert.equal(cpu.choosePoint(), 'left');
  for (let i = 0; i < 5; i++) cpu.observePlayerPoint('up');
  assert.notEqual(cpu.chooseLook(), 'up');
});

test('CPU（賢さ 0）はランダムで、上下左右のどれかを返す', () => {
  const cpu = new CpuBrain(0);
  for (let i = 0; i < 50; i++) {
    assert.ok(['up', 'down', 'left', 'right'].includes(cpu.choosePoint()));
    assert.ok(['up', 'down', 'left', 'right'].includes(cpu.chooseLook()));
  }
});

test('連勝記録', () => {
  let s = emptyStats();
  s = updateStats(s, 'player');
  s = updateStats(s, 'player');
  assert.equal(s.streak, 2);
  s = updateStats(s, 'cpu');
  assert.equal(s.streak, 0);
  assert.equal(s.bestStreak, 2);
  s = updateStats(s, 'draw');
  assert.deepEqual(s, { wins: 2, losses: 1, draws: 1, streak: 0, bestStreak: 2 });
});
