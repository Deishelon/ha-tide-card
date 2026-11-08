/** Pure tide-card/v1 helpers. No DOM. */

export function parseTideDocument(input) {
  const doc = typeof input === "string" ? JSON.parse(input) : input;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("Tide data is not an object");
  }
  if (
    doc.schema != null &&
    (typeof doc.schema !== "string" || !doc.schema.startsWith("tide-card/"))
  ) {
    throw new Error(`Unsupported tide schema: ${doc.schema}`);
  }
  if (!Array.isArray(doc.extrema)) {
    throw new Error("Tide data has no extrema");
  }

  const extrema = [];
  for (const item of doc.extrema) {
    if (!item || typeof item !== "object") continue;
    const type = String(item.type || "").toLowerCase();
    if (type !== "high" && type !== "low") continue;
    const t = Date.parse(item.time);
    const height = Number(item.height);
    if (Number.isNaN(t) || !Number.isFinite(height)) continue;
    extrema.push({ time: String(item.time), t, height, type });
  }
  extrema.sort((a, b) => a.t - b.t);

  let range = null;
  if (
    doc.range &&
    Number.isFinite(Number(doc.range.min)) &&
    Number.isFinite(Number(doc.range.max))
  ) {
    range = { min: Number(doc.range.min), max: Number(doc.range.max) };
  }

  return {
    schema: doc.schema || "tide-card/v1",
    location: typeof doc.location === "string" ? doc.location : "",
    timezone: typeof doc.timezone === "string" && doc.timezone ? doc.timezone : null,
    unit: typeof doc.unit === "string" && doc.unit ? doc.unit : "",
    updated: typeof doc.updated === "string" ? doc.updated : "",
    range,
    extrema,
  };
}

export function documentFromState(stateObj, attribute) {
  if (!stateObj) {
    throw new Error("Entity not found");
  }
  const attrs = stateObj.attributes || {};
  if (attribute) {
    if (!Object.prototype.hasOwnProperty.call(attrs, attribute)) {
      throw new Error(`Missing attribute ${attribute}`);
    }
    return parseTideDocument(attrs[attribute]);
  }
  if (Array.isArray(attrs.extrema)) {
    return parseTideDocument(attrs);
  }
  if (attrs.tide_data != null) {
    return parseTideDocument(attrs.tide_data);
  }
  throw new Error("This entity has no tide extrema");
}

/** Cosine blend between neighbouring extrema. Flat outside the series. */
export function heightAt(extrema, tMs) {
  if (!extrema.length) return null;
  if (tMs <= extrema[0].t) return extrema[0].height;
  const last = extrema[extrema.length - 1];
  if (tMs >= last.t) return last.height;

  let lo = 0;
  let hi = extrema.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (extrema[mid].t <= tMs) lo = mid;
    else hi = mid;
  }
  const a = extrema[lo];
  const b = extrema[hi];
  const span = b.t - a.t;
  if (span <= 0) return a.height;
  const progress = (tMs - a.t) / span;
  const blend = (1 - Math.cos(Math.PI * progress)) / 2;
  return a.height + (b.height - a.height) * blend;
}

export function yDomain(extrema, range) {
  if (!extrema.length && !range) return { min: 0, max: 1 };
  let min = range ? range.min : Infinity;
  let max = range ? range.max : -Infinity;
  for (const item of extrema) {
    min = Math.min(min, item.height);
    max = Math.max(max, item.height);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) {
    min = (Number.isFinite(min) ? min : 0) - 0.5;
    max = (Number.isFinite(max) ? max : 0) + 0.5;
    if (!(max > min)) {
      min -= 0.5;
      max += 0.5;
    }
  }
  const pad = (max - min) * 0.1;
  return { min: min - pad, max: max + pad };
}

