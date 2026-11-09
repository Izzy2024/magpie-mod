// Routing, live, in the side panel. Magpie's window is a Wails webview Herdr
// cannot host, so this draws the same stage from the gateway's own trace
// (GET /v1/magpie/trace — what a second magpie reads) and today's jsonl.
// Every request in flight is its own bird, in its agent's color, on one shared
// stage whose rows are the accounts, so several agents can be watched at once.
import { View, div, svg, PathBuilder } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { exec, home, theme, layout, watchFolder, panes, spaces, run } from "herdr";
import { demoRoutes, feed, flierParts, flightLine, flowDash, frame, headline, localDay, maskName, matchPane, modeOf, parseJsonl, plural, requestLine, ridersOf, seatKey, seatView, shortModel, stageRows, stepsOf, why, wiresOf } from "./logic.js";

const FLYING = new Set(["to-hub", "to-seat", "back", "back-hub", "away"]);
const IDLE_HINT = "Send one from any agent routed through magpie and it plays here as it happens.";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

function showing() {
  const lay = layout();
  const panel = find(lay, "panel"), body = find(lay, "panel-body");
  return Boolean(panel && !panel.hidden && body?.active === "routing");
}

async function discover() {
  let text = "";
  try { text = (await exec("sh", ["-c", "lsof -nP -c magpie -a -iTCP -sTCP:LISTEN 2>/dev/null || true"])).stdout || ""; }
  catch { text = ""; }
  const ports = [...new Set([...String(text).matchAll(/:(\d+)/g)].map((m) => m[1]))];
  if (!ports.includes("3425")) ports.unshift("3425");
  for (const port of ports) {
    try {
      const r = await exec("curl", ["-fsS", "--max-time", "2", `http://127.0.0.1:${port}/`]);
      const body = JSON.parse(r.stdout || "");
      if (body?.name === "magpie" && Array.isArray(body.apis)) return port;
    } catch { /* that listener is not the gateway */ }
  }
  return null;
}

// The Routing panel that both layers read. A bird moves 60 times a second;
// the cards, the text and the log do not. Flight is the part that moves (dashed
// wires, birds, packets) and is redrawn every frame; Stage is everything else
// on the card and is redrawn when what it shows changes, or 4 times a second
// for the clocks. Only the data changes reach the panel itself.
let owner = null;

class Flight extends View {
  init(_props, cx) {
    // every tick while a bird flies, every other one at the hub, once when a dot settles on its account
    cx.timer.every(16, (cx) => {
      if (owner?.syncScene() && owner.shown) { owner.flown = owner.sig; cx.notify(); }
    });
  }

  render() {
    return owner ? owner.overlay(theme()) : div();
  }
}

class Stage extends View {
  init(_props, cx) {
    this.seen = "";
    this.at = 0;
    cx.timer.every(50, (cx) => {
      if (!owner?.shown) return;
      const key = `${owner.version}|${owner.sig}`;
      const tick = owner.busy && owner.now - this.at >= 250;
      if (key === this.seen && !tick) return;
      this.seen = key;
      this.at = owner.now;
      cx.notify();
    });
  }

  render() {
    return owner ? owner.stageCard(theme()) : div();
  }
}

export default class Routing extends View {
  init(_props, cx) {
    owner = this;
    this.live = new Map();
    this.history = [];
    this.today = 0;
    this.seq = 0;
    this.totals = { requests: 0, rerouted: 0, errors: 0 };
    this.gateway = null;
    this.port = null;
    this.offline = "";
    this.pin = null;
    this.mask = false;
    this.demo = null;
    this.now = Date.now();
    this.px = 368;
    this.shown = false;
    this.laidAt = 0;
    this.parked = true;
    this.drew = 0;
    this.version = 0;
    this.listAt = -1;
    this.listOf = [];
    this.st = { plays: new Map(), keys: [], played: new Set() };
    this.rows = { keys: [], more: 0, seats: new Map() };
    this.entries = [];
    this.sig = "";
    this.flown = "";
    this.busy = false;
    this.focusId = null;
    this.demoShape = "";
    this.tones = new Map();
    this.where = new Map();
    this.whereAt = 0;
    this.focus = cx.focus_handle();
    cx.spawn((cx) => this.trace(cx));
    cx.spawn((cx) => this.watch(cx));
    this.flightView = cx.new(Flight);
    this.stageView = cx.new(Stage);
    // the in-flight clocks in the strip and the log tick here, five times a second
    cx.timer.every(200, (cx) => {
      if (this.shown && !(this.offline && !this.demo) && this.list().some((r) => !r.done)) cx.notify();
    });
  }

