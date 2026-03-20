#include "ui.h"
#include "protocol.h"
#include <raylib.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>

// === Skill tree data (hardcoded from server's SkillTree.ts) ===

typedef struct {
    const char *id;
    const char *name;
    const char *region; // "combat","defense","utility","center","major"
    int cost;
    float px, py;
    const char *connections[4]; // max 4 connections
    int numConnections;
} SkillNodeDef;

static const SkillNodeDef SKILL_NODES[] = {
    {"center","Origin","center",0,0.5f,0.5f,{"c1","d1","u1"},3},
    {"c1","Sharpness I","combat",1,0.38f,0.42f,{"center","c2","c3"},3},
    {"c2","Precision I","combat",1,0.28f,0.35f,{"c1","c4","c5"},3},
    {"c3","Swift Strikes","combat",1,0.42f,0.32f,{"c1","c6","mc1"},3},
    {"c4","Sharpness II","combat",1,0.2f,0.28f,{"c2","c7"},2},
    {"c5","Precision II","combat",1,0.3f,0.22f,{"c2","c7","c8"},3},
    {"c6","Ferocity","combat",1,0.45f,0.2f,{"c3","c8","c9"},3},
    {"c7","Devastation","combat",1,0.22f,0.15f,{"c4","c5","c10"},3},
    {"c8","Devastating Crit","combat",1,0.35f,0.12f,{"c5","c6","c10"},3},
    {"c9","Double Strike","combat",1,0.5f,0.1f,{"c6","c11"},2},
    {"c10","Sharpness III","combat",1,0.28f,0.05f,{"c7","c8","c11"},3},
    {"c11","Vampirism","combat",1,0.42f,0.03f,{"c9","c10"},2},
    {"d1","Toughness I","defense",1,0.38f,0.58f,{"center","d2","d3"},3},
    {"d2","Regeneration I","defense",1,0.28f,0.65f,{"d1","d4","d5"},3},
    {"d3","Thick Skin","defense",1,0.42f,0.68f,{"d1","d6","mc1"},3},
    {"d4","Toughness II","defense",1,0.2f,0.72f,{"d2","d7"},2},
    {"d5","Regeneration II","defense",1,0.3f,0.78f,{"d2","d7","d8"},3},
    {"d6","Iron Will","defense",1,0.45f,0.8f,{"d3","d8","d9"},3},
    {"d7","Toughness III","defense",1,0.22f,0.85f,{"d4","d5","d10"},3},
    {"d8","Kill Shield","defense",1,0.35f,0.88f,{"d5","d6","d10"},3},
    {"d9","Fortitude","defense",1,0.52f,0.88f,{"d6","d11","mc2"},3},
    {"d10","Regeneration III","defense",1,0.28f,0.95f,{"d7","d8","d11"},3},
    {"d11","Second Chance","defense",1,0.42f,0.97f,{"d9","d10"},2},
    {"u1","Swiftness I","utility",1,0.62f,0.5f,{"center","u2","u3"},3},
    {"u2","Collector I","utility",1,0.72f,0.42f,{"u1","u4","u5"},3},
    {"u3","Fortune I","utility",1,0.68f,0.58f,{"u1","u6","mc2"},3},
    {"u4","Swiftness II","utility",1,0.8f,0.35f,{"u2","u7"},2},
    {"u5","Scholar I","utility",1,0.78f,0.48f,{"u2","u7","u8"},3},
    {"u6","Fortune II","utility",1,0.75f,0.65f,{"u3","u8","u9"},3},
    {"u7","Swiftness III","utility",1,0.88f,0.4f,{"u4","u5","u10"},3},
    {"u8","Lucky Drops","utility",1,0.85f,0.55f,{"u5","u6","u10"},3},
    {"u9","War Aura","utility",1,0.78f,0.75f,{"u6","u11"},2},
    {"u10","Scholar II","utility",1,0.92f,0.5f,{"u7","u8","u11"},3},
    {"u11","Collector II","utility",1,0.9f,0.68f,{"u9","u10"},2},
    {"mc1","Berserker","major",2,0.45f,0.5f,{"c3","d3"},2},
    {"mc2","Scavenger","major",2,0.6f,0.72f,{"d9","u3"},2},
};
#define NUM_SKILL_NODES 36

