// Debug panel — gives items, spells, levels, stats
import { SPELL_NAMES } from "./constants.js";

const WEAPONS = ["sword", "hammer", "bow", "staff", "pistol", "shotgun", "arcaneOrb"];
const SPELLS = ["fireball", "iceRay", "magicShield", "heal", "meteor", "chainLightning", "teleport", "summonSpirits", "arcaneStorm", "blackHole"];
const RARITIES = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];

let panel = null;

export function setupDebugPanel(room) {
  // Create debug button
  const btn = document.createElement("button");
  btn.textContent = "DEBUG";
  btn.style.cssText = "position:fixed;bottom:14px;right:14px;z-index:40;padding:6px 12px;border-radius:8px;background:#ff8800;color:#000;border:none;font-weight:700;cursor:pointer;font-size:12px;";
  btn.addEventListener("click", () => toggleDebug(room));
  document.body.appendChild(btn);
}

function toggleDebug(room) {
  if (panel) { panel.remove(); panel = null; return; }

  panel = document.createElement("div");
  panel.style.cssText = "position:fixed;right:14px;bottom:50px;z-index:40;background:rgba(0,0,0,.9);border:1px solid #ff8800;border-radius:12px;padding:14px;color:#fff;font:12px/1.6 system-ui,sans-serif;min-width:260px;max-height:80vh;overflow-y:auto;";

  panel.innerHTML = `
    <div style="font-size:16px;font-weight:700;color:#ff8800;margin-bottom:10px">DEBUG PANEL</div>

    <div style="margin-bottom:8px;border-bottom:1px solid #333;padding-bottom:8px">
      <b>Level Up</b><br>
      <input id="dbgLevelAmt" type="number" value="10" min="1" max="99" style="width:50px;background:#222;border:1px solid #555;color:#fff;border-radius:4px;padding:2px 6px">
      <button id="dbgLevelBtn" style="padding:3px 10px;border-radius:4px;background:#58a6ff;color:#000;border:none;cursor:pointer">Level Up</button>
    </div>

    <div style="margin-bottom:8px;border-bottom:1px solid #333;padding-bottom:8px">
      <b>Dar Arma</b><br>
      <select id="dbgWeaponType" style="background:#222;color:#fff;border:1px solid #555;border-radius:4px;padding:2px">
        ${WEAPONS.map(w => `<option value="${w}">${w}</option>`).join("")}
      </select>
      <select id="dbgWeaponRarity" style="background:#222;color:#fff;border:1px solid #555;border-radius:4px;padding:2px">
        ${RARITIES.map((r, i) => `<option value="${i}">${r}</option>`).join("")}
      </select>
      <button id="dbgWeaponBtn" style="padding:3px 10px;border-radius:4px;background:#4ade80;color:#000;border:none;cursor:pointer">Equipar</button>
    </div>

    <div style="margin-bottom:8px;border-bottom:1px solid #333;padding-bottom:8px">
      <b>Dar Feitico</b><br>
      <select id="dbgSpellId" style="background:#222;color:#fff;border:1px solid #555;border-radius:4px;padding:2px">
        ${SPELLS.map(s => `<option value="${s}">${SPELL_NAMES[s] || s}</option>`).join("")}
      </select>
      <select id="dbgSpellRarity" style="background:#222;color:#fff;border:1px solid #555;border-radius:4px;padding:2px">
        ${RARITIES.map((r, i) => `<option value="${i}">${r}</option>`).join("")}
      </select>
      Slot: <select id="dbgSpellSlot" style="background:#222;color:#fff;border:1px solid #555;border-radius:4px;padding:2px">
        ${[0,1,2,3,4].map(i => `<option value="${i}">${i+1}</option>`).join("")}
      </select>
      <button id="dbgSpellBtn" style="padding:3px 10px;border-radius:4px;background:#c084fc;color:#000;border:none;cursor:pointer">Dar</button>
    </div>

    <div style="margin-bottom:8px;border-bottom:1px solid #333;padding-bottom:8px">
      <b>Stats (set direto)</b><br>
      STR:<input id="dbgStr" type="number" value="0" style="width:40px;background:#222;border:1px solid #555;color:#fff;border-radius:4px;padding:2px">
      DEX:<input id="dbgDex" type="number" value="0" style="width:40px;background:#222;border:1px solid #555;color:#fff;border-radius:4px;padding:2px">
      VIT:<input id="dbgVit" type="number" value="0" style="width:40px;background:#222;border:1px solid #555;color:#fff;border-radius:4px;padding:2px"><br>
      INT:<input id="dbgInt" type="number" value="0" style="width:40px;background:#222;border:1px solid #555;color:#fff;border-radius:4px;padding:2px">
      LCK:<input id="dbgLck" type="number" value="0" style="width:40px;background:#222;border:1px solid #555;color:#fff;border-radius:4px;padding:2px">
      <button id="dbgStatsBtn" style="padding:3px 10px;border-radius:4px;background:#fbbf24;color:#000;border:none;cursor:pointer">Set</button>
    </div>

    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button id="dbgHealBtn" style="padding:4px 10px;border-radius:4px;background:#44ff88;color:#000;border:none;cursor:pointer">Full Heal + Mana</button>
      <button id="dbgSlotsBtn" style="padding:4px 10px;border-radius:4px;background:#9966ff;color:#fff;border:none;cursor:pointer">5 Spell Slots</button>
    </div>
  `;

  document.body.appendChild(panel);

  // Wire up buttons
  document.getElementById("dbgLevelBtn").addEventListener("click", () => {
    room.send("debug", { cmd: "level_up", amount: Number(document.getElementById("dbgLevelAmt").value) });
  });

  document.getElementById("dbgWeaponBtn").addEventListener("click", () => {
    room.send("debug", { cmd: "give_weapon", weaponType: document.getElementById("dbgWeaponType").value, rarity: Number(document.getElementById("dbgWeaponRarity").value) });
  });

  document.getElementById("dbgSpellBtn").addEventListener("click", () => {
    room.send("debug", { cmd: "give_spell", spellId: document.getElementById("dbgSpellId").value, rarity: Number(document.getElementById("dbgSpellRarity").value), slot: Number(document.getElementById("dbgSpellSlot").value) });
  });

  document.getElementById("dbgStatsBtn").addEventListener("click", () => {
    room.send("debug", { cmd: "set_stats",
      str: Number(document.getElementById("dbgStr").value),
      dex: Number(document.getElementById("dbgDex").value),
      vit: Number(document.getElementById("dbgVit").value),
      intel: Number(document.getElementById("dbgInt").value),
      lck: Number(document.getElementById("dbgLck").value),
    });
  });

  document.getElementById("dbgHealBtn").addEventListener("click", () => room.send("debug", { cmd: "heal" }));
  document.getElementById("dbgSlotsBtn").addEventListener("click", () => room.send("debug", { cmd: "max_spell_slots" }));
}
