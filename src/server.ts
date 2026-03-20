import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineRoom, defineServer } from "colyseus";
import { GameRoom } from "./rooms/GameRoom.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = Number(process.env.PORT || 2567);

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

server.listen(port);
console.log(`HTTP + client em http://localhost:${port}`);
console.log("Colyseus room: world");
