// client/src/game.c
#include "game.h"
#include <string.h>
#include <stdio.h>
#include <math.h>

void game_init(GameState *gs) {
    memset(gs, 0, sizeof(*gs));
    gs->worldWidth = 1600;
    gs->worldHeight = 1200;
}

// === Lookup helpers ===

Player *game_find_player(GameState *gs, const char *id) {
    for (int i = 0; i < MAX_PLAYERS; i++)
        if (gs->players[i].active && strcmp(gs->players[i].id, id) == 0)
            return &gs->players[i];
    return NULL;
}

static Player *game_alloc_player(GameState *gs) {
    for (int i = 0; i < MAX_PLAYERS; i++)
        if (!gs->players[i].active) return &gs->players[i];
    return NULL;
}

Player *game_my_player(GameState *gs) {
    return game_find_player(gs, gs->mySessionId);
}

Enemy *game_find_enemy(GameState *gs, const char *id) {
    for (int i = 0; i < MAX_ENEMIES; i++)
        if (gs->enemies[i].active && strcmp(gs->enemies[i].id, id) == 0)
            return &gs->enemies[i];
    return NULL;
}

static Enemy *game_alloc_enemy(GameState *gs) {
    for (int i = 0; i < MAX_ENEMIES; i++)
        if (!gs->enemies[i].active) return &gs->enemies[i];
    return NULL;
}

static DroppedItem *find_drop(GameState *gs, const char *id) {
    for (int i = 0; i < MAX_DROPS; i++)
        if (gs->drops[i].active && strcmp(gs->drops[i].id, id) == 0)
            return &gs->drops[i];
    return NULL;
}

static DroppedItem *alloc_drop(GameState *gs) {
    for (int i = 0; i < MAX_DROPS; i++)
        if (!gs->drops[i].active) return &gs->drops[i];
    return NULL;
}

static DroppedSpell *find_spell_drop(GameState *gs, const char *id) {
    for (int i = 0; i < MAX_SPELL_DROPS; i++)
        if (gs->spellDrops[i].active && strcmp(gs->spellDrops[i].id, id) == 0)
            return &gs->spellDrops[i];
    return NULL;
}

static DroppedSpell *alloc_spell_drop(GameState *gs) {
    for (int i = 0; i < MAX_SPELL_DROPS; i++)
        if (!gs->spellDrops[i].active) return &gs->spellDrops[i];
    return NULL;
}

static FloatingText *alloc_float_text(GameState *gs) {
    for (int i = 0; i < MAX_FLOAT_TEXTS; i++)
        if (!gs->floatTexts[i].active) return &gs->floatTexts[i];
    return NULL;
}

static Projectile *alloc_projectile(GameState *gs) {
    for (int i = 0; i < MAX_PROJECTILES; i++)
        if (!gs->projectiles[i].active) return &gs->projectiles[i];
    return NULL;
}

static SpellEffect *alloc_spell_effect(GameState *gs) {
    for (int i = 0; i < MAX_SPELL_EFFECTS; i++)
        if (!gs->spellEffects[i].active) return &gs->spellEffects[i];
    return NULL;
}

static SwingEffect *alloc_swing(GameState *gs) {
    for (int i = 0; i < MAX_SWINGS; i++)
        if (!gs->swings[i].active) return &gs->swings[i];
    return NULL;
}

// === JSON helpers ===

static float jnum(cJSON *obj, const char *key, float def) {
    cJSON *v = cJSON_GetObjectItem(obj, key);
    return v ? (float)v->valuedouble : def;
}

static int jint(cJSON *obj, const char *key, int def) {
    cJSON *v = cJSON_GetObjectItem(obj, key);
    return v ? v->valueint : def;
}

static const char *jstr(cJSON *obj, const char *key) {
    cJSON *v = cJSON_GetObjectItem(obj, key);
    return (v && v->valuestring) ? v->valuestring : "";
}

