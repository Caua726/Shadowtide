// Spell bar UI, spell visuals, spell effects
import { Graphics, Container, Text, TextStyle } from "https://cdn.jsdelivr.net/npm/pixi.js@8.16.0/dist/pixi.min.mjs";
import { SPELL_NAMES, SPELL_ICONS, SPELL_COLORS, SPELL_DESC, RARITY_CSS, RARITY_LABEL } from "./constants.js";

const spellEffects = new Map(); // effectId -> Graphics
const SPELL_KEYS = ["z", "x", "c", "v", "b"];

export function setupSpellMessages(room, world) {
  room.onMessage("spell_cast", ({ spellId, effectId, casterId, x, y, dx, dy, targetX, targetY, rarity }) => {
    const color = SPELL_COLORS[spellId] || 0xffffff;

    switch (spellId) {
      case "fireball": {
        // Fireball projectile handled by projectile system — add a glow trail
        const g = new Graphics();
        g.circle(0, 0, 8).fill({ color: 0xff6600, alpha: 0.6 });
        g.circle(0, 0, 14).fill({ color: 0xff4400, alpha: 0.2 });
        g.x = x; g.y = y; g._dx = dx; g._dy = dy; g._speed = 450; g.life = 2;
        world.addChild(g);
        spellEffects.set(effectId, g);
        break;
      }
      case "iceRay": {
        const g = new Graphics();
        g.circle(0, 0, 6).fill({ color: 0x66ccff, alpha: 0.8 });
        g.x = x; g.y = y; g._dx = dx; g._dy = dy; g._speed = 500; g.life = 2;
        world.addChild(g);
        spellEffects.set(effectId, g);
        break;
      }
      case "magicShield": {
        const g = new Graphics();
        g.circle(x, y, 28).stroke({ color: 0x44aaff, width: 3, alpha: 0.6 });
        g.life = 5;
        world.addChild(g);
        spellEffects.set(effectId, g);
        break;
      }
      case "heal": {
        const g = new Graphics();
        g.circle(x, y, 20).fill({ color: 0x44ff88, alpha: 0.3 });
        g.life = 4;
        world.addChild(g);
        spellEffects.set(effectId, g);
        break;
      }
      case "meteor": {
        // Shadow on ground growing
        const g = new Graphics();
        g.circle(x, y, 30).fill({ color: 0x000000, alpha: 0.4 });
        g.life = 1.2;
        g._targetX = x; g._targetY = y;
        world.addChild(g);
        spellEffects.set(effectId, g);
        // Impact after 1s
        setTimeout(() => {
          const impact = new Graphics();
          impact.circle(x, y, 120).fill({ color: 0xff4400, alpha: 0.5 });
          impact.circle(x, y, 60).fill({ color: 0xffaa00, alpha: 0.7 });
          impact.circle(x, y, 30).fill({ color: 0xffffff, alpha: 0.8 });
          impact.life = 0.5;
          world.addChild(impact);
          spellEffects.set(effectId + "_impact", impact);
        }, 1000);
        break;
      }
      case "chainLightning": {
        // Draw line from caster to target
        const g = new Graphics();
        g.moveTo(x, y);
        // Zigzag line
        const tx = targetX || x, ty = targetY || y;
        const segments = 8;
        for (let i = 1; i <= segments; i++) {
          const t = i / segments;
          const lx = x + (tx - x) * t + (Math.random() - 0.5) * 20;
          const ly = y + (ty - y) * t + (Math.random() - 0.5) * 20;
          g.lineTo(lx, ly);
        }
        g.stroke({ color: 0xffff44, width: 3 });
        g.life = 0.3;
        world.addChild(g);
        spellEffects.set(effectId, g);
        break;
      }
      case "teleport": {
        // Vanish effect at old position
        const g = new Graphics();
        g.circle(x, y, 20).fill({ color: 0xcc66ff, alpha: 0.5 });
        for (let i = 0; i < 8; i++) {
          const angle = (Math.PI * 2 / 8) * i;
          g.circle(x + Math.cos(angle) * 15, y + Math.sin(angle) * 15, 3).fill(0xcc66ff);
        }
        g.life = 0.4;
        world.addChild(g);
        spellEffects.set(effectId, g);
        break;
      }
      case "summonSpirits": {
        // Will be updated via spell_spirits_update
        const c = new Container();
        for (let i = 0; i < 3; i++) {
          const spirit = new Graphics();
          spirit.circle(0, 0, 8).fill({ color: 0x88ffcc, alpha: 0.6 });
          spirit.circle(0, 0, 12).fill({ color: 0x88ffcc, alpha: 0.2 });
          c.addChild(spirit);
        }
        c.life = 8;
        world.addChild(c);
        spellEffects.set(effectId, c);
        break;
      }
      case "arcaneStorm": {
        const g = new Graphics();
        g.circle(x, y, 140).fill({ color: 0x9966ff, alpha: 0.15 });
        g.circle(x, y, 100).fill({ color: 0x9966ff, alpha: 0.1 });
        g.life = 6;
        g._centerX = x; g._centerY = y; g._isStorm = true;
        world.addChild(g);
        spellEffects.set(effectId, g);
        break;
      }
      case "blackHole": {
        const c = new Container();
        // Dark core
        const core = new Graphics();
        core.circle(0, 0, 25).fill({ color: 0x000000, alpha: 0.9 });
        core.circle(0, 0, 35).fill({ color: 0x220033, alpha: 0.4 });
        // Swirling ring
        const ring = new Graphics();
        ring.circle(0, 0, 50).stroke({ color: 0x6600cc, width: 3, alpha: 0.5 });
        ring.circle(0, 0, 70).stroke({ color: 0x4400aa, width: 2, alpha: 0.3 });
        c.addChild(ring, core);
        c.x = x; c.y = y;
        c.life = 5;
        c._isBlackHole = true;
        world.addChild(c);
        spellEffects.set(effectId, c);
        break;
      }
    }
  });

  room.onMessage("spell_effect", ({ spellId, x, y, radius, phase }) => {
    // Additional spell effects (e.g., meteor impact)
  });

  room.onMessage("spell_end", ({ effectId, spellId }) => {
    const g = spellEffects.get(effectId);
    if (g) { world.removeChild(g); spellEffects.delete(effectId); }
    const impact = spellEffects.get(effectId + "_impact");
    if (impact) { world.removeChild(impact); spellEffects.delete(effectId + "_impact"); }
  });

  room.onMessage("spell_spirits_update", ({ id, spirits }) => {
    const c = spellEffects.get(id);
    if (c && c.children) {
      for (let i = 0; i < Math.min(spirits.length, c.children.length); i++) {
        c.children[i].x = spirits[i].x - (c.x || 0);
        c.children[i].y = spirits[i].y - (c.y || 0);
      }
    }
  });
}

