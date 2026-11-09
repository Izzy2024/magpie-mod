// Pure reading of a Magpie route. The gateway writes the same objects to
// /v1/magpie/trace and to ~/.config/magpie/routing/<day>.jsonl.
// Wording follows magpie's Routing page (internal/gui/assets/plugins/routing/client.js)
// for the cases this panel draws; it does not re-decide the route.

const MODES = {
  "": ["Smart", "Smart: the one with the most left before it renews goes first."],
  pace: ["Smart", "Smart: the one with the most left before it renews goes first."],
  order: ["In order", "In order: the first that can answer takes the request."],
  rotate: ["In turn", "In turn: each request starts one further along."],
  weight: ["By weight", "By weight: each takes requests as its weight says."],
  cheap: ["Cheapest", "Cheapest first: the lowest price that can answer goes first."],
  fast: ["Fastest", "Speed first: whoever answered fastest lately goes first."],
  free: ["Free first", "What costs nothing is spent before anything that spends the allowance."],
  drain: ["Until used up", "The one in use answers everything until it is used up."],
  expiring: ["Expiring", "Free quota that is lost soonest is spent first."],
};

export function localDay(date = new Date()) {
  const z = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${z(date.getMonth() + 1)}-${z(date.getDate())}`;
}

export function parseJsonl(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* a torn last line while magpie is writing */ }
  }
  return out;
}

export function shortModel(model) {
  if (!model) return "";
  const parts = String(model).split("/");
  return parts[parts.length - 1] || model;
}

export function maskName(name, on) {
  if (!on || !name) return name || "";
  if (name.includes("@")) return name.replace(/(.{1}).+(@.*)/, "$1•••$2");
  if (name.length <= 2) return "••";
  return `${name.slice(0, 1)}•${name.slice(-1)}`;
}

export function clock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const z = (n) => String(n).padStart(2, "0");
  return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

export function secs(ms) {
  if (ms == null || Number.isNaN(ms)) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

export function modeOf(routing) {
  return MODES[routing || ""] || [routing || "Routed", "Routed as magpie weighed the accounts."];
}

function who(seat) {
  return seat?.name || seat?.who || seat?.provider || "the account";
}

export function why(route) {
  if (!route) return "Send one from any agent routed through magpie and it plays here as it happens.";
  const order = route.order || [];
  const first = order[0];
  if (!first) {
    if (!route.done) return "Magpie has the request and has not picked an account yet.";
    return route.error || "Nothing took this request.";
  }
  const name = who(first);
  const model = shortModel(first.model || route.served || route.model);
  if (order.length === 1) {
    if (first.rest) return `${name} is the only one, so it's tried though it is resting.`;
    return first.kind === "key"
      ? `${first.name || first.provider} has one key on — nothing to choose between.`
      : `${name} is the only account on for ${model} — nothing to choose between.`;
  }
  if (first.rest) return `Every one is resting after a failure, so ${name}, first in line, is tried all the same.`;
  const [chip, line] = modeOf(first.routing);
  if (first.routing === "cheap" || first.routing === "fast" || first.routing === "free") return `${line.replace(/\.$/, "")}: ${model} on ${name}.`;
  if (!first.routing) return `${name} goes first for ${model}. ${line}`;
  return `${chip}: ${name} goes first for ${model}.`;
}

export function headline(route) {
  if (!route) return { name: "Waiting for a request", tail: "" };
  const group = route.group;
  const first = (route.order || []).find((x) => !x.fallback) || (route.order || [])[0];
  const name = group?.name || first?.name || route.provider || route.agent || "magpie";
  const on = group?.members?.length || (route.order || []).filter((x) => !x.fallback).length;
  const count = on === 0 ? "" : on === 1 ? " · one on" : ` · ${on} on`;
  const agent = route.agent ? `${route.agent}` : "";
  return { name, tail: `${count}${agent ? "" : ""}`, agent };
}

export function stepsOf(route) {
  if (!route) return [];
  const out = [{ text: why(route), kind: "why" }];
  for (const tr of route.tries || []) {
    const ok = tr.done && tr.status >= 200 && tr.status < 300;
    if (!tr.done) out.push({ kind: "wait", text: `Asking ${shortModel(tr.model)}…` });
    else if (ok) out.push({ kind: "ok", text: `${tr.status} · ${shortModel(tr.served || tr.model)} · ${secs(tr.ms)}` });
    else out.push({ kind: "bad", text: `${tr.status || "error"} · ${shortModel(tr.model)} · ${secs(tr.ms)}` });
  }
  if (route.done && (route.out || route.reasoning)) {
    const bits = [];
    if (route.out) bits.push(`${route.out} out`);
    if (route.reasoning) bits.push(`${route.reasoning} reasoning`);
    if (route.ttft) bits.push(`first token ${secs(route.ttft)}`);
    out.push({ kind: "why", text: bits.join(" · ") });
  }
  return out;
}

