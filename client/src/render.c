#include "render.h"
#include <math.h>
#include <string.h>
#include <stdio.h>

static Color BG_COLOR = { 30, 30, 46, 255 };
static Color GRID_COLOR = { 50, 50, 70, 255 };

Color rarity_color(int rarity) {
    switch (rarity) {
        case 0: return WHITE;
        case 1: return (Color){ 74, 222, 128, 255 };
        case 2: return (Color){ 96, 165, 250, 255 };
        case 3: return (Color){ 192, 132, 252, 255 };
        case 4: return (Color){ 251, 191, 36, 255 };
        default: return GRAY;
    }
}

static float clampf(float v, float lo, float hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

void render_update_camera(Camera2DState *cam, GameState *gs, float screenW, float screenH) {
    Player *me = game_my_player(gs);
    if (!me) return;
    cam->offsetX = clampf(screenW / 2.0f - me->x, screenW - gs->worldWidth, 0);
    cam->offsetY = clampf(screenH / 2.0f - me->y, screenH - gs->worldHeight, 0);
}

void render_world(Camera2DState *cam, GameState *gs) {
    float ox = cam->offsetX, oy = cam->offsetY;

    // Background
    DrawRectangle((int)ox, (int)oy, gs->worldWidth, gs->worldHeight, BG_COLOR);

    // Grid
    for (int x = 0; x <= gs->worldWidth; x += 50)
        DrawLine((int)(ox + x), (int)oy, (int)(ox + x), (int)(oy + gs->worldHeight), GRID_COLOR);
    for (int y = 0; y <= gs->worldHeight; y += 50)
        DrawLine((int)ox, (int)(oy + y), (int)(ox + gs->worldWidth), (int)(oy + y), GRID_COLOR);

    // Dropped items (diamond)
    for (int i = 0; i < MAX_DROPS; i++) {
        DroppedItem *d = &gs->drops[i];
        if (!d->active) continue;
        Color c = rarity_color(d->weaponRarity);
        Vector2 center = { ox + d->x, oy + d->y };
        DrawPoly(center, 4, 8, 45, c);
    }

    // Dropped spells (circle)
    for (int i = 0; i < MAX_SPELL_DROPS; i++) {
        DroppedSpell *s = &gs->spellDrops[i];
        if (!s->active) continue;
        Color c = rarity_color(s->spellRarity);
        DrawCircle((int)(ox + s->x), (int)(oy + s->y), 7, c);
        DrawCircleLines((int)(ox + s->x), (int)(oy + s->y), 10, Fade(c, 0.5f));
    }

    // Enemies
    for (int i = 0; i < MAX_ENEMIES; i++) {
        Enemy *e = &gs->enemies[i];
        if (!e->active) continue;
        float r = e->isBoss ? 18.0f : 12.0f;
        Color c = e->isBoss ? ORANGE : RED;
        DrawCircle((int)(ox + e->x), (int)(oy + e->y), r, c);
        // HP bar
        float barW = r * 2.0f;
        float hpRatio = e->maxHp > 0 ? e->hp / e->maxHp : 0;
        DrawRectangle((int)(ox + e->x - barW/2), (int)(oy + e->y - r - 8), (int)barW, 4, DARKGRAY);
        DrawRectangle((int)(ox + e->x - barW/2), (int)(oy + e->y - r - 8), (int)(barW * hpRatio), 4, RED);
    }

    // Players
    for (int i = 0; i < MAX_PLAYERS; i++) {
        Player *p = &gs->players[i];
        if (!p->active) continue;
        bool isMe = (strcmp(p->id, gs->mySessionId) == 0);
        Color c = isMe ? (Color){ 74, 222, 128, 255 } : (Color){ 96, 165, 250, 255 };
        DrawCircle((int)(ox + p->x), (int)(oy + p->y), 16, c);
        // Name
        int nameW = MeasureText(p->name, 10);
        DrawText(p->name, (int)(ox + p->x - nameW/2), (int)(oy + p->y - 28), 10, WHITE);
        // HP bar
        float hpRatio = p->maxHp > 0 ? p->hp / p->maxHp : 0;
        DrawRectangle((int)(ox + p->x - 16), (int)(oy + p->y - 22), 32, 4, DARKGRAY);
        DrawRectangle((int)(ox + p->x - 16), (int)(oy + p->y - 22), (int)(32 * hpRatio), 4, (Color){239,68,68,255});
    }

    // Projectiles
    for (int i = 0; i < MAX_PROJECTILES; i++) {
        Projectile *p = &gs->projectiles[i];
        if (!p->active) continue;
        Color c = p->isEnemy ? RED : YELLOW;
        DrawCircle((int)(ox + p->x), (int)(oy + p->y), 4, c);
    }

    // Spell effects
    for (int i = 0; i < MAX_SPELL_EFFECTS; i++) {
        SpellEffect *se = &gs->spellEffects[i];
        if (!se->active) continue;
        Color c = Fade(PURPLE, 0.3f);
        DrawCircle((int)(ox + se->x), (int)(oy + se->y), se->radius, c);
        DrawCircleLines((int)(ox + se->x), (int)(oy + se->y), se->radius, Fade(PURPLE, 0.6f));
    }

    // Swing effects
    for (int i = 0; i < MAX_SWINGS; i++) {
        SwingEffect *sw = &gs->swings[i];
        if (!sw->active) continue;
        float angle = atan2f(sw->dy, sw->dx);
        float r = 40.0f;
        Color c = Fade(WHITE, sw->ttl / 0.15f);
        DrawCircleSector(
            (Vector2){ ox + sw->x, oy + sw->y },
            r, (angle - 0.5f) * RAD2DEG, (angle + 0.5f) * RAD2DEG, 8, c
        );
    }

    // Floating text
    for (int i = 0; i < MAX_FLOAT_TEXTS; i++) {
        FloatingText *ft = &gs->floatTexts[i];
        if (!ft->active) continue;
        float alpha = ft->ttl > 0.5f ? 1.0f : ft->ttl * 2.0f;
        Color c = Fade(WHITE, alpha);
        int w = MeasureText(ft->text, 14);
        DrawText(ft->text, (int)(ox + ft->x - w/2), (int)(oy + ft->y), 14, c);
    }
}
