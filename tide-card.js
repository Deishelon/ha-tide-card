import {
  dayKey,
  dayPhrase,
  daysIn,
  documentFromState,
  formatClock,
  formatHeight,
  heightAt,
  heightCovered,
  nextExtremum,
  nextOfType,
  previousExtremum,
  relativePhrase,
  resolveLayout,
  shiftDayKey,
  trendWord,
  windowForDay,
  yDomain,
} from "./tide-model.js";

const PLOT_W = 600;
const PLOT_H = 168;
const PAD_X = 28;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

function waveGeometry(extrema, tMin, tMax, domain, plotH, padBottom) {
  const span = tMax - tMin;
  const inset = span * 0.06;
  const xOf = (t) => PAD_X + ((t - (tMin - inset)) / (span + inset * 2)) * (PLOT_W - PAD_X * 2);
  const yOf = (height) => {
    const ySpan = domain.max - domain.min;
    return PAD_TOP + (1 - (height - domain.min) / ySpan) * (plotH - PAD_TOP - padBottom);
  };
  const steps = 80;
  let line = "";
  for (let i = 0; i <= steps; i += 1) {
    const t = tMin + ((tMax - tMin) * i) / steps;
    const cmd = i === 0 ? "M" : "L";
    line += `${cmd}${xOf(t).toFixed(1)} ${yOf(heightAt(extrema, t)).toFixed(1)} `;
  }
  const baseline = plotH - padBottom;
  const area = `${line}L${xOf(tMax).toFixed(1)} ${baseline} L${xOf(tMin).toFixed(1)} ${baseline} Z`;
  return { line: line.trim(), area, xOf, yOf, plotH, baseline };
}

function tile(kind, item, now, timeZone, unit) {
  const label = kind === "low" ? "Next low" : "Next high";
  if (!item) {
    return `
      <div class="tile ${kind} empty">
        <div class="kicker">${label}</div>
        <div class="clock muted">—</div>
        <div class="when">Not in this forecast</div>
      </div>`;
  }
  const clock = formatClock(item.t, timeZone);
  const day = dayPhrase(item.t, now, timeZone);
  const rel = relativePhrase(item.t, now);
  return `
    <button class="tile ${kind}" type="button" data-day="${esc(dayKey(item.t, timeZone))}"
      aria-label="${label} ${clock}, ${formatHeight(item.height, unit)}, ${day}, ${rel}">
      <div class="kicker">${label}</div>
      <div class="clock">${esc(clock)}</div>
      <div class="tile-height">${esc(formatHeight(item.height, unit))}</div>
      <div class="meta"><span>${esc(day)}</span><span>${esc(rel)}</span></div>
    </button>`;
}

function dayClockTiles(onDay, now, timeZone, unit) {
  const tiles = onDay.map((item) => {
    const label = item.type === "low" ? "Low" : "High";
    const clock = formatClock(item.t, timeZone);
    const rel = relativePhrase(item.t, now);
    return `
      <div class="tile ${item.type} static">
        <div class="kicker">${label}</div>
        <div class="clock">${esc(clock)}</div>
        <div class="tile-height">${esc(formatHeight(item.height, unit))}</div>
        <div class="meta"><span>${esc(rel)}</span></div>
      </div>`;
  }).join("");
  return `<div class="day-clocks">${tiles}</div>`;
}