export function dayKey(ms, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const value = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function shiftDayKey(day, days) {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + days));
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${m}-${d}`;
}

export function formatClock(ms, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || undefined,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

export function formatHeight(height, unit) {
  const text = Number(height).toFixed(1);
  return unit ? `${text} ${unit}` : text;
}

export function relativePhrase(targetMs, nowMs) {
  const mins = Math.round((targetMs - nowMs) / 60000);
  const abs = Math.abs(mins);
  if (abs < 1) return "now";
  const days = Math.floor(abs / (60 * 24));
  const hours = Math.floor((abs % (60 * 24)) / 60);
  const minutes = abs % 60;
  let body;
  if (days > 0) body = hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  else if (hours > 0) body = minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  else body = `${minutes}m`;
  return mins < 0 ? `${body} ago` : `in ${body}`;
}

export function dayPhrase(ms, nowMs, timeZone, { long = false } = {}) {
  const day = dayKey(ms, timeZone);
  const today = dayKey(nowMs, timeZone);
  if (day === today) return "Today";
  if (day === shiftDayKey(today, 1)) return "Tomorrow";
  if (day === shiftDayKey(today, -1)) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || undefined,
    weekday: long ? "long" : "short",
    day: "numeric",
    month: long ? "short" : undefined,
  }).format(new Date(ms));
}

export function nextExtremum(extrema, nowMs) {
  return extrema.find((item) => item.t > nowMs) || null;
}

export function nextOfType(extrema, nowMs, type) {
  return extrema.find((item) => item.t > nowMs && item.type === type) || null;
}

export function previousExtremum(extrema, nowMs) {
  let previous = null;
  for (const item of extrema) {
    if (item.t <= nowMs) previous = item;
    else break;
  }
  return previous;
}

export function trendWord(extrema, nowMs) {
  const upcoming = nextExtremum(extrema, nowMs);
  if (!upcoming) return "";
  return upcoming.type === "low" ? "falling" : "rising";
}

export function daysIn(extrema, timeZone) {
  const days = [];
  const seen = new Set();
  for (const item of extrema) {
    const day = dayKey(item.t, timeZone);
    if (seen.has(day)) continue;
    seen.add(day);
    days.push({ day, sample: item });
  }
  return days;
}

/** Extrema on `day`, plus one neighbour each side so the wave is continuous. */
export function windowForDay(extrema, day, timeZone) {
  const indexes = [];
  extrema.forEach((item, index) => {
    if (dayKey(item.t, timeZone) === day) indexes.push(index);
  });
  if (!indexes.length) return null;
  const from = Math.max(0, indexes[0] - 1);
  const to = Math.min(extrema.length - 1, indexes[indexes.length - 1] + 1);
  const points = extrema.slice(from, to + 1);
  return {
    points,
    onDay: extrema.filter((item) => dayKey(item.t, timeZone) === day),
    tMin: points[0].t,
    tMax: points[points.length - 1].t,
  };
}

export function heightCovered(extrema, nowMs) {
  if (extrema.length < 2) return null;
  if (nowMs < extrema[0].t || nowMs > extrema[extrema.length - 1].t) return null;
  return heightAt(extrema, nowMs);
}

/** Card sections. An omitted flag follows the full layout, or the minimal preset. */
export const LAYOUT_FLAGS = [
  "show_header",
  "show_since",
  "show_now",
  "show_trend",
  "show_next_low",
  "show_next_high",
  "show_days",
  "show_graph",
  "show_labels",
  "show_table",
  "show_updated",
];

const FULL_LAYOUT = {
  show_header: true,
  show_since: true,
  show_now: true,
  show_trend: true,
  show_next_low: true,
  show_next_high: true,
  show_days: true,
  show_graph: true,
  show_labels: true,
  show_table: true,
  show_updated: true,
};

const MINIMAL_LAYOUT = {
  show_header: true,
  show_since: false,
  show_now: true,
  show_trend: true,
  show_next_low: true,
  show_next_high: true,
  show_days: false,
  show_graph: true,
  show_labels: false,
  show_table: false,
  show_updated: false,
};

export function resolveLayout(config = {}) {
  const layout = {
    minimal: Boolean(config.minimal),
    ...(config.minimal ? MINIMAL_LAYOUT : FULL_LAYOUT),
  };
  for (const key of LAYOUT_FLAGS) {
    if (typeof config[key] === "boolean") layout[key] = config[key];
  }
  return layout;
}
