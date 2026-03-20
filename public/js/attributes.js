// Attribute distribution panel

const pending = { str: 0, dex: 0, vit: 0, intel: 0, lck: 0 };

export function setupAttrPanel(room) {
  const panel = document.getElementById("attrPanel");
  panel.addEventListener("click", e => {
    const btn = e.target.closest("button[data-d]");
    if (!btn) return;
    const attr = btn.dataset.d;
    const spent = Object.values(pending).reduce((a, b) => a + b, 0);
    const me = room.state.players?.get(room.sessionId);
    if (!me || spent >= me.unspentPoints) return;
    pending[attr]++;
    updateDisplay(me);
  });

  document.getElementById("attrConfirm").addEventListener("click", () => {
    const t = Object.values(pending).reduce((a, b) => a + b, 0);
    if (t > 0) room.send("allocate_points", { ...pending });
    panel.style.display = "none";
  });

  document.getElementById("attrClose").addEventListener("click", () => panel.style.display = "none");
}

export function showAttrPanel(room) {
  const me = room.state.players?.get(room.sessionId);
  if (!me || me.unspentPoints <= 0) return;
  Object.keys(pending).forEach(k => pending[k] = 0);
  updateDisplay(me);
  document.getElementById("attrPanel").style.display = "block";
}

export function toggleAttrPanel(room) {
  const panel = document.getElementById("attrPanel");
  if (panel.style.display === "none") showAttrPanel(room);
  else panel.style.display = "none";
}

function updateDisplay(me) {
  document.getElementById("attrStr").textContent = me.str + pending.str;
  document.getElementById("attrDex").textContent = me.dex + pending.dex;
  document.getElementById("attrVit").textContent = me.vit + pending.vit;
  document.getElementById("attrInt").textContent = me.intel + pending.intel;
  document.getElementById("attrLck").textContent = me.lck + pending.lck;
  const spent = Object.values(pending).reduce((a, b) => a + b, 0);
  document.getElementById("attrAvail").textContent = `(${me.unspentPoints - spent} disponiveis)`;
}