static bool is_node_active(Player *p, const char *nodeId) {
    for (int i = 0; i < p->activeSkillNodeCount; i++)
        if (strcmp(p->activeSkillNodes[i], nodeId) == 0) return true;
    return false;
}

static bool is_node_available(Player *p, const char *nodeId) {
    for (int n = 0; n < NUM_SKILL_NODES; n++) {
        if (strcmp(SKILL_NODES[n].id, nodeId) != 0) continue;
        for (int c = 0; c < SKILL_NODES[n].numConnections; c++) {
            if (is_node_active(p, SKILL_NODES[n].connections[c])) return true;
        }
        break;
    }
    return false;
}

static int find_node_index(const char *id) {
    for (int i = 0; i < NUM_SKILL_NODES; i++)
        if (strcmp(SKILL_NODES[i].id, id) == 0) return i;
    return -1;
}

// === Draw helpers ===

static void draw_bar(float x, float y, float w, float h, float ratio, Color fg, Color bg) {
    DrawRectangle((int)x, (int)y, (int)w, (int)h, bg);
    DrawRectangle((int)x, (int)y, (int)(w * ratio), (int)h, fg);
    DrawRectangleLines((int)x, (int)y, (int)w, (int)h, Fade(WHITE, 0.3f));
}

// === Main UI draw ===