export function seatView(route, seat, index) {
  const tries = route?.tries || [];
  const hit = [...tries].reverse().find((t) => t.id && seat?.id && t.id === seat.id)
    || (tries.length === 1 && index === 0 ? tries[0] : null);
  const open = tries.find((t) => !t.done);
  const active = Boolean(open && hit && open === hit) || Boolean(open && open.id && open.id === seat?.id);
  let kind = "idle";
  let label = modeOf(seat?.routing)[0];
  if (seat?.rest && !hit) { kind = "rest"; label = "resting"; }
  if (!route?.done && !tries.length && index === 0) { kind = "wait"; label = "next"; }
  if (active) { kind = "now"; label = "answering…"; }
  else if (hit?.done && hit.status >= 200 && hit.status < 300) { kind = "on"; label = `${hit.status} · ${secs(hit.ms)}`; }
  else if (hit?.done) { kind = "bad"; label = `${hit.status || "error"} · ${secs(hit.ms)}`; }
  return { kind, label, model: shortModel(seat?.model || hit?.served || hit?.model) };
}

// The stage, in the same geometry as Magpie's narrow Routing page: the
// agent and magpie side by side, accounts underneath. x is a percent of the
// stage width, y is pixels.
const HEAD_TOP = 8, HEAD_H = 78, ROW_H = 50, ROW_GAP = 8;
const ACCOUNTS_TOP = HEAD_TOP + HEAD_H + 20;

export function stageBox(n) {
  const rows = Math.max(1, n);
  const h = ACCOUNTS_TOP + rows * ROW_H + Math.max(0, rows - 1) * ROW_GAP + 8;
  const mid = HEAD_TOP + HEAD_H / 2;
  return {
    h, rows, accountsTop: ACCOUNTS_TOP, rowH: ROW_H, rowGap: ROW_GAP,
    agent: { x: 4, w: 40, top: HEAD_TOP, h: HEAD_H, right: 44, cy: mid },
    hub: { x: 56, w: 40, top: HEAD_TOP, h: HEAD_H, left: 56, cx: 76, bottom: HEAD_TOP + HEAD_H, cy: mid },
    account(i) {
      const top = ACCOUNTS_TOP + i * (ROW_H + ROW_GAP);
      return { x: 10, w: 86, top, h: ROW_H, left: 10, cy: top + ROW_H / 2 };
    },
  };
}

const PX = 368;
const R = 8, K = 0.5523;

// A polyline given in pixels, drawn with quarter-circle corners of radius R.
// Comes back as M/L/C with x as a percent of px.
function rounded(pts, px) {
  const X = (x) => x / px * 100;
  let [lx, ly] = pts[0];
  const out = [["M", X(lx), ly]];
  const line = (x, y) => {
    if (Math.hypot(x - lx, y - ly) > 1e-6) out.push(["L", X(x), y]);
    lx = x; ly = y;
  };
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1], [x, y] = pts[i], [bx, by] = pts[i + 1];
    const da = Math.hypot(x - ax, y - ay), db = Math.hypot(bx - x, by - y);
    // ponytail: no two corners share a run shorter than 2R on this stage
    const r = Math.min(R, da, db);
    const sx = x + (ax - x) / da * r, sy = y + (ay - y) / da * r;
    const ex = x + (bx - x) / db * r, ey = y + (by - y) / db * r;
    line(sx, sy);
    out.push(["C", X(sx + (x - sx) * K), sy + (y - sy) * K, X(ex + (x - ex) * K), ey + (y - ey) * K, X(ex), ey]);
    lx = ex; ly = ey;
  }
  line(...pts[pts.length - 1]);
  return out;
}

