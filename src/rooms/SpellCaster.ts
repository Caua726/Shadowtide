import { GameState, Player } from "./GameState.js";
import { type SpellId, SPELL_DEFS, getSpellDamage, getSpellCooldown, getMaxMana, getManaRegen, type ActiveSpellEffect } from "./SpellSystem.js";
import { type SkillBuffs, emptyBuffs } from "./SkillTree.js";
import { distance } from "./utils.js";
import type { CombatSystem } from "./CombatSystem.js";

const TICK_RATE = 30;

export class SpellCaster {
  activeSpellEffects: ActiveSpellEffect[] = [];
  private spellSeq = 1;

  constructor(
    private state: GameState,
    private broadcast: (type: string, data: any) => void,
    private playerBuffs: Map<string, SkillBuffs>,
    private getCombatSystem: () => CombatSystem,
  ) {}

  handleCastSpell(sessionId: string, slotIndex: number, targetX: number, targetY: number) {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    if (slotIndex < 0 || slotIndex >= player.maxSpellSlots) return;

    const slot = player.spellSlots[slotIndex];
    if (!slot || !slot.spellId || slot.spellRarity < 0) return;
    if (slot.cooldownLeft > 0) return;

    const spellId = slot.spellId as SpellId;
    const def = SPELL_DEFS[spellId];
    if (!def) return;

    if (player.mana < def.baseManaCost) return;
    player.mana -= def.baseManaCost;

    slot.cooldownLeft = getSpellCooldown(spellId, player.intel) / 1000;

    const damage = getSpellDamage(spellId, slot.spellRarity, player.intel);
    const aim = { x: targetX - player.x, y: targetY - player.y };
    const aimLen = Math.hypot(aim.x, aim.y) || 1;
    aim.x /= aimLen; aim.y /= aimLen;

    const effectId = `se${this.spellSeq++}`;
    const combat = this.getCombatSystem();

    switch (spellId) {
      case "fireball": {
        combat.projectiles.push({
          id: effectId, x: player.x, y: player.y, dx: aim.x, dy: aim.y,
          speed: def.projectileSpeed, maxRange: 600, distanceTraveled: 0,
          damage, ownerId: sessionId, isEnemy: false, aoeRadius: def.radius,
        });
        this.broadcast("spell_cast", { spellId, effectId, casterId: sessionId, x: player.x, y: player.y, dx: aim.x, dy: aim.y, targetX, targetY, rarity: slot.spellRarity });
        break;
      }
      case "iceRay": {
        combat.projectiles.push({
          id: effectId, x: player.x, y: player.y, dx: aim.x, dy: aim.y,
          speed: def.projectileSpeed, maxRange: 500, distanceTraveled: 0,
          damage, ownerId: sessionId, isEnemy: false,
        });
        this.activeSpellEffects.push({ id: effectId, spellId, casterId: sessionId, x: 0, y: 0, damage: 0, radius: 0, remainingTime: def.duration, slowFactor: 0.4 });
        this.broadcast("spell_cast", { spellId, effectId, casterId: sessionId, x: player.x, y: player.y, dx: aim.x, dy: aim.y, targetX, targetY, rarity: slot.spellRarity });
        break;
      }
      case "magicShield": {
        const shieldHp = Math.round(50 * (1 + player.intel * 0.03) * [1, 1.3, 1.7, 2.2, 3.5][slot.spellRarity]);
        this.activeSpellEffects.push({ id: effectId, spellId, casterId: sessionId, x: player.x, y: player.y, damage: 0, radius: 0, remainingTime: def.duration, shieldHp });
        this.broadcast("spell_cast", { spellId, effectId, casterId: sessionId, x: player.x, y: player.y, rarity: slot.spellRarity });
        break;
      }
      case "heal": {
        const totalHeal = Math.round(40 * (1 + player.intel * 0.03) * [1, 1.3, 1.7, 2.2, 3.5][slot.spellRarity]);
        this.activeSpellEffects.push({ id: effectId, spellId, casterId: sessionId, x: player.x, y: player.y, damage: 0, radius: 0, remainingTime: def.duration, healPerTick: totalHeal / (def.duration * TICK_RATE) });
        this.broadcast("spell_cast", { spellId, effectId, casterId: sessionId, x: player.x, y: player.y, rarity: slot.spellRarity });
        break;
      }
      case "meteor": {
        this.activeSpellEffects.push({ id: effectId, spellId, casterId: sessionId, x: targetX, y: targetY, damage, radius: def.radius, remainingTime: 1.0 });
        this.broadcast("spell_cast", { spellId, effectId, casterId: sessionId, x: targetX, y: targetY, rarity: slot.spellRarity });
        break;
      }
      case "chainLightning": {
        let firstTarget: { id: string; enemy: any } | null = null;
        let bestDist = Infinity;
        for (const [eid, e] of this.state.enemies) {
          const d = distance(player, e);
          if (d < 400 && d < bestDist) { bestDist = d; firstTarget = { id: eid, enemy: e }; }
        }
        if (firstTarget) {
          const buffs = this.playerBuffs.get(sessionId) ?? emptyBuffs();
          const hitEnemies = new Set<string>();
          hitEnemies.add(firstTarget.id);
          combat.damageEnemy(firstTarget.id, firstTarget.enemy, damage, sessionId, buffs);
          let current = firstTarget.enemy;
          for (let chain = 0; chain < 4; chain++) {
            let nextTarget: { id: string; enemy: any } | null = null;
            let nd = Infinity;
            for (const [eid, e] of this.state.enemies) {
              if (hitEnemies.has(eid)) continue;
              const d = distance(current, e);
              if (d < def.radius && d < nd) { nd = d; nextTarget = { id: eid, enemy: e }; }
            }
            if (!nextTarget) break;
            hitEnemies.add(nextTarget.id);
            combat.damageEnemy(nextTarget.id, nextTarget.enemy, Math.round(damage * 0.7), sessionId, buffs);
            current = nextTarget.enemy;
          }
        }
        this.broadcast("spell_cast", { spellId, effectId, casterId: sessionId, x: player.x, y: player.y, targetX: firstTarget?.enemy?.x ?? targetX, targetY: firstTarget?.enemy?.y ?? targetY, rarity: slot.spellRarity });
        break;
      }
      case "teleport": {
        const clampX = Math.max(24, Math.min(this.state.worldWidth - 24, targetX));
        const clampY = Math.max(24, Math.min(this.state.worldHeight - 24, targetY));
        const maxDist = 400;
        const dx = clampX - player.x;
        const dy = clampY - player.y;
        const dist = Math.hypot(dx, dy);
        if (dist > maxDist) {
          player.x += (dx / dist) * maxDist;
          player.y += (dy / dist) * maxDist;
        } else {
          player.x = clampX;
          player.y = clampY;
        }
        this.broadcast("spell_cast", { spellId, effectId, casterId: sessionId, x: player.x, y: player.y, rarity: slot.spellRarity });
        break;
      }
      case "summonSpirits": {
        const spirits = [];
        for (let i = 0; i < 3; i++) {
          spirits.push({ x: player.x + (Math.random() - 0.5) * 60, y: player.y + (Math.random() - 0.5) * 60 });
        }
        this.activeSpellEffects.push({ id: effectId, spellId, casterId: sessionId, x: player.x, y: player.y, damage, radius: def.radius, remainingTime: def.duration, spirits });
        this.broadcast("spell_cast", { spellId, effectId, casterId: sessionId, x: player.x, y: player.y, rarity: slot.spellRarity });
        break;
      }
      case "arcaneStorm": {
        this.activeSpellEffects.push({ id: effectId, spellId, casterId: sessionId, x: targetX, y: targetY, damage, radius: def.radius, remainingTime: def.duration });
        this.broadcast("spell_cast", { spellId, effectId, casterId: sessionId, x: targetX, y: targetY, rarity: slot.spellRarity });
        break;
      }
      case "blackHole": {
        this.activeSpellEffects.push({ id: effectId, spellId, casterId: sessionId, x: targetX, y: targetY, damage, radius: def.radius, remainingTime: def.duration, pullForce: 180 });
        this.broadcast("spell_cast", { spellId, effectId, casterId: sessionId, x: targetX, y: targetY, rarity: slot.spellRarity });
        break;
      }
    }
  }

