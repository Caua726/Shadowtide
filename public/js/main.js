// Shadowtide: Endless Horde — Main entry point
import { Client, Callbacks } from "https://cdn.jsdelivr.net/npm/@colyseus/sdk@0.17.35/+esm";
import { Container, Graphics, Text, TextStyle } from "https://cdn.jsdelivr.net/npm/pixi.js@8.16.0/dist/pixi.min.mjs";
import { RARITY_HEX, SPELL_ICONS, SPELL_COLORS, WEAPON_ICONS } from "./constants.js";
import { initRenderer, redrawFloor, updateCamera, initMouseTracking, mouseWorldX, mouseWorldY, app, world } from "./renderer.js";
import { showToast, updateHUD, updateWaveHUD } from "./hud.js";
import { makePlayer, updatePlayerWeapon, makeEnemy, updateEnemyBar, makeFloatingText } from "./entities.js";
import { setupWeaponMessages, updateProjectiles, updateEffects } from "./weapons.js";
import { setupSpellMessages, updateSpellEffects, updateSpellBar, setupSpellBar, handleSpellKeys } from "./spells.js";
import { setupInventoryUI, updateInventoryUI, handleInventoryKeys } from "./inventory.js";
import { setupAttrPanel, showAttrPanel, toggleAttrPanel } from "./attributes.js";
import { setupSkillTree, toggle as toggleSkillTree } from "./skilltree.js";
import { setupNameScreen } from "./namescreen.js";

// --- State maps ---
const players = new Map();
const enemies = new Map();
const floatingTexts = new Map();
const droppedItems = new Map();
const droppedSpells = new Map();

// --- Keys ---
const keys = Object.create(null);
window.addEventListener("keydown", e => { keys[e.key.toLowerCase()] = true; if (e.code === "Space") e.preventDefault(); });
window.addEventListener("keyup", e => { keys[e.key.toLowerCase()] = false; });

// --- Init ---
await initRenderer();
initMouseTracking(app.canvas);

let room = null;

setupNameScreen(async (playerName) => {
  try {
    const protocol = location.protocol === "https:" ? "https" : "http";
    const client = new Client(`${protocol}://${location.host}`);
    room = await client.joinOrCreate("world", { name: playerName });
  } catch (err) {
    document.getElementById("error").textContent = `Falha ao conectar.\n${err?.message || err}`;
    document.getElementById("error").style.display = "block";
    throw err;
  }

  initGame();
});