static bool jbool(cJSON *obj, const char *key) {
    cJSON *v = cJSON_GetObjectItem(obj, key);
    return v ? cJSON_IsTrue(v) : false;
}

// === Parse entity from JSON ===

static void parse_player(Player *p, cJSON *obj, bool full) {
    if (full) memset(p, 0, sizeof(*p));
    p->active = true;

    cJSON *v;
    if ((v = cJSON_GetObjectItem(obj, "id"))) strncpy(p->id, v->valuestring, ID_LEN - 1);
    if ((v = cJSON_GetObjectItem(obj, "name"))) strncpy(p->name, v->valuestring, NAME_LEN - 1);
    if ((v = cJSON_GetObjectItem(obj, "x"))) p->x = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "y"))) p->y = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "hp"))) p->hp = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "maxHp"))) p->maxHp = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "mana"))) p->mana = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "maxMana"))) p->maxMana = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "manaRegen"))) p->manaRegen = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "level"))) p->level = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "xp"))) p->xp = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "xpToNext"))) p->xpToNext = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "str"))) p->str = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "dex"))) p->dex = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "vit"))) p->vit = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "intel"))) p->intel = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "lck"))) p->lck = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "unspentPoints"))) p->unspentPoints = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "perkPoints"))) p->perkPoints = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "equippedWeaponType"))) p->equippedWeaponType = weapon_type_from_string(v->valuestring);
    if ((v = cJSON_GetObjectItem(obj, "equippedWeaponRarity"))) p->equippedWeaponRarity = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "maxSpellSlots"))) p->maxSpellSlots = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "aimX"))) p->aimX = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "aimY"))) p->aimY = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "lastMoveX"))) p->lastMoveX = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "lastMoveY"))) p->lastMoveY = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "moveSpeed"))) p->moveSpeed = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "critChance"))) p->critChance = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "hpRegen"))) p->hpRegen = (float)v->valuedouble;

    // Inventory
    if ((v = cJSON_GetObjectItem(obj, "inventory"))) {
        int n = cJSON_GetArraySize(v);
        for (int i = 0; i < n && i < MAX_INV_SLOTS; i++) {
            cJSON *slot = cJSON_GetArrayItem(v, i);
            p->inventory[i].weaponType = weapon_type_from_string(jstr(slot, "weaponType"));
            p->inventory[i].weaponRarity = jint(slot, "weaponRarity", -1);
        }
    }

    // Spell slots
    if ((v = cJSON_GetObjectItem(obj, "spellSlots"))) {
        int n = cJSON_GetArraySize(v);
        for (int i = 0; i < n && i < MAX_SPELL_SLOTS; i++) {
            cJSON *slot = cJSON_GetArrayItem(v, i);
            p->spellSlots[i].spellId = spell_id_from_string(jstr(slot, "spellId"));
            p->spellSlots[i].spellRarity = jint(slot, "spellRarity", -1);
            p->spellSlots[i].cooldownLeft = jnum(slot, "cooldownLeft", 0);
        }
    }

    // Active skill nodes
    if ((v = cJSON_GetObjectItem(obj, "activeSkillNodes"))) {
        p->activeSkillNodeCount = 0;
        int n = cJSON_GetArraySize(v);
        for (int i = 0; i < n && i < MAX_SKILL_NODES; i++) {
            cJSON *node = cJSON_GetArrayItem(v, i);
            if (node && node->valuestring) {
                strncpy(p->activeSkillNodes[i], node->valuestring, ID_LEN - 1);
                p->activeSkillNodeCount++;
            }
        }
    }
}

static void parse_enemy(Enemy *e, cJSON *obj, bool full) {
    if (full) memset(e, 0, sizeof(*e));
    e->active = true;
    cJSON *v;
    if ((v = cJSON_GetObjectItem(obj, "id"))) strncpy(e->id, v->valuestring, ID_LEN - 1);
    if ((v = cJSON_GetObjectItem(obj, "x"))) e->x = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "y"))) e->y = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "hp"))) e->hp = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "maxHp"))) e->maxHp = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "speed"))) e->speed = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "damage"))) e->damage = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "enemyType"))) e->enemyType = enemy_type_from_string(v->valuestring);
    if ((v = cJSON_GetObjectItem(obj, "isBoss"))) e->isBoss = cJSON_IsTrue(v);
}

