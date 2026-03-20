import { GameState, Player, InventorySlot, SpellSlot } from "./GameState.js";
import { type SkillBuffs, emptyBuffs, computeBuffs, canActivateNode, getTotalCost } from "./SkillTree.js";
import { getMaxMana, getManaRegen } from "./SpellSystem.js";
import { clamp } from "./utils.js";

const BASE_PLAYER_SPEED = 180;

export class PlayerManager {
  inputByClient = new Map<string, { x: number; y: number }>();
  aimByClient = new Map<string, { x: number; y: number }>();
  private hpRegenAccumulator = new Map<string, number>();

  constructor(
    private state: GameState,
    private playerBuffs: Map<string, SkillBuffs>,
    private secondChanceUsed: Map<string, boolean>,
    private onFirstPlayer: () => void,
  ) {}

  createPlayer(sessionId: string, name: string, clientCount: number): Player {
    const player = new Player();
    player.id = sessionId;
    player.name = name || `Player ${clientCount}`;
    player.x = 300 + Math.random() * 1000;
    player.y = 250 + Math.random() * 700;
    player.activeSkillNodes.push("center");
    for (let i = 0; i < 5; i++) {
      const slot = new InventorySlot();
      player.inventory.push(slot);
    }
    for (let i = 0; i < 5; i++) {
      const slot = new SpellSlot();
      player.spellSlots.push(slot);
    }
    player.maxMana = getMaxMana(0);
    player.mana = player.maxMana;
    player.manaRegen = getManaRegen(0);

    this.state.players.set(sessionId, player);
    this.inputByClient.set(sessionId, { x: 0, y: 0 });
    this.playerBuffs.set(sessionId, emptyBuffs());

    if (this.state.players.size === 1 && this.state.wave.state === "waiting") {
      this.onFirstPlayer();
    }

    return player;
  }

  removePlayer(sessionId: string) {
    this.state.players.delete(sessionId);
    this.inputByClient.delete(sessionId);
    this.aimByClient.delete(sessionId);
    this.playerBuffs.delete(sessionId);
    this.secondChanceUsed.delete(sessionId);
  }

  handleAllocatePoints(sessionId: string, payload: any) {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    const str = Math.floor(Number(payload?.str) || 0);
    const dex = Math.floor(Number(payload?.dex) || 0);
    const vit = Math.floor(Number(payload?.vit) || 0);
    const intel = Math.floor(Number(payload?.intel) || 0);
    const lck = Math.floor(Number(payload?.lck) || 0);
    const total = str + dex + vit + intel + lck;
    if (total <= 0 || total > player.unspentPoints) return;
    if (str < 0 || dex < 0 || vit < 0 || intel < 0 || lck < 0) return;

    player.str += str;
    player.dex += dex;
    player.vit += vit;
    player.intel += intel;
    player.lck += lck;
    player.unspentPoints -= total;
    this.recomputeDerivedStats(player);
  }

  handleActivateNode(sessionId: string, payload: any) {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    const nodeId = payload?.nodeId;
    if (!nodeId) return;

    const activeIds = [...player.activeSkillNodes];
    const result = canActivateNode(nodeId, activeIds);
    if (!result.ok) return;
    if (player.perkPoints < result.cost) return;

    player.perkPoints -= result.cost;
    player.activeSkillNodes.push(nodeId);
    this.recomputeBuffs(sessionId, player);
    this.recomputeDerivedStats(player);
  }

  handleResetTree(sessionId: string) {
    const player = this.state.players.get(sessionId);
    if (!player) return;

    const refund = getTotalCost([...player.activeSkillNodes]);
    player.activeSkillNodes.clear();
    player.activeSkillNodes.push("center");
    player.perkPoints += refund;
    this.recomputeBuffs(sessionId, player);
    this.recomputeDerivedStats(player);

    if (player.hp > player.maxHp) player.hp = player.maxHp;
    if (player.hp < 1) player.hp = 1;
  }

  recomputeBuffs(sessionId: string, player: Player) {
    const buffs = computeBuffs([...player.activeSkillNodes]);
    this.playerBuffs.set(sessionId, buffs);
  }

  recomputeDerivedStats(player: Player) {
    const buffs = this.playerBuffs.get(player.id) ?? emptyBuffs();
    const baseMaxHp = 100 + player.vit * 10;
    player.maxHp = Math.round(baseMaxHp * (1 + buffs.maxHpPercent / 100));
    player.moveSpeed = Math.round(BASE_PLAYER_SPEED * (1 + buffs.moveSpeedPercent / 100));
    player.critChance = player.lck * 0.5;
    player.hpRegen = 1.0 + player.vit * 0.3 + buffs.hpRegenFlat;
    player.maxMana = getMaxMana(player.intel);
    player.manaRegen = getManaRegen(player.intel);
  }

  updatePlayers(dt: number) {
    for (const [id, player] of this.state.players) {
      const input = this.inputByClient.get(id) ?? { x: 0, y: 0 };
      player.x = clamp(player.x + input.x * player.moveSpeed * dt, 24, this.state.worldWidth - 24);
      player.y = clamp(player.y + input.y * player.moveSpeed * dt, 24, this.state.worldHeight - 24);
      if (input.x !== 0 || input.y !== 0) {
        player.lastMoveX = input.x;
        player.lastMoveY = input.y;
      }
    }
  }

  updateHpRegen(dt: number) {
    for (const [id, player] of this.state.players) {
      if (player.hpRegen > 0 && player.hp < player.maxHp && player.hp > 0) {
        const acc = (this.hpRegenAccumulator.get(id) ?? 0) + player.hpRegen * dt;
        const whole = Math.floor(acc);
        if (whole >= 1) {
          player.hp = Math.min(player.maxHp, player.hp + whole);
          this.hpRegenAccumulator.set(id, acc - whole);
        } else {
          this.hpRegenAccumulator.set(id, acc);
        }
      }
    }
  }
}