function renderPlot(doc, view, now, layout) {
  if (!view || view.tMax <= view.tMin) {
    return `<p class="empty-plot">Not enough tides to draw this day.</p>`;
  }
  const plotH = layout.minimal ? 104 : PLOT_H;
  const padBottom = layout.show_labels ? PAD_BOTTOM : 12;
  const domain = yDomain(doc.extrema, doc.range);
  const geo = waveGeometry(doc.extrema, view.tMin, view.tMax, domain, plotH, padBottom);
  const markers = view.points.map((item) => {
    const cx = geo.xOf(item.t);
    const cy = geo.yOf(item.height);
    return `<circle class="mark ${item.type}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.5"></circle>`;
  }).join("");

  let nowMark = "";
  if (now >= view.tMin && now <= view.tMax) {
    const height = heightAt(doc.extrema, now);
    const nx = geo.xOf(now);
    const ny = geo.yOf(height);
    nowMark = `
      <line class="now-line" x1="${nx.toFixed(1)}" y1="${PAD_TOP}" x2="${nx.toFixed(1)}" y2="${geo.baseline}"></line>
      <circle class="now-dot" cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="5.5"></circle>`;
  }

  const ticks = layout.show_labels ? view.points.map((item) => {
    const left = (geo.xOf(item.t) / PLOT_W) * 100;
    const offDay = dayKey(item.t, doc.timezone) !== dayKey(view.onDay[0].t, doc.timezone);
    return `
      <div class="tick ${item.type}${offDay ? " off" : ""}" style="left:${left}%">
        <b>${esc(formatClock(item.t, doc.timezone))}</b>
        <span>${esc(formatHeight(item.height, doc.unit))}</span>
        <em>${item.type === "low" ? "Low" : "High"}</em>
      </div>`;
  }).join("") : "";

  const nowFlag = layout.show_labels && now >= view.tMin && now <= view.tMax
    ? `<div class="now-flag" style="left:${(geo.xOf(now) / PLOT_W) * 100}%">now</div>`
    : "";

  return `
    <div class="plot">
      ${nowFlag}
      <svg viewBox="0 0 ${PLOT_W} ${plotH}" role="img" aria-label="Tide wave">
        <path class="area" d="${geo.area}"></path>
        <path class="line" d="${geo.line}"></path>
        ${markers}
        ${nowMark}
      </svg>
      ${ticks ? `<div class="axis">${ticks}</div>` : ""}
    </div>`;
}

function renderSchedule(view, now, timeZone, unit, nextTime) {
  if (!view) return "";
  const title = dayPhrase(view.onDay[0].t, now, timeZone, { long: true });
  const rows = view.onDay.map((item) => {
    const past = item.t <= now;
    const isNext = nextTime != null && item.t === nextTime;
    const rel = relativePhrase(item.t, now);
    return `
      <div class="row ${item.type}${past ? " past" : ""}${isNext ? " next" : ""}">
        <div class="row-time">${esc(formatClock(item.t, timeZone))}</div>
        <div class="kind">${item.type === "low" ? "Low" : "High"}</div>
        <div class="row-height">${esc(formatHeight(item.height, unit))}</div>
        <div class="rel">${esc(rel)}</div>
      </div>`;
  }).join("");
  return `
    <div class="schedule">
      <div class="schedule-title">${esc(title)}</div>
      ${rows}
    </div>`;
}

function renderHead(doc, now, timeZone, name, layout) {
  const nowHeight = heightCovered(doc.extrema, now);
  const previous = previousExtremum(doc.extrema, now);
  const since = previous
    ? `Since ${previous.type} ${formatHeight(previous.height, doc.unit)} at ${formatClock(previous.t, timeZone)} · ${relativePhrase(previous.t, now)}`
    : "Before the first tide in this forecast";
  const left = layout.show_header || layout.show_since
    ? `<div class="titles">
        ${layout.show_header ? `<div class="place">${esc(name)}</div>` : ""}
        ${layout.show_since ? `<div class="since">${esc(since)}</div>` : ""}
      </div>`
    : "";
  const right = layout.show_now || layout.show_trend
    ? `<div class="now-readout">
        ${layout.show_now ? `<div class="now-height">${nowHeight == null ? "—" : esc(formatHeight(nowHeight, doc.unit))}</div>` : ""}
        ${layout.show_trend ? `<div class="trend">${esc(trendWord(doc.extrema, now))}</div>` : ""}
      </div>`
    : "";
  if (!left && !right) return "";
  return `<div class="head">${left}${right}</div>`;
}

function renderClocks(doc, view, viewingToday, now, timeZone, layout) {
  if (!layout.show_next_low && !layout.show_next_high) return "";
  if (viewingToday || !view) {
    const parts = [];
    if (layout.show_next_low) parts.push(tile("low", nextOfType(doc.extrema, now, "low"), now, timeZone, doc.unit));
    if (layout.show_next_high) parts.push(tile("high", nextOfType(doc.extrema, now, "high"), now, timeZone, doc.unit));
    return `<div class="pair">${parts.join("")}</div>`;
  }
  const items = view.onDay.filter((item) => (
    (item.type === "low" && layout.show_next_low)
    || (item.type === "high" && layout.show_next_high)
  ));
  return items.length ? dayClockTiles(items, now, timeZone, doc.unit) : "";
}