  bump() { this.version++; }

  // The feed is sorted and merged once per change, not once per row per frame.
  list() {
    if (this.listAt !== this.version) {
      this.listAt = this.version;
      this.listOf = feed(this.demo ? [] : this.history, this.live);
    }
    return this.listOf;
  }

  current(list = this.list()) {
    const pinned = this.pin != null && list.find((r) => r.id === this.pin);
    return pinned || list.find((r) => !r.done) || list[0] || null;
  }

  // The flights run on their own clock, like Magpie's frame loop: a request
  // already in flight still flies its path, then the dot waits until the try
  // actually finishes. Hidden, nothing advances. True when a frame is due.
  syncScene() {
    const now = Date.now();
    // layout() hands over the whole window tree: where the panel is changes slowly, so read it 4 times a second
    if (now - this.laidAt >= 250) {
      this.laidAt = now;
      const lay = layout();
      const panel = find(lay, "panel"), body = find(lay, "panel-body");
      this.shown = Boolean(panel && !panel.hidden && body?.active === "routing");
      this.px = Math.max(240, (Number(panel?.size?.px) || 420) - 52);
    }
    const stale = this.offline && !this.demo;
    if (!this.shown || stale) {
      this.parked = true;
      if (stale) this.entries = [];
      return false;
    }
    this.now = now;
    if (this.parked) { this.parked = false; this.st.plays.clear(); }
    if (this.demo) {
      const routes = demoRoutes(now - this.demo, this.demo);
      const shape = routes.map((r) => `${r.id}.${r.done ? 1 : 0}.${r.tries.map((x) => (x.done ? 1 : 0)).join("")}`).join("|");
      this.live = new Map(routes.map((r) => [r.id, r]));
      if (shape !== this.demoShape) { this.demoShape = shape; this.bump(); }
    }
    const list = this.list();
    const focus = this.current(list);
    const out = frame(this.st, list, focus, now, this.px);
    this.rows = out.rows;
    this.entries = out.entries;
    this.focusId = focus?.id ?? null;
    this.busy = list.some((r) => !r.done);
    // what the Stage layer shows depends on this, not on the bird's position
    this.sig = out.entries.map((e) => `${e.route.id}.${e.scene.phase}.${e.scene.flowSeat}.${e.scene.litSeat}.${e.scene.flowAgent ? 1 : 0}.${e.scene.dot?.kind === "held" ? 1 : 0}`).join("|") + `#${out.rows.keys.join(",")}`;
    let waiting = false, flying = false;
    for (const e of out.entries) {
      if (e.scene.phase === "wait-hub") waiting = true;
      if (FLYING.has(e.scene.phase)) flying = true;
    }
    // a hold costs no frames: one when the scene changes (so no stale bird stays up), then the renderer pulses the dot
    if (flying || this.sig !== this.flown) return true;
    if (!waiting || now - this.drew < 33) return false;
    this.drew = now;
    return true;
  }

  pick(id, cx) {
    if (id == null) return;
    this.pin = id;
    // choosing a finished request shows its journey again
    if (this.list().find((r) => r.id === id)?.done) { this.st.played.delete(id); this.st.plays.delete(id); }
    this.bump();
    this.syncScene();
    cx.notify();
  }

