import { Room, type Client } from "colyseus";
import { DroppedItem, GameState } from "./GameState.js";
import { type SkillBuffs } from "./SkillTree.js";
import { WaveManager } from "./WaveManager.js";
import { CombatSystem } from "./CombatSystem.js";
import { SpellCaster } from "./SpellCaster.js";
import { PlayerManager } from "./PlayerManager.js";
import { DropSystem } from "./DropSystem.js";
import { saveState, loadState } from "./SaveSystem.js";

const TICK_RATE = 30;
const SAVE_INTERVAL_MS = 30000;

export class GameRoom extends Room<{ state: GameState }> {
  state = new GameState();
  maxClients = 32;

  private playerBuffs = new Map<string, SkillBuffs>();
  private secondChanceUsed = new Map<string, boolean>();

  private waveManager!: WaveManager;
  private combatSystem!: CombatSystem;
  private spellCaster!: SpellCaster;
  private playerManager!: PlayerManager;
  private dropSystem!: DropSystem;

  private saveInterval?: NodeJS.Timeout;

  onCreate() {
    this.dropSystem = new DropSystem(this.state, this.playerBuffs);

    this.waveManager = new WaveManager(
      this.state,
      (type, data) => this.broadcast(type, data),
      this.secondChanceUsed,
    );

    this.playerManager = new PlayerManager(
      this.state,
      this.playerBuffs,
      this.secondChanceUsed,
      () => this.waveManager.startWavePause(),
    );

    this.spellCaster = new SpellCaster(
      this.state,
      (type, data) => this.broadcast(type, data),
      this.playerBuffs,
      () => this.combatSystem,
    );

    this.combatSystem = new CombatSystem(
      this.state,
      (type, data) => this.broadcast(type, data),
      this.playerBuffs,
      this.playerManager.aimByClient,
      this.secondChanceUsed,
      () => this.spellCaster.activeSpellEffects,
      () => this.dropSystem,
    );

    this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000 / TICK_RATE);
    this.registerMessages();

    const loaded = loadState(this.state);
    if (loaded) {
      this.waveManager.enemySeq = loaded.enemySeq;
      this.dropSystem.dropSeq = loaded.dropSeq;
    }

    this.saveInterval = setInterval(() => this.doSave(), SAVE_INTERVAL_MS);
  }

  private registerMessages() {
    this.onMessage("move", (client, payload: { x?: number; y?: number } | undefined) => {
      const x = Number(payload?.x) || 0;
      const y = Number(payload?.y) || 0;
      const len = Math.hypot(x, y);
      if (len > 0) {
        this.playerManager.inputByClient.set(client.sessionId, { x: x / len, y: y / len });
      } else {
        this.playerManager.inputByClient.set(client.sessionId, { x: 0, y: 0 });
      }
    });

    this.onMessage("aim", (client, payload: { x?: number; y?: number } | undefined) => {
      const x = Number(payload?.x) || 0;
      const y = Number(payload?.y) || 1;
      const len = Math.hypot(x, y) || 1;
      this.playerManager.aimByClient.set(client.sessionId, { x: x / len, y: y / len });
      const player = this.state.players.get(client.sessionId);
      if (player) { player.aimX = x / len; player.aimY = y / len; }
    });

    this.onMessage("attack", (client) => this.combatSystem.handleAttack(client.sessionId));
    this.onMessage("allocate_points", (client, payload) => this.playerManager.handleAllocatePoints(client.sessionId, payload));
    this.onMessage("activate_node", (client, payload) => this.playerManager.handleActivateNode(client.sessionId, payload));
    this.onMessage("reset_tree", (client) => this.playerManager.handleResetTree(client.sessionId));
    this.onMessage("pickup_item", (client, payload) => this.dropSystem.handlePickupItem(client.sessionId, payload));
    this.onMessage("pickup_spell", (client, payload) => this.dropSystem.handlePickupSpell(client.sessionId, payload));

    this.onMessage("cast_spell", (client, payload: { slot?: number; targetX?: number; targetY?: number } | undefined) => {
      this.spellCaster.handleCastSpell(client.sessionId, Number(payload?.slot) || 0, Number(payload?.targetX) || 0, Number(payload?.targetY) || 0);
    });

    this.onMessage("swap_weapon", (client, payload: { slot?: number } | undefined) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const slot = Number(payload?.slot);
      if (slot < 0 || slot >= 5 || !Number.isInteger(slot)) return;
      const invSlot = player.inventory[slot];
      if (!invSlot || invSlot.weaponRarity < 0) return;
      const oldType = player.equippedWeaponType;
      const oldRarity = player.equippedWeaponRarity;
      player.equippedWeaponType = invSlot.weaponType;
      player.equippedWeaponRarity = invSlot.weaponRarity;
      invSlot.weaponType = oldType;
      invSlot.weaponRarity = oldRarity;
    });

    this.onMessage("drop_weapon", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (player.equippedWeaponType === "sword" && player.equippedWeaponRarity === 0) return;
      const item = new DroppedItem();
      item.id = `d${this.dropSystem.dropSeq++}`;
      item.x = player.x;
      item.y = player.y;
      item.weaponType = player.equippedWeaponType;
      item.weaponRarity = player.equippedWeaponRarity;
      item.ttl = 30;
      this.state.droppedItems.set(item.id, item);
      player.equippedWeaponType = "sword";
      player.equippedWeaponRarity = 0;
    });

    this.onMessage("reset_game", () => {
      // Reset wave state
      this.state.wave.waveNumber = 0;
      this.state.wave.state = "waiting";
      this.state.wave.timer = 0;
      this.state.wave.enemiesRemaining = 0;
      // Clear all enemies and drops
      this.state.enemies.clear();
      this.state.droppedItems.clear();
      this.state.droppedSpells.clear();
      this.state.floatingTexts.clear();
      // Start fresh
      if (this.state.players.size > 0) {
        this.waveManager.startWavePause();
      }
      this.broadcast("wave_complete", { waveNumber: 0, nextWaveIn: 10 });
    });
  }

  onJoin(client: Client, options: { name?: string }) {
    this.playerManager.createPlayer(client.sessionId, String(options?.name || ""), this.clients.length);
  }

  onLeave(client: Client) {
    this.playerManager.removePlayer(client.sessionId);
    this.combatSystem.cleanupClient(client.sessionId);
  }

  onDispose() {
    if (this.saveInterval) clearInterval(this.saveInterval);
    this.doSave();
  }

  private update(deltaTime: number) {
    const dt = deltaTime / 1000;
    const now = Date.now();

    this.waveManager.updateWave(dt);
    this.playerManager.updatePlayers(dt);
    this.combatSystem.updateEnemies(dt, now);
    this.combatSystem.updateProjectiles(dt);
    this.dropSystem.updateDrops(dt);
    this.updateFloatingTexts(dt);
    this.playerManager.updateHpRegen(dt);
    this.spellCaster.updateSpellEffects(dt);
    this.spellCaster.updateMana(dt);
    this.spellCaster.updateSpellCooldowns(dt);
  }

  private updateFloatingTexts(dt: number) {
    for (const [id, text] of this.state.floatingTexts) {
      text.y -= 18 * dt;
      text.ttl -= dt;
      if (text.ttl <= 0) this.state.floatingTexts.delete(id);
    }
  }

  private doSave() {
    saveState(this.state, this.waveManager.enemySeq, this.dropSystem.dropSeq);
  }
}