  updateSpellEffects(dt: number) {
    const combat = this.getCombatSystem();
    for (let i = this.activeSpellEffects.length - 1; i >= 0; i--) {
      const eff = this.activeSpellEffects[i];
      eff.remainingTime -= dt;

      const caster = this.state.players.get(eff.casterId);
      const buffs = caster ? (this.playerBuffs.get(eff.casterId) ?? emptyBuffs()) : emptyBuffs();

      switch (eff.spellId as SpellId) {
        case "heal": {
          if (caster && eff.healPerTick) {
            caster.hp = Math.min(caster.maxHp, caster.hp + eff.healPerTick);
          }
          break;
        }
        case "meteor": {
          if (eff.remainingTime <= 0) {
            for (const [eid, enemy] of this.state.enemies) {
              if (distance(eff, enemy) <= eff.radius) {
                combat.damageEnemy(eid, enemy, eff.damage, eff.casterId, buffs);
              }
            }
            this.broadcast("spell_effect", { spellId: "meteor", x: eff.x, y: eff.y, radius: eff.radius, phase: "impact" });
          }
          break;
        }
        case "arcaneStorm": {
          if (Math.floor(eff.remainingTime * 2) !== Math.floor((eff.remainingTime + dt) * 2)) {
            for (const [eid, enemy] of this.state.enemies) {
              if (distance(eff, enemy) <= eff.radius) {
                combat.damageEnemy(eid, enemy, Math.round(eff.damage * 0.3), eff.casterId, buffs);
              }
            }
          }
          break;
        }
        case "blackHole": {
          for (const enemy of this.state.enemies.values()) {
            const d = distance(eff, enemy);
            if (d <= eff.radius && d > 5) {
              const pullX = eff.x - enemy.x;
              const pullY = eff.y - enemy.y;
              const len = Math.hypot(pullX, pullY) || 1;
              const force = (eff.pullForce ?? 180) * dt;
              enemy.x += (pullX / len) * force;
              enemy.y += (pullY / len) * force;
            }
          }
          if (Math.floor(eff.remainingTime * 2) !== Math.floor((eff.remainingTime + dt) * 2)) {
            for (const [eid, enemy] of this.state.enemies) {
              if (distance(eff, enemy) <= eff.radius) {
                combat.damageEnemy(eid, enemy, Math.round(eff.damage * 0.5), eff.casterId, buffs);
              }
            }
          }
          break;
        }
        case "summonSpirits": {
          if (eff.spirits) {
            for (const spirit of eff.spirits) {
              let nearest: any = null;
              let bestD = Infinity;
              for (const enemy of this.state.enemies.values()) {
                const d = Math.hypot(spirit.x - enemy.x, spirit.y - enemy.y);
                if (d < bestD) { bestD = d; nearest = enemy; }
              }
              if (nearest && bestD < eff.radius) {
                const dx = nearest.x - spirit.x;
                const dy = nearest.y - spirit.y;
                const len = Math.hypot(dx, dy) || 1;
                spirit.x += (dx / len) * 150 * dt;
                spirit.y += (dy / len) * 150 * dt;
                if (bestD < 25) {
                  for (const [eid, e] of this.state.enemies) {
                    if (e === nearest) {
                      combat.damageEnemy(eid, e, Math.round(eff.damage * dt * 3), eff.casterId, buffs);
                      break;
                    }
                  }
                }
              }
            }
            this.broadcast("spell_spirits_update", { id: eff.id, spirits: eff.spirits });
          }
          break;
        }
        case "magicShield": {
          break;
        }
      }

      if (eff.remainingTime <= 0) {
        this.activeSpellEffects.splice(i, 1);
        this.broadcast("spell_end", { effectId: eff.id, spellId: eff.spellId });
      }
    }
  }

  updateMana(dt: number) {
    for (const player of this.state.players.values()) {
      if (player.mana < player.maxMana) {
        player.mana = Math.min(player.maxMana, player.mana + player.manaRegen * dt);
      }
    }
  }

  updateSpellCooldowns(dt: number) {
    for (const player of this.state.players.values()) {
      for (let i = 0; i < 5; i++) {
        const slot = player.spellSlots[i];
        if (slot && slot.cooldownLeft > 0) {
          slot.cooldownLeft = Math.max(0, slot.cooldownLeft - dt);
        }
      }
    }
  }
}
