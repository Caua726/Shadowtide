// client/src/main.c
#include <raylib.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

#include "game.h"
#include "network.h"
#include "input.h"
#include "render.h"
#include "ui.h"

#define SCREEN_W 1024
#define SCREEN_H 768

typedef enum { SCREEN_NAME, SCREEN_GAME } Screen;

int main(int argc, char **argv) {
    const char *host = "localhost";
    int port = 2567;

    // Parse optional args: ./shadowtide [host] [port]
    if (argc > 1) host = argv[1];
    if (argc > 2) port = atoi(argv[2]);

    InitWindow(SCREEN_W, SCREEN_H, "Shadowtide: Endless Horde");
    SetTargetFPS(60);

    // State
    Screen screen = SCREEN_NAME;
    char playerName[NAME_LEN] = "";
    int nameLen = 0;

    GameState gs;
    game_init(&gs);

    NetworkContext net;
    InputState input;
    input_init(&input);

    Camera2DState cam = {0};

    while (!WindowShouldClose()) {
        float dt = GetFrameTime();

        if (screen == SCREEN_NAME) {
            // Name entry
            int key = GetCharPressed();
            while (key > 0) {
                if (key >= 32 && key < 127 && nameLen < NAME_LEN - 1) {
                    playerName[nameLen++] = (char)key;
                    playerName[nameLen] = '\0';
                }
                key = GetCharPressed();
            }
            if (IsKeyPressed(KEY_BACKSPACE) && nameLen > 0) {
                playerName[--nameLen] = '\0';
            }
            if (IsKeyPressed(KEY_ENTER) && nameLen > 0) {
                net_init(&net, host, port, playerName);
                net_start(&net);
                screen = SCREEN_GAME;
            }

            BeginDrawing();
            ClearBackground((Color){20,20,35,255});
            const char *title = "SHADOWTIDE";
            DrawText(title, SCREEN_W/2 - MeasureText(title,40)/2, SCREEN_H/3 - 40, 40, (Color){192,132,252,255});
            const char *sub = "Endless Horde";
            DrawText(sub, SCREEN_W/2 - MeasureText(sub,20)/2, SCREEN_H/3 + 10, 20, GRAY);

            DrawText("Enter your name:", SCREEN_W/2 - 100, SCREEN_H/2 - 10, 16, WHITE);
            DrawRectangle(SCREEN_W/2 - 100, SCREEN_H/2 + 14, 200, 30, (Color){40,40,60,255});
            DrawRectangleLines(SCREEN_W/2 - 100, SCREEN_H/2 + 14, 200, 30, GRAY);
            DrawText(playerName, SCREEN_W/2 - 94, SCREEN_H/2 + 20, 16, WHITE);

            if (nameLen > 0) {
                DrawText("Press ENTER to play", SCREEN_W/2 - MeasureText("Press ENTER to play",14)/2, SCREEN_H/2 + 60, 14, GREEN);
            }
            EndDrawing();
        }
        else if (screen == SCREEN_GAME) {
            // Process incoming messages
            char msgBuf[MSG_MAX_LEN];
            while (mq_dequeue(&net.inbox, msgBuf, MSG_MAX_LEN)) {
                game_process_message(&gs, msgBuf);
            }

            // Input
            input_update(&input, &gs, &net, SCREEN_W, SCREEN_H);

            // Game update
            game_update(&gs, dt);

            // Camera
            render_update_camera(&cam, &gs, SCREEN_W, SCREEN_H);

            // Render
            BeginDrawing();
            ClearBackground(BLACK);
            render_world(&cam, &gs);
            ui_draw(&gs, &input, &net, SCREEN_W, SCREEN_H);
            EndDrawing();
        }
    }

    if (screen == SCREEN_GAME) {
        net_stop(&net);
    }

    CloseWindow();
    return 0;
}
