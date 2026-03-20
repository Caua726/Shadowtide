// Inventory bar, weapon tooltips, swap/drop
import { RARITY_CSS, RARITY_LABEL, WEAPON_ICONS, WEAPON_NAMES, WEAPON_DESC, WEAPON_SCALE_ATTR, WEAPON_BASE_DMG, RARITY_MULT } from "./constants.js";

export function setupInventoryUI(room) {
  const slots = document.querySelectorAll(".inv-slot");
  slots.forEach(el => {
    el.addEventListener("click", () => room.send("swap_weapon", { slot: Number(el.dataset.slot) }));
    el.addEventListener("mouseenter", (e) => showWeaponTooltip(e, Number(el.dataset.slot), room));
    el.addEventListener("mouseleave", () => document.getElementById("tooltip").style.display = "none");
  });
}

export function updateInventoryUI(me) {
  if (!me?.inventory) return;
  const slots = document.querySelectorAll(".inv-slot");
  slots.forEach(el => {
    const idx = Number(el.dataset.slot);
    const slot = me.inventory[idx];
    const icon = el.querySelector(".slot-icon");
    if (slot && slot.weaponRarity >= 0 && slot.weaponType) {
      icon.textContent = WEAPON_ICONS[slot.weaponType] || "?";
      el.style.borderColor = RARITY_CSS[slot.weaponRarity];
    } else {
      icon.textContent = "";
      el.style.borderColor = "rgba(255,255,255,.2)";
    }
  });
}

function showWeaponTooltip(e, slotIdx, room) {
  const me = room.state.players?.get(room.sessionId);
  if (!me?.inventory) return;
  const slot = me.inventory[slotIdx];
  if (!slot || slot.weaponRarity < 0) { document.getElementById("tooltip").style.display = "none"; return; }
  const wt = slot.weaponType;
  const wr = slot.weaponRarity;
  const attr = WEAPON_SCALE_ATTR[wt] || "STR";
  const attrMap = { STR: me.str, DEX: me.dex, INT: me.intel };
  const finalDmg = Math.round((WEAPON_BASE_DMG[wt] || 10) * RARITY_MULT[wr] * (1 + (attrMap[attr] || 0) * 0.03));

  const tip = document.getElementById("tooltip");
  tip.innerHTML = `
    <div style="color:${RARITY_CSS[wr]};font-weight:700;font-size:14px">${RARITY_LABEL[wr]} ${WEAPON_NAMES[wt] || wt}</div>
    <div style="margin-top:4px">Dano: <b>${finalDmg}</b></div>
    <div>Escala: <b>${attr}</b></div>
    <div style="color:#aaa;margin-top:4px;font-size:11px">${WEAPON_DESC[wt] || ""}</div>
  `;
  tip.style.display = "block";
  tip.style.left = `${e.clientX + 12}px`;
  tip.style.top = `${e.clientY - 10}px`;
}

export function handleInventoryKeys(keys, room, me) {
  // Pickup E
  if (keys["e"]) {
    if (!keys._e) { keys._e = true; pickupNearest(room, me); }
  } else keys._e = false;

  // Drop Q
  if (keys["q"]) {
    if (!keys._q) { keys._q = true; room.send("drop_weapon"); }
  } else keys._q = false;

  // Swap 1-5
  for (let i = 1; i <= 5; i++) {
    if (keys[String(i)]) {
      if (!keys[`_${i}`]) { keys[`_${i}`] = true; room.send("swap_weapon", { slot: i - 1 }); }
    } else keys[`_${i}`] = false;
  }

  // Pickup spell (F)
  if (keys["f"]) {
    if (!keys._f) {
      keys._f = true;
      if (me && room.state.droppedSpells) {
        let nearestId = null, nearestDist = 60;
        room.state.droppedSpells.forEach((item, id) => {
          const d = Math.hypot(item.x - me.x, item.y - me.y);
          if (d < nearestDist) { nearestDist = d; nearestId = id; }
        });
        if (nearestId) room.send("pickup_spell", { itemId: nearestId });
      }
    }
  } else keys._f = false;
}

function pickupNearest(room, me) {
  if (!me || !room.state.droppedItems) return;
  let nearestId = null, nearestDist = 60;
  room.state.droppedItems.forEach((item, id) => {
    const d = Math.hypot(item.x - me.x, item.y - me.y);
    if (d < nearestDist) { nearestDist = d; nearestId = id; }
  });
  if (nearestId) room.send("pickup_item", { itemId: nearestId });
}
