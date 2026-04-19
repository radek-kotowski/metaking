import { C } from './constants.js';

const $ = (id) => document.getElementById(id);

export const hud = {
  show() { $('hud').classList.remove('hidden'); },
  hide() { $('hud').classList.add('hidden'); },

  updateVitals(mana, stamina, hearts) {
    $('mana-val').textContent    = mana.toLocaleString() + ' mp';
    $('stamina-val').textContent = stamina + '/999';
    $('hearts-val').textContent  = hearts + '♥';

    $('mana-fill').style.width    = Math.max(2, (mana    / 5000) * 100)  + '%';
    $('stamina-fill').style.width = Math.max(2, (stamina /  999) * 100)  + '%';
    $('hearts-fill').style.width  = Math.max(2, (hearts  / C.heartsMax) * 100) + '%';
  },

  setNickname(nick) { $('nickname-display').textContent = nick; },

  setWeapon(name, tier) { $('weapon-display').textContent = name + ' (T' + tier + ')'; },

  setMetaKing(isKing) {
    const el = $('nickname-display');
    el.style.color = isKing ? '#ffd700' : '';
    if (isKing) el.textContent = '👑 ' + el.textContent.replace('👑 ', '');
    else         el.textContent = el.textContent.replace('👑 ', '');
  },

  // ── Toast ────────────────────────────────────────────────────────────────
  _toastTimer: null,
  showMessage(msg, duration = 2.5) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('visible'), duration * 1000);
  },

  // ── Portal prompt ─────────────────────────────────────────────────────────
  showPortalPrompt(visible) {
    $('portal-prompt').classList.toggle('visible', visible);
  },

  // ── Leaderboard ──────────────────────────────────────────────────────────
  updateLeaderboard(entries) {
    const container = $('lb-entries');
    if (!entries || entries.length === 0) {
      container.innerHTML = '<div style="color:#555;font-size:12px">No data (offline)</div>';
      return;
    }
    container.innerHTML = entries.slice(0, 10).map(e => `
      <div class="lb-row${e.isPlayer ? ' lb-row-you' : ''}">
        <span class="lb-rank">${e.rank}</span>
        <span class="lb-name">${e.isMetaKing ? '👑 ' : ''}${escHtml(e.nickname)}${e.isPlayer ? ' ◀' : ''}</span>
        <span class="lb-mana">${e.mana.toLocaleString()}</span>
      </div>
    `).join('');
  },
};

// ── Screen helpers ─────────────────────────────────────────────────────────
export const screens = {
  show(id) {
    ['screen-title','screen-nickname','screen-death','screen-onboarding'].forEach(s => {
      document.getElementById(s).classList.toggle('hidden', s !== id);
    });
  },

  setSummary({ manaAtStart, manaAtEnd, died }) {
    const delta = manaAtEnd - manaAtStart;
    const sign  = delta >= 0 ? '+' : '';
    $('summary-stats').innerHTML = `
      Mana: <strong>${manaAtEnd.toLocaleString()}</strong><br>
      Change: <strong>${sign}${delta.toLocaleString()}</strong><br>
      ${died ? 'Cause: <strong>Death</strong>' : 'Session ended'}
    `;
  },
};

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
