#include "input.h"
#include "protocol.h"
#include <raylib.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

void input_init(InputState *is) {
    memset(is, 0, sizeof(*is));
    is->selectedSkillNode = -1;
}

void input_update(InputState *is, GameState *gs, NetworkContext *net, float screenW, float screenH) {
    Player *me = game_my_player(gs);
    if (!me) return;

    static double lastMoveSend = 0;
    static double lastAimSend = 0;
    double now = GetTime();

    // === Movement (WASD) ===
    float mx = 0, my = 0;
    if (IsKeyDown(KEY_W)) my -= 1;
    if (IsKeyDown(KEY_S)) my += 1;
    if (IsKeyDown(KEY_A)) mx -= 1;
    if (IsKeyDown(KEY_D)) mx += 1;

    float len = sqrtf(mx * mx + my * my);
    if (len > 0) { mx /= len; my /= len; }

    if (now - lastMoveSend >= 0.05) { // 20/s
        char *msg = msg_move(mx, my);
        net_send(net, msg);
        free(msg);
        lastMoveSend = now;
    }

    // === Aim (mouse) ===
    if (now - lastAimSend >= 0.066) { // ~15/s
        float mouseX = GetMouseX() - screenW / 2.0f;
        float mouseY = GetMouseY() - screenH / 2.0f;
        float aimLen = sqrtf(mouseX * mouseX + mouseY * mouseY);
        if (aimLen > 0) {
            char *msg = msg_aim(mouseX / aimLen, mouseY / aimLen);
            net_send(net, msg);
            free(msg);
        }
        lastAimSend = now;
    }

    // === Attack (Space) ===
    if (IsKeyPressed(KEY_SPACE)) {
        char *msg = msg_attack();
        net_send(net, msg);
        free(msg);
    }

    // === Pickup item (E) ===
    if (IsKeyPressed(KEY_E)) {
        // Find closest drop in range
        float bestDist = 40.0f;
        DroppedItem *best = NULL;
        for (int i = 0; i < MAX_DROPS; i++) {
            if (!gs->drops[i].active) continue;
            float dx = gs->drops[i].x - me->x;
            float dy = gs->drops[i].y - me->y;
            float dist = sqrtf(dx * dx + dy * dy);
            if (dist < bestDist) { bestDist = dist; best = &gs->drops[i]; }
        }
        if (best) {
            char *msg = msg_pickup_item(best->id);
            net_send(net, msg);
            free(msg);
        }
    }

    // === Pickup spell (F) ===
    if (IsKeyPressed(KEY_F)) {
        float bestDist = 40.0f;
        DroppedSpell *best = NULL;
        for (int i = 0; i < MAX_SPELL_DROPS; i++) {
            if (!gs->spellDrops[i].active) continue;
            float dx = gs->spellDrops[i].x - me->x;
            float dy = gs->spellDrops[i].y - me->y;
            float dist = sqrtf(dx * dx + dy * dy);
            if (dist < bestDist) { bestDist = dist; best = &gs->spellDrops[i]; }
        }
        if (best) {
            char *msg = msg_pickup_spell(best->id);
            net_send(net, msg);
            free(msg);
        }
    }

    // === Drop weapon (Q) ===
    if (IsKeyPressed(KEY_Q)) {
        char *msg = msg_drop_weapon();
        net_send(net, msg);
        free(msg);
    }

    // === Swap weapon (1-5) ===
    for (int i = 0; i < 5; i++) {
        if (IsKeyPressed(KEY_ONE + i)) {
            char *msg = msg_swap_weapon(i);
            net_send(net, msg);
            free(msg);
        }
    }

    // === Cast spells (Z X C V B) ===
    int spellKeys[] = { KEY_Z, KEY_X, KEY_C, KEY_V, KEY_B };
    for (int i = 0; i < 5; i++) {
        if (IsKeyPressed(spellKeys[i]) && i < me->maxSpellSlots) {
            float mouseWorldX = GetMouseX() - screenW / 2.0f + me->x;
            float mouseWorldY = GetMouseY() - screenH / 2.0f + me->y;
            char *msg = msg_cast_spell(i, mouseWorldX, mouseWorldY);
            net_send(net, msg);
            free(msg);
        }
    }

    // === Toggle panels ===
    if (IsKeyPressed(KEY_P)) is->showAttributes = !is->showAttributes;
    if (IsKeyPressed(KEY_T)) is->showSkillTree = !is->showSkillTree;
}
