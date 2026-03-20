import { Enemy, FloatingText, Player, GameState } from "./GameState.js";
import { type Projectile, WEAPON_DEFS, type WeaponType, computeWeaponDamage, getWeaponCooldown } from "./WeaponSystem.js";
import { type SkillBuffs, emptyBuffs } from "./SkillTree.js";
import { type ActiveSpellEffect } from "./SpellSystem.js";
import { getEnemyAI, clearEnemyCooldowns } from "./EnemyBehaviors.js";
import { clamp, distance } from "./utils.js";
import type { DropSystem } from "./DropSystem.js";

const ENEMY_TOUCH_COOLDOWN_MS = 650;

export class CombatSystem {
  projectiles: Projectile[] = [];
  projectileSeq = 1;
  private textSeq = 1;
  private lastAttackAt = new Map<string, number>();
  lastDamageAt = new Map<string, number>();

  constructor(
    private state: GameState,
    private broadcast: (type: string, data: any) => void,
    private playerBuffs: Map<string, SkillBuffs>,
    private aimByClient: Map<string, { x: number; y: number }>,
    private secondChanceUsed: Map<string, boolean>,
    private getActiveSpellEffects: () => ActiveSpellEffect[],
    private getDropSystem: () => DropSystem,
  ) {}

  handleAttack(sessionId: string) {
    const player = this.state.players.get(sessionId);
    if (!player) return;

    const weaponType = player.equippedWeaponType as WeaponType;
    const def = WEAPON_DEFS[weaponType];
    if (!def) return;

    const now = Date.now();
    const buffs = this.playerBuffs.get(sessionId) ?? emptyBuffs();
    const baseCooldown = getWeaponCooldown(weaponType, player.dex);
    const cooldown = Math.round(baseCooldown * (1 - buffs.attackSpeedPercent / 200));
    if (now - (this.lastAttackAt.get(sessionId) ?? 0) < cooldown) return;
    this.lastAttackAt.set(sessionId, now);

    const baseDamage = computeWeaponDamage(weaponType, player.equippedWeaponRarity, { str: player.str, dex: player.dex, intel: player.intel });

    const critChance = player.critChance / 100;
    const isCrit = Math.random() < critChance;
    const critMultiplier = isCrit ? (2.0 + buffs.critDamageFlat) : 1.0;

    let categoryBonus = 0;
    if (def.category === "melee") categoryBonus = buffs.meleeDamagePercent;
    else categoryBonus = buffs.rangedDamagePercent;

    let berserkerBonus = 0;
    if (buffs.berserkerDamagePercent > 0 && player.hp / player.maxHp < 0.3) {
      berserkerBonus = buffs.berserkerDamagePercent;
    }

    let allyAuraBonus = 0;
    for (const [otherId, otherPlayer] of this.state.players) {
      if (otherId === sessionId) continue;
      const otherBuffs = this.playerBuffs.get(otherId) ?? emptyBuffs();
      if (otherBuffs.allyDamageAuraPercent > 0 && distance(player, otherPlayer) <= 120) {
        allyAuraBonus = Math.max(allyAuraBonus, otherBuffs.allyDamageAuraPercent);
      }
    }

    const finalDamage = Math.round(baseDamage * critMultiplier * (1 + (categoryBonus + berserkerBonus + allyAuraBonus) / 100));

    let dx: number, dy: number;
    if (def.projectileSpeed === 0) {
      dx = player.lastMoveX || 0;
      dy = player.lastMoveY || 1;
    } else {
      const aim = this.aimByClient.get(sessionId) ?? { x: 0, y: 1 };
      dx = aim.x;
      dy = aim.y;
    }

    if (def.projectileSpeed === 0) {
      this.broadcast("swing", { id: sessionId, x: player.x, y: player.y, dx, dy });
      this.meleeHit(player, sessionId, finalDamage, def, buffs);
    } else {
      for (const [enemyId, enemy] of this.state.enemies) {
        if (distance(player, enemy) <= 40) {
          this.damageEnemy(enemyId, enemy, finalDamage, sessionId, buffs);
        }
      }
      if (def.pelletCount) {
        this.fireShotgun(player, sessionId, finalDamage, def, dx, dy);
      } else {
        this.fireProjectile(player, sessionId, finalDamage, def, dx, dy);
      }
    }

    if (buffs.doubleStrikeChance > 0 && Math.random() < buffs.doubleStrikeChance) {
      if (def.projectileSpeed === 0) {
        this.meleeHit(player, sessionId, finalDamage, def, buffs);
      } else if (def.pelletCount) {
        this.fireShotgun(player, sessionId, finalDamage, def, dx, dy);
      } else {
        this.fireProjectile(player, sessionId, finalDamage, def, dx, dy);
      }
    }
  }

