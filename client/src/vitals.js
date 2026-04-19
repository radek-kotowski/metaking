import { C } from './constants.js';

export class Vitals {
  constructor(mana, stamina, hearts) {
    this.mana    = mana;
    this.stamina = stamina;
    this.hearts  = hearts;
    this.onChange = null; // callback(mana, stamina, hearts)
    this.onDied   = null;
  }

  _fire() { this.onChange?.(this.mana, this.stamina, this.hearts); }

  init(mana, stamina, hearts) {
    this.mana = mana; this.stamina = stamina; this.hearts = hearts;
    this._fire();
  }

  takeWarlockHit() {
    this.hearts  = Math.max(0, this.hearts  - C.warlockHitHearts);
    this.stamina = Math.max(C.staminaMin, this.stamina - C.warlockHitStamina);
    this._fire();
    if (this.hearts === 0) this.onDied?.();
    return this.hearts === 0;
  }

  killWarlock() {
    this.stamina = Math.min(this.stamina + C.warlockKillStamina, 999);
    this._fire();
  }

  tryEnterPortal() {
    if (this.stamina < C.portalStaminaRequired) return false;
    this.stamina = Math.max(C.staminaMin, this.stamina - C.portalStaminaCost);
    this._fire();
    return true;
  }

  gainMana(n) { this.mana = Math.max(C.manaMin, this.mana + n); this._fire(); }
  loseMana(n) { this.mana = Math.max(C.manaMin, this.mana - n); this._fire(); }

  restoreHeartPickup() {
    this.hearts = Math.min(C.heartsMax, this.hearts + C.heartPickupRestore);
    this._fire();
  }

  applyDeath() {
    this.mana    = Math.max(C.manaMin, this.mana - C.deathManaPenalty);
    this.stamina = C.deathStaminaReset;
    this.hearts  = C.deathHeartsReset;
    this._fire();
  }

  syncFromServer(mana, stamina, hearts) {
    this.mana = mana; this.stamina = stamina; this.hearts = hearts;
    this._fire();
  }

  get isAlive() { return this.hearts > 0; }
}
