import type { Enemy, Player } from "./GameState.js";

export type EnemyTypeName = "slime" | "skeleton" | "archer" | "wolf" | "golem" | "necromancer" | "creeper" | "sorcerer";

export interface EnemyDef {
  type: EnemyTypeName;
  baseHp: number;
  baseDamage: number;
  speed: number;
  xpReward: number;
  firstWave: number;
}

export const ENEMY_DEFS: Record<EnemyTypeName, EnemyDef> = {
  slime:       { type: "slime",       baseHp: 20,  baseDamage: 8,  speed: 40,  xpReward: 8,  firstWave: 1 },
  skeleton:    { type: "skeleton",    baseHp: 30,  baseDamage: 12, speed: 55,  xpReward: 12, firstWave: 2 },
  archer:      { type: "archer",      baseHp: 18,  baseDamage: 10, speed: 45,  xpReward: 14, firstWave: 3 },
  wolf:        { type: "wolf",        baseHp: 15,  baseDamage: 10, speed: 100, xpReward: 10, firstWave: 4 },
  golem:       { type: "golem",       baseHp: 100, baseDamage: 20, speed: 25,  xpReward: 25, firstWave: 6 },
  necromancer: { type: "necromancer", baseHp: 25,  baseDamage: 6,  speed: 35,  xpReward: 20, firstWave: 8 },
  creeper:     { type: "creeper",     baseHp: 30,  baseDamage: 40, speed: 70,  xpReward: 18, firstWave: 10 },
  sorcerer:    { type: "sorcerer",    baseHp: 20,  baseDamage: 14, speed: 40,  xpReward: 22, firstWave: 12 },
};

export function getAvailableTypes(waveNumber: number): EnemyTypeName[] {
  return (Object.values(ENEMY_DEFS) as EnemyDef[])
    .filter(d => waveNumber >= d.firstWave)
    .map(d => d.type);
}

export function scaleStats(def: EnemyDef, waveNumber: number, isBoss: boolean): { hp: number; damage: number; speed: number; xpReward: number } {
  const hpScale = Math.pow(1.08, waveNumber);
  const dmgScale = Math.pow(1.05, waveNumber);
  let hp = Math.round(def.baseHp * hpScale);
  let damage = Math.round(def.baseDamage * dmgScale);
  let speed = def.speed;
  let xpReward = Math.round(def.xpReward * (1 + waveNumber * 0.1));

  if (isBoss) {
    hp *= 10;
    damage *= 3;
    speed *= 0.8;
    xpReward *= 5;
  }

  return { hp, damage, speed, xpReward };
}

export interface AIAction {
  moveX: number;
  moveY: number;
  shoot?: { dx: number; dy: number; speed: number; damage: number; maxRange: number; homingTurnRate?: number; targetId?: string };
  heal?: { radius: number; amount: number };
  explode?: { radius: number; damage: number };
  slam?: { radius: number; damage: number };
}

function findNearest(enemy: Enemy, players: Iterable<Player>): { player: Player; dist: number } | null {
  let nearest: Player | null = null;
  let bestDist = Infinity;
  for (const p of players) {
    const d = Math.hypot(p.x - enemy.x, p.y - enemy.y);
    if (d < bestDist) { bestDist = d; nearest = p; }
  }
  return nearest ? { player: nearest, dist: bestDist } : null;
}

function dirTo(from: { x: number; y: number }, to: { x: number; y: number }): { dx: number; dy: number; len: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { dx: dx / len, dy: dy / len, len };
}

const cooldowns = new Map<string, number>();

export function clearEnemyCooldowns(enemyId: string) {
  for (const key of [...cooldowns.keys()]) {
    if (key.startsWith(enemyId + ":")) cooldowns.delete(key);
  }
}

export function clearAllCooldowns() {
  cooldowns.clear();
}

function checkCooldown(enemyId: string, ability: string, cooldownMs: number, now: number): boolean {
  const key = `${enemyId}:${ability}`;
  const last = cooldowns.get(key) ?? 0;
  if (now - last < cooldownMs) return false;
  cooldowns.set(key, now);
  return true;
}

export function getEnemyAI(
  enemy: Enemy,
  players: Iterable<Player>,
  allEnemies: Iterable<Enemy>,
  now: number,
): AIAction {
  const target = findNearest(enemy, players);
  if (!target) return { moveX: 0, moveY: 0 };

  const { player, dist } = target;
  const dir = dirTo(enemy, player);
  const type = enemy.enemyType as EnemyTypeName;

  switch (type) {
    case "slime":
    case "skeleton":
      return { moveX: dir.dx, moveY: dir.dy };

    case "archer": {
      if (dist < 100) {
        return { moveX: -dir.dx, moveY: -dir.dy };
      }
      const action: AIAction = { moveX: 0, moveY: 0 };
      if (dist > 220) {
        action.moveX = dir.dx;
        action.moveY = dir.dy;
      }
      if (checkCooldown(enemy.id, "shoot", 800, now)) {
        action.shoot = { dx: dir.dx, dy: dir.dy, speed: 400, damage: enemy.damage, maxRange: 500 };
      }
      return action;
    }

    case "wolf":
      return { moveX: dir.dx, moveY: dir.dy };

    case "golem":
      return { moveX: dir.dx, moveY: dir.dy };

    case "necromancer": {
      const action: AIAction = { moveX: 0, moveY: 0 };
      if (dist < 150) {
        action.moveX = -dir.dx;
        action.moveY = -dir.dy;
      } else if (dist > 180) {
        action.moveX = dir.dx;
        action.moveY = dir.dy;
      }
      const healAmount = enemy.isBoss ? 15 : 5;
      const healRadius = enemy.isBoss ? 150 : 80;
      if (checkCooldown(enemy.id, "heal", 2000, now)) {
        action.heal = { radius: healRadius, amount: healAmount };
      }
      return action;
    }

    case "creeper": {
      if (enemy.isBoss) {
        const action: AIAction = { moveX: dir.dx, moveY: dir.dy };
        if (dist < 110 && checkCooldown(enemy.id, "slam", 3000, now)) {
          action.slam = { radius: 100, damage: enemy.damage };
        }
        return action;
      }
      const action: AIAction = { moveX: dir.dx, moveY: dir.dy };
      if (dist < 30) {
        action.explode = { radius: 100, damage: enemy.damage };
      }
      return action;
    }

    case "sorcerer": {
      const action: AIAction = { moveX: 0, moveY: 0 };
      if (dist < 200) {
        action.moveX = -dir.dx;
        action.moveY = -dir.dy;
      } else if (dist > 270) {
        action.moveX = dir.dx;
        action.moveY = dir.dy;
      }
      if (checkCooldown(enemy.id, "shoot", 1200, now)) {
        action.shoot = {
          dx: dir.dx, dy: dir.dy, speed: 250, damage: enemy.damage, maxRange: 400,
          homingTurnRate: 2, targetId: player.id,
        };
      }
      return action;
    }

    default:
      return { moveX: dir.dx, moveY: dir.dy };
  }
}