function initGame() {
  // --- Message handlers ---
  room.onMessage("level_up", ({ id, level }) => {
    if (id === room.sessionId) { showToast(`LEVEL UP -> ${level}`); setTimeout(() => showAttrPanel(room), 500); }
  });
  room.onMessage("player_died", ({ id }) => {
    if (id === room.sessionId) showToast("VOCE MORREU!", "#ff5a5a");
  });
  room.onMessage("wave_start", ({ waveNumber, enemyCount }) => showToast(`WAVE ${waveNumber} — ${enemyCount} inimigos`));
  room.onMessage("wave_complete", ({ waveNumber }) => showToast(`WAVE ${waveNumber} COMPLETA!`));
  room.onMessage("boss_spawn", ({ enemyType }) => showToast(`BOSS: ${enemyType.toUpperCase()}!`, "#fbbf24"));
  room.onMessage("perk_available", ({ id }) => { if (id === room.sessionId) showToast("NOVO PERK! (T)", "#c084fc"); });

  setupWeaponMessages(room, world);
  setupSpellMessages(room, world);

  // Reset button
  document.getElementById("resetGameBtn").addEventListener("click", () => {
    if (confirm("Resetar o jogo inteiro? (waves, inimigos, drops)")) {
      room.send("reset_game");
    }
  });

  // --- State callbacks ---
  const $ = Callbacks.get(room);

  $.onAdd("players", (player, id) => {
    const sprite = makePlayer(player.name, id === room.sessionId ? 0x58a6ff : 0xdc7dff);
    world.addChild(sprite); players.set(id, sprite);
    $.onChange(player, () => {
      sprite.x = player.x; sprite.y = player.y;
      updatePlayerWeapon(sprite, player.equippedWeaponType, player.equippedWeaponRarity);
    });
    sprite.x = player.x; sprite.y = player.y;
  });
  $.onRemove("players", (_, id) => { const s = players.get(id); if (s) { world.removeChild(s); players.delete(id); } });

  $.onAdd("enemies", (enemy, id) => {
    const sprite = makeEnemy(enemy.enemyType, enemy.isBoss);
    world.addChild(sprite); enemies.set(id, sprite);
    updateEnemyBar(sprite, enemy); sprite.x = enemy.x; sprite.y = enemy.y;
    $.onChange(enemy, () => { sprite.x = enemy.x; sprite.y = enemy.y; updateEnemyBar(sprite, enemy); });
  });
  $.onRemove("enemies", (_, id) => { const s = enemies.get(id); if (s) { world.removeChild(s); enemies.delete(id); } });

  $.onAdd("floatingTexts", (item, id) => {
    const t = makeFloatingText(item.text); t.x = item.x; t.y = item.y;
    world.addChild(t); floatingTexts.set(id, t);
    $.onChange(item, () => { t.text = item.text; t.x = item.x; t.y = item.y; });
  });
  $.onRemove("floatingTexts", (_, id) => { const t = floatingTexts.get(id); if (t) { world.removeChild(t); floatingTexts.delete(id); } });

  $.onAdd("droppedItems", (item, id) => {
    const c = new Container();
    const color = RARITY_HEX[item.weaponRarity] || 0xffffff;
    c.addChild(new Graphics().circle(0, 0, 14).fill({ color, alpha: 0.25 }));
    c.addChild(new Graphics().roundRect(-6, -6, 12, 12, 3).fill(color));
    const icon = new Text({ text: WEAPON_ICONS[item.weaponType] || "?", style: new TextStyle({ fontSize: 10 }) });
    icon.anchor.set(0.5); c.addChild(icon);
    c.x = item.x; c.y = item.y;
    world.addChild(c); droppedItems.set(id, c);
  });
  $.onRemove("droppedItems", (_, id) => { const c = droppedItems.get(id); if (c) { world.removeChild(c); droppedItems.delete(id); } });

  $.onAdd("droppedSpells", (item, id) => {
    const c = new Container();
    const color = SPELL_COLORS[item.spellId] || 0xffffff;
    const rarityColor = RARITY_HEX[item.spellRarity] || 0xffffff;
    c.addChild(new Graphics().circle(0, 0, 16).fill({ color, alpha: 0.3 }));
    c.addChild(new Graphics().circle(0, 0, 8).fill(rarityColor));
    const icon = new Text({ text: SPELL_ICONS[item.spellId] || "\u2728", style: new TextStyle({ fontSize: 12 }) });
    icon.anchor.set(0.5); c.addChild(icon);
    c.x = item.x; c.y = item.y;
    world.addChild(c); droppedSpells.set(id, c);
  });
  $.onRemove("droppedSpells", (_, id) => { const c = droppedSpells.get(id); if (c) { world.removeChild(c); droppedSpells.delete(id); } });

  // --- UI setup ---
  setupAttrPanel(room);
  setupSkillTree(room);
  setupInventoryUI(room);
  setupSpellBar(room);

  // --- Game loop ---
  let sendTimer = 0, attackDown = false, aimTimer = 0;

  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;
    const me = room.state.players?.get(room.sessionId);
    const ww = room.state.worldWidth || 1600;
    const wh = room.state.worldHeight || 1200;
    redrawFloor(ww, wh);

    // Movement input
    let dx = 0, dy = 0;
    if (keys["w"] || keys["arrowup"]) dy -= 1;
    if (keys["s"] || keys["arrowdown"]) dy += 1;
    if (keys["a"] || keys["arrowleft"]) dx -= 1;
    if (keys["d"] || keys["arrowright"]) dx += 1;
    if (dx || dy) { const l = Math.hypot(dx, dy); dx /= l; dy /= l; }

    // Attack
    if (keys[" "] || keys["space"]) { if (!attackDown) { room.send("attack"); attackDown = true; } } else attackDown = false;

    // Keys
    handleInventoryKeys(keys, room, me);
    handleSpellKeys(keys, room, me, mouseWorldX, mouseWorldY);
    if (keys["p"]) { if (!keys._p) { keys._p = true; toggleAttrPanel(room); } } else keys._p = false;
    if (keys["t"]) { if (!keys._t) { keys._t = true; toggleSkillTree(room); } } else keys._t = false;

    // Send movement
    sendTimer += dt;
    if (sendTimer >= 1 / 20) { sendTimer = 0; room.send("move", { x: dx, y: dy }); }

    // Send aim
    aimTimer += dt;
    if (aimTimer >= 1 / 15 && me) {
      aimTimer = 0;
      const adx = mouseWorldX - me.x;
      const ady = mouseWorldY - me.y;
      const al = Math.hypot(adx, ady) || 1;
      room.send("aim", { x: adx / al, y: ady / al });
    }

    // Update HUD
    if (me) {
      updateHUD(me);
      updateCamera(me, app.screen.width, app.screen.height, ww, wh);
      updatePlayerWeapon(players.get(room.sessionId), me.equippedWeaponType, me.equippedWeaponRarity);
      updateInventoryUI(me);
      updateSpellBar(me);

      // Crosshair cursor for ranged
      const isRanged = ["bow", "staff", "pistol", "shotgun", "arcaneOrb"].includes(me.equippedWeaponType);
      app.canvas.style.cursor = isRanged ? "crosshair" : "default";
    }

    updateWaveHUD(room.state.wave);

    // Update visuals
    updateProjectiles(dt, world);
    updateSpellEffects(dt, world);
    updateEffects(dt, world);
  });
}