  meleeHit(player: Player, ownerId: string, damage: number, def: typeof WEAPON_DEFS.sword, buffs: SkillBuffs) {
    for (const [enemyId, enemy] of this.state.enemies) {
      if (distance(player, enemy) <= def.range) {
        this.damageEnemy(enemyId, enemy, damage, ownerId, buffs, def.knockback);
      }
    }
  }

  fireProjectile(player: Player, ownerId: string, damage: number, def: typeof WEAPON_DEFS.bow, dirX: number, dirY: number) {
    const id = `p${this.projectileSeq++}`;

    let targetId: string | undefined;
    if (def.homingTurnRate) {
      let bestDist = Infinity;
      for (const [eid, enemy] of this.state.enemies) {
        const d = distance(player, enemy);
        if (d < bestDist) { bestDist = d; targetId = eid; }
      }
    }

    const proj: Projectile = {
      id, x: player.x, y: player.y, dx: dirX, dy: dirY,
      speed: def.projectileSpeed, maxRange: def.range, distanceTraveled: 0,
      damage, ownerId, isEnemy: false,
      aoeRadius: def.aoeRadius, homingTurnRate: def.homingTurnRate, targetId,
    };
    this.projectiles.push(proj);
    this.broadcast("projectile_fired", { id, type: def.type, x: player.x, y: player.y, dx: dirX, dy: dirY, speed: def.projectileSpeed, isEnemy: false });
  }

  fireShotgun(player: Player, ownerId: string, damagePerPellet: number, def: typeof WEAPON_DEFS.shotgun, dirX: number, dirY: number) {
    const baseAngle = Math.atan2(dirY, dirX);
    const count = def.pelletCount!;
    const cone = def.coneAngle!;
    for (let i = 0; i < count; i++) {
      const angle = baseAngle - cone / 2 + (cone / (count - 1)) * i;
      const pdx = Math.cos(angle);
      const pdy = Math.sin(angle);
      const id = `p${this.projectileSeq++}`;
      const proj: Projectile = {
        id, x: player.x, y: player.y, dx: pdx, dy: pdy,
        speed: def.projectileSpeed, maxRange: def.range, distanceTraveled: 0,
        damage: damagePerPellet, ownerId, isEnemy: false,
      };
      this.projectiles.push(proj);
      this.broadcast("projectile_fired", { id, type: "shotgun", x: player.x, y: player.y, dx: pdx, dy: pdy, speed: def.projectileSpeed, isEnemy: false });
    }
  }

  damageEnemy(enemyId: string, enemy: Enemy, damage: number, killerId: string, buffs: SkillBuffs, knockback?: number) {
    enemy.hp -= damage;
    this.spawnFloatingText(`-${damage}`, enemy.x, enemy.y - 12);

    if (knockback && knockback > 0) {
      const player = this.state.players.get(killerId);
      if (player) {
        const dx = enemy.x - player.x;
        const dy = enemy.y - player.y;
        const len = Math.hypot(dx, dy) || 1;
        const kb = enemy.enemyType === "golem" ? knockback * 0.5 : knockback;
        enemy.x += (dx / len) * kb;
        enemy.y += (dy / len) * kb;
      }
    }

    if (buffs.vampirismPercent > 0) {
      const player = this.state.players.get(killerId);
      if (player) {
        const heal = Math.round(damage * buffs.vampirismPercent / 100);
        player.hp = Math.min(player.maxHp, player.hp + heal);
      }
    }

    if (enemy.hp <= 0) {
      const killer = this.state.players.get(killerId);
      if (killer) this.killEnemy(enemyId, killer);
    }
  }

