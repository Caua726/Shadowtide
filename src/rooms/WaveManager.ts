import { Enemy, GameState } from "./GameState.js";
import { ENEMY_DEFS, type EnemyTypeName, getAvailableTypes, scaleStats, clearAllCooldowns } from "./EnemyBehaviors.js";

const WAVE_PAUSE_SECONDS = 10;
const SPAWN_BATCH_INTERVAL_MS = 1500;
const MAX_ENEMIES = 80;

export class WaveManager {
  private waveEnemyBudget = 0;
  private waveEnemiesSpawned = 0;
  private spawnTimer = 0;
  enemySeq = 1;

  constructor(
    private state: GameState,
    private broadcast: (type: string, data: any) => void,
    private secondChanceUsed: Map<string, boolean>,
  ) {}

  updateWave(dt: number) {
    const wave = this.state.wave;
    if (this.state.players.size === 0) return;

    if (wave.state === "pause") {
      wave.timer -= dt;
      if (wave.timer <= 0) {
        this.startWaveCombat();
      }
    } else if (wave.state === "combat") {
      this.spawnTimer += dt * 1000;
      if (this.spawnTimer >= SPAWN_BATCH_INTERVAL_MS && this.waveEnemiesSpawned < this.waveEnemyBudget) {
        this.spawnTimer = 0;
        const batchSize = Math.min(4 + Math.floor(Math.random() * 3), this.waveEnemyBudget - this.waveEnemiesSpawned, MAX_ENEMIES - this.state.enemies.size);
        for (let i = 0; i < batchSize; i++) {
          this.spawnWaveEnemy();
        }
      }

      wave.enemiesRemaining = (this.waveEnemyBudget - this.waveEnemiesSpawned) + this.state.enemies.size;
      if (wave.enemiesRemaining <= 0) {
        this.completeWave();
      }
    }
  }

  startWavePause() {
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
    this.spawnTimer = SPAWN_BATCH_INTERVAL_MS;
    clearAllCooldowns();

    this.broadcast("wave_start", { waveNumber: wave.waveNumber, enemyCount: this.waveEnemyBudget });

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

  spawnEnemyOfType(typeName: EnemyTypeName, isBoss: boolean): Enemy | null {
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

    const edge = Math.floor(Math.random() * 4);
    if (edge === 0) { enemy.x = Math.random() * this.state.worldWidth; enemy.y = 20; }
    else if (edge === 1) { enemy.x = Math.random() * this.state.worldWidth; enemy.y = this.state.worldHeight - 20; }
    else if (edge === 2) { enemy.x = 20; enemy.y = Math.random() * this.state.worldHeight; }
    else { enemy.x = this.state.worldWidth - 20; enemy.y = Math.random() * this.state.worldHeight; }

    this.state.enemies.set(enemy.id, enemy);
    return enemy;
  }
}