static void parse_drop(DroppedItem *d, cJSON *obj, bool full) {
    if (full) memset(d, 0, sizeof(*d));
    d->active = true;
    cJSON *v;
    if ((v = cJSON_GetObjectItem(obj, "id"))) strncpy(d->id, v->valuestring, ID_LEN - 1);
    if ((v = cJSON_GetObjectItem(obj, "x"))) d->x = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "y"))) d->y = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "weaponType"))) d->weaponType = weapon_type_from_string(v->valuestring);
    if ((v = cJSON_GetObjectItem(obj, "weaponRarity"))) d->weaponRarity = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "ttl"))) d->ttl = (float)v->valuedouble;
}

static void parse_spell_drop(DroppedSpell *s, cJSON *obj, bool full) {
    if (full) memset(s, 0, sizeof(*s));
    s->active = true;
    cJSON *v;
    if ((v = cJSON_GetObjectItem(obj, "id"))) strncpy(s->id, v->valuestring, ID_LEN - 1);
    if ((v = cJSON_GetObjectItem(obj, "x"))) s->x = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "y"))) s->y = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "spellId"))) s->spellId = spell_id_from_string(v->valuestring);
    if ((v = cJSON_GetObjectItem(obj, "spellRarity"))) s->spellRarity = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "ttl"))) s->ttl = (float)v->valuedouble;
}

static void parse_float_text(FloatingText *ft, cJSON *obj, const char *key_id) {
    memset(ft, 0, sizeof(*ft));
    ft->active = true;
    if (key_id) strncpy(ft->id, key_id, ID_LEN - 1);
    strncpy(ft->text, jstr(obj, "text"), sizeof(ft->text) - 1);
    ft->x = jnum(obj, "x", 0);
    ft->y = jnum(obj, "y", 0);
    ft->ttl = jnum(obj, "ttl", 1);
}

static FloatingText *find_float_text(GameState *gs, const char *id) {
    for (int i = 0; i < MAX_FLOAT_TEXTS; i++)
        if (gs->floatTexts[i].active && strcmp(gs->floatTexts[i].id, id) == 0)
            return &gs->floatTexts[i];
    return NULL;
}

// === Process state_sync ===

static void handle_state_sync(GameState *gs, cJSON *root) {
    // Clear all entities
    for (int i = 0; i < MAX_PLAYERS; i++) gs->players[i].active = false;
    for (int i = 0; i < MAX_ENEMIES; i++) gs->enemies[i].active = false;
    for (int i = 0; i < MAX_DROPS; i++) gs->drops[i].active = false;
    for (int i = 0; i < MAX_SPELL_DROPS; i++) gs->spellDrops[i].active = false;
    for (int i = 0; i < MAX_FLOAT_TEXTS; i++) gs->floatTexts[i].active = false;

    // Players
    cJSON *players = cJSON_GetObjectItem(root, "players");
    if (players) {
        cJSON *pj;
        cJSON_ArrayForEach(pj, players) {
            Player *p = game_alloc_player(gs);
            if (p) parse_player(p, pj, true);
        }
    }

    // Enemies
    cJSON *enemies = cJSON_GetObjectItem(root, "enemies");
    if (enemies) {
        cJSON *ej;
        cJSON_ArrayForEach(ej, enemies) {
            Enemy *e = game_alloc_enemy(gs);
            if (e) parse_enemy(e, ej, true);
        }
    }

    // Dropped items
    cJSON *drops = cJSON_GetObjectItem(root, "droppedItems");
    if (drops) {
        cJSON *dj;
        cJSON_ArrayForEach(dj, drops) {
            DroppedItem *d = alloc_drop(gs);
            if (d) parse_drop(d, dj, true);
        }
    }

    // Dropped spells
    cJSON *spells = cJSON_GetObjectItem(root, "droppedSpells");
    if (spells) {
        cJSON *sj;
        cJSON_ArrayForEach(sj, spells) {
            DroppedSpell *s = alloc_spell_drop(gs);
            if (s) parse_spell_drop(s, sj, true);
        }
    }

    // Floating texts
    cJSON *texts = cJSON_GetObjectItem(root, "floatingTexts");
    if (texts) {
        cJSON *tj;
        cJSON_ArrayForEach(tj, texts) {
            FloatingText *ft = alloc_float_text(gs);
            if (ft) parse_float_text(ft, tj, NULL);
        }
    }

    // Wave
    cJSON *wave = cJSON_GetObjectItem(root, "wave");
    if (wave) {
        gs->wave.waveNumber = jint(wave, "waveNumber", 0);
        gs->wave.state = wave_state_from_string(jstr(wave, "state"));
        gs->wave.timer = jnum(wave, "timer", 0);
        gs->wave.enemiesRemaining = jint(wave, "enemiesRemaining", 0);
    }

    gs->connected = true;
}