// Square wiring: one bus under magpie, one lane down the gutter left of the
// accounts, a hook into each. Straight runs sit on half pixels. base draws
// every wire once; seats, edge and full are whole paths for a flight.
const WIRES = new Map();
export function wiresOf(n, px = PX) {
  const key = `${n}:${px}`;
  if (WIRES.has(key)) return WIRES.get(key);
  const box = stageBox(n);
  const P = (pct) => pct / 100 * px;
  const half = (v) => Math.round(v) + 0.5;
  const hy = Math.floor(box.hub.cy) + 0.5, bus = box.hub.bottom + 10.5;
  const ax = P(box.agent.right), hl = half(P(box.hub.left)), hc = half(P(box.hub.cx));
  // the nearest half pixel at or left of 12px out, so the lane is never short
  const left = P(box.account(0).left), lane = Math.floor(left - 12.5) + 0.5;
  const cy = (i) => Math.floor(box.account(i).cy) + 0.5;
  const tail = (i) => [[lane, bus], [lane, cy(i)], [left, cy(i)]];
  const agentHub = rounded([[ax, hy], [P(box.hub.left), hy]], px);
  // The flight rides magpie's left edge down to the bus, already heading left.
  const via = rounded([[hl, hy], [hl, bus], [hl - R, bus]], px);
  const seats = [], edge = [], full = [], base = [agentHub];
  for (let i = 0; i < box.rows; i++) {
    seats.push(rounded([[hc, box.hub.bottom], [hc, bus], ...tail(i)], px));
    edge.push(rounded([[hl, hy], [hl, bus], ...tail(i)], px));
    full.push(rounded([[ax, hy], [hl, hy], [hl, bus], ...tail(i)], px));
  }
  base.push(seats[box.rows - 1]);
  for (let i = 0; i < box.rows - 1; i++) base.push(rounded([[lane, cy(i) - R], [lane, cy(i)], [left, cy(i)]], px));
  const wires = { box, agentHub, via, seats, base, edge, full };
  if (WIRES.size > 60) WIRES.clear();
  WIRES.set(key, wires);
  return wires;
}

const glide = (k) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, k)))) / 2;

function flattenRaw(cmds, px) {
  const pts = [];
  let cx = 0, cy = 0;
  const push = (xp, y) => {
    const last = pts[pts.length - 1];
    if (last && Math.hypot((xp - last.xp) / 100 * px, y - last.y) < 0.6) return;
    pts.push({ xp, y });
  };
  const curve = (c1x, c1y, c2x, c2y, x, y, cubic) => {
    const steps = 18;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      const w = cubic
        ? [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
        : [u * u, 2 * u * t, t * t];
      const xs = cubic ? [cx, c1x, c2x, x] : [cx, c1x, x];
      const ys = cubic ? [cy, c1y, c2y, y] : [cy, c1y, y];
      let px = 0, py = 0;
      w.forEach((wi, q) => { px += wi * xs[q]; py += wi * ys[q]; });
      push(px, py);
    }
    cx = x; cy = y;
  };
  for (const c of cmds) {
    if (c[0] === "M") { cx = c[1]; cy = c[2]; push(cx, cy); }
    else if (c[0] === "L") {
      for (let i = 1; i <= 8; i++) push(cx + (c[1] - cx) * i / 8, cy + (c[2] - cy) * i / 8);
      cx = c[1]; cy = c[2];
    } else if (c[0] === "C") curve(c[1], c[2], c[3], c[4], c[5], c[6], true);
    else if (c[0] === "Q") curve(c[1], c[2], 0, 0, c[3], c[4], false);
  }
  let L = 0;
  const len = [0];
  for (let i = 1; i < pts.length; i++) {
    L += Math.hypot((pts[i].xp - pts[i - 1].xp) / 100 * px, pts[i].y - pts[i - 1].y);
    len.push(L);
  }
  return { pts, len, L };
}

// A wire only changes with the number of rows and the panel width, but every
// bird asks for its length and position every frame: measure each path once.
const FLAT = new Map();
function memo(kind, cmds, px, make) {
  const key = `${kind}${px}${JSON.stringify(cmds)}`;
  let hit = FLAT.get(key);
  if (!hit) {
    if (FLAT.size > 300) FLAT.clear();
    hit = make();
    FLAT.set(key, hit);
  }
  return hit;
}

function flatten(cmds, px) {
  return memo("f", cmds, px, () => flattenRaw(cmds, px));
}

function atLength(flat, dist) {
  const { pts, len, L } = flat;
  const d = Math.max(0, Math.min(L, dist));
  let lo = 0, hi = len.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (len[mid] <= d) lo = mid; else hi = mid;
  }
  const span = len[hi] - len[lo] || 1;
  const f = (d - len[lo]) / span;
  const x = pts[lo].xp + (pts[hi].xp - pts[lo].xp) * f;
  const y = pts[lo].y + (pts[hi].y - pts[lo].y) * f;
  return { x, y, vx: pts[hi].xp - pts[lo].xp, vy: pts[hi].y - pts[lo].y };
}