  damagePlayer(player: Player, rawDamage: number) {
    const effects = this.getActiveSpellEffects();
    for (const eff of effects) {
      if (eff.spellId === "magicShield" && eff.casterId === player.id && eff.shieldHp && eff.shieldHp > 0) {
        if (rawDamage <= eff.shieldHp) {
          eff.shieldHp -= rawDamage;
          this.spawnFloatingText("SHIELD!", player.x, player.y - 20);
          return;
        } else {
          rawDamage -= eff.shieldHp;
          eff.shieldHp = 0;
        }
      }
    }

    const buffs = this.playerBuffs.get(player.id) ?? emptyBuffs();
    const damage = Math.round(rawDamage * (1 - buffs.damageReductionPercent / 100));
    player.hp = Math.max(0, player.hp - damage);
    this.spawnFloatingText(`-${damage}`, player.x, player.y - 16);

    if (player.hp <= 0) {
      if (buffs.secondChance && !this.secondChanceUsed.get(player.id)) {
        this.secondChanceUsed.set(player.id, true);
        player.hp = Math.round(player.maxHp * 0.5);
        this.spawnFloatingText("SECOND CHANCE!", player.x, player.y - 32);
        return;
      }

      player.hp = player.maxHp;
      player.x = 300 + Math.random() * 1000;
      player.y = 250 + Math.random() * 700;
      player.xp = Math.max(0, player.xp - 20);
      this.broadcast("player_died", { id: player.id });
    }
  }

