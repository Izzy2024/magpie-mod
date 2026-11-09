import assert from "node:assert/strict";
import {
  DEMO_CYCLE, MAX_FLIGHTS, advance, along, beakOffset, demoRoutes, feed, flightCmds, flightLine, flowDash, frame, matchPane,
  plural, requestLine, ridersOf, rowMap, seatKey, seatView, stageRows, why, wiresOf,
} from "../mods/routing/logic.js";

// ---- one request on one account: the shape the gateway writes ----
const seat = { id: "ccp", name: "Command Code Plan", provider: "commandcode-plan", model: "deepseek/deepseek-v4.1-flash", routing: "", kind: "account" };
const ok = { id: "ccp", model: seat.model, done: true, status: 200, ms: 4903 };
const route = { id: 2, time: new Date().toISOString(), agent: "cindy", model: `commandcode-plan/${seat.model}`, provider: "commandcode-plan", order: [seat], tries: [ok], done: true, status: 200, ms: 5158, served: seat.model };

assert.equal(route.done, true);
assert.match(why(route), /only account on for deepseek-v4.1-flash/);
assert.equal(seatView(route, route.order[0], 0).kind, "on");
assert.match(seatView(route, route.order[0], 0).label, /^200/);
const wires = wiresOf(1);
const hubStart = along(wires.agentHub, 0);
const hubEnd = along(wires.agentHub, 1);
assert.ok(hubStart.x < hubEnd.x, "the outbound wire runs from the agent toward magpie");
assert.ok(Math.abs(hubStart.y - hubEnd.y) < 4, "side by side, that wire stays level");
const down = along(wires.seats[0], 0);
const into = along(wires.seats[0], 1);
assert.ok(into.y > down.y + 20, "the account wire drops below magpie");
assert.ok(into.x < wires.box.hub.cx - 10, "it arrives at the account's left edge, not across the card");

const waiting = { id: 1, done: false, tries: [], order: route.order, status: 0 };
let step = advance(null, waiting, 0);
assert.equal(step.play.phase, "to-hub");
assert.ok(step.scene.bird.x < 55);
step = advance(step.play, waiting, 700);
assert.equal(step.play.phase, "wait-hub");
assert.equal(step.scene.bird != null, true);
const asking = { ...waiting, tries: [{ ...ok, done: false, status: 0 }] };
step = advance(step.play, asking, 700);
assert.equal(step.play.phase, "to-seat");
assert.equal(step.play.from, "edge");
const leaving = advance(step.play, asking, 1600);
assert.equal(leaving.play.phase, "away");
assert.equal(leaving.scene.bird != null, true);
const atSeat = advance(leaving.play, asking, 2050);
assert.equal(atSeat.play.phase, "hold");
assert.equal(atSeat.scene.bird, null);
assert.equal(atSeat.scene.dot.kind, "held");
const streaming = { ...asking, tries: [{ ...ok }] };
const still = advance(atSeat.play, streaming, 2200);
assert.equal(still.play.phase, "hold", "a try can finish before the route does; the dot keeps waiting");
const answered = { ...asking, done: true, status: 200, tries: [{ ...ok }] };
const returning = advance(still.play, answered, 2200);
assert.equal(returning.play.phase, "back");
assert.equal(returning.scene.dot.kind, "ring");
assert.equal(returning.scene.bird.face, "left");
assert.equal(advance(null, route, 0).scene.phase, "rest");
const box = wires.box;
const cmds = flightCmds(1, 0, "full");
for (let i = 0; i <= 24; i++) {
  const p = along(cmds, i / 24);
  const through = p.x > box.hub.left + 2 && p.x < box.hub.left + box.hub.w - 2 && p.y > box.hub.top + 6 && p.y < box.hub.bottom - 8;
  assert.equal(through, false, `the flight cuts the card at t=${i / 24}`);
}
// the corner is wherever the flight first drops off the level wire: beside magpie's left edge, not at a fixed t
const corner = Array.from({ length: 201 }, (_, i) => along(cmds, i / 200)).find((p) => p.y > box.agent.cy + 4);
assert.ok(corner, "the corner leaves the level wire");
assert.ok(corner.aim > 12, "the corner banks the bird");
assert.ok(corner.x <= box.hub.left + 1, "and it turns down beside magpie's left edge, not inside the card");
const beak = beakOffset({ face: "right", bank: 0, away: 0, intro: 0 });
assert.ok(beak[0] < -4 && beak[0] > -8 && Math.abs(beak[1]) < 1, "the beak sits just behind the packet");
const flipped = beakOffset({ face: "left", bank: 0, away: 0, intro: 0 });
assert.ok(flipped[0] > 4 && flipped[0] < 8);
const merged = feed([route, { ...route, id: 1 }], new Map([[1, { ...route, id: 1, done: false }]]));
assert.equal(merged[0].id >= merged[1].id, true);
assert.equal(merged.find((r) => r.id === 1).done, false);
assert.equal(requestLine(route).bad, false);
assert.match(requestLine({ ...route, status: 500, done: true }).meta, /500/);