  follow(cx) {
    this.pin = null;
    this.bump();
    this.syncScene();
    cx.notify();
  }

  toggleMask(cx) {
    this.mask = !this.mask;
    this.bump();
    cx.notify();
  }

  toggleDemo(cx) {
    this.demo = this.demo ? null : Date.now();
    this.pin = null;
    this.live = new Map();
    this.demoShape = "";
    this.seq = 0;
    this.st.plays.clear();
    this.st.played.clear();
    this.bump();
    this.syncScene();
    cx.notify();
  }

  onKey(e, cx) {
    if (e.keystroke.includes("-")) return;
    const list = this.list();
    const at = list.findIndex((r) => r.id === this.current(list)?.id);
    const k = e.key;
    if (k === "down" || k === "j") this.pick(list[Math.min(list.length - 1, at + 1)]?.id, cx);
    else if (k === "up" || k === "k") this.pick(list[Math.max(0, at - 1)]?.id, cx);
    else if (k === "escape") this.follow(cx);
    else if (k === "r") this.pick(list[at]?.id, cx);
    else if (k === "m") this.toggleMask(cx);
    else if (k === "d") this.toggleDemo(cx);
  }

  async loadHistory() {
    const path = `${home()}/.config/magpie/routing/${localDay()}.jsonl`;
    let r;
    try { r = await exec("tail", ["-n", "50", path]); }
    catch { this.history = []; this.today = 0; this.bump(); return; }
    this.history = r.code === 0 ? parseJsonl(r.stdout) : [];
    // the list shows the last 50; "today" is the whole day
    try { this.today = parseInt((await exec("wc", ["-l", path])).stdout, 10) || this.history.length; }
    catch { this.today = this.history.length; }
    this.bump();
  }

  async watch(cx) {
    const dir = `${home()}/.config/magpie/routing`;
    await this.loadHistory();
    cx.notify();
    for (;;) {
      try { await watchFolder(dir); }
      catch { await exec("sleep", ["5"]); continue; }
      await this.loadHistory();
      cx.notify();
    }
  }

  async trace(cx) {
    for (;;) {
      let failed = null;
      try { await this.pull(); }
      catch (e) { failed = e; }
      if (failed) {
        this.offline = /isn't running|magpie/i.test(String(failed)) ? "Magpie isn't running, so nothing is routed." : "The gateway didn't answer. It retries.";
        this.port = null;
      }
      this.bump();
      cx.notify();
      if (!showing() || failed) await exec("sleep", [failed ? "3" : "2"]);
    }
  }

  async pull() {
    if (!this.port) this.port = await discover();
    if (!this.port) throw new Error("Magpie isn't running");
    const wait = showing();
    const r = await exec("curl", ["-fsS", "--max-time", wait ? "26" : "3", `http://127.0.0.1:${this.port}/v1/magpie/trace?after=${this.seq}${wait ? "&wait=1" : ""}`], { timeout: wait ? 32000 : 8000 });
    if (r.code !== 0) throw new Error(r.stderr || "gateway");
    const body = JSON.parse(r.stdout || "");
    if (body.object !== "trace" || !Array.isArray(body.routes)) throw new Error("not a magpie trace");
    if (this.demo) return; // the demo owns the stage
    if (body.seq < this.seq) { this.live.clear(); this.seq = 0; }
    this.seq = body.seq;
    this.totals = body.totals || this.totals;
    this.gateway = { pid: body.pid, serves: body.serves };
    for (const route of body.routes) this.live.set(route.id, route);
    if (Array.isArray(body.ids)) {
      const keep = new Set(body.ids);
      for (const [id, route] of this.live) if (!route.done && !keep.has(id)) this.live.delete(id);
    }
    while (this.live.size > 60) this.live.delete(this.live.keys().next().value);
    this.offline = "";
    this.bump();
  }