  updateProjectiles(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      const moveStep = proj.speed * dt;

      if (proj.homingTurnRate && proj.targetId) {
        const target = proj.isEnemy
          ? this.state.players.get(proj.targetId)
          : this.state.enemies.get(proj.targetId);
        if (target) {
          const toDirX = target.x - proj.x;
          const toDirY = target.y - proj.y;
          const toLen = Math.hypot(toDirX, toDirY) || 1;
          const desiredAngle = Math.atan2(toDirY / toLen, toDirX / toLen);
          const currentAngle = Math.atan2(proj.dy, proj.dx);
          let angleDiff = desiredAngle - currentAngle;
          while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
          while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
          const maxTurn = proj.homingTurnRate * dt;
          const turn = clamp(angleDiff, -maxTurn, maxTurn);
          const newAngle = currentAngle + turn;
          proj.dx = Math.cos(newAngle);
          proj.dy = Math.sin(newAngle);
        }
      }

      proj.x += proj.dx * moveStep;
      proj.y += proj.dy * moveStep;
      proj.distanceTraveled += moveStep;

      if (proj.distanceTraveled >= proj.maxRange || proj.x < 0 || proj.x > this.state.worldWidth || proj.y < 0 || proj.y > this.state.worldHeight) {
        this.broadcast("projectile_hit", { id: proj.id });
        this.projectiles.splice(i, 1);
        continue;
      }

      let hit = false;
      if (proj.isEnemy) {
        for (const player of this.state.players.values()) {
          if (distance(proj, player) < 20) {
            this.damagePlayer(player, proj.damage);
            hit = true;
            break;
          }
        }
      } else {
        const buffs = this.playerBuffs.get(proj.ownerId) ?? emptyBuffs();
        if (proj.aoeRadius) {
          for (const [enemyId, enemy] of this.state.enemies) {
            if (distance(proj, enemy) < 20) {
              for (const [eid2, e2] of this.state.enemies) {
                if (distance(proj, e2) <= proj.aoeRadius) {
                  this.damageEnemy(eid2, e2, proj.damage, proj.ownerId, buffs);
                }
              }
              hit = true;
              break;
            }
          }
        } else {
          for (const [enemyId, enemy] of this.state.enemies) {
            if (distance(proj, enemy) < 20) {
              this.damageEnemy(enemyId, enemy, proj.damage, proj.ownerId, buffs);
              hit = true;
              break;
            }
          }
        }
      }

      if (hit) {
        this.broadcast("projectile_hit", { id: proj.id });
        this.projectiles.splice(i, 1);
      }
    }
  }

  updateEnemies(dt: number, now: number) {
    const playersArr = [...this.state.players.values()];
    const enemiesArr = [...this.state.enemies.values()];
    const enemiesToDelete: string[] = [];

    for (const [enemyId, enemy] of this.state.enemies) {
      const action = getEnemyAI(enemy, playersArr, enemiesArr, now);

      enemy.x = clamp(enemy.x + action.moveX * enemy.speed * dt, 0, this.state.worldWidth);
      enemy.y = clamp(enemy.y + action.moveY * enemy.speed * dt, 0, this.state.worldHeight);

      for (const player of playersArr) {
        if (distance(enemy, player) < 30) {
          const key = `${player.id}:${enemy.id}`;
          if (now - (this.lastDamageAt.get(key) ?? 0) >= ENEMY_TOUCH_COOLDOWN_MS) {
            this.lastDamageAt.set(key, now);
            let dmg = enemy.damage;
            if (enemy.enemyType === "wolf" && !enemy.isBoss) {
              const nearbyWolves = enemiesArr.filter(e => e.id !== enemy.id && e.enemyType === "wolf" && distance(e, enemy) <= 80).length;
              if (nearbyWolves > 0) dmg = Math.round(dmg * 1.2);
            }
            this.damagePlayer(player, dmg);
          }
        }
      }

      if (action.shoot) {
        const s = action.shoot;
        const projId = `ep${this.projectileSeq++}`;
        this.projectiles.push({
          id: projId, x: enemy.x, y: enemy.y, dx: s.dx, dy: s.dy,
          speed: s.speed, maxRange: s.maxRange, distanceTraveled: 0,
          damage: s.damage, ownerId: enemy.id, isEnemy: true,
          homingTurnRate: s.homingTurnRate, targetId: s.targetId,
        });
        this.broadcast("projectile_fired", { id: projId, type: enemy.enemyType, x: enemy.x, y: enemy.y, dx: s.dx, dy: s.dy, speed: s.speed, isEnemy: true });
      }

      if (action.heal) {
        for (const other of enemiesArr) {
          if (other.id === enemy.id) continue;
          if (other.isBoss) continue;
          if (distance(enemy, other) <= action.heal.radius && other.hp < other.maxHp) {
            other.hp = Math.min(other.maxHp, other.hp + action.heal.amount);
          }
        }
      }

      if (action.explode) {
        this.broadcast("explosion", { x: enemy.x, y: enemy.y, radius: action.explode.radius });
        for (const player of playersArr) {
          if (distance(enemy, player) <= action.explode.radius) {
            this.damagePlayer(player, action.explode.damage);
          }
        }
        enemiesToDelete.push(enemyId);
        clearEnemyCooldowns(enemyId);
      }

      if (action.slam) {
        this.broadcast("explosion", { x: enemy.x, y: enemy.y, radius: action.slam.radius });
        for (const player of playersArr) {
          if (distance(enemy, player) <= action.slam.radius) {
            this.damagePlayer(player, action.slam.damage);
          }
        }
      }
    }

    for (const eid of enemiesToDelete) {
      this.state.enemies.delete(eid);
    }
  }

  private killEnemy(enemyId: string, killer: Player) {
    const enemy = this.state.enemies.get(enemyId);
    if (!enemy) return;

    const buffs = this.playerBuffs.get(killer.id) ?? emptyBuffs();
    const xpBonus = 1 + buffs.xpBonusPercent / 100;
    const xpGain = Math.round(enemy.xpReward * xpBonus);

    killer.xp += xpGain;
    this.spawnFloatingText(`+${xpGain} XP`, killer.x, killer.y - 30);

    if (buffs.killShieldHp > 0) {
      killer.hp = Math.min(killer.maxHp, killer.hp + buffs.killShieldHp);
    }

    const dropSystem = this.getDropSystem();
    dropSystem.spawnDrop(enemy.x, enemy.y, enemy.isBoss, killer.id);

    if (Math.random() < 0.03) {
      dropSystem.spawnSpellDrop(enemy.x, enemy.y);
    }

    this.state.enemies.delete(enemyId);
    clearEnemyCooldowns(enemyId);

    while (killer.xp >= killer.xpToNext && killer.level < 100) {
      killer.xp -= killer.xpToNext;
      killer.level += 1;
      killer.unspentPoints += 3;
      killer.xpToNext = Math.round(killer.xpToNext * 1.45);
      this.spawnFloatingText(`LEVEL ${killer.level}!`, killer.x, killer.y - 48);
      this.broadcast("level_up", { id: killer.id, level: killer.level });

      if (killer.level % 5 === 0) {
        killer.perkPoints += 1;
        this.broadcast("perk_available", { id: killer.id, level: killer.level });
      }
    }
  }

  spawnFloatingText(text: string, x: number, y: number) {
    const ft = new FloatingText();
    ft.id = `t${this.textSeq++}`;
    ft.text = text;
    ft.x = x;
    ft.y = y;
    ft.ttl = 0.85;
    this.state.floatingTexts.set(ft.id, ft);
  }

  cleanupClient(sessionId: string) {
    this.lastAttackAt.delete(sessionId);
    for (const key of [...this.lastDamageAt.keys()]) {
      if (key.startsWith(`${sessionId}:`)) this.lastDamageAt.delete(key);
    }
  }
}
