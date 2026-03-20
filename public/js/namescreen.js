// Name entry screen

export function setupNameScreen(onSubmit) {
  const screen = document.getElementById("nameScreen");
  const input = document.getElementById("nameInput");
  const btn = document.getElementById("nameBtn");

  btn.addEventListener("click", () => {
    const name = input.value.trim().replace(/[^a-zA-Z0-9_\- ]/g, "").slice(0, 16);
    if (!name) { input.focus(); return; }
    screen.style.display = "none";
    document.getElementById("hud").style.display = "block";
    document.getElementById("invBar").style.display = "flex";
    document.getElementById("spellBar").style.display = "flex";
    onSubmit(name);
  });

  input.addEventListener("keydown", e => { if (e.key === "Enter") btn.click(); });
}