export function updateSpellEffects(dt, world) {
  for (const [id, g] of spellEffects) {
    if (g.life !== undefined) {
      g.life -= dt;
      if (g._dx) { g.x += g._dx * g._speed * dt; g.y += g._dy * g._speed * dt; }
      if (g._isBlackHole && g.children) {
        // Rotate the ring
        if (g.children[0]) g.children[0].rotation += dt * 2;
      }
      if (g._isStorm) {
        g.alpha = 0.5 + Math.sin(Date.now() * 0.005) * 0.3;
      }
      if (g.life <= 0) { world.removeChild(g); spellEffects.delete(id); }
    }
  }
}

// --- Spell bar UI ---
export function updateSpellBar(me) {
  if (!me?.spellSlots) return;
  const slots = document.querySelectorAll(".spell-slot");
  slots.forEach(el => {
    const idx = Number(el.dataset.slot);
    const slot = me.spellSlots[idx];
    const icon = el.querySelector(".spell-icon");
    const cd = el.querySelector(".spell-cd");
    if (idx >= me.maxSpellSlots) {
      el.style.opacity = "0.3";
      icon.textContent = "\uD83D\uDD12";
      cd.textContent = "";
      return;
    }
    el.style.opacity = "1";
    if (slot && slot.spellId && slot.spellRarity >= 0) {
      icon.textContent = SPELL_ICONS[slot.spellId] || "?";
      el.style.borderColor = RARITY_CSS[slot.spellRarity];
      cd.textContent = slot.cooldownLeft > 0 ? `${Math.ceil(slot.cooldownLeft)}s` : "";
    } else {
      icon.textContent = "";
      el.style.borderColor = "rgba(255,255,255,.2)";
      cd.textContent = "";
    }
  });
}

export function setupSpellBar(room) {
  const slots = document.querySelectorAll(".spell-slot");
  slots.forEach(el => {
    el.addEventListener("mouseenter", (e) => showSpellTooltip(e, Number(el.dataset.slot), room));
    el.addEventListener("mouseleave", () => document.getElementById("tooltip").style.display = "none");
  });
}

function showSpellTooltip(e, slotIdx, room) {
  const me = room.state.players?.get(room.sessionId);
  if (!me?.spellSlots) return;
  const slot = me.spellSlots[slotIdx];
  if (!slot || !slot.spellId || slot.spellRarity < 0) return;
  const tip = document.getElementById("tooltip");
  tip.innerHTML = `
    <div style="color:${RARITY_CSS[slot.spellRarity]};font-weight:700;font-size:14px">${RARITY_LABEL[slot.spellRarity]} ${SPELL_NAMES[slot.spellId] || slot.spellId}</div>
    <div style="color:#aaa;margin-top:4px;font-size:11px">${SPELL_DESC[slot.spellId] || ""}</div>
    <div style="margin-top:4px;font-size:11px">Tecla: <b>${SPELL_KEYS[slotIdx].toUpperCase()}</b></div>
  `;
  tip.style.display = "block";
  tip.style.left = `${e.clientX + 12}px`;
  tip.style.top = `${e.clientY - 10}px`;
}

export function handleSpellKeys(keys, room, me, mouseWorldX, mouseWorldY) {
  for (let i = 0; i < SPELL_KEYS.length; i++) {
    const k = SPELL_KEYS[i];
    if (keys[k]) {
      if (!keys[`_spell_${k}`]) {
        keys[`_spell_${k}`] = true;
        if (me && i < me.maxSpellSlots) {
          room.send("cast_spell", { slot: i, targetX: mouseWorldX, targetY: mouseWorldY });
        }
      }
    } else {
      keys[`_spell_${k}`] = false;
    }
  }
}
