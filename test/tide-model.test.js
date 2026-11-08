import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  dayKey,
  documentFromState,
  formatClock,
  heightAt,
  nextOfType,
  parseTideDocument,
  relativePhrase,
  resolveLayout,
  windowForDay,
} from "../tide-model.js";

const here = dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(readFileSync(join(here, "../sample.json"), "utf8"));
const doc = parseTideDocument(sample);
const tz = "Pacific/Auckland";

test("midway between low and high is the mean height", () => {
  const low = doc.extrema[0];
  const high = doc.extrema[1];
  const mid = low.t + (high.t - low.t) / 2;
  const height = heightAt(doc.extrema, mid);
  assert.ok(Math.abs(height - (low.height + high.height) / 2) < 1e-9);
  assert.equal(heightAt(doc.extrema, low.t), low.height);
  assert.equal(heightAt(doc.extrema, high.t), high.height);
});

test("clocks stay in the station timezone", () => {
  const low = doc.extrema.find((item) => item.time.startsWith("2026-11-08T13:21"));
  assert.equal(formatClock(low.t, tz), "13:21");
  assert.equal(dayKey(low.t, tz), "2026-11-08");
});

test("next low after 10:00 is 13:21, not the morning low", () => {
  const now = Date.parse("2026-11-08T10:00:00+13:00");
  const next = nextOfType(doc.extrema, now, "low");
  assert.equal(formatClock(next.t, tz), "13:21");
  assert.equal(next.height, 0.8);
});

test("a day window keeps the neighbouring extremum", () => {
  const view = windowForDay(doc.extrema, "2026-11-09", tz);
  assert.ok(view.onDay.every((item) => dayKey(item.t, tz) === "2026-11-09"));
  assert.ok(view.points.length > view.onDay.length);
  assert.ok(view.tMin < view.onDay[0].t);
});

test("relative time keeps hours under a day and switches to days after that", () => {
  const now = Date.parse("2026-11-08T14:27:00+13:00");
  assert.equal(relativePhrase(Date.parse("2026-11-09T01:46:00+13:00"), now), "in 11h 19m");
  assert.equal(relativePhrase(Date.parse("2026-11-11T03:18:00+13:00"), now), "in 2d 12h");
});

test("minimal mode hides the table and an explicit flag puts it back", () => {
  const full = resolveLayout({});
  assert.equal(full.show_graph, true);
  assert.equal(full.show_table, true);
  assert.equal(full.minimal, false);

  const minimal = resolveLayout({ minimal: true });
  assert.equal(minimal.show_now, true);
  assert.equal(minimal.show_next_low, true);
  assert.equal(minimal.show_next_high, true);
  assert.equal(minimal.show_graph, true);
  assert.equal(minimal.show_table, false);
  assert.equal(minimal.show_days, false);
  assert.equal(minimal.show_labels, false);
  assert.equal(minimal.show_since, false);

  const graphOnly = resolveLayout({
    show_header: false,
    show_since: false,
    show_now: false,
    show_trend: false,
    show_next_low: false,
    show_next_high: false,
    show_days: false,
    show_labels: true,
    show_table: false,
    show_updated: false,
  });
  assert.equal(graphOnly.show_graph, true);
  assert.equal(graphOnly.show_table, false);

  const minimalWithTable = resolveLayout({ minimal: true, show_table: true });
  assert.equal(minimalWithTable.show_table, true);
  assert.equal(minimalWithTable.show_days, false);
  assert.equal(resolveLayout({ show_graph: "yes" }).show_graph, true);
});

test("attributes are the document, and a JSON string still parses", () => {
  const fromAttrs = documentFromState({ attributes: sample });
  assert.equal(fromAttrs.extrema.length, sample.extrema.length);
  const fromString = documentFromState({
    attributes: { tide_data: JSON.stringify(sample) },
  });
  assert.equal(fromString.location, "Weiti River Entrance");
  assert.throws(() => parseTideDocument({ schema: "metservice" }), /Unsupported tide schema/);
});