// Magpie eases the flight in and out and keeps the dot a few pixels clear
// of each card, so it is seen whole beside the edge. aim is the bank,
// clamped the way pose() clamps it: the bird stays mostly level.
export function along(cmds, t, px = PX) {
  const flat = flatten(cmds, px);
  const edge = Math.min(6, flat.L / 4);
  const d = edge + glide(t) * Math.max(0, flat.L - 2 * edge);
  const p = atLength(flat, d);
  const before = atLength(flat, d - 3), after = atLength(flat, d + 3);
  const vx = (after.x - before.x) / 100 * px;
  const vy = after.y - before.y;
  const aim = Math.max(-24, Math.min(24, Math.atan2(vy, Math.abs(vx)) * 180 / Math.PI));
  return { x: p.x, y: p.y, vx, vy, aim };
}

function reversed(cmds, px) {
  return memo("r", cmds, px, () => {
    const { pts } = flatten(cmds, px);
    if (pts.length < 2) return cmds;
    const out = [["M", pts[pts.length - 1].xp, pts[pts.length - 1].y]];
    for (let i = pts.length - 2; i >= 0; i--) out.push(["L", pts[i].xp, pts[i].y]);
    return out;
  });
}

// The dashes run away from the start of the stroke; back runs them home.
export function flowDash(now, back = false) {
  const u = ((now % 700) / 700) * 8;
  const p = back ? u : (8 - u) % 8;
  if (p < 3) return [Math.max(0.35, 3 - p), 5, 3, 5];
  return [0.35, Math.max(0.35, 8 - p), 3, 5];
}

const heldOpacity = (now) => 1 - 0.55 * (1 - Math.cos(2 * Math.PI * ((now % 1200) / 1200))) / 2;
const tryOk = (tr) => Boolean(tr?.done && tr.status >= 200 && tr.status < 300);
const tryBad = (tr) => Boolean(tr?.done && !tryOk(tr));

function restScene(route, row = (i) => i) {
  const seat = Math.max(0, (route?.tries || []).length - 1);
  return { moving: false, phase: "rest", bird: null, dot: null, flowAgent: false, flowSeat: null, litSeat: route?.tries?.length ? row(seat) : null };
}

// Several requests share one stage, so a seat is an account, not "the n-th
// of this request". rowMap says which stage row a request's try i lands on.
export const seatKey = (s) => s?.id || s?.name || s?.provider || "";

export function rowMap(route, keys) {
  const rows = Math.max(1, keys.length);
  return {
    rows,
    of(i) {
      const at = keys.indexOf(route?.tries?.[i]?.id ?? seatKey(route?.order?.[i]));
      return at < 0 ? Math.min(Math.max(0, i), rows - 1) : at;
    },
  };
}

// The stage rows: every account of every request on show, in the order first
// seen. prev keeps that order while something flies, so a wire never moves
// under a bird. Past max the rest is counted, not drawn.
export function stageRows(prev, routes, max = 8) {
  const seats = new Map();
  for (const r of routes) for (const s of r?.order || []) {
    const k = seatKey(s);
    if (k && !seats.has(k)) seats.set(k, s);
  }
  const keys = prev.filter((k) => seats.has(k));
  for (const k of seats.keys()) if (!keys.includes(k)) keys.push(k);
  return { keys: keys.slice(0, max), more: Math.max(0, keys.length - max), seats };
}

// Requests with a try open on this account right now.
export function ridersOf(routes, key) {
  return routes.filter((r) => !r.done && (r.tries || []).some((t) => !t.done && t.id === key));
}

// from is where this leg starts. "full" is the agent wire, the corner and
// the lane (1400ms). "edge" is the same bird already at magpie's left edge
// (900ms). "lane" is a new bird at the top of the lane, after a failure
// came back only that far (900ms).
function leg(wires, from, seat) {
  if (from === "lane") return wires.seats[seat];
  return (from === "edge" ? wires.edge : wires.full)[seat];
}

export function flightCmds(n, seat, from, px = PX) {
  const wires = wiresOf(Math.max(1, n), px);
  const s = Math.min(Math.max(0, seat), wires.seats.length - 1);
  return leg(wires, from || "full", s);
}