// === Process state_patch ===

static void handle_state_patch(GameState *gs, cJSON *root) {
    // Players
    cJSON *players = cJSON_GetObjectItem(root, "players");
    if (players) {
        cJSON *pj;
        cJSON_ArrayForEach(pj, players) {
            const char *id = pj->string;
            if (cJSON_IsNull(pj)) {
                Player *p = game_find_player(gs, id);
                if (p) p->active = false;
            } else {
                Player *p = game_find_player(gs, id);
                if (!p) { p = game_alloc_player(gs); if (!p) continue; }
                parse_player(p, pj, p->id[0] == '\0');
                if (p->id[0] == '\0') strncpy(p->id, id, ID_LEN - 1);
            }
        }
    }

    // Enemies
    cJSON *enemies = cJSON_GetObjectItem(root, "enemies");
    if (enemies) {
        cJSON *ej;
        cJSON_ArrayForEach(ej, enemies) {
            const char *id = ej->string;
            if (cJSON_IsNull(ej)) {
                Enemy *e = game_find_enemy(gs, id);
                if (e) e->active = false;
            } else {
                Enemy *e = game_find_enemy(gs, id);
                if (!e) { e = game_alloc_enemy(gs); if (!e) continue; }
                parse_enemy(e, ej, e->id[0] == '\0');
                if (e->id[0] == '\0') strncpy(e->id, id, ID_LEN - 1);
            }
        }
    }

    // Dropped items
    cJSON *drops = cJSON_GetObjectItem(root, "droppedItems");
    if (drops) {
        cJSON *dj;
        cJSON_ArrayForEach(dj, drops) {
            const char *id = dj->string;
            if (cJSON_IsNull(dj)) {
                DroppedItem *d = find_drop(gs, id);
                if (d) d->active = false;
            } else {
                DroppedItem *d = find_drop(gs, id);
                if (!d) { d = alloc_drop(gs); if (!d) continue; }
                parse_drop(d, dj, d->id[0] == '\0');
                if (d->id[0] == '\0') strncpy(d->id, id, ID_LEN - 1);
            }
        }
    }

    // Dropped spells
    cJSON *spellDrops = cJSON_GetObjectItem(root, "droppedSpells");
    if (spellDrops) {
        cJSON *sj;
        cJSON_ArrayForEach(sj, spellDrops) {
            const char *id = sj->string;
            if (cJSON_IsNull(sj)) {
                DroppedSpell *s = find_spell_drop(gs, id);
                if (s) s->active = false;
            } else {
                DroppedSpell *s = find_spell_drop(gs, id);
                if (!s) { s = alloc_spell_drop(gs); if (!s) continue; }
                parse_spell_drop(s, sj, s->id[0] == '\0');
                if (s->id[0] == '\0') strncpy(s->id, id, ID_LEN - 1);
            }
        }
    }

    // Floating texts
    cJSON *texts = cJSON_GetObjectItem(root, "floatingTexts");
    if (texts) {
        cJSON *tj;
        cJSON_ArrayForEach(tj, texts) {
            const char *id = tj->string;
            if (cJSON_IsNull(tj)) {
                FloatingText *ft = find_float_text(gs, id);
                if (ft) ft->active = false;
            } else {
                FloatingText *ft = find_float_text(gs, id);
                if (!ft) { ft = alloc_float_text(gs); if (!ft) continue; }
                parse_float_text(ft, tj, id);
            }
        }
    }

    // Wave
    cJSON *wave = cJSON_GetObjectItem(root, "wave");
    if (wave) {
        cJSON *v;
        if ((v = cJSON_GetObjectItem(wave, "waveNumber"))) gs->wave.waveNumber = v->valueint;
        if ((v = cJSON_GetObjectItem(wave, "state"))) gs->wave.state = wave_state_from_string(v->valuestring);
        if ((v = cJSON_GetObjectItem(wave, "timer"))) gs->wave.timer = (float)v->valuedouble;
        if ((v = cJSON_GetObjectItem(wave, "enemiesRemaining"))) gs->wave.enemiesRemaining = v->valueint;
    }
}

