export function scoreMomentum(recent, previous) {
  if (previous === 0 && recent === 0) return { label: "Flat", cls: "stable" };
  if (previous === 0 && recent > 0) return { label: "Rising", cls: "rising" };
  const ratio = (recent - previous) / previous;
  if (ratio > 0.2) return { label: "Rising", cls: "rising" };
  if (ratio < -0.2) return { label: "Falling", cls: "falling" };
  return { label: "Stable", cls: "stable" };
}

export function riskBand(value) {
  if (value >= 70) return { label: "High", cls: "high" };
  if (value >= 40) return { label: "Medium", cls: "medium" };
  return { label: "Low", cls: "low" };
}

export function heatLevel(value) {
  if (value <= 0) return 0;
  if (value === 1) return 1;
  if (value === 2) return 2;
  if (value <= 4) return 3;
  return 4;
}

export function radarPoints(values, radius, cx, cy) {
  const step = (Math.PI * 2) / values.length;
  return values
    .map((v, i) => {
      const angle = -Math.PI / 2 + i * step;
      const r = (Math.max(0, Math.min(100, v)) / 100) * radius;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      return `${x},${y}`;
    })
    .join(" ");
}
