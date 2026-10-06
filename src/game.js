// あっち向いてホイ のルール・CPU・記録をまとめたファイル。
// 画面やカメラには依存しないので、Node.js でテストできます。

export const DIRECTIONS = ['up', 'down', 'left', 'right'];

export const DIRECTION_LABEL = { up: '上', down: '下', left: '左', right: '右' };
export const DIRECTION_ARROW = { up: '↑', down: '↓', left: '←', right: '→' };

export const ROUND_OPTIONS = [3, 5, 10];

// 難易度：timeLimitMs は「ホイ！」から向きを決めるまでの制限時間。
// cpuSkill は CPU があなたのクセを読んでくる確率（0 なら完全ランダム）。
export const DIFFICULTIES = {
  easy: { label: 'かんたん', timeLimitMs: 3000, cpuSkill: 0 },
  normal: { label: 'ふつう', timeLimitMs: 2000, cpuSkill: 0.5 },
  hard: { label: 'むずかしい', timeLimitMs: 1000, cpuSkill: 0.85 },
};

// ---------- 試合の進行 ----------

// rounds 回戦。1回戦ごとに「攻め」と「守り」を1回ずつ行う。
export function createMatch({ rounds, playerFirst }) {
  return {
    rounds,
    playerFirst,
    turnIndex: 0,
    totalTurns: rounds * 2,
    scores: { player: 0, cpu: 0 },
    history: [],
  };
}

export function currentTurn(match) {
  const i = match.turnIndex;
  const playerAttacks = (i % 2 === 0) === match.playerFirst;
  return {
    round: Math.floor(i / 2) + 1,
    attacker: playerAttacks ? 'player' : 'cpu',
    defender: playerAttacks ? 'cpu' : 'player',
  };
}

// 攻めの指と守りの顔が同じ向きなら攻めの勝ち（1点）。
// pointDir が null = 攻めが時間切れ → 得点なし。
// lookDir が null = 守りが時間切れ → 逃げ遅れたので攻めの得点。
export function judge(pointDir, lookDir) {
  if (pointDir === null) return false;
  if (lookDir === null) return true;
  return pointDir === lookDir;
}

export function playTurn(match, { pointDir, lookDir }) {
  const turn = currentTurn(match);
  const hit = judge(pointDir, lookDir);
  if (hit) match.scores[turn.attacker] += 1;
  const record = { ...turn, pointDir, lookDir, hit };
  match.history.push(record);
  match.turnIndex += 1;
  return record;
}

export function isMatchOver(match) {
  return match.turnIndex >= match.totalTurns;
}

export function matchWinner(match) {
  const { player, cpu } = match.scores;
  if (player > cpu) return 'player';
  if (cpu > player) return 'cpu';
  return 'draw';
}

// ---------- CPU ----------

// あなたの「指差し」と「顔の向き」の履歴から次の手を予想する。
// よく出す向き（頻度）と、直前の向きから次に出しやすい向き（つながり）の両方を見る。
class HabitModel {
  constructor() {
    this.freq = Object.fromEntries(DIRECTIONS.map((d) => [d, 0]));
    this.trans = Object.fromEntries(
      DIRECTIONS.map((from) => [from, Object.fromEntries(DIRECTIONS.map((d) => [d, 0]))]),
    );
    this.last = null;
  }

  observe(dir) {
    if (!DIRECTIONS.includes(dir)) return;
    this.freq[dir] += 1;
    if (this.last) this.trans[this.last][dir] += 1;
    this.last = dir;
  }

  scores() {
    return Object.fromEntries(
      DIRECTIONS.map((d) => [d, 1 + this.freq[d] + (this.last ? 2 * this.trans[this.last][d] : 0)]),
    );
  }
}

function pickBy(scores, better, rng) {
  let best = [];
  let bestScore = null;
  for (const d of DIRECTIONS) {
    const s = scores[d];
    if (bestScore === null || better(s, bestScore)) {
      best = [d];
      bestScore = s;
    } else if (s === bestScore) {
      best.push(d);
    }
  }
  return best[Math.floor(rng() * best.length)];
}

export class CpuBrain {
  constructor(skill, rng = Math.random) {
    this.skill = skill;
    this.rng = rng;
    this.playerPoints = new HabitModel();
    this.playerLooks = new HabitModel();
  }

  randomDir() {
    return DIRECTIONS[Math.floor(this.rng() * DIRECTIONS.length)];
  }

  useHabit() {
    return this.rng() < this.skill;
  }

  // CPU が攻め：あなたが向きそうな方向を指す。
  choosePoint() {
    if (!this.useHabit()) return this.randomDir();
    return pickBy(this.playerLooks.scores(), (a, b) => a > b, this.rng);
  }

  // CPU が守り：あなたが指しそうにない方向を向く。
  chooseLook() {
    if (!this.useHabit()) return this.randomDir();
    return pickBy(this.playerPoints.scores(), (a, b) => a < b, this.rng);
  }

  observePlayerPoint(dir) {
    this.playerPoints.observe(dir);
  }

  observePlayerLook(dir) {
    this.playerLooks.observe(dir);
  }
}

// ---------- 記録（勝敗・連勝） ----------

export function emptyStats() {
  return { wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0 };
}

// 勝てば連勝が伸び、負け・引き分けで連勝が途切れる。
export function updateStats(stats, winner) {
  const next = { ...emptyStats(), ...stats };
  if (winner === 'player') {
    next.wins += 1;
    next.streak += 1;
    next.bestStreak = Math.max(next.bestStreak, next.streak);
  } else {
    if (winner === 'cpu') next.losses += 1;
    else next.draws += 1;
    next.streak = 0;
  }
  return next;
}