  // Each agent keeps one color for as long as the panel is open.
  tone(t, agent) {
    const k = agent || "agent";
    if (!this.tones.has(k)) this.tones.set(k, this.tones.size);
    return [t.ansi4, t.ansi5, t.ansi6, t.ansi3][this.tones.get(k) % 4];
  }

  // The Herdr terminal behind a request, looked up once a second per folder.
  herdr(route) {
    const sec = Math.floor(this.now / 1000);
    if (this.whereAt !== sec) { this.whereAt = sec; this.where.clear(); }
    const k = route?.folder || "";
    if (!this.where.has(k)) this.where.set(k, matchPane(route?.folder, panes(), spaces()));
    return this.where.get(k);
  }

  render() {
    const t = theme();
    const list = this.list();
    const route = this.current(list);
    const inflight = list.filter((r) => !r.done);
    const away = this.pin != null && route?.done ? inflight.length : 0; // watching an old one while others fly
    const stale = Boolean(this.offline) && !this.demo;
    return v_flex().id("routing").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .track_focus(this.focus)
      .on_mouse_down("left", () => this.focus.focus())
      .on_key_down((e, cx) => this.onKey(e, cx))
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Routing"))
        .child(this.pulse(t, inflight.length > 0 && !stale))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(stale ? "offline" : inflight.length ? `${inflight.length} in flight` : this.demo ? "demo" : "live, as the gateway decides"))
        .child(this.action(t, "routing-demo", this.demo ? "Stop demo" : "Demo", Boolean(this.demo), (cx) => this.toggleDemo(cx)))
        .child(this.action(t, "routing-mask", this.mask ? "Show names" : "Hide names", this.mask, (cx) => this.toggleMask(cx))))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("routing-scroll").absolute().inset_0().overflow_y_scroll().px(10).py(10).gap(8)
          .when(stale && list.length > 0, (el) => el.child(div().px(10).py(6).rounded(8).bg(t.raised).text_size(12).text_color(t.muted).child(`${this.offline} Showing the last requests; checking again every few seconds.`)))
          .when(inflight.length > 1 || away > 0, (el) => el.child(this.strip(t, inflight, route?.id)))
          .child(stale && !list.length ? this.empty(t, this.offline) : this.stageView)
          .child(this.stats(t))
          .child(this.log(t, list, route)))
        .child(Scrollbar.vertical("routing-scroll").absolute().inset_0()));
  }

  action(t, id, label, on, fn) {
    return div().id(id).text_size(11).text_color(on ? t.foreground : t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => fn(cx))
      .child(label);
  }

  // A halo that breathes while anything is in flight, run by the renderer: no frames from here.
  pulse(t, on) {
    return div().relative().size(10).flex_none()
      .when(on, (el) => el.child(div().id("routing-halo").absolute().left(-5).top(-5).size(20).rounded_full().bg(t.ansi2).opacity(0.3).loop("opacity", { from: 0, to: 0.3, period: 1400 })))
      .child(div().absolute().left(2).top(2).size(6).rounded_full().bg(on ? t.ansi2 : t.dim));
  }

  empty(t, text) {
    return v_flex().gap(6).px(8).py(16)
      .child(div().font_semibold().child("Waiting for a request"))
      .child(div().text_size(12).text_color(t.muted).child(text || IDLE_HINT));
  }

  // Everything in flight, with its own clock. Click one to watch it.
  strip(t, inflight, focusId) {
    return v_flex().gap(2).p(6).rounded(12).border_1().border_color(t.border).bg(t.surface || t.raised)
      .child(div().px(4).pb(2).text_size(11).font_semibold().text_color(t.muted).child(`In flight · ${inflight.length}`))
      .children(inflight.map((r) => {
        const f = flightLine(r, this.now), at = this.herdr(r);
        return h_flex().id(`fly-${r.id}`).relative().gap(8).items_center().px(6).py(5).rounded(8).cursor_pointer().bg(t.background).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.pick(r.id, cx))
          .child(div().id(`sel-fly-${r.id}`).absolute().inset_0().rounded(8).bg(t.selected).opacity(r.id === focusId ? 1 : 0).transition("opacity", 150))
          .child(div().relative().size(8).rounded_full().flex_none().bg(this.tone(t, r.agent)))
          .child(v_flex().relative().flex_1().min_w(0)
            .child(div().text_size(12).font_semibold().truncate().child(at?.space ? `${f.agent} · ${at.space}` : f.agent))
            .child(div().text_size(11).text_color(t.muted).truncate().child(f.state)))
          .child(div().relative().text_size(12).text_color(t.muted).child(f.wait));
      }));
  }

  stageCard(t) {
    const list = this.list();
    const route = this.current(list);
    const inflight = list.filter((r) => !r.done);
    const rows = this.rows.keys.length || !route ? this.rows : stageRows([], [route]);
    const stale = Boolean(this.offline) && !this.demo;
    const orders = rows.keys.map((k) => rows.seats.get(k));
    const drawn = wiresOf(Math.max(1, orders.length), this.px);
    const box = drawn.box;
    const entries = this.entries;
    const head = headline(route);
    const [chip] = modeOf((route?.order || []).find((x) => !x.fallback)?.routing || route?.order?.[0]?.routing || "");
    const lone = (route?.order || []).filter((x) => !x.fallback).length <= 1 && !route?.group;
    const hubSub = inflight.length > 1 ? `${inflight.length} in flight · ${this.port || "demo"}` : this.gateway ? `${this.gateway.serves || "app"} · ${this.port}` : (this.port ? `127.0.0.1:${this.port}` : "gateway");
    const wires = drawn.base.map((cmds) => this.wire(cmds, t.border, 1));
    entries.forEach((e) => {
      const s = e.scene, color = this.tone(t, e.route.agent);
      if (!s.flowAgent && s.litSeat != null) wires.push(this.wire(drawn.agentHub, color, 1.5));
      if ((s.flowSeat == null || s.phase === "hold") && drawn.seats[s.litSeat]) wires.push(this.wire(drawn.seats[s.litSeat], color, 1.5));
    });
    const agents = [...new Set(inflight.map((r) => r.agent || "agent"))].slice(0, 4);
    const dots = (agents.length ? agents : [route?.agent || "agent"]).map((a) => this.tone(t, a));
    const at = route ? this.herdr(route) : null;
    const busy = entries.some((e) => e.scene.phase === "to-hub" || e.scene.phase === "wait-hub");
    const stageKids = [
      ...wires,
      this.node(t, `${box.agent.x}%`, box.agent.w, box.agent.top, route?.agent || "your agent", at?.space || shortModel(route?.model) || "agent", dots, at),
      this.hub(t, `${box.hub.x}%`, box.hub.w, box.hub.top, hubSub, !lone && route ? chip : "", busy),
      v_flex().absolute().left(`${box.account(0).x}%`).top(box.accountsTop).w(`${box.account(0).w}%`).gap(box.rowGap).children(orders.length ? [
        ...orders.map((seat, i) => this.account(t, rows.keys[i], seat, i, route, inflight, entries)),
        ...(rows.more ? [div().h(18).px(10).text_size(11).text_color(t.muted).child(`+${rows.more} more ${plural(rows.more, "account")} on this request`)] : []),
      ] : [
        div().h(box.rowH).px(10).rounded(10).border_1().border_dashed().border_color(t.border).text_color(t.muted).text_size(12).flex().items_center().child(route ? "No account on this request" : "No request yet"),
      ]),
      this.flightView,
    ];
    return v_flex().gap(8).p(10).rounded(14).border_1().border_color(t.border).bg(t.surface || t.raised).opacity(stale ? 0.55 : 1)
      .child(v_flex().gap(2)
        .child(h_flex().gap(6).items_center().min_w(0)
          .child(div().font_semibold().truncate().child(this.mask ? maskName(head.name, true) : head.name))
          .child(div().text_size(12).text_color(t.muted).truncate().child(head.tail)))
        .child(div().text_size(12).text_color(t.muted).child(route ? why(route) : `${IDLE_HINT} Demo shows several at once.`)))
      .child(div().id("routing-stage").relative().w_full().h(box.h + (rows.more ? 22 : 0)).transition("height", { duration: 220, easing: "ease-out" }).children(stageKids))
      .when(Boolean(route), (el) => el.child(v_flex().gap(4).pt(8).border_t(1).border_color(t.border)
        .child(div().text_size(12).font_semibold().child(this.outcome(route)))
        .children(stepsOf(route).slice(1).map((step, i) => h_flex().id(`step-${i}`).gap(6).items_center()
          .child(div().size(6).rounded_full().flex_none().bg(step.kind === "ok" ? t.ansi2 : step.kind === "bad" ? t.ansi1 : step.kind === "wait" ? t.foreground : t.dim))
          .child(div().flex_1().min_w(0).text_size(12).text_color(step.kind === "why" ? t.foreground : t.muted).child(step.text))))));
  }

  // What moves: the dashed flow on a wire, the birds, the packets. Nothing here is
  // read by the layer underneath, so it is rebuilt every frame without it.
  overlay(t) {
    const drawn = wiresOf(Math.max(1, this.rows.keys.length), this.px);
    const kids = [];
    this.entries.forEach((e, n) => {
      const s = e.scene, color = this.tone(t, e.route.agent);
      const back = s.phase === "back" || s.phase === "back-hub";
      if (s.flowAgent) kids.push(this.wire(drawn.agentHub, color, 1.5, true, n * 230, back));
      if (s.flowSeat != null && s.phase !== "hold" && drawn.seats[s.flowSeat]) kids.push(this.wire(drawn.seats[s.flowSeat], color, 1.5, true, n * 230, back));
      if (s.bird) {
        const dim = e.route.id === this.focusId ? 1 : 0.7;
        flierParts(s.bird, this.now).forEach((part, i) => kids.push(this.flier(t, part, `${e.route.id}-${i}`, s.bird, this.px, color, dim)));
      }
      if (s.dot) kids.push(this.packet(t, s.dot, color, e.route.id, s.phase === "hold"));
    });
    return div().absolute().top(0).left(0).size_full().children(kids);
  }

  // One line on how it went; the tries below say which model and how long each took.
  outcome(route) {
    if (!route.done) return `In flight · ${flightLine(route, this.now).wait}`;
    if (requestLine(route).bad) return `Failed with ${route.status || "an error"}${route.error ? ` · ${route.error}` : ""}`;
    return route.ms ? `Answered in ${(route.ms / 1000).toFixed(route.ms < 10000 ? 1 : 0)}s` : "Answered";
  }

  wire(cmds, color, width, flow = false, shift = 0, back = false) {
    const pct = (n) => `${Math.round(n * 100) / 100}%`;
    let path = PathBuilder.stroke(width);
    if (flow) path = path.dash_array(flowDash(this.now + shift, back));
    for (const c of cmds) {
      if (c[0] === "M") path = path.move_to(pct(c[1]), c[2]);
      else if (c[0] === "L") path = path.line_to(pct(c[1]), c[2]);
      else if (c[0] === "C") path = path.cubic_bezier_to(pct(c[5]), c[6], pct(c[1]), c[2], pct(c[3]), c[4]);
      else if (c[0] === "Q") path = path.curve_to(pct(c[3]), c[4], pct(c[1]), c[2]);
    }
    return window.paint_path(path.build(), color).absolute().top(0).left(0).size_full();
  }

  flier(t, part, id, bird, px, color, dim) {
    const X = (x) => `${Math.round((bird.x + (x / px) * 100) * 100) / 100}%`;
    const Y = (y) => (bird.y || 0) + y;
    let path = part.stroke ? PathBuilder.stroke(part.stroke) : PathBuilder.fill();
    for (const c of part.cmds) {
      if (c[0] === "M") path = path.move_to(X(c[1]), Y(c[2]));
      else if (c[0] === "L") path = path.line_to(X(c[1]), Y(c[2]));
      else if (c[0] === "C") path = path.cubic_bezier_to(X(c[5]), Y(c[6]), X(c[1]), Y(c[2]), X(c[3]), Y(c[4]));
      else if (c[0] === "Z") path = path.close();
    }
    return window.paint_path(path.build(), part.belly ? t.background : color).id(`flier-${id}`).absolute().top(0).left(0).size_full()
      .opacity(dim * (bird.opacity ?? 1) * (part.opacity ?? 1));
  }

  packet(t, dot, color, id, pulse) {
    const ring = dot.kind === "ring";
    const err = dot.kind === "err";
    return div().id(`routing-packet-${id}`).absolute()
      .left(`${dot.x}%`).top(dot.y).ml(-5).mt(-5).size(10).rounded_full().opacity(pulse ? 1 : dot.opacity ?? 1)
      .when(pulse, (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1200 }))
      .border(ring || err ? 2 : 0).border_color(err ? t.ansi1 : color)
      .bg(ring ? t.background : color);
  }

  // The agent. When Herdr knows which terminal it is, the card says so and a click goes there.
  node(t, left, width, top, name, sub, dots, at) {
    return v_flex().id("routing-agent").absolute().left(left).top(top).w(`${width}%`).h(78).px(8).gap(2).items_center().justify_center().rounded(12).border_1().border_color(t.border).bg(t.background)
      .when(Boolean(at), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Go to its terminal").on_click(() => run("pane.focus", { terminal: at.terminal })))
      .child(h_flex().gap(3).children(dots.map((c) => div().size(7).rounded_full().bg(c))))
      .child(div().w_full().font_semibold().text_size(12).truncate().text_center().child(name))
      .child(div().w_full().text_size(11).text_color(at ? t.foreground : t.muted).truncate().text_center().child(sub));
  }

  hub(t, left, width, top, sub, chip, busy) {
    return v_flex().absolute().left(left).top(top).w(`${width}%`).h(78).px(8).gap(2).items_center().justify_center().rounded(12).border_1().border_color(t.foreground).bg(t.background).shadow_sm()
      .child(svg("mods/routing/bird.svg").size(22).text_color(t.foreground).opacity(busy ? 1 : 0.8))
      .child(div().font_semibold().text_size(12).child("magpie"))
      .child(div().w_full().text_size(10).text_color(t.muted).truncate().child(sub))
      .when(Boolean(chip), (el) => el.child(div().mt(4).px(6).rounded_full().bg(t.foreground).text_color(t.background).text_size(10).child(chip)));
  }

  // An account is a place several requests can be at once: the row says how
  // many, in their agents' colors. The row lights and dims by fading, not snapping.
  account(t, key, seat, index, route, inflight, entries) {
    const at = (route?.order || []).findIndex((s) => seatKey(s) === key);
    let view = at >= 0 ? seatView(route, seat, at) : { kind: "idle", label: modeOf(seat.routing)[0], model: shortModel(seat.model) };
    const riders = ridersOf(inflight, key);
    if (riders.length && view.kind !== "now") view = { ...view, kind: "now", label: riders.length > 1 ? `${riders.length} answering…` : "answering…" };
    else if (riders.length > 1) view = { ...view, label: `${riders.length} answering…` };
    const held = entries.find((e) => e.scene.flowSeat === index && e.scene.dot?.kind === "held");
    const on = view.kind === "on" || view.kind === "now" || Boolean(held);
    const bad = view.kind === "bad";
    const rest = view.kind === "rest";
    return h_flex().id(`acct-${key}`).relative().h(50).flex_none().px(8).gap(8).items_center().rounded(10).border_1().border_color(t.border).bg(t.background).opacity(rest ? 0.55 : 1)
      .when(rest, (el) => el.border_dashed())
      .child(div().id(`lit-${key}`).absolute().inset_0().rounded(10).border_1().border_color(bad ? t.ansi1 : t.foreground).opacity(on || bad ? 1 : 0).transition("opacity", { duration: 220, easing: "ease-out" }))
      .child(div().size(8).rounded_full().flex_none().border_1().border_color(bad ? t.ansi1 : on ? t.foreground : t.muted).bg(on ? t.foreground : bad ? t.ansi1 : t.background).id(`dot-${key}`).opacity(1).when(Boolean(held), (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1200 })))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().font_semibold().text_size(12).truncate().child(maskName(seat.name || seat.provider || "account", this.mask)))
        .child(div().text_size(11).text_color(t.muted).truncate().child(view.model)))
      .child(h_flex().gap(2).children(riders.slice(0, 4).map((r) => div().size(6).rounded_full().bg(this.tone(t, r.agent)))))
      .child(div().text_size(11).text_color(bad ? t.ansi1 : on ? t.foreground : t.muted).child(view.label));
  }

  stats(t) {
    const n = this.totals;
    const cells = [[plural(n.requests || 0, "request"), n.requests || 0], ["rerouted", n.rerouted || 0], [plural(n.errors || 0, "error"), n.errors || 0], ["today", this.today]];
    return v_flex().gap(2).px(4).py(2)
      .child(h_flex().gap(14).children(cells.map(([label, v]) => v_flex().gap(0)
        .child(div().text_size(18).font_semibold().child(String(v)))
        .child(div().text_size(11).text_color(t.muted).child(label)))))
      .child(div().text_size(11).text_color(t.muted).child("The first three count since this gateway started; today is the whole log."));
  }

  log(t, list, route) {
    return v_flex().gap(4)
      .child(h_flex().items_center().gap(8)
        .child(div().text_size(12).font_semibold().child("Requests"))
        .child(div().flex_1())
        .when(Boolean(this.pin), (el) => el.child(div().id("routing-live").text_size(11).text_color(t.accent).cursor_pointer().on_click((_e, cx) => this.follow(cx)).child("Back to live"))))
      .children(list.length ? list.map((r) => {
        const line = requestLine(r), at = this.herdr(r);
        const picked = route?.id === r.id;
        return v_flex().id(`req-${r.id}`).relative().px(8).py(6).gap(2).rounded(8).cursor_pointer().bg(t.background).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.pick(r.id, cx))
          .child(div().id(`sel-req-${r.id}`).absolute().inset_0().rounded(8).bg(t.selected).opacity(picked ? 1 : 0).transition("opacity", 150))
          .child(h_flex().relative().gap(6).items_center().min_w(0)
            .child(div().size(6).rounded_full().flex_none().bg(this.tone(t, r.agent)))
            .child(div().text_size(12).font_semibold().child(line.agent))
            .when(Boolean(at?.space), (el) => el.child(div().text_size(11).text_color(t.muted).truncate().child(at.space)))
            .child(div().px(5).rounded(5).bg(t.raised).text_size(11).text_color(t.muted).truncate().child(line.ask || "—"))
            .child(div().flex_1())
            .child(div().text_size(11).text_color(t.dim).child(line.at)))
          .child(h_flex().relative().gap(6).items_center().min_w(0)
            .child(div().text_size(11).text_color(line.bad ? t.ansi1 : t.muted).truncate().child(line.wait ? `→ ${flightLine(r, this.now).state}` : `→ ${this.mask ? maskName(line.where, true) : line.where}${line.served ? " · " + line.served : ""}`))
            .child(div().flex_1())
            .child(div().text_size(11).text_color(t.dim).child(line.wait ? flightLine(r, this.now).wait : line.meta)));
      }) : [div().px(8).py(8).text_size(12).text_color(t.muted).child("No request yet today.")]);
  }
}