// === Process events ===

static void handle_event(GameState *gs, cJSON *root) {
    const char *event = jstr(root, "event");
    cJSON *data = cJSON_GetObjectItem(root, "data");
    if (!data) return;

    if (strcmp(event, "projectile_fired") == 0) {
        Projectile *p = alloc_projectile(gs);
        if (!p) return;
        memset(p, 0, sizeof(*p));
        p->active = true;
        strncpy(p->id, jstr(data, "id"), ID_LEN - 1);
        p->x = jnum(data, "x", 0);
        p->y = jnum(data, "y", 0);
        p->dx = jnum(data, "dx", 0);
        p->dy = jnum(data, "dy", 0);
        p->speed = jnum(data, "speed", 500);
        p->isEnemy = jbool(data, "isEnemy");
        p->type = weapon_type_from_string(jstr(data, "type"));
        p->lifetime = 3.0f;
    }
    else if (strcmp(event, "projectile_hit") == 0) {
        const char *id = jstr(data, "id");
        for (int i = 0; i < MAX_PROJECTILES; i++) {
            if (gs->projectiles[i].active && strcmp(gs->projectiles[i].id, id) == 0) {
                gs->projectiles[i].active = false;
                break;
            }
        }
    }
    else if (strcmp(event, "swing") == 0) {
        SwingEffect *sw = alloc_swing(gs);
        if (!sw) return;
        sw->active = true;
        sw->x = jnum(data, "x", 0);
        sw->y = jnum(data, "y", 0);
        sw->dx = jnum(data, "dx", 0);
        sw->dy = jnum(data, "dy", 0);
        sw->ttl = 0.15f;
        sw->weaponType = WEAPON_SWORD; // server doesn't send weaponType in swing event
    }
    else if (strcmp(event, "explosion") == 0) {
        SpellEffect *se = alloc_spell_effect(gs);
        if (!se) return;
        memset(se, 0, sizeof(*se));
        se->active = true;
        se->spellId = -1; // generic explosion
        se->x = jnum(data, "x", 0);
        se->y = jnum(data, "y", 0);
        se->radius = jnum(data, "radius", 100);
        se->ttl = 0.3f;
    }
    else if (strcmp(event, "spell_cast") == 0) {
        SpellEffect *se = alloc_spell_effect(gs);
        if (!se) return;
        memset(se, 0, sizeof(*se));
        se->active = true;
        strncpy(se->id, jstr(data, "effectId"), ID_LEN - 1);
        se->spellId = spell_id_from_string(jstr(data, "spellId"));
        se->x = jnum(data, "x", 0);
        se->y = jnum(data, "y", 0);
        se->radius = 60; // default
        se->ttl = 5.0f;

        // Projectile spells also spawn a projectile
        if (se->spellId == SPELL_FIREBALL || se->spellId == SPELL_ICE_RAY) {
            Projectile *p = alloc_projectile(gs);
            if (p) {
                memset(p, 0, sizeof(*p));
                p->active = true;
                strncpy(p->id, se->id, ID_LEN - 1);
                p->x = jnum(data, "x", 0);
                p->y = jnum(data, "y", 0);
                p->dx = jnum(data, "dx", 0);
                p->dy = jnum(data, "dy", 0);
                p->speed = (se->spellId == SPELL_FIREBALL) ? 450.0f : 500.0f;
                p->isEnemy = false;
                p->type = -1; // spell projectile
                p->lifetime = 3.0f;
            }
            se->active = false; // no lingering effect for projectile spells
        }
    }
    else if (strcmp(event, "spell_effect") == 0) {
        // Update existing spell effect (e.g., meteor impact)
        SpellEffect *se = alloc_spell_effect(gs);
        if (!se) return;
        memset(se, 0, sizeof(*se));
        se->active = true;
        se->spellId = spell_id_from_string(jstr(data, "spellId"));
        se->x = jnum(data, "x", 0);
        se->y = jnum(data, "y", 0);
        se->radius = jnum(data, "radius", 60);
        se->ttl = 0.5f;
    }
    else if (strcmp(event, "spell_end") == 0) {
        const char *effectId = jstr(data, "effectId");
        for (int i = 0; i < MAX_SPELL_EFFECTS; i++) {
            if (gs->spellEffects[i].active && strcmp(gs->spellEffects[i].id, effectId) == 0) {
                gs->spellEffects[i].active = false;
                break;
            }
        }
    }
    // Other events (level_up, wave_start, etc.) are informational
    // State changes come through patches
}

