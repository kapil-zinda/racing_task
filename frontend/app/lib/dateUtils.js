export function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function daysSince(value) {
  const d = toDate(value);
  if (!d) return 999;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

export function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

export function daysUntil(value) {
  const d = toDate(value);
  if (!d) return null;
  const now = new Date();
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = startOfTarget.getTime() - startOfNow.getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

export function buildRecentDates(total) {
  const dates = [];
  const now = new Date();
  for (let i = total - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    dates.push(toIsoDate(d));
  }
  return dates;
}