function renderCard(doc, config, now, selectedDay) {
  const layout = resolveLayout(config);
  const timeZone = doc.timezone;
  const name = config.name || doc.location || "Tides";
  const days = daysIn(doc.extrema, timeZone);
  const todayKey = dayKey(now, timeZone);
  let day = layout.show_days ? selectedDay : null;
  if (!days.some((item) => item.day === day)) {
    day = days.some((item) => item.day === todayKey)
      ? todayKey
      : (days.find((item) => item.day >= todayKey) || days[0])?.day;
  }
  const view = day ? windowForDay(doc.extrema, day, timeZone) : null;
  const viewingToday = day === todayKey;

  const chips = layout.show_days && days.length > 1
    ? `<div class="days" role="tablist">${days.map((item) => {
      const label = item.day === todayKey
        ? "Today"
        : item.day === shiftDayKey(todayKey, 1)
          ? "Tomorrow"
          : dayPhrase(item.sample.t, now, timeZone);
      const pressed = item.day === day;
      return `<button class="chip" type="button" data-day="${esc(item.day)}" aria-pressed="${pressed ? "true" : "false"}">${esc(label)}</button>`;
    }).join("")}</div>`
    : "";

  const updatedMs = Date.parse(doc.updated);
  const stale = Number.isFinite(updatedMs) && now - updatedMs > 6 * 60 * 60 * 1000;
  const updated = layout.show_updated && Number.isFinite(updatedMs)
    ? `<div class="updated${stale ? " stale" : ""}">Updated ${esc(dayPhrase(updatedMs, now, timeZone))} ${esc(formatClock(updatedMs, timeZone))}</div>`
    : "";

  const sections = [
    renderHead(doc, now, timeZone, name, layout),
    renderClocks(doc, view, viewingToday, now, timeZone, layout),
    chips,
    layout.show_graph ? renderPlot(doc, view, now, layout) : "",
    layout.show_table
      ? renderSchedule(view, now, timeZone, doc.unit, nextExtremum(doc.extrema, now)?.t ?? null)
      : "",
    updated,
  ].filter(Boolean);

  if (!sections.length) {
    return messageCard(name, "Every section is hidden. Turn one show_* flag back on.");
  }

  return `<ha-card class="${layout.minimal ? "minimal" : ""}">${sections.join("")}</ha-card>`;
}

class TideCard extends HTMLElement {
  constructor() {
    super();
    this._day = null;
  }

  static getConfigForm() {
    return {
      schema: [
        {
          name: "entity",
          required: true,
          selector: { entity: { domain: "sensor" } },
        },
        { name: "name", selector: { text: {} } },
        { name: "attribute", selector: { text: {} } },
        {
          name: "minimal",
          selector: { boolean: {} },
        },
        ...FLAG_FIELDS,
      ],
    };
  }

  static getStubConfig() {
    return { entity: "sensor.tide_data" };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("Please define an entity holding tide-card/v1 data");
    }
    this._config = config;
    this._sig = null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const sig = this._signature();
    if (sig !== this._sig) {
      this._sig = sig;
      this._render();
    }
  }

  getCardSize() {
    const layout = resolveLayout(this._config || {});
    let rows = 0;
    if (layout.show_header || layout.show_since || layout.show_now || layout.show_trend) rows += 1;
    if (layout.show_next_low || layout.show_next_high) rows += layout.minimal ? 2 : 3;
    if (layout.show_days) rows += 1;
    if (layout.show_graph) rows += layout.minimal || !layout.show_labels ? 2 : 4;
    if (layout.show_table) rows += 4;
    if (layout.show_updated) rows += 1;
    return Math.max(rows, 1);
  }

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    if (!this._listening) {
      this._listening = true;
      this.shadowRoot.addEventListener("click", (event) => {
        const button = event.target.closest("[data-day]");
        if (!button) return;
        this._day = button.dataset.day;
        this._render();
      });
    }
    this._timer = window.setInterval(() => this._render(), 30000);
    this._render();
  }

  disconnectedCallback() {
    if (this._timer) window.clearInterval(this._timer);
    this._timer = null;
  }

  _signature() {
    const state = this._hass?.states?.[this._config?.entity];
    if (!state) return "missing";
    const attrs = state.attributes || {};
    const key = this._config.attribute || "";
    const body = key ? attrs[key] : (attrs.extrema ? attrs : attrs.tide_data);
    return JSON.stringify(body ?? null);
  }

  _render() {
    if (!this.shadowRoot || !this._config) return;
    if (!this.shadowRoot.querySelector("style")) {
      const style = document.createElement("style");
      style.textContent = STYLES;
      this.shadowRoot.appendChild(style);
    }
    let html;
    try {
      const state = this._hass?.states?.[this._config.entity];
      if (!this._hass) {
        html = messageCard("Tide card", "Waiting for Home Assistant");
      } else if (!state) {
        html = messageCard("Tide card", `Entity ${this._config.entity} was not found`);
      } else {
        const doc = documentFromState(state, (this._config.attribute || "").trim());
        if (!doc.extrema.length) {
          html = messageCard(this._config.name || "Tides", "No high or low tides in this forecast");
        } else {
          html = renderCard(doc, this._config, Date.now(), this._day);
        }
      }
    } catch (error) {
      html = messageCard("Tide card", error.message || "Could not read tide data");
    }
    let mount = this.shadowRoot.querySelector(".mount");
    if (!mount) {
      mount = document.createElement("div");
      mount.className = "mount";
      this.shadowRoot.appendChild(mount);
    }
    mount.innerHTML = html;
  }
}