// The bird faces the way it flies, but only just: a vertical lane keeps the
// facing it already had. Bank and turn ease by real time (extra.now), so the
// motion is the same at any frame rate.
function place(play, cmds, t, px, extra) {
  const at = along(cmds, t, px);
  let left = Boolean(play.flip);
  if (at.vx < -0.8) left = true;
  else if (at.vx > 0.8) left = false;
  const gap = (extra.now ?? 0) - (play.last ?? extra.now ?? 0);
  const dt = Math.min(100, Math.max(0, gap));
  if (extra.now != null) play.last = extra.now;
  const side = left ? -1 : 1;
  // no bird was drawn for a while (it waited as a dot): the next one starts facing its way, not mid-turn
  if (gap > 250) { play.bank = null; play.turn = null; }
  if (play.bank == null) play.bank = at.aim;
  else play.bank += (at.aim - play.bank) * (1 - Math.exp(-dt / 180));
  if (play.turn == null) play.turn = side;
  else play.turn += (side - play.turn) * (1 - Math.exp(-dt / 70));
  play.flip = left;
  let intro = 0;
  if (extra.spawn) {
    const u = Math.min(1, Math.max(0, (extra.elapsed || 0) / 300));
    intro = (1 - u) * (1 - u);
  }
  return {
    x: at.x, y: at.y,
    face: left ? "left" : "right",
    turn: play.turn,
    bank: play.bank,
    away: extra.away || 0,
    intro,
    opacity: (extra.opacity ?? 1) * (1 - intro),
  };
}

function flyScene(play, cmds, t, dot, elapsed, px, spawn) {
  const bird = place(play, cmds, t, px, { spawn, elapsed, now: play.t0 + elapsed });
  return {
    moving: true, phase: "fly",
    bird,
    dot: { x: bird.x, y: bird.y, kind: dot, opacity: 1 },
    flowAgent: false, flowSeat: null, litSeat: null,
  };
}

// Plays one request the way Magpie's Routing page does: a fixed flight
// (620 / 900 / 1400 ms, cosine ease), the bird lets go, the dot waits on
// the account until the route finishes, then another bird brings the
// answer back. Not tied to how long the request has already been running.
export function advance(play, route, now, px = PX, map) {
  const m = map || rowMap(route, (route?.order || []).map(seatKey));
  const wires = wiresOf(m.rows, px);
  const row = (i) => Math.min(Math.max(0, m.of(i)), wires.seats.length - 1);
  if (!route) return { play: null, scene: restScene(null) };
  if (!play || play.id !== route.id) {
    if (route.done) return { play: { id: route.id, phase: "rest", t0: now, seen: now }, scene: restScene(route, row) };
    play = { id: route.id, phase: (route.tries || []).length ? "to-seat" : "to-hub", t0: now, from: "full", seat: 0, err: false };
  }
  const open = (route.tries || []).findIndex((tr) => !tr.done);
  const finish = (phase, extra) => {
    play.phase = phase;
    play.t0 = now;
    Object.assign(play, extra || {});
    return true;
  };

  for (let hop = 0; hop < 6; hop++) {
    const elapsed = now - play.t0;
    if (play.phase === "to-hub") {
      if (elapsed >= 620) {
        if ((route.tries || []).length) finish("to-seat", { from: "edge", seat: open < 0 ? 0 : open });
        else finish("wait-hub");
        continue;
      }
      const scene = flyScene(play, wires.agentHub, elapsed / 620, "fill", elapsed, px, true);
      scene.flowAgent = true;
      scene.phase = "to-hub";
      return { play, scene };
    }
    if (play.phase === "wait-hub") {
      if ((route.tries || []).length) { finish("to-seat", { from: "edge", seat: open < 0 ? 0 : open }); continue; }
      if (route.done) { finish("rest"); continue; }
      const bird = place(play, wires.agentHub, 1, px, { now });
      return {
        play,
        scene: {
          moving: true, phase: "wait-hub",
          bird,
          dot: { x: bird.x, y: bird.y, kind: "fill", opacity: heldOpacity(now) },
          flowAgent: true, flowSeat: null, litSeat: null,
        },
      };
    }
    if (play.phase === "to-seat") {
      const from = play.from || "full";
      const ms = from === "full" ? 1400 : 900;
      if (elapsed >= ms) { finish("away"); continue; }
      const scene = flyScene(play, leg(wires, from, row(play.seat)), elapsed / ms, "fill", elapsed, px, from !== "edge");
      scene.flowAgent = from === "full";
      scene.flowSeat = row(play.seat);
      scene.phase = "to-seat";
      return { play, scene };
    }
    if (play.phase === "away") {
      if (elapsed >= 450) { finish("hold"); continue; }
      const k = glide(elapsed / 450);
      const cmds = wires.seats[row(play.seat)];
      const bird = place(play, cmds, 1, px, { away: k, opacity: 1 - k, now });
      const at = along(cmds, 1, px);
      return {
        play,
        scene: {
          moving: true, phase: "away",
          bird,
          dot: { x: at.x, y: at.y, kind: "held", opacity: 1 },
          flowAgent: false, flowSeat: row(play.seat), litSeat: row(play.seat),
        },
      };
    }
    if (play.phase === "hold") {
      const tr = (route.tries || [])[play.seat];
      const next = open > play.seat ? open : (route.tries || []).length - 1;
      if (tryBad(tr) && !route.done && next > play.seat) { finish("back-hub", { err: true }); continue; }
      if (route.done) { finish("back", { err: !tryOk(tr) }); continue; }
      const at = along(wires.seats[row(play.seat)], 1, px);
      return {
        play,
        scene: {
          moving: true, phase: "hold", bird: null,
          dot: { x: at.x, y: at.y, kind: "held", opacity: heldOpacity(now) },
          flowAgent: false, flowSeat: row(play.seat), litSeat: row(play.seat),
        },
      };
    }
    if (play.phase === "back-hub") {
      if (elapsed >= 620) { finish("to-seat", { from: "lane", seat: open < 0 ? play.seat + 1 : open, err: false }); continue; }
      const scene = flyScene(play, reversed(wires.seats[row(play.seat)], px), elapsed / 620, "err", elapsed, px, true);
      scene.flowSeat = row(play.seat);
      scene.phase = "back-hub";
      return { play, scene };
    }
    if (play.phase === "back") {
      if (elapsed >= 1400) { finish("rest"); continue; }
      const scene = flyScene(play, reversed(leg(wires, "full", row(play.seat)), px), elapsed / 1400, play.err ? "err" : "ring", elapsed, px, true);
      scene.flowAgent = true;
      scene.flowSeat = row(play.seat);
      scene.phase = "back";
      return { play, scene };
    }
    return { play, scene: restScene(route, row) };
  }
  return { play, scene: restScene(route, row) };
}

