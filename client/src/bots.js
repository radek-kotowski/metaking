import { seededRng } from './prng.js';

const BOT_SEED  = 42;
const BOT_COUNT = 10000;
const DRIFT_PCT = 0.125;
const WINDOW_MS = 10 * 60 * 1000;

const FIRST_NAMES = ['alex','jake','mike','tom','sam','dan','max','ben','leo','zoe',
  'emma','luke','ryan','adam','josh','kyle','noah','ethan','liam','owen',
  'tyler','cole','sean','dean','mark','nick','brad','evan','eric','ian'];
const GAMER_WORDS = ['lol','pro','gg','ez','noob','pwn','rekt','clutch','yolo','lit'];
const COOL_WORDS  = ['shadow','void','frost','storm','blaze','phantom','rogue','stealth','neon','apex',
  'fury','reaper','ghost','viper','nexus','zenith','surge','cipher','zero','ace'];
const SEPARATORS  = ['','_','','.',''];

function _pick(arr, seed) { return arr[seed % arr.length]; }

function _nickname(i) {
  const style = i % 6;
  const num   = (i % 9999) + 1;
  const snum  = (i % 999)  + 1;
  const sep   = _pick(SEPARATORS, Math.floor(i / 7));
  switch (style) {
    case 0: return `${_pick(FIRST_NAMES, i)}${i % 3 === 0 ? num : snum}`;
    case 1: return `${_pick(GAMER_WORDS, i)}${snum}`;
    case 2: return `${_pick(COOL_WORDS, i)}${sep}${snum}`;
    case 3: return `${_pick(FIRST_NAMES, i)}${sep}${_pick(COOL_WORDS, Math.floor(i/5))}`.slice(0,16);
    case 4: return `${_pick(COOL_WORDS, i).toUpperCase()}${snum}`.slice(0,16);
    default: return `${_pick(FIRST_NAMES, i)}${_pick(GAMER_WORDS, Math.floor(i/3)).toUpperCase()}`.slice(0,16);
  }
}

function _baseMana(rng) {
  const r = rng();
  if (r < 0.60) return Math.floor(100  + rng() * 1900);
  if (r < 0.90) return Math.floor(2000 + rng() * 8000);
  if (r < 0.99) return Math.floor(10000 + rng() * 40000);
  return Math.floor(50000 + rng() * 50000);
}

let _bots = null;

function _getBots() {
  if (_bots) return _bots;
  const rng = seededRng(BOT_SEED);
  _bots = Array.from({ length: BOT_COUNT }, (_, i) => ({
    nickname: _nickname(i),
    mana:     _baseMana(rng),
  }));
  return _bots;
}

function _timeSeed() {
  return Math.floor(Date.now() / WINDOW_MS);
}

function _driftedMana(baseMana, botIndex, timeSeed) {
  const rng    = seededRng((BOT_SEED ^ ((timeSeed * 2654435761) >>> 0) ^ ((botIndex * 1234567) >>> 0)) >>> 0);
  const factor = 1 + (rng() * DRIFT_PCT * 2 - DRIFT_PCT);
  return Math.max(100, Math.round(baseMana * factor));
}

/**
 * Returns top-10 leaderboard entries including the player.
 * @param {string} playerNick
 * @param {number} playerMana
 * @returns {{ rank: number, nickname: string, mana: number, isMetaKing: boolean, isPlayer: boolean }[]}
 */
export function getLeaderboard(playerNick, playerMana) {
  const ts   = _timeSeed();
  const bots = _getBots();

  const scored = bots.map((b, i) => ({
    nickname: b.nickname,
    mana:     _driftedMana(b.mana, i, ts),
    isPlayer: false,
  }));

  scored.push({ nickname: playerNick, mana: playerMana, isPlayer: true });
  scored.sort((a, b) => b.mana - a.mana);

  const playerIdx   = scored.findIndex(e => e.isPlayer);
  const top10       = scored.slice(0, 10);
  const playerInTop = top10.some(e => e.isPlayer);
  if (!playerInTop) top10[9] = scored[playerIdx];

  return top10.map(e => ({
    rank:       scored.indexOf(e) + 1,
    nickname:   e.nickname,
    mana:       e.mana,
    isMetaKing: scored.indexOf(e) === 0,
    isPlayer:   e.isPlayer,
  }));
}

export function currentTimeSeed() {
  return _timeSeed();
}