// ---- several requests share one stage ----
const A = { id: "a" }, B = { id: "b" }, C = { id: "c" };
const rows = stageRows([], [{ order: [B, A] }, { order: [A, C] }]);
assert.deepEqual(rows.keys, ["b", "a", "c"], "first seen first: the request on screen decides the order");
assert.deepEqual(stageRows(["a", "c", "b"], [{ order: [B, A, C] }]).keys, ["a", "c", "b"], "while something flies the order stays put");
assert.deepEqual(stageRows(["x"], [{ order: [A] }]).keys, ["a"], "an account nobody uses any more leaves");
const many = stageRows([], [{ order: "abcdefghij".split("").map((id) => ({ id })) }]);
assert.equal(many.keys.length, 8);
assert.equal(many.more, 2);
assert.equal(seatKey({ name: "n" }), "n");
const failing = { order: [A, B, C], tries: [{ id: "a" }, { id: "c" }] };
const map = rowMap(failing, ["c", "b", "a"]);
assert.deepEqual([map.of(0), map.of(1), map.of(2)], [2, 0, 0], "a try lands on its account's row, not on its own index (no 3rd try yet: the plan's 3rd seat)");
assert.equal(map.rows, 3);
assert.equal(ridersOf([{ done: false, tries: [{ id: "a", done: false }] }, { done: false, tries: [{ id: "a", done: true }] }, { done: true, tries: [{ id: "a", done: false }] }], "a").length, 1);
assert.equal(plural(1, "request"), "request");
assert.equal(plural(0, "request"), "requests");

const same = { id: 9, time: new Date(1000).toISOString(), agent: "x", order: [A], tries: [], done: false };
assert.deepEqual(flightLine(same, 1000 + 3240), { agent: "x", state: "routing", wait: "3.2s" });
assert.equal(flightLine({ ...same, tries: [{ id: "a", model: "p/m", done: false }] }, 1000).state, "asking m");
assert.equal(flightLine({ ...same, tries: [{ id: "a", done: true, status: 200 }] }, 1000).state, "streaming");
assert.equal(flightLine({ ...same, tries: [{ id: "a", done: true, status: 429 }] }, 1000).state, "retrying");

const panes = [
  { pane: "p1", terminal: "t1", tab: "tb1", cwd: "/Users/me/deepseek-harness/mod-magpie", status: "idle" },
  { pane: "p2", terminal: "t2", tab: "tb2", cwd: "/Users/me/deepseek-harness/mod-magpie", status: "working" },
  { pane: "p3", terminal: null, mod: "files", tab: "tb1", cwd: null, status: null },
];
const spaces = [{ name: "mod-magpie", tabs: [{ id: "tb1" }, { id: "tb2" }] }];
assert.deepEqual(matchPane("deepseek-harness/mod-magpie", panes, spaces), { terminal: "t2", space: "mod-magpie", status: "working" }, "the agent that is working is the likely sender");
assert.equal(matchPane("mod-magpie", panes, spaces).terminal, "t2", "a one-segment label still matches the folder name");
assert.equal(matchPane("agent-more", panes, spaces), null);
assert.equal(matchPane(null, panes, spaces), null);

