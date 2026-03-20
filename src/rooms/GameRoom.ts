import { Room, type Client } from "colyseus";
import { Enemy, FloatingText, GameState, Player } from "./GameState.js";

const TICK_RATE = 30;
const PLAYER_SPEED = 180;
const ENEMY_SPAWN_INTERVAL_MS = 1400;
const ENEMY_TOUCH_DAMAGE = 12;
const ENEMY_TOUCH_COOLDOWN_MS = 650;
const ATTACK_RANGE = 90;
const ATTACK_COOLDOWN_MS = 350;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class GameRoom extends Room<GameState> {
  state = new GameState();
  maxClients = 32;

  private inputByClient = new Map<string, { x: number; y: number }>();
  private lastAttackAt = new Map<string, number>();
  private lastDamageAt = new Map<string, number>();
  private enemySeq = 1;
  private textSeq = 1;
  private spawnInterval?: NodeJS.Timeout;

  onCreate() {
    this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000 / TICK_RATE);

    this.onMessage("move", (client, payload: { x?: number; y?: number } | undefined) => {
      const x = Number(payload?.x) || 0;
      const y = Number(payload?.y) || 0;
      const len = Math.hypot(x, y);

      if (len > 0) {
        this.inputByClient.set(client.sessionId, { x: x / len, y: y / len });
      } else {
        this.inputByClient.set(client.sessionId, { x: 0, y: 0 });
      }
    });

    this.onMessage("attack", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const now = Date.now();
      if (now - (this.lastAttackAt.get(client.sessionId) ?? 0) < ATTACK_COOLDOWN_MS) {
        return;
      }
      this.lastAttackAt.set(client.sessionId, now);

      const dx = player.lastMoveX || 0;
      const dy = player.lastMoveY || 1;
      this.broadcast("swing", { id: client.sessionId, x: player.x, y: player.y, dx, dy });

      for (const [enemyId, enemy] of this.state.enemies) {
        if (distance(player, enemy) <= ATTACK_RANGE) {
          enemy.hp -= player.damage;
          this.spawnFloatingText(`-${player.damage}`, enemy.x, enemy.y - 12);
          if (enemy.hp <= 0) {
            this.killEnemy(enemyId, player);
          }
        }
      }
    });

    this.spawnInterval = setInterval(() => this.spawnEnemy(), ENEMY_SPAWN_INTERVAL_MS);
  }

  onJoin(client: Client, options: { name?: string }) {
    const player = new Player();
    player.id = client.sessionId;
    player.name = String(options?.name || `Player ${this.clients.length}`);
    player.x = 300 + Math.random() * 1000;
    player.y = 250 + Math.random() * 700;

    this.state.players.set(client.sessionId, player);
    this.inputByClient.set(client.sessionId, { x: 0, y: 0 });
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.inputByClient.delete(client.sessionId);
    this.lastAttackAt.delete(client.sessionId);

    for (const key of [...this.lastDamageAt.keys()]) {
      if (key.startsWith(`${client.sessionId}:`)) {
        this.lastDamageAt.delete(key);
      }
    }
  }

  onDispose() {
    if (this.spawnInterval) clearInterval(this.spawnInterval);
  }

  private update(deltaTime: number) {
    const dt = deltaTime / 1000;
    const now = Date.now();

    for (const [id, player] of this.state.players) {
      const input = this.inputByClient.get(id) ?? { x: 0, y: 0 };
      player.x = clamp(player.x + input.x * PLAYER_SPEED * dt, 24, this.state.worldWidth - 24);
      player.y = clamp(player.y + input.y * PLAYER_SPEED * dt, 24, this.state.worldHeight - 24);

      if (input.x !== 0 || input.y !== 0) {
        player.lastMoveX = input.x;
        player.lastMoveY = input.y;
      }
    }

    for (const enemy of this.state.enemies.values()) {
      let nearest: Player | null = null;
      let bestDistance = Infinity;

      for (const player of this.state.players.values()) {
        const d = distance(enemy, player);
        if (d < bestDistance) {
          bestDistance = d;
          nearest = player;
        }
      }

      if (!nearest) continue;

      if (bestDistance > 1) {
        const dx = nearest.x - enemy.x;
        const dy = nearest.y - enemy.y;
        const len = Math.hypot(dx, dy) || 1;
        enemy.x += (dx / len) * enemy.speed * dt;
        enemy.y += (dy / len) * enemy.speed * dt;
      }

      if (bestDistance < 30) {
        const key = `${nearest.id}:${enemy.id}`;
        if (now - (this.lastDamageAt.get(key) ?? 0) >= ENEMY_TOUCH_COOLDOWN_MS) {
          this.lastDamageAt.set(key, now);
          nearest.hp = Math.max(0, nearest.hp - ENEMY_TOUCH_DAMAGE);
          this.spawnFloatingText(`-${ENEMY_TOUCH_DAMAGE}`, nearest.x, nearest.y - 16);

          if (nearest.hp <= 0) {
            nearest.hp = nearest.maxHp;
            nearest.x = 300 + Math.random() * 1000;
            nearest.y = 250 + Math.random() * 700;
            nearest.xp = Math.max(0, nearest.xp - 20);
            this.broadcast("player_died", { id: nearest.id });
          }
        }
      }
    }

    for (const [id, text] of this.state.floatingTexts) {
      text.y -= 18 * dt;
      text.ttl -= dt;
      if (text.ttl <= 0) {
        this.state.floatingTexts.delete(id);
      }
    }
  }

  private spawnEnemy() {
    if (this.state.players.size === 0) return;
    if (this.state.enemies.size >= 60) return;

    const enemy = new Enemy();
    enemy.id = `e${this.enemySeq++}`;

    const edge = Math.floor(Math.random() * 4);
    if (edge === 0) {
      enemy.x = Math.random() * this.state.worldWidth;
      enemy.y = 20;
    } else if (edge === 1) {
      enemy.x = Math.random() * this.state.worldWidth;
      enemy.y = this.state.worldHeight - 20;
    } else if (edge === 2) {
      enemy.x = 20;
      enemy.y = Math.random() * this.state.worldHeight;
    } else {
      enemy.x = this.state.worldWidth - 20;
      enemy.y = Math.random() * this.state.worldHeight;
    }

    const scale = 1 + Math.random() * 0.8;
    enemy.maxHp = Math.round(24 * scale);
    enemy.hp = enemy.maxHp;
    enemy.speed = 40 + Math.random() * 35;
    enemy.xpReward = Math.round(10 * scale);

    this.state.enemies.set(enemy.id, enemy);
  }

  private killEnemy(enemyId: string, killer: Player) {
    const enemy = this.state.enemies.get(enemyId);
    if (!enemy) return;

    killer.xp += enemy.xpReward;
    this.spawnFloatingText(`+${enemy.xpReward} XP`, killer.x, killer.y - 30);
    this.state.enemies.delete(enemyId);

    while (killer.xp >= killer.xpToNext) {
      killer.xp -= killer.xpToNext;
      killer.level += 1;
      killer.maxHp += 20;
      killer.hp = killer.maxHp;
      killer.damage += 4;
      killer.xpToNext = Math.round(killer.xpToNext * 1.45);
      this.spawnFloatingText(`LEVEL ${killer.level}!`, killer.x, killer.y - 48);
      this.broadcast("level_up", { id: killer.id, level: killer.level });
    }
  }

  private spawnFloatingText(text: string, x: number, y: number) {
    const ft = new FloatingText();
    ft.id = `t${this.textSeq++}`;
    ft.text = text;
    ft.x = x;
    ft.y = y;
    ft.ttl = 0.85;
    this.state.floatingTexts.set(ft.id, ft);
  }
}
