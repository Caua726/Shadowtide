import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineRoom, defineServer, matchMaker } from "colyseus";
import { GameRoom } from "./rooms/GameRoom.js";
import { RawSocketBridge } from "./rooms/RawSocketBridge.js";
import type { Server as HTTPServer } from "node:http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = Number(process.env.PORT || 2567);

export let httpServer: HTTPServer | null = null;
export let bridge: RawSocketBridge | null = null;

const server = defineServer({
  rooms: {
    world: defineRoom(GameRoom),
  },
  express: (app) => {
    app.use(express.static(path.join(__dirname, "../public")));
    app.get("/health", (_req, res) => {
      res.json({ ok: true, room: "world" });
    });
  },
});

server.listen(port).then(async () => {
  httpServer = (server as any).transport?.server ?? null;
  console.log(`HTTP + client em http://localhost:${port}`);
  console.log("Colyseus room: world");
  if (httpServer) {
    bridge = new RawSocketBridge();
    bridge.attach(httpServer);
    // Auto-create the "world" room so the bridge callbacks are bound immediately
    await matchMaker.createRoom("world", {});
    console.log("World room pre-created for RawSocketBridge");
  } else {
    console.warn("WARNING: could not capture httpServer from Colyseus transport");
  }
});