// === Main message router ===

void game_process_message(GameState *gs, const char *json_str) {
    cJSON *root = cJSON_Parse(json_str);
    if (!root) return;

    const char *type = jstr(root, "type");
    ServerMsgType mt = server_msg_type(type);

    switch (mt) {
    case MSG_IDENTITY:
        strncpy(gs->mySessionId, jstr(root, "sessionId"), ID_LEN - 1);
        break;
    case MSG_STATE_SYNC:
        handle_state_sync(gs, root);
        break;
    case MSG_STATE_PATCH:
        handle_state_patch(gs, root);
        break;
    case MSG_EVENT:
        handle_event(gs, root);
        break;
    default:
        break;
    }

    cJSON_Delete(root);
}

// === Per-frame update ===

void game_update(GameState *gs, float dt) {
    // Update projectiles
    for (int i = 0; i < MAX_PROJECTILES; i++) {
        Projectile *p = &gs->projectiles[i];
        if (!p->active) continue;
        p->x += p->dx * p->speed * dt;
        p->y += p->dy * p->speed * dt;
        p->lifetime -= dt;
        if (p->lifetime <= 0 || p->x < 0 || p->x > gs->worldWidth ||
            p->y < 0 || p->y > gs->worldHeight) {
            p->active = false;
        }
    }

    // Update floating texts
    for (int i = 0; i < MAX_FLOAT_TEXTS; i++) {
        FloatingText *ft = &gs->floatTexts[i];
        if (!ft->active) continue;
        ft->y -= 18.0f * dt;
        ft->ttl -= dt;
        if (ft->ttl <= 0) ft->active = false;
    }

    // Update spell effects
    for (int i = 0; i < MAX_SPELL_EFFECTS; i++) {
        SpellEffect *se = &gs->spellEffects[i];
        if (!se->active) continue;
        se->ttl -= dt;
        if (se->ttl <= 0) se->active = false;
    }

    // Update swing effects
    for (int i = 0; i < MAX_SWINGS; i++) {
        SwingEffect *sw = &gs->swings[i];
        if (!sw->active) continue;
        sw->ttl -= dt;
        if (sw->ttl <= 0) sw->active = false;
    }
}