function messageCard(title, text) {
  return `
    <ha-card>
      <div class="place">${esc(title)}</div>
      <p class="error">${esc(text)}</p>
    </ha-card>`;
}

const STYLES = `
  :host {
    --tide-high: #2f6fdb;
    --tide-low: #c47b2b;
    display: block;
    font-family: var(--ha-font-family, var(--paper-font-body, system-ui, sans-serif));
  }
  ha-card {
    display: block;
    padding: 16px 16px 12px;
    color: var(--primary-text-color, #1c1c1c);
    background: var(--ha-card-background, var(--card-background-color, #fff));
    border-radius: var(--ha-card-border-radius, 12px);
    box-shadow: var(--ha-card-box-shadow, none);
  }
  .head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
  }
  .place {
    font-size: 1.05rem;
    font-weight: 700;
    line-height: 1.2;
  }
  .since, .updated, .when, .rel, .trend {
    color: var(--secondary-text-color, #667);
    font-size: 0.82rem;
  }
  .since { margin-top: 4px; }
  .now-readout { text-align: right; }
  .now-height {
    font-size: 1.45rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .trend { text-transform: capitalize; margin-top: 4px; }
  ha-card > :first-child { margin-top: 0; }
  .pair, .day-clocks {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px;
    margin-top: 14px;
  }
  .tile {
    text-align: left;
    font: inherit;
    color: inherit;
    border-radius: 12px;
    padding: 10px 12px 12px;
    cursor: pointer;
  }
  .tile.low {
    background: rgba(196, 123, 43, 0.14);
    border: 1px solid rgba(196, 123, 43, 0.5);
  }
  .tile.high {
    background: rgba(47, 111, 219, 0.1);
    border: 1px solid rgba(47, 111, 219, 0.38);
  }
  .tile.empty { cursor: default; }
  .kicker {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .tile.low .kicker { color: var(--tide-low); }
  .tile.high .kicker { color: var(--tide-high); }
  .clock {
    margin-top: 2px;
    font-size: 1.9rem;
    font-weight: 700;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
    line-height: 1.05;
  }
  .tile-height {
    font-size: 1.05rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
  .meta {
    display: flex;
    flex-direction: column;
    margin-top: 2px;
    color: var(--secondary-text-color, #667);
    font-size: 0.82rem;
    font-variant-numeric: tabular-nums;
  }
  .tile.static { cursor: default; }
  .muted { opacity: 0.45; }
  .days {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    margin: 14px 0 8px;
    padding-bottom: 2px;
  }
  .chip {
    border: 0;
    border-radius: 999px;
    padding: 6px 11px;
    background: var(--secondary-background-color, rgba(0, 0, 0, 0.06));
    color: var(--primary-text-color, inherit);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .chip[aria-pressed="true"] {
    background: var(--primary-color, #0288d1);
    color: var(--text-primary-color, #fff);
  }
  .plot { position: relative; margin-top: 4px; }
  svg { width: 100%; height: auto; display: block; overflow: visible; }
  .area { fill: rgba(47, 111, 219, 0.16); }
  .line {
    fill: none;
    stroke: var(--tide-high);
    stroke-width: 3;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .mark.low { fill: var(--tide-low); }
  .mark.high { fill: var(--tide-high); }
  .now-line { stroke: var(--primary-color, #0288d1); stroke-width: 1.5; stroke-dasharray: 3 3; }
  .now-dot { fill: var(--primary-color, #0288d1); stroke: var(--card-background-color, #fff); stroke-width: 2; }
  .now-flag {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--primary-color, #0288d1);
  }
  .axis { position: relative; height: 52px; margin-top: 2px; }
  .tick {
    position: absolute;
    transform: translateX(-50%);
    text-align: center;
    min-width: 52px;
  }
  .tick b {
    display: block;
    font-size: 0.95rem;
    font-variant-numeric: tabular-nums;
  }
  .tick span, .tick em { display: block; font-style: normal; font-size: 0.72rem; }
  .tick.low b, .tick.low em { color: var(--tide-low); }
  .tick.high em { color: var(--tide-high); }
  .tick.off { opacity: 0.55; }
  .schedule { margin-top: 8px; }
  .schedule-title {
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--secondary-text-color, #667);
    margin-bottom: 2px;
  }
  .row {
    display: grid;
    grid-template-columns: 4.5rem 3.2rem 4.4rem 1fr;
    gap: 8px;
    align-items: baseline;
    padding: 7px 0;
    border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
  }
  .row-time {
    font-size: 1.15rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .kind { font-weight: 700; font-size: 0.85rem; }
  .row.low .kind { color: var(--tide-low); }
  .row.high .kind { color: var(--tide-high); }
  .row-height { font-variant-numeric: tabular-nums; }
  .row.past { opacity: 0.45; }
  .row.next {
    opacity: 1;
    background: var(--secondary-background-color, rgba(0, 0, 0, 0.04));
    border-radius: 8px;
    margin: 0 -8px;
    padding: 7px 8px;
    border-top-color: transparent;
  }
  .updated { margin-top: 8px; }
  .updated.stale { color: var(--error-color, #c62828); }
  .error { color: var(--secondary-text-color, #667); }
  .empty-plot { color: var(--secondary-text-color, #667); }
  ha-card.minimal { padding: 8px 10px 6px; }
  ha-card.minimal .place { font-size: 0.92rem; }
  ha-card.minimal .since, ha-card.minimal .trend, ha-card.minimal .updated { font-size: 0.75rem; }
  ha-card.minimal .now-height { font-size: 1.05rem; }
  ha-card.minimal .clock { font-size: 1.35rem; }
  ha-card.minimal .tile { padding: 6px 8px 7px; border-radius: 10px; }
  ha-card.minimal .tile-height { font-size: 0.92rem; }
  ha-card.minimal .kicker { font-size: 0.64rem; }
  ha-card.minimal .meta { font-size: 0.75rem; }
  ha-card.minimal .pair, ha-card.minimal .day-clocks { gap: 6px; margin-top: 8px; }
  ha-card.minimal .days { margin: 8px 0 4px; }
  ha-card.minimal .chip { padding: 4px 8px; font-size: 0.78rem; }
  ha-card.minimal .row { padding: 4px 0; }
  ha-card.minimal .row-time { font-size: 0.98rem; }
  ha-card.minimal .axis { height: 42px; }
  ha-card.minimal .tick b { font-size: 0.8rem; }
`;

const FLAG_FIELDS = [
  ["show_header", "Place name"],
  ["show_since", "Previous tide under the name"],
  ["show_now", "Estimated height now"],
  ["show_trend", "Rising or falling"],
  ["show_next_low", "Next low, or lows on the selected day"],
  ["show_next_high", "Next high, or highs on the selected day"],
  ["show_days", "Day switcher"],
  ["show_graph", "Tide wave"],
  ["show_labels", "Times and heights under the wave"],
  ["show_table", "Tide table"],
  ["show_updated", "Forecast update time"],
].map(([name, description]) => ({
  name,
  description,
  selector: { boolean: {} },
}));

if (!customElements.get("tide-card")) {
  customElements.define("tide-card", TideCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "tide-card",
  name: "Tide card",
  description: "Wave chart of high and low tides from a tide-card/v1 entity",
  preview: true,
});
