// HUD updates, toast, wave info
import { RARITY_CSS, RARITY_LABEL, WEAPON_NAMES } from "./constants.js";

const toast = document.getElementById("toast");

export function showToast(msg, color) {
  toast.textContent = msg;
  toast.style.opacity = "1";
  toast.style.color = color || "#fff";
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.style.opacity = "0", 2000);
}

export function updateHUD(me) {
  if (!me) return;
  document.getElementById("hpText").textContent = `${Math.round(me.hp)} / ${me.maxHp}`;
  document.getElementById("xpText").textContent = `${me.xp} / ${me.xpToNext}`;
  document.getElementById("levelText").textContent = String(me.level);
  document.getElementById("hpFill").style.width = `${(me.hp / me.maxHp) * 100}%`;
  document.getElementById("xpFill").style.width = `${(me.xp / me.xpToNext) * 100}%`;

  const wt = document.getElementById("weaponText");
  wt.textContent = `${RARITY_LABEL[me.equippedWeaponRarity]} ${WEAPON_NAMES[me.equippedWeaponType] || me.equippedWeaponType}`;
  wt.style.color = RARITY_CSS[me.equippedWeaponRarity];

  document.getElementById("hudStr").textContent = me.str;
  document.getElementById("hudDex").textContent = me.dex;
  document.getElementById("hudVit").textContent = me.vit;
  document.getElementById("hudInt").textContent = me.intel;
  document.getElementById("hudLck").textContent = me.lck;

  // Mana bar
  const manaFill = document.getElementById("manaFill");
  if (manaFill) {
    document.getElementById("manaText").textContent = `${Math.round(me.mana)} / ${me.maxMana}`;
    manaFill.style.width = `${(me.mana / Math.max(1, me.maxMana)) * 100}%`;
  }
}

export function updateWaveHUD(wave) {
  if (!wave) return;
  document.getElementById("waveText").textContent = String(wave.waveNumber);
  document.getElementById("waveStateText").textContent = wave.state === "pause" ? "(pausa)" : wave.state === "combat" ? "(combate)" : "";
  document.getElementById("waveTimerText").textContent = wave.state === "pause" ? `${Math.ceil(wave.timer)}s` : "-";
  document.getElementById("enemiesRemainingText").textContent = String(wave.enemiesRemaining);
}
