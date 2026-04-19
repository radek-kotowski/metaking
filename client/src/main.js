import { Game }         from './game.js';
import { hud, screens } from './hud.js';
import { C, randomWeaponForMana } from './constants.js';
import { getLeaderboard, currentTimeSeed } from './bots.js';

// ─── Persistent state ─────────────────────────────────────────────────────────
const SAVE_KEY = 'metaking_save';

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function writeSave(data) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch {}
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch {}
}

// ─── Session state ────────────────────────────────────────────────────────────
let game        = null;
let nickname    = '';
let _lastLbSeed = null;
let _lbInterval = null;

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  screens.show('screen-title');
  const loadingEl = document.getElementById('loading-status');

  game = new Game({
    onVitalsChanged: (m, s, h) => {
      hud.updateVitals(m, s, h);
      // Persist mana on every change so progress is never lost
      const save = loadSave();
      if (save) writeSave({ ...save, mana: m, stamina: s, hearts: h });
    },
    onDied:          (summary) => handleDeath(summary),
    onPortalEntered: (res)     => handlePortalEntered(res),
    onPortalError:   (msg)     => hud.showMessage(msg),
    onPortalNearby:  (near)    => hud.showPortalPrompt(near),
  });

  const btnPlay   = document.getElementById('btn-play');
  const btnOnline = document.getElementById('btn-play-online');
  btnPlay.disabled = true;
  if (btnOnline) btnOnline.style.display = 'none';

  await game.loadAssets((msg) => { if (loadingEl) loadingEl.textContent = msg; });
  if (loadingEl) loadingEl.textContent = '';

  btnPlay.disabled = false;
  btnPlay.addEventListener('click', () => startGame());
}

// ─── Start ────────────────────────────────────────────────────────────────────
async function startGame() {
  const save = loadSave();

  // First-time player: show onboarding then nickname
  if (!save) {
    screens.show('screen-onboarding');
    document.getElementById('btn-onboarding-continue').onclick = () => {
      screens.show('screen-nickname');
      setupNicknameScreen((nick) => {
        nickname = nick;
        _launchFresh();
      });
    };
    return;
  }

  // Returning player with saved nickname
  nickname = save.nickname || '';
  if (!nickname) {
    screens.show('screen-nickname');
    setupNicknameScreen((nick) => {
      nickname = nick;
      _launchFresh();
    });
    return;
  }

  // Resume from saved state
  _launchWithState(save.mana, save.stamina, save.hearts, save.weaponName, save.weaponTier);
}

function _launchFresh() {
  const w = randomWeaponForMana(C.manaMin);
  writeSave({ nickname, mana: C.manaMin, stamina: C.staminaStart, hearts: C.heartsStart, weaponName: w.name, weaponTier: w.tier });
  _launchWithState(C.manaMin, C.staminaStart, C.heartsStart, w.name, w.tier);
}

function _launchWithState(mana, stamina, hearts, weaponName, weaponTier) {
  hud.show();
  hud.setNickname(nickname);
  hud.setWeapon(weaponName, weaponTier);
  hud.updateVitals(mana, stamina, hearts);
  screens.show(null);

  game.setManaAtStart(mana);
  game.start({ mana, stamina, hearts, weaponName, weaponTier, portals: null, offline: true });

  _startLbPolling();
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────
function _refreshLeaderboard() {
  const mana    = game?.vitals?.mana ?? C.manaMin;
  const entries = getLeaderboard(nickname || 'You', mana);
  hud.updateLeaderboard(entries);
}

function _startLbPolling() {
  clearInterval(_lbInterval);
  _lastLbSeed = currentTimeSeed();
  _refreshLeaderboard();
  _lbInterval = setInterval(() => {
    const ts = currentTimeSeed();
    if (ts !== _lastLbSeed) {
      _lastLbSeed = ts;
      _refreshLeaderboard();
    }
    // Also refresh live player rank every 30s without awaiting window change
    _refreshLeaderboard();
  }, 30000);
}

// ─── Portal entered ───────────────────────────────────────────────────────────
function handlePortalEntered(res) {
  hud.setWeapon(res.weaponName, res.weaponTier);
  hud.showMessage('+' + C.portalManaGain + ' mana stolen!');
  // Persist weapon upgrade
  const save = loadSave();
  if (save) writeSave({ ...save, weaponName: res.weaponName, weaponTier: res.weaponTier });
}

// ─── Death ────────────────────────────────────────────────────────────────────
async function handleDeath({ manaAtStart, manaAtEnd, weapon }) {
  clearInterval(_lbInterval);
  hud.hide();

  // Persist post-death state (mana penalty already applied by vitals)
  const save = loadSave();
  if (save) {
    writeSave({
      ...save,
      mana: manaAtEnd,
      stamina: C.deathStaminaReset,
      hearts: C.deathHeartsReset,
      weaponName: weapon?.name ?? save.weaponName,
      weaponTier: weapon?.tier ?? save.weaponTier,
    });
  }

  screens.show('screen-death');
  screens.setSummary({ manaAtStart, manaAtEnd, died: true });

  document.getElementById('btn-play-again').onclick = () => startGame();
  document.getElementById('btn-quit').onclick = () => {
    game?.stop();
    screens.show('screen-title');
    hud.hide();
  };
}

// ─── Nickname screen ──────────────────────────────────────────────────────────
function setupNicknameScreen(onConfirm) {
  const input = document.getElementById('nick-input');
  const err   = document.getElementById('nick-error');
  const btn   = document.getElementById('btn-nick-confirm');
  input.value = '';
  err.textContent = '';

  btn.onclick = () => {
    const nick = input.value.trim();
    if (nick.length < 3 || nick.length > 16) {
      err.textContent = '3–16 characters required';
      return;
    }
    err.textContent = '';
    onConfirm(nick);
  };

  input.onkeydown = (e) => { if (e.key === 'Enter') btn.click(); };
}

// ─── Go ───────────────────────────────────────────────────────────────────────
boot();