// ---- wire and flight geometry, at three panel widths and three row counts ----
// along() eases with a cosine; undoing it gives samples a fixed distance apart.
const walk = (cmds, px) => {
  const at = (k) => along(cmds, Math.acos(1 - 2 * k) / Math.PI, px);
  const gap = (a, b) => Math.hypot((b.x - a.x) / 100 * px, b.y - a.y);
  let L = 0;
  for (let i = 1; i <= 400; i++) L += gap(at((i - 1) / 400), at(i / 400));
  const n = Math.max(2, Math.round(L)); // one sample per pixel of path
  return { pts: Array.from({ length: n + 1 }, (_, i) => at(i / n)), gap };
};
const LANE_PX = 12;  // the contract: the lane runs 12 px left of the accounts
const LANE_SNAP = 1; // px: straight runs are snapped to half pixels (round, then +0.5), so the lane lands within 1 px of 12
const EPS = 0.05;    // px; float noise from interpolating the flattened path, far below anything visible
const MAX_TURN = 12; // degrees per ~1 px: a radius-8 arc turns 7.2°/px (8.1° measured, flattened); a square corner gives 45° or more, a hairpin 180°
const MAX_STEP = 1.5; // px: samples measure 1.00 px apart; half as much again is already a jump
for (const px of [240, 368, 560]) for (const n of [1, 3, 8]) {
  const at = `px=${px} rows=${n}`;
  const w = wiresOf(n, px);
  assert.equal(w.base.length, n + 1, `every static wire is drawn once (${at})`);
  assert.equal(w.seats.length, n, `one wire per account (${at})`);
  w.seats.forEach((cmds, i) => {
    const { pts } = walk(cmds, px);
    const lane = Math.min(...pts.map((p) => p.x));
    const off = (w.box.account(i).left - lane) / 100 * px - LANE_PX;
    assert.ok(Math.abs(off) <= LANE_SNAP, `seat ${i} lane is ${LANE_PX} px left of the accounts, off by ${off.toFixed(2)} px (${at})`);
    let inLane = false;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      assert.ok(b.y >= a.y - EPS, `seat ${i} wire never climbs (${at}, sample ${k}: y ${a.y} -> ${b.y})`);
      inLane ||= (a.x - lane) / 100 * px <= EPS;
      if (!inLane) assert.ok((b.x - a.x) / 100 * px <= EPS, `seat ${i} wire never heads right before the lane (${at}, sample ${k}: x ${a.x} -> ${b.x})`);
    }
  });
  for (const from of ["full", "edge", "lane"]) for (let seat = 0; seat < n; seat++) {
    const { pts, gap } = walk(flightCmds(n, seat, from, px), px);
    let was = null;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k], d = gap(a, b);
      assert.ok(d <= MAX_STEP, `${from} flight to seat ${seat} jumps ${d.toFixed(2)} px (${at}, sample ${k})`);
      const now = Math.atan2(b.y - a.y, (b.x - a.x) / 100 * px) * 180 / Math.PI;
      const turn = was == null ? 0 : Math.abs(((now - was + 540) % 360) - 180);
      assert.ok(turn <= MAX_TURN, `${from} flight to seat ${seat} turns ${turn.toFixed(1)}° in one step (${at}, sample ${k} at ${b.x.toFixed(2)}%, ${b.y.toFixed(1)})`);
      was = now;
    }
  }
}
for (const back of [false, true]) for (let ms = 0; ms <= 1400; ms++) {
  for (const v of flowDash(ms, back)) assert.ok(Number.isFinite(v) && v > 0, `dash ${v} at ${ms} ms, back=${back}`);
}

// ---- the scripted demo, played frame by frame like the panel does ----
const start = 1_000_000;
const state = { plays: new Map(), keys: [], played: new Set() };
const seen = new Map();
let peak = 0, prevKeys = [], prevHad = false;
for (let ms = 0; ms < DEMO_CYCLE; ms += 16) {
  const live = new Map(demoRoutes(ms, start).map((r) => [r.id, r]));
  const list = feed([], live);
  const focus = list.find((r) => !r.done) || list[0] || null;
  const { rows: r, entries } = frame(state, list, focus, start + ms, 368);
  peak = Math.max(peak, entries.filter((e) => e.scene.bird).length);
  assert.ok(entries.length <= MAX_FLIGHTS + 1, "never more than the cap, plus the one on screen at rest");
  if (prevHad && state.plays.size) assert.deepEqual(prevKeys.filter((k) => r.keys.includes(k)), r.keys.filter((k) => prevKeys.includes(k)), `rows keep their order while birds fly (t=${ms})`);
  prevKeys = r.keys;
  prevHad = state.plays.size > 0;
  for (const e of entries) {
    const set = seen.get(e.route.id) || new Set();
    set.add(e.scene.phase === "fly" ? e.play.phase : e.scene.phase);
    set.add(e.play?.phase);
    seen.set(e.route.id, set);
    const b = e.scene.bird;
    if (b) {
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.opacity), `bird has a place and an opacity (t=${ms}, route ${e.route.id})`);
      assert.ok(Number.isFinite(b.turn) && b.turn >= -1 && b.turn <= 1, `bird.turn ${b.turn} is within [-1, 1] (t=${ms}, route ${e.route.id})`);
    }
    for (const row of [e.scene.flowSeat, e.scene.litSeat]) if (row != null) assert.ok(row >= 0 && row < r.keys.length, "a lit wire is a row that exists");
  }
}
assert.ok(peak >= 3, `three birds fly at once (peak ${peak})`);
const nova = seen.get(start + 1800);
assert.ok(nova.has("back-hub"), "the failing request returns to magpie before the next account");
assert.ok(nova.has("hold"), "and waits on the account that is answering");
assert.equal(state.plays.size, 0, "every flight ends in rest before the cycle does, and an answered request is not flown again");
console.log("logic ok; peak", peak, "birds at once; failover phases:", [...nova].join(" "));
