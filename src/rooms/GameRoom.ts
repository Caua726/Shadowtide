import { Room, type Client } from "colyseus";
import { DroppedItem, Enemy, FloatingText, GameState, Player } from "./GameState.js";
import { type Projectile, WEAPON_DEFS, type WeaponType, computeWeaponDamage, getWeaponCooldown, rollRarity, rollWeaponType } from "./WeaponSystem.js";
import { ENEMY_DEFS, type EnemyTypeName, getAvailableTypes, scaleStats, getEnemyAI, clearEnemyCooldowns, clearAllCooldowns } from "./EnemyBehaviors.js";
import { NODE_MAP, canActivateNode, computeBuffs, getTotalCost, type SkillBuffs, emptyBuffs } from "./SkillTree.js";

const TICK_RATE = 30;
const BASE_PLAYER_SPEED = 180;
const ENEMY_TOUCH_COOLDOWN_MS = 650;
const WAVE_PAUSE_SECONDS = 10;
const SPAWN_BATCH_INTERVAL_MS = 1500;
const DROP_TTL = 30;
const MAX_DROPS = 40;
const MAX_ENEMIES = 80;
const DROP_CHANCE_NORMAL = 0.05;
const PICKUP_RANGE = 40;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class GameRoom extends Room<{ state: GameState }> {
  state = new GameState();
  maxClients = 32;

  private inputByClient = new Map<string, { x: number; y: number }>();
  private lastAttackAt = new Map<string, number>();
  private lastDamageAt = new Map<string, number>();
  private playerBuffs = new Map<string, SkillBuffs>();
  private secondChanceUsed = new Map<string, boolean>(); // per wave
  private enemySeq = 1;
  private textSeq = 1;
  private dropSeq = 1;
  private projectileSeq = 1;
  private projectiles: Projectile[] = [];

  // Wave system
  private waveEnemyBudget = 0;
  private waveEnemiesSpawned = 0;
  private spawnTimer = 0;
  private waveTimer = 0;

  onCreate() {
    this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000 / TICK_RATE);
    this.registerMessages();
  }

  private registerMessages() {
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

    this.onMessage("attack", (client) => this.handleAttack(client));
    this.onMessage("allocate_points", (client, payload) => this.handleAllocatePoints(client, payload));
    this.onMessage("activate_node", (client, payload) => this.handleActivateNode(client, payload));
    this.onMessage("reset_tree", (client) => this.handleResetTree(client));
    this.onMessage("pickup_item", (client, payload) => this.handlePickupItem(client, payload));
  }

  // --- Attack ---
  private handleAttack(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const weaponType = player.equippedWeaponType as WeaponType;
    const def = WEAPON_DEFS[weaponType];
    if (!def) return;

    const now = Date.now();
    const buffs = this.playerBuffs.get(client.sessionId) ?? emptyBuffs();
    const baseCooldown = getWeaponCooldown(weaponType, player.dex);
    const cooldown = Math.round(baseCooldown * (1 - buffs.attackSpeedPercent / 200)); // diminishing returns
    if (now - (this.lastAttackAt.get(client.sessionId) ?? 0) < cooldown) return;
    this.lastAttackAt.set(client.sessionId, now);

    const baseDamage = computeWeaponDamage(weaponType, player.equippedWeaponRarity, { str: player.str, dex: player.dex, intel: player.intel });

    // Crit check
    const critChance = player.critChance / 100;
    const isCrit = Math.random() < critChance;
    const critMultiplier = isCrit ? (2.0 + buffs.critDamageFlat) : 1.0;

    // Category-based damage bonus from skill tree
    let categoryBonus = 0;
    if (def.category === "melee") categoryBonus = buffs.meleeDamagePercent;
    else categoryBonus = buffs.rangedDamagePercent;

    // Berserker check
    let berserkerBonus = 0;
    if (buffs.berserkerDamagePercent > 0 && player.hp / player.maxHp < 0.3) {
      berserkerBonus = buffs.berserkerDamagePercent;
    }

    // Ally damage aura — check if any nearby ally has the aura buff
    let allyAuraBonus = 0;
    for (const [otherId, otherPlayer] of this.state.players) {
      if (otherId === client.sessionId) continue;
      const otherBuffs = this.playerBuffs.get(otherId) ?? emptyBuffs();
      if (otherBuffs.allyDamageAuraPercent > 0 && distance(player, otherPlayer) <= 120) {
        allyAuraBonus = Math.max(allyAuraBonus, otherBuffs.allyDamageAuraPercent);
      }
    }

    const finalDamage = Math.round(baseDamage * critMultiplier * (1 + (categoryBonus + berserkerBonus + allyAuraBonus) / 100));

    const dx = player.lastMoveX || 0;
    const dy = player.lastMoveY || 1;

    if (def.projectileSpeed === 0) {
      // Melee attack
      this.broadcast("swing", { id: client.sessionId, x: player.x, y: player.y, dx, dy });
      this.meleeHit(player, client.sessionId, finalDamage, def, buffs);
    } else if (def.pelletCount) {
      // Shotgun — multiple projectiles in cone
      this.fireShotgun(player, client.sessionId, finalDamage, def, dx, dy);
    } else {
      // Single projectile
      this.fireProjectile(player, client.sessionId, finalDamage, def, dx, dy);
    }

    // Double Strike
    if (buffs.doubleStrikeChance > 0 && Math.random() < buffs.doubleStrikeChance) {
      if (def.projectileSpeed === 0) {
        this.meleeHit(player, client.sessionId, finalDamage, def, buffs);
      } else if (def.pelletCount) {
        this.fireShotgun(player, client.sessionId, finalDamage, def, dx, dy);
      } else {
        this.fireProjectile(player, client.sessionId, finalDamage, def, dx, dy);
      }
    }
  }

  private meleeHit(player: Player, ownerId: string, damage: number, def: typeof WEAPON_DEFS.sword, buffs: SkillBuffs) {
    for (const [enemyId, enemy] of this.state.enemies) {
      if (distance(player, enemy) <= def.range) {
        this.damageEnemy(enemyId, enemy, damage, ownerId, buffs, def.knockback);
      }
    }
  }

  private fireProjectile(player: Player, ownerId: string, damage: number, def: typeof WEAPON_DEFS.bow, dirX: number, dirY: number) {
    const id = `p${this.projectileSeq++}`;

    // For homing projectiles, find nearest enemy as target
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

  private fireShotgun(player: Player, ownerId: string, damagePerPellet: number, def: typeof WEAPON_DEFS.shotgun, dirX: number, dirY: number) {
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

  private damageEnemy(enemyId: string, enemy: Enemy, damage: number, killerId: string, buffs: SkillBuffs, knockback?: number) {
    enemy.hp -= damage;
    this.spawnFloatingText(`-${damage}`, enemy.x, enemy.y - 12);

    // Knockback
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

    // Vampirism
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

  // --- Attribute allocation ---
  private handleAllocatePoints(client: Client, payload: any) {
    const player = this.state.players.get(client.sessionId);
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

  // --- Skill tree ---
  private handleActivateNode(client: Client, payload: any) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const nodeId = payload?.nodeId;
    if (!nodeId) return;

    const activeIds = [...player.activeSkillNodes];
    const result = canActivateNode(nodeId, activeIds);
    if (!result.ok) return;
    if (player.perkPoints < result.cost) return;

    player.perkPoints -= result.cost;
    player.activeSkillNodes.push(nodeId);
    this.recomputeBuffs(client.sessionId, player);
    this.recomputeDerivedStats(player);
  }

  private handleResetTree(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const refund = getTotalCost([...player.activeSkillNodes]);
    player.activeSkillNodes.clear();
    player.activeSkillNodes.push("center");
    player.perkPoints += refund;
    this.recomputeBuffs(client.sessionId, player);
    this.recomputeDerivedStats(player);

    // Clamp HP
    if (player.hp > player.maxHp) player.hp = player.maxHp;
    if (player.hp < 1) player.hp = 1;
  }

  // --- Item pickup ---
  private handlePickupItem(client: Client, payload: any) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const itemId = payload?.itemId;
    if (!itemId) return;

    const item = this.state.droppedItems.get(itemId);
    if (!item) return;
    const buffs = this.playerBuffs.get(client.sessionId) ?? emptyBuffs();
    const pickupRange = PICKUP_RANGE * (1 + buffs.pickupRadiusPercent / 100);
    if (distance(player, item) > pickupRange) return;

    player.equippedWeaponType = item.weaponType;
    player.equippedWeaponRarity = item.weaponRarity;
    this.state.droppedItems.delete(itemId);
  }

  // --- Derived stats ---
  private recomputeBuffs(sessionId: string, player: Player) {
    const buffs = computeBuffs([...player.activeSkillNodes]);
    this.playerBuffs.set(sessionId, buffs);
  }

  private recomputeDerivedStats(player: Player) {
    const buffs = this.playerBuffs.get(player.id) ?? emptyBuffs();
    const baseMaxHp = 100 + player.vit * 10;
    player.maxHp = Math.round(baseMaxHp * (1 + buffs.maxHpPercent / 100));
    player.moveSpeed = Math.round(BASE_PLAYER_SPEED * (1 + buffs.moveSpeedPercent / 100));
    player.critChance = player.lck * 0.5; // stored as percentage
    player.hpRegen = player.vit * 0.2 + buffs.hpRegenFlat;
  }

  // --- Join / Leave ---
  onJoin(client: Client, options: { name?: string }) {
    const player = new Player();
    player.id = client.sessionId;
    player.name = String(options?.name || `Player ${this.clients.length}`);
    player.x = 300 + Math.random() * 1000;
    player.y = 250 + Math.random() * 700;
    player.activeSkillNodes.push("center");

    this.state.players.set(client.sessionId, player);
    this.inputByClient.set(client.sessionId, { x: 0, y: 0 });
    this.playerBuffs.set(client.sessionId, emptyBuffs());

    // Start wave system if first player
    if (this.state.players.size === 1 && this.state.wave.state === "waiting") {
      this.startWavePause();
    }
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.inputByClient.delete(client.sessionId);
    this.lastAttackAt.delete(client.sessionId);
    this.playerBuffs.delete(client.sessionId);
    this.secondChanceUsed.delete(client.sessionId);
    for (const key of [...this.lastDamageAt.keys()]) {
      if (key.startsWith(`${client.sessionId}:`)) this.lastDamageAt.delete(key);
    }
  }

  onDispose() {}

  // --- Main update loop ---
  private update(deltaTime: number) {
    const dt = deltaTime / 1000;
    const now = Date.now();

    this.updateWave(dt, now);
    this.updatePlayers(dt);
    this.updateEnemies(dt, now);
    this.updateProjectiles(dt, now);
    this.updateDrops(dt);
    this.updateFloatingTexts(dt);
    this.updateHpRegen(dt);
  }

  // --- Wave state machine ---
  private updateWave(dt: number, now: number) {
    const wave = this.state.wave;
    if (this.state.players.size === 0) return;

    if (wave.state === "pause") {
      wave.timer -= dt;
      if (wave.timer <= 0) {
        this.startWaveCombat();
      }
    } else if (wave.state === "combat") {
      // Spawn enemies in batches
      this.spawnTimer += dt * 1000;
      if (this.spawnTimer >= SPAWN_BATCH_INTERVAL_MS && this.waveEnemiesSpawned < this.waveEnemyBudget) {
        this.spawnTimer = 0;
        const batchSize = Math.min(4 + Math.floor(Math.random() * 3), this.waveEnemyBudget - this.waveEnemiesSpawned, MAX_ENEMIES - this.state.enemies.size);
        for (let i = 0; i < batchSize; i++) {
          this.spawnWaveEnemy();
        }
      }

      // Check wave complete
      wave.enemiesRemaining = (this.waveEnemyBudget - this.waveEnemiesSpawned) + this.state.enemies.size;
      if (wave.enemiesRemaining <= 0) {
        this.completeWave();
      }
    }
  }

  private startWavePause() {
    const wave = this.state.wave;
    wave.state = "pause";
    wave.timer = WAVE_PAUSE_SECONDS;
    this.secondChanceUsed.clear();
  }

  private startWaveCombat() {
    const wave = this.state.wave;
    wave.waveNumber++;
    wave.state = "combat";
    wave.timer = 0;
    this.waveEnemyBudget = Math.min(5 + wave.waveNumber * 2, 200);
    this.waveEnemiesSpawned = 0;
    this.spawnTimer = SPAWN_BATCH_INTERVAL_MS; // spawn first batch immediately
    clearAllCooldowns();

    this.broadcast("wave_start", { waveNumber: wave.waveNumber, enemyCount: this.waveEnemyBudget });

    // Boss wave
    if (wave.waveNumber % 5 === 0) {
      this.spawnBoss();
    }
  }

  private completeWave() {
    this.broadcast("wave_complete", { waveNumber: this.state.wave.waveNumber, nextWaveIn: WAVE_PAUSE_SECONDS });
    this.startWavePause();
  }

  private spawnWaveEnemy() {
    if (this.state.enemies.size >= MAX_ENEMIES) return;
    const waveNum = this.state.wave.waveNumber;
    const available = getAvailableTypes(waveNum);
    const typeName = available[Math.floor(Math.random() * available.length)];
    this.spawnEnemyOfType(typeName, false);
    this.waveEnemiesSpawned++;
  }

  private spawnBoss() {
    const waveNum = this.state.wave.waveNumber;
    const available = getAvailableTypes(waveNum);
    const typeName = available[Math.floor(Math.random() * available.length)];
    const enemy = this.spawnEnemyOfType(typeName, true);
    if (enemy) {
      this.broadcast("boss_spawn", { enemyId: enemy.id, enemyType: typeName });
    }
  }

  private spawnEnemyOfType(typeName: EnemyTypeName, isBoss: boolean): Enemy | null {
    const def = ENEMY_DEFS[typeName];
    const waveNum = this.state.wave.waveNumber;
    const scaled = scaleStats(def, waveNum, isBoss);

    const enemy = new Enemy();
    enemy.id = `e${this.enemySeq++}`;
    enemy.enemyType = typeName;
    enemy.isBoss = isBoss;
    enemy.hp = scaled.hp;
    enemy.maxHp = scaled.hp;
    enemy.damage = scaled.damage;
    enemy.speed = scaled.speed;
    enemy.xpReward = scaled.xpReward;

    // Spawn at random edge
    const edge = Math.floor(Math.random() * 4);
    if (edge === 0) { enemy.x = Math.random() * this.state.worldWidth; enemy.y = 20; }
    else if (edge === 1) { enemy.x = Math.random() * this.state.worldWidth; enemy.y = this.state.worldHeight - 20; }
    else if (edge === 2) { enemy.x = 20; enemy.y = Math.random() * this.state.worldHeight; }
    else { enemy.x = this.state.worldWidth - 20; enemy.y = Math.random() * this.state.worldHeight; }

    this.state.enemies.set(enemy.id, enemy);
    return enemy;
  }

  // --- Player update ---
  private updatePlayers(dt: number) {
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

  // --- Enemy AI update ---
  private updateEnemies(dt: number, now: number) {
    const playersArr = [...this.state.players.values()];
    const enemiesArr = [...this.state.enemies.values()];
    const enemiesToDelete: string[] = [];

    for (const [enemyId, enemy] of this.state.enemies) {
      const action = getEnemyAI(enemy, playersArr, enemiesArr, now);

      // Movement
      enemy.x = clamp(enemy.x + action.moveX * enemy.speed * dt, 0, this.state.worldWidth);
      enemy.y = clamp(enemy.y + action.moveY * enemy.speed * dt, 0, this.state.worldHeight);

      // Touch damage for melee enemies
      for (const player of playersArr) {
        if (distance(enemy, player) < 30) {
          const key = `${player.id}:${enemy.id}`;
          if (now - (this.lastDamageAt.get(key) ?? 0) >= ENEMY_TOUCH_COOLDOWN_MS) {
            this.lastDamageAt.set(key, now);
            let dmg = enemy.damage;
            // Wolf pack bonus
            if (enemy.enemyType === "wolf" && !enemy.isBoss) {
              const nearbyWolves = enemiesArr.filter(e => e.id !== enemy.id && e.enemyType === "wolf" && distance(e, enemy) <= 80).length;
              if (nearbyWolves > 0) dmg = Math.round(dmg * 1.2);
            }
            this.damagePlayer(player, dmg);
          }
        }
      }

      // Ranged attack (creates enemy projectile)
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

      // Necromancer heal
      if (action.heal) {
        for (const other of enemiesArr) {
          if (other.id === enemy.id) continue; // can't heal self
          if (other.isBoss) continue; // can't heal bosses
          if (distance(enemy, other) <= action.heal.radius && other.hp < other.maxHp) {
            other.hp = Math.min(other.maxHp, other.hp + action.heal.amount);
          }
        }
      }

      // Creeper explosion
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

      // Boss creeper slam
      if (action.slam) {
        this.broadcast("explosion", { x: enemy.x, y: enemy.y, radius: action.slam.radius });
        for (const player of playersArr) {
          if (distance(enemy, player) <= action.slam.radius) {
            this.damagePlayer(player, action.slam.damage);
          }
        }
      }
    }

    // Deferred deletion (creeper explosions)
    for (const eid of enemiesToDelete) {
      this.state.enemies.delete(eid);
    }
  }

  private damagePlayer(player: Player, rawDamage: number) {
    const buffs = this.playerBuffs.get(player.id) ?? emptyBuffs();
    const damage = Math.round(rawDamage * (1 - buffs.damageReductionPercent / 100));
    player.hp = Math.max(0, player.hp - damage);
    this.spawnFloatingText(`-${damage}`, player.x, player.y - 16);

    if (player.hp <= 0) {
      // Second Chance check
      if (buffs.secondChance && !this.secondChanceUsed.get(player.id)) {
        this.secondChanceUsed.set(player.id, true);
        player.hp = Math.round(player.maxHp * 0.5);
        this.spawnFloatingText("SECOND CHANCE!", player.x, player.y - 32);
        return;
      }

      // Normal death: respawn with XP penalty
      player.hp = player.maxHp;
      player.x = 300 + Math.random() * 1000;
      player.y = 250 + Math.random() * 700;
      player.xp = Math.max(0, player.xp - 20);
      this.broadcast("player_died", { id: player.id });
    }
  }

  // --- Projectile update ---
  private updateProjectiles(dt: number, now: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      const moveStep = proj.speed * dt;

      // Homing
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

      // Out of bounds or max range
      if (proj.distanceTraveled >= proj.maxRange || proj.x < 0 || proj.x > this.state.worldWidth || proj.y < 0 || proj.y > this.state.worldHeight) {
        this.broadcast("projectile_hit", { id: proj.id });
        this.projectiles.splice(i, 1);
        continue;
      }

      // Hit detection
      let hit = false;
      if (proj.isEnemy) {
        // Enemy projectile hits players
        for (const player of this.state.players.values()) {
          if (distance(proj, player) < 20) {
            this.damagePlayer(player, proj.damage);
            hit = true;
            break;
          }
        }
      } else {
        // Player projectile hits enemies
        const buffs = this.playerBuffs.get(proj.ownerId) ?? emptyBuffs();
        if (proj.aoeRadius) {
          // AoE: check center hit, then damage all in radius
          for (const [enemyId, enemy] of this.state.enemies) {
            if (distance(proj, enemy) < 20) {
              // Explode on contact
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

  // --- Drop system ---
  private updateDrops(dt: number) {
    for (const [id, item] of this.state.droppedItems) {
      item.ttl -= dt;
      if (item.ttl <= 0) {
        this.state.droppedItems.delete(id);
      }
    }
  }

  private spawnDrop(x: number, y: number, isBoss: boolean, killerId: string) {
    const waveNum = this.state.wave.waveNumber;
    const killer = this.state.players.get(killerId);
    const killerLck = killer?.lck ?? 0;
    const buffs = this.playerBuffs.get(killerId) ?? emptyBuffs();
    const dropChance = isBoss ? 1.0 : (DROP_CHANCE_NORMAL + buffs.dropChancePercent / 100);
    if (Math.random() > dropChance) return;

    // Enforce max drops
    if (this.state.droppedItems.size >= MAX_DROPS) {
      // Remove oldest
      const firstKey = this.state.droppedItems.keys().next().value;
      if (firstKey) this.state.droppedItems.delete(firstKey);
    }

    const item = new DroppedItem();
    item.id = `d${this.dropSeq++}`;
    item.x = x;
    item.y = y;
    item.weaponType = rollWeaponType();
    let rarity = rollRarity(isBoss, waveNum, killerLck);
    // Apply skill tree rarity shift
    rarity = Math.min(4, rarity + buffs.dropRarityShift);
    item.weaponRarity = rarity;
    item.ttl = DROP_TTL;
    this.state.droppedItems.set(item.id, item);
  }

  // --- Kill enemy ---
  private killEnemy(enemyId: string, killer: Player) {
    const enemy = this.state.enemies.get(enemyId);
    if (!enemy) return;

    const buffs = this.playerBuffs.get(killer.id) ?? emptyBuffs();
    const xpBonus = 1 + buffs.xpBonusPercent / 100;
    const xpGain = Math.round(enemy.xpReward * xpBonus);

    killer.xp += xpGain;
    this.spawnFloatingText(`+${xpGain} XP`, killer.x, killer.y - 30);

    // Kill Shield
    if (buffs.killShieldHp > 0) {
      killer.hp = Math.min(killer.maxHp, killer.hp + buffs.killShieldHp);
    }

    // Drop
    this.spawnDrop(enemy.x, enemy.y, enemy.isBoss, killer.id);

    this.state.enemies.delete(enemyId);
    clearEnemyCooldowns(enemyId);

    // Level up
    while (killer.xp >= killer.xpToNext && killer.level < 100) {
      killer.xp -= killer.xpToNext;
      killer.level += 1;
      killer.unspentPoints += 3;
      killer.xpToNext = Math.round(killer.xpToNext * 1.45);
      this.spawnFloatingText(`LEVEL ${killer.level}!`, killer.x, killer.y - 48);
      this.broadcast("level_up", { id: killer.id, level: killer.level });

      // Perk point every 5 levels
      if (killer.level % 5 === 0) {
        killer.perkPoints += 1;
        this.broadcast("perk_available", { id: killer.id, level: killer.level });
      }
    }
  }

  // --- HP Regen ---
  private hpRegenAccumulator = new Map<string, number>();
  private updateHpRegen(dt: number) {
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

  // --- Floating text ---
  private updateFloatingTexts(dt: number) {
    for (const [id, text] of this.state.floatingTexts) {
      text.y -= 18 * dt;
      text.ttl -= dt;
      if (text.ttl <= 0) this.state.floatingTexts.delete(id);
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