void ui_draw(GameState *gs, InputState *is, NetworkContext *net, float screenW, float screenH) {
    Player *me = game_my_player(gs);
    if (!me) {
        const char *txt = "Connecting...";
        DrawText(txt, (int)(screenW/2 - MeasureText(txt,20)/2), (int)(screenH/2), 20, WHITE);
        return;
    }

    // === Top HUD ===
    // HP bar
    float hpRatio = me->maxHp > 0 ? me->hp / me->maxHp : 0;
    draw_bar(10, 10, 200, 16, hpRatio, (Color){239,68,68,255}, (Color){60,20,20,255});
    char buf[64];
    snprintf(buf, sizeof(buf), "HP %.0f/%.0f", me->hp, me->maxHp);
    DrawText(buf, 14, 11, 12, WHITE);

    // Mana bar
    float manaRatio = me->maxMana > 0 ? me->mana / me->maxMana : 0;
    draw_bar(10, 30, 200, 16, manaRatio, (Color){96,165,250,255}, (Color){20,20,60,255});
    snprintf(buf, sizeof(buf), "MP %.0f/%.0f", me->mana, me->maxMana);
    DrawText(buf, 14, 31, 12, WHITE);

    // Level + XP
    float xpRatio = me->xpToNext > 0 ? (float)me->xp / me->xpToNext : 0;
    snprintf(buf, sizeof(buf), "Lv.%d", me->level);
    DrawText(buf, 220, 11, 14, YELLOW);
    draw_bar(220, 30, 120, 12, xpRatio, (Color){168,85,247,255}, (Color){40,20,60,255});
    snprintf(buf, sizeof(buf), "XP %d/%d", me->xp, me->xpToNext);
    DrawText(buf, 224, 30, 10, WHITE);

    // Wave info
    const char *waveStates[] = {"WAITING","COMBAT","PAUSE"};
    int ws = me ? gs->wave.state : 0;
    snprintf(buf, sizeof(buf), "Wave %d  %s", gs->wave.waveNumber, waveStates[ws]);
    DrawText(buf, (int)(screenW - 200), 11, 14, WHITE);
    if (gs->wave.enemiesRemaining > 0) {
        snprintf(buf, sizeof(buf), "Enemies: %d", gs->wave.enemiesRemaining);
        DrawText(buf, (int)(screenW - 200), 30, 12, LIGHTGRAY);
    }

    // === Bottom: Inventory bar ===
    float invStartX = 10;
    float invY = screenH - 50;
    for (int i = 0; i < MAX_INV_SLOTS; i++) {
        float x = invStartX + i * 70;
        Color border = (me->inventory[i].weaponRarity >= 0)
            ? rarity_color(me->inventory[i].weaponRarity) : DARKGRAY;
        DrawRectangle((int)x, (int)invY, 60, 40, (Color){30,30,50,200});
        DrawRectangleLines((int)x, (int)invY, 60, 40, border);
        snprintf(buf, sizeof(buf), "%d", i + 1);
        DrawText(buf, (int)x + 2, (int)invY + 2, 10, GRAY);
        if (me->inventory[i].weaponRarity >= 0) {
            DrawText(weapon_type_to_string(me->inventory[i].weaponType),
                     (int)x + 4, (int)invY + 14, 10, border);
        }
    }

    // === Bottom center: Spell bar ===
    const char *spellKeys = "ZXCVB";
    float spellStartX = screenW / 2 - (5 * 70) / 2;
    float spellY = screenH - 50;
    for (int i = 0; i < MAX_SPELL_SLOTS; i++) {
        float x = spellStartX + i * 70;
        bool locked = i >= me->maxSpellSlots;
        bool hasSpell = me->spellSlots[i].spellRarity >= 0;
        Color border = locked ? (Color){40,40,40,255}
                     : hasSpell ? rarity_color(me->spellSlots[i].spellRarity) : DARKGRAY;
        DrawRectangle((int)x, (int)spellY, 60, 40, (Color){30,30,50,200});
        DrawRectangleLines((int)x, (int)spellY, 60, 40, border);
        snprintf(buf, sizeof(buf), "%c", spellKeys[i]);
        DrawText(buf, (int)x + 2, (int)spellY + 2, 10, GRAY);
        if (hasSpell && !locked) {
            DrawText(spell_id_to_string(me->spellSlots[i].spellId),
                     (int)x + 4, (int)spellY + 14, 9, border);
            // Cooldown overlay
            if (me->spellSlots[i].cooldownLeft > 0) {
                float cdRatio = me->spellSlots[i].cooldownLeft / 10.0f; // rough
                DrawRectangle((int)x, (int)spellY, 60, (int)(40 * cdRatio), Fade(BLACK, 0.6f));
                snprintf(buf, sizeof(buf), "%.1f", me->spellSlots[i].cooldownLeft);
                DrawText(buf, (int)x + 20, (int)spellY + 14, 10, WHITE);
            }
        }
    }

    // === Attribute panel (P key) ===
    if (is->showAttributes) {
        float px = 10, py = 60;
        DrawRectangle((int)px, (int)py, 220, 220, (Color){20,20,30,230});
        DrawRectangleLines((int)px, (int)py, 220, 220, GRAY);
        snprintf(buf, sizeof(buf), "Attributes (%d pts)", me->unspentPoints);
        DrawText(buf, (int)px + 8, (int)py + 8, 14, YELLOW);

        const char *names[] = {"STR","DEX","VIT","INT","LCK"};
        int *vals[] = {&me->str, &me->dex, &me->vit, &me->intel, &me->lck};
        for (int i = 0; i < 5; i++) {
            float row = py + 30 + i * 24;
            snprintf(buf, sizeof(buf), "%s: %d", names[i], *vals[i]);
            DrawText(buf, (int)px + 12, (int)row, 12, WHITE);
            // [+] button
            if (me->unspentPoints > 0) {
                Rectangle btn = { px + 160, row - 2, 24, 18 };
                DrawRectangleRec(btn, (Color){60,60,80,255});
                DrawText("+", (int)btn.x + 8, (int)btn.y + 2, 12, GREEN);
                if (IsMouseButtonPressed(MOUSE_BUTTON_LEFT) && CheckCollisionPointRec(GetMousePosition(), btn)) {
                    int pts[5] = {0,0,0,0,0};
                    pts[i] = 1;
                    char *msg = msg_allocate_points(pts[0], pts[1], pts[2], pts[3], pts[4]);
                    net_send(net, msg);
                    free(msg);
                }
            }
        }

        // Derived stats
        float dy = py + 160;
        snprintf(buf, sizeof(buf), "HP Regen: %.1f/s", me->hpRegen);
        DrawText(buf, (int)px + 12, (int)dy, 10, LIGHTGRAY);
        snprintf(buf, sizeof(buf), "Move Speed: %.0f", me->moveSpeed);
        DrawText(buf, (int)px + 12, (int)dy + 14, 10, LIGHTGRAY);
        snprintf(buf, sizeof(buf), "Crit: %.1f%%", me->critChance);
        DrawText(buf, (int)px + 12, (int)dy + 28, 10, LIGHTGRAY);
    }

    // === Skill tree (T key) ===
    if (is->showSkillTree) {
        float treeW = 500, treeH = 500;
        float tx = (screenW - treeW) / 2;
        float ty = (screenH - treeH) / 2;
        DrawRectangle((int)tx, (int)ty, (int)treeW, (int)treeH, (Color){15,15,25,240});
        DrawRectangleLines((int)tx, (int)ty, (int)treeW, (int)treeH, GRAY);
        snprintf(buf, sizeof(buf), "Skill Tree (Perk Points: %d)", me->perkPoints);
        DrawText(buf, (int)tx + 10, (int)ty + 8, 14, YELLOW);

        // Draw connections first
        for (int i = 0; i < NUM_SKILL_NODES; i++) {
            float x1 = tx + SKILL_NODES[i].px * treeW;
            float y1 = ty + SKILL_NODES[i].py * treeH;
            for (int c = 0; c < SKILL_NODES[i].numConnections; c++) {
                int j = find_node_index(SKILL_NODES[i].connections[c]);
                if (j < 0 || j <= i) continue; // avoid double draw
                float x2 = tx + SKILL_NODES[j].px * treeW;
                float y2 = ty + SKILL_NODES[j].py * treeH;
                DrawLine((int)x1, (int)y1, (int)x2, (int)y2, Fade(GRAY, 0.4f));
            }
        }

        // Draw nodes
        for (int i = 0; i < NUM_SKILL_NODES; i++) {
            float nx = tx + SKILL_NODES[i].px * treeW;
            float ny = ty + SKILL_NODES[i].py * treeH;
            float r = (SKILL_NODES[i].cost == 2) ? 14.0f : 10.0f;

            bool active = is_node_active(me, SKILL_NODES[i].id);
            bool available = !active && is_node_available(me, SKILL_NODES[i].id);

            Color fill, border;
            if (active) {
                if (strcmp(SKILL_NODES[i].region, "combat") == 0) fill = (Color){220,60,60,255};
                else if (strcmp(SKILL_NODES[i].region, "defense") == 0) fill = (Color){60,200,60,255};
                else if (strcmp(SKILL_NODES[i].region, "utility") == 0) fill = (Color){60,120,220,255};
                else if (strcmp(SKILL_NODES[i].region, "major") == 0) fill = (Color){251,191,36,255};
                else fill = WHITE;
                border = WHITE;
            } else if (available) {
                fill = (Color){40,40,60,255};
                border = (Color){200,200,255,255};
            } else {
                fill = (Color){30,30,40,255};
                border = (Color){60,60,70,255};
            }

            DrawCircle((int)nx, (int)ny, r, fill);
            DrawCircleLines((int)nx, (int)ny, r, border);

            // Hover: show name
            Vector2 mouse = GetMousePosition();
            float dx = mouse.x - nx, dy2 = mouse.y - ny;
            if (dx*dx + dy2*dy2 < r*r) {
                DrawText(SKILL_NODES[i].name, (int)nx + (int)r + 4, (int)ny - 6, 10, WHITE);
                // Click to activate
                if (available && me->perkPoints >= SKILL_NODES[i].cost &&
                    IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
                    char *msg = msg_activate_node(SKILL_NODES[i].id);
                    net_send(net, msg);
                    free(msg);
                }
            }
        }

        // Reset button
        Rectangle resetBtn = { tx + treeW - 80, ty + treeH - 30, 70, 22 };
        DrawRectangleRec(resetBtn, (Color){80,30,30,255});
        DrawText("Reset", (int)resetBtn.x + 12, (int)resetBtn.y + 4, 12, WHITE);
        if (IsMouseButtonPressed(MOUSE_BUTTON_LEFT) && CheckCollisionPointRec(GetMousePosition(), resetBtn)) {
            char *msg = msg_reset_tree();
            net_send(net, msg);
            free(msg);
        }
    }

    // Connection status
    if (net->state != NET_CONNECTED) {
        const char *status = net->state == NET_CONNECTING ? "Connecting..." : "Disconnected";
        DrawText(status, (int)(screenW/2 - MeasureText(status,16)/2), 50, 16, RED);
    }
}