// Magpie draws the flier at 1.2× with the beak just behind the packet, banks
// it, and beats the wings from the shoulder (scaleY to -0.62, a little skew).
const FAR_WING = [
  ["M", -14.5, -3.4],
  ["C", -16.5, -9.5, -14.2, -15, -8.6, -18.6],
  ["C", -9.4, -12.6, -9.6, -7.4, -9.2, -3.2],
  ["Z"],
];
const NEAR_WING = [
  ["M", -15.6, -3.2],
  ["C", -17.8, -10.2, -15.2, -16.4, -8.4, -20.4],
  ["C", -9.3, -13.6, -9.4, -7.8, -8.8, -2.8],
  ["Z"],
];
const WING_BAR = [
  ["M", -14.6, -5.6],
  ["C", -15.4, -10.4, -13.8, -14.4, -10.4, -17.2],
];
const TAIL = [
  ["M", -31.5, 3.1], ["L", -18.6, -1.8], ["L", -17.4, 1.2], ["L", -30.8, 4.6], ["Z"],
];
const BEAK = [
  ["M", -2.3, -4.8], ["L", 1.4, -3.3], ["L", -2.3, -2.2], ["Z"],
];

function ellipse(cx, cy, rx, ry) {
  const k = 0.551784;
  return [
    ["M", cx + rx, cy],
    ["C", cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry],
    ["C", cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy],
    ["C", cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry],
    ["C", cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy],
    ["Z"],
  ];
}

function flapOf(now, delay) {
  const u = (((now + delay) % 420) + 420) % 420 / 420;
  if (u < 0.55) return 1 - (1 - u / 0.55) ** 0.45;
  return ((1 - u) / 0.45) ** 1.35;
}

function flapPoint(x, y, origin, f) {
  const scaleY = 1 - 1.62 * f;
  const skew = Math.tan(-8 * Math.PI / 180) * f;
  let dx = x - origin[0], dy = y - origin[1];
  dx += dy * skew;
  dy *= scaleY;
  return [dx + origin[0], dy + origin[1]];
}

function toScreen(x, y, bird) {
  const intro = bird.intro || 0;
  const born = 1 - 0.15 * intro;
  let X = 1.2 * (x - 6.5) * born - 6 * intro;
  let Y = 1.2 * (y + 3.2) * born - 10 * intro;
  const away = bird.away || 0;
  const s = 1 - 0.2 * away;
  X = X * s + 14 * away;
  Y = Y * s - 16 * away;
  const th = (bird.bank || 0) * Math.PI / 180;
  const c = Math.cos(th), sn = Math.sin(th);
  let xr = X * c - Y * sn;
  const yr = X * sn + Y * c;
  xr *= bird.turn ?? (bird.face === "left" ? -1 : 1);
  return [xr, yr];
}

