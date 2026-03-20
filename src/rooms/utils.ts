export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
