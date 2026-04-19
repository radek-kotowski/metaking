export const C = {
  manaMin: 100,
  staminaMin: 10,
  staminaStart: 10,
  heartsMax: 20,
  heartsStart: 20,
  heartPickupRestore: 5,
  heartPickupsOnMap: 8,
  heartPickupRespawnSeconds: 60,
  warlockHitHearts: 1,
  warlockHitStamina: 1,
  warlockKillStamina: 5,
  portalStaminaRequired: 50,
  portalStaminaCost: 40,
  portalManaGain: 10,
  warlockGroupsMin: 12,
  warlockGroupsMax: 16,
  warlockGroupSizeMin: 3,
  warlockGroupSizeMax: 6,
  warlockChaseRadius: 8,
  deathManaPenalty: 100,
  deathStaminaReset: 10,
  deathHeartsReset: 20,
  mapSize: 200,
};

const WEAPON_TIERS = [
  [],
  ['Sword', 'Staff'],
  ['War Axe', 'Spear'],
  ['Flail', 'Lightning Wand'],
  ['Void Blade', 'Frost Lance'],
  ['Soul Reaper', "MetaKing's Scepter"],
  ['Shadowfang', 'Arcane Devastator'],
  ['Worldbreaker', 'Eternal Flame Staff'],
  ['Oblivion Scythe', "Titan's Wrath"],
  ['The MetaKing Blade'],
];

export function tierForMana(mana) {
  if (mana >= 100000) return 9;
  if (mana >= 50000)  return 8;
  if (mana >= 10000)  return 7;
  if (mana >= 5000)   return 6;
  if (mana >= 1000)   return 5;
  if (mana >= 700)    return 4;
  if (mana >= 400)    return 3;
  if (mana >= 200)    return 2;
  return 1;
}

export function randomWeaponForMana(mana) {
  const tier = tierForMana(mana);
  const pool = WEAPON_TIERS[tier];
  return { name: pool[Math.floor(Math.random() * pool.length)], tier };
}

export function weaponAttackRange(tier) { return 2.5 + tier * 0.4; }
export function weaponAttackCooldown(tier) { return Math.max(0.25, 0.9 - tier * 0.07); }