function mapCmds(cmds, bird, origin, f) {
  return cmds.map((cmd) => {
    if (cmd[0] === "Z") return ["Z"];
    const out = [cmd[0]];
    for (let i = 1; i < cmd.length; i += 2) {
      let x = cmd[i], y = cmd[i + 1];
      if (origin) [x, y] = flapPoint(x, y, origin, f);
      const p = toScreen(x, y, bird);
      out.push(p[0], p[1]);
    }
    return out;
  });
}

export function beakOffset(bird) {
  return toScreen(1.4, -3.3, bird || { face: "right", bank: 0 });
}

export function flierParts(bird, now) {
  const far = flapOf(now, 30), near = flapOf(now, 0);
  return [
    { cmds: mapCmds(FAR_WING, bird, [-12.55, -3.2], far), opacity: 0.45 },
    { cmds: mapCmds(TAIL, bird) },
    { cmds: mapCmds(ellipse(-12.2, -1.4, 7.6, 3.9), bird) },
    { cmds: mapCmds(ellipse(-12.8, 0.4, 4.3, 1.6), bird), belly: true },
    { cmds: mapCmds(ellipse(-4.9, -3.7, 3.1, 3.1), bird) },
    { cmds: mapCmds(BEAK, bird) },
    { cmds: mapCmds(NEAR_WING, bird, [-13.1, -2.8], near) },
    { cmds: mapCmds(WING_BAR, bird, [-13.1, -2.8], near), stroke: 1.6, belly: true },
  ];
}

export function feed(history, live) {
  const byId = new Map();
  for (const route of history || []) if (route && route.id != null) byId.set(route.id, route);
  for (const route of live?.values?.() || []) if (route && route.id != null) byId.set(route.id, route);
  return [...byId.values()].sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, 40);
}

export function requestLine(route) {
  const ask = shortModel(route.model);
  const served = shortModel(route.served);
  const where = (route.order || [])[0]?.name || route.provider || "";
  const bad = Boolean(route.done && ((route.status || 0) >= 400 || route.error));
  const wait = !route.done;
  return {
    agent: route.agent || "agent",
    ask,
    where,
    served: served && served !== ask ? served : "",
    at: clock(route.time),
    meta: route.done ? `${route.status || ""}${route.ms ? ` · ${secs(route.ms)}` : ""}`.trim() : "in flight",
    bad,
    wait,
  };
}

export const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);

// One line per request in flight: who, where it is, how long. The clock runs
// from the route's own start, so it ticks between the gateway's updates.
export function flightLine(route, now) {
  const at = Date.parse(route.time);
  const tries = route.tries || [];
  const open = tries.find((t) => !t.done);
  const last = tries[tries.length - 1];
  let state = "routing";
  if (open) state = `asking ${shortModel(open.model)}`;
  else if (last) state = tryOk(last) ? "streaming" : "retrying";
  return { agent: route.agent || "agent", state, wait: Number.isNaN(at) ? "" : secs(Math.round(Math.max(0, now - at) / 100) * 100) };
}

// Which Herdr terminal sent this request. Magpie records the folder as a short
// label ("deepseek-harness/mod-magpie"), so it is matched as a path tail. With
// several agents in one folder the one that is working wins.
const RANK = { working: 0, blocked: 1, done: 2, idle: 3 };
export function matchPane(folder, panes, spaces) {
  if (!folder) return null;
  const hits = (panes || []).filter((p) => p.terminal && p.cwd && (p.cwd === folder || p.cwd.endsWith(`/${folder}`)));
  if (!hits.length) return null;
  const rank = (p) => RANK[p.status] ?? 4;
  const hit = hits.reduce((a, b) => (rank(b) < rank(a) ? b : a));
  const space = (spaces || []).find((s) => (s.tabs || []).some((t) => t.id === hit.tab));
  return { terminal: hit.terminal, space: space?.name || "", status: hit.status };
}

// A scripted afternoon for the Demo switch: three agents, five requests, one
// of them failing over twice. It is the shape the gateway sends, as a function
// of time, so the panel can be seen (and tested) with several routes at once.
export const DEMO_CYCLE = 15000;
const SEAT = {
  a: { id: "ccp", name: "Command Code Plan", provider: "commandcode-plan", model: "deepseek/deepseek-v4.1-flash" },
  b: { id: "mistral", name: "Mistral", provider: "mistral", model: "mistral-large" },
  c: { id: "openrouter", name: "OpenRouter", provider: "openrouter", model: "deepseek/deepseek-v4.1" },
};
// seats in the order magpie weighed them; tries are [seat, start, duration, status]
const DEMO = [
  { at: 0, agent: "cindy", folder: "deepseek-harness/mod-magpie", seats: "ab", tries: [["a", 250, 3300, 200]] },
  { at: 900, agent: "atlas", folder: "Paginas-web/agent-more", seats: "ba", tries: [["b", 1100, 4200, 200]] },
  { at: 1800, agent: "nova", folder: "deepseek-harness/curl-brew", seats: "abc", tries: [["a", 2000, 900, 429], ["b", 2900, 1500, 503], ["c", 4400, 3000, 200]] },
  { at: 6000, agent: "cindy", folder: "deepseek-harness/mod-magpie", seats: "c", tries: [["c", 6200, 2200, 200]] },
  { at: 7000, agent: "atlas", folder: "Paginas-web/agent-more", seats: "ab", tries: [["a", 7200, 5000, 200]] },
];

