// Skill tree overlay with canvas rendering
import { SKILL_NODES, SKILL_MAP, REGION_COLORS } from "./constants.js";

const overlay = document.getElementById("skillTreeOverlay");
const canvas = document.getElementById("skillTreeCanvas");

export function setupSkillTree(room) {
  canvas.addEventListener("click", e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const n of SKILL_NODES) {
      if (Math.hypot(mx - n.px * w, my - n.py * h) < 20) {
        room.send("activate_node", { nodeId: n.id });
        setTimeout(() => render(room), 100);
        break;
      }
    }
  });

  document.getElementById("resetTreeBtn").addEventListener("click", () => {
    room.send("reset_tree");
    setTimeout(() => render(room), 100);
  });

  document.getElementById("closeTreeBtn").addEventListener("click", () => toggle(room));
}

export function toggle(room) {
  if (overlay.style.display === "none") {
    overlay.style.display = "block";
    render(room);
  } else {
    overlay.style.display = "none";
  }
}

function render(room) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const dw = canvas.clientWidth, dh = canvas.clientHeight;
  canvas.width = dw * dpr; canvas.height = dh * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, dw, dh);

  const me = room.state.players?.get(room.sessionId);
  const active = me ? [...me.activeSkillNodes] : [];

  // Connections
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 2;
  for (const n of SKILL_NODES) {
    for (const cid of n.conns) {
      const o = SKILL_MAP.get(cid);
      if (o) { ctx.beginPath(); ctx.moveTo(n.px * dw, n.py * dh); ctx.lineTo(o.px * dw, o.py * dh); ctx.stroke(); }
    }
  }

  // Nodes
  for (const n of SKILL_NODES) {
    const x = n.px * dw, y = n.py * dh;
    const isA = active.includes(n.id);
    const col = REGION_COLORS[n.region] || "#fff";
    const r = n.cost === 2 ? 18 : 12;

    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = isA ? col : "rgba(40,40,60,0.8)";
    ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = isA ? 3 : 1; ctx.stroke();

    ctx.fillStyle = "#fff"; ctx.font = "11px system-ui"; ctx.textAlign = "center";
    ctx.fillText(n.name, x, y + r + 14);
    ctx.font = "9px system-ui"; ctx.fillStyle = "#aaa";
    ctx.fillText(n.effects, x, y + r + 26);
  }

  document.getElementById("perkPointsText").textContent = me ? me.perkPoints : "0";
}