function demoRoute(spec, local, origin) {
  const iso = (ms) => new Date(origin + ms).toISOString();
  const order = [...spec.seats].map((k) => ({ ...SEAT[k], kind: "account", routing: "pace", fallback: null }));
  const tries = spec.tries.filter(([, from]) => local >= from).map(([k, from, dur, status]) => {
    const done = local >= from + dur;
    return { id: SEAT[k].id, model: SEAT[k].model, start: iso(from), done, status: done ? status : 0, ms: done ? dur : null, served: done && status < 300 ? SEAT[k].model : undefined };
  });
  const [lk, lf, ld, ls] = spec.tries[spec.tries.length - 1];
  const done = local >= lf + ld + 250;
  const first = SEAT[spec.tries[0][0]];
  return {
    id: origin + spec.at, time: iso(spec.at), agent: spec.agent, folder: spec.folder,
    model: `${first.provider}/${first.model}`, provider: first.provider, order, tries,
    done, status: done ? ls : 0, ms: done ? lf + ld + 250 - spec.at : undefined,
    served: done ? SEAT[lk].model : undefined, out: done ? 128 : 0, ttft: done ? 900 : undefined,
  };
}

// start is the wall clock of elapsed 0. The cycle before this one is kept, so
// the request list does not empty every 15 seconds.
export function demoRoutes(elapsed, start) {
  const out = [];
  const c = Math.floor(elapsed / DEMO_CYCLE);
  for (const cycle of [c - 1, c]) {
    if (cycle < 0) continue;
    const local = elapsed - cycle * DEMO_CYCLE;
    for (const spec of DEMO) if (local >= spec.at) out.push(demoRoute(spec, local, start + cycle * DEMO_CYCLE));
  }
  return out;
}

// One frame of the whole stage. state is {plays: Map<id, play>, keys: [], played: Set<id>}
// and is updated in place. A request flies once; deleting its id from played
// makes it fly again. Every request in flight gets its own bird (newest
// MAX_FLIGHTS of them); the request on screen is played once when it is
// already done. Returns the stage rows and one entry per thing to draw.
export const MAX_FLIGHTS = 4;
const STAGGER = 120;

export function frame(state, list, focus, now, px) {
  const byId = new Map(list.map((r) => [r.id, r]));
  const starts = list.filter((r) => !r.done && !state.plays.has(r.id)).slice(0, Math.max(0, MAX_FLIGHTS - state.plays.size));
  for (const r of starts) { state.plays.set(r.id, null); state.played.add(r.id); }
  if (focus?.done && !state.plays.has(focus.id) && !state.played.has(focus.id)) {
    state.plays.set(focus.id, { id: focus.id, phase: "to-seat", t0: now, from: "full", seat: 0, err: false });
    state.played.add(focus.id);
  }
  if (state.played.size > 200) state.played.delete(state.played.values().next().value);
  const flying = [...state.plays.keys()].map((id) => byId.get(id)).filter(Boolean);
  const rows = stageRows(state.plays.size ? state.keys : [], [focus, ...flying, ...list.filter((r) => !r.done)].filter(Boolean));
  state.keys = rows.keys;
  const entries = [];
  let born = 0;
  for (const [id, play] of [...state.plays]) {
    const route = byId.get(id);
    if (!route) { state.plays.delete(id); continue; }
    const map = rowMap(route, rows.keys);
    const next = advance(play, route, now, px, map);
    // birds that appear in the same frame leave a beat apart, not as one clump
    if (!play) next.play.t0 = now + STAGGER * born++;
    if (next.play.phase === "rest") { state.plays.delete(id); continue; }
    state.plays.set(id, next.play);
    entries.push({ route, play: next.play, scene: next.scene, map });
  }
  if (focus?.done && !entries.some((e) => e.route.id === focus.id)) {
    const map = rowMap(focus, rows.keys);
    entries.push({ route: focus, play: null, scene: advance(null, focus, now, px, map).scene, map });
  }
  return { rows, entries };
}
