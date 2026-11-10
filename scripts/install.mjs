#!/usr/bin/env node
// Installs the Routing panel into Herdr.
// Shipped layouts and the shipped `tabs` mod are replaced on every start, so
// those are cloned first. A personal layout (one Herdr will not overwrite) is
// edited in place and stays on screen.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHIPPED = new Set(["main", "terminals", "win98"]);
const flags = new Set(process.argv.slice(2));
const dry = flags.has("--dry-run");
const removing = flags.has("--uninstall");

if (flags.has("--help") || flags.has("-h")) {
  console.log(`Usage: node scripts/install.mjs [--dry-run] [--uninstall]

Copy the Routing mod into Herdr and add its button after Changes.

  npx github:Izzy2024/magpie-mod

Herdr replaces its own main layout and tabs mod on every start, so those are
cloned to main-routing and tabs-routing first. A personal layout is edited
where it is and stays the one on screen. ctrl-shift-l switches layouts.

--dry-run    print what would change
--uninstall  remove the mod, the panel and the button; leave clones in place`);
  process.exit(0);
}

const home = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
const dest = join(home, "mods", "routing");
const notes = [];

function die(message) {
  console.error(message);
  process.exit(1);
}

function herdr(argv, { inherit = false } = {}) {
  try {
    if (inherit) return execFileSync("herdr-app", argv, { stdio: "inherit" });
    return execFileSync("herdr-app", argv, { encoding: "utf8" });
  } catch (error) {
    const detail = error.stderr?.toString?.() || error.message;
    die(`herdr-app ${argv.join(" ")} failed\n${detail}`);
  }
}

function layoutFile(name) {
  return join(home, "layouts", `${name}.json`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const hit = find(child, id);
    if (hit) return hit;
  }
  return null;
}

function statusLayout() {
  const out = herdr(["status"]);
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start < 0 || end < start) die(`herdr-app status was not JSON:\n${out}`);
  const status = JSON.parse(out.slice(start, end + 1));
  if (!status.layout) die("herdr-app status has no layout.");
  return status.layout;
}

// The enabled-panels line decides which buttons exist. Two shapes ship:
//   const enabled = shared("workspace.panels") ?? ["files", "changes"];
//   const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), "graph"];
function addRouting(line) {
  if (line.includes('"routing"') || line.includes("'routing'")) return line;
  const bare = /^(\s*const enabled = )shared\((["'])workspace\.panels\2\)\s*\?\?\s*\[[^\]]*\]\s*;\s*$/;
  if (bare.test(line)) {
    return line.replace(
      /shared\((["'])workspace\.panels\1\)\s*\?\?\s*\[[^\]]*\]/,
      '[...(shared("workspace.panels") ?? ["files", "changes"]), "routing"]',
    );
  }
  const spread = line.match(/^(\s*const enabled = )\[\.\.\.\(shared\((["'])workspace\.panels\2\)\s*\?\?\s*\[[^\]]*\]\)(.*)]\s*;\s*$/);
  if (!spread) return null;
  const extra = spread[3].trim();
  const items = extra ? `, "routing"${extra.startsWith(",") ? extra : `, ${extra}`}` : `, "routing"`;
  return `${spread[1]}[...(shared("workspace.panels") ?? ["files", "changes"])${items}];`;
}

function patchEnabled(src) {
  const lines = src.split("\n");
  const at = lines.findIndex((line) => line.includes("workspace.panels"));
  if (at < 0) return { ok: false, reason: "the tab bar has no workspace.panels list" };
  const next = addRouting(lines[at]);
  if (next == null) return { ok: false, reason: "could not edit the workspace.panels line" };
  const changed = next !== lines[at];
  lines[at] = next;
  return { ok: true, changed, src: lines.join("\n") };
}

function patchTabs(src) {
  const lines = src.split("\n");
  const hasButton = lines.some((line) => line.includes('panelButton("routing"') || line.includes("panelButton('routing'"));
  if (!hasButton) {
    const at = lines.findIndex((line) => line.includes('panelButton("changes"') || line.includes("panelButton('changes'"));
    if (at < 0) return { ok: false, reason: "the tab bar has no Changes button to put Routing after" };
    const indent = lines[at].match(/^\s*/)[0];
    lines.splice(at + 1, 0, `${indent}.when(enabled.includes("routing"), el => el.child(panelButton("routing", "Routing", "mods/routing/route.svg")))`);
  }
  const enabled = patchEnabled(lines.join("\n"));
  if (!enabled.ok) return enabled;
  return { ok: true, changed: enabled.changed || !hasButton, src: enabled.src };
}

function unpatchTabs(src) {
  const lines = src.split("\n").filter((line) => !(line.includes('panelButton("routing"') || line.includes("panelButton('routing'")));
  let changed = lines.length !== src.split("\n").length;
  const at = lines.findIndex((line) => line.includes("workspace.panels"));
  if (at >= 0 && (lines[at].includes('"routing"') || lines[at].includes("'routing'"))) {
    const before = lines[at];
    lines[at] = before
      .replace(/,\s*"routing"/, "")
      .replace(/,\s*'routing'/, "")
      .replace(/"routing"\s*,\s*/, "")
      .replace(/'routing'\s*,\s*/, "")
      .replace(
        /\[\.\.\.\(shared\((["'])workspace\.panels\1\)\s*\?\?\s*(\[[^\]]*\])\)\]/,
        "shared($1workspace.panels$1) ?? $2",
      );
    if (lines[at] !== before) changed = true;
  }
  return { changed, src: lines.join("\n") };
}

function ensurePanel(layout) {
  const body = find(layout, "panel-body");
  if (!body?.children) return { ok: false, reason: "this layout has no side panel (panel-body)" };
  if (body.children.some((child) => child.id === "routing")) return { ok: true, changed: false };
  const block = { id: "routing", type: "block", content: { mod: "routing" } };
  const at = body.children.findIndex((child) => child.id === "graph");
  body.children.splice(at < 0 ? body.children.length : at, 0, block);
  return { ok: true, changed: true };
}

function dropPanel(layout) {
  const body = find(layout, "panel-body");
  if (!body?.children) return false;
  const before = body.children.length;
  body.children = body.children.filter((child) => !(child.id === "routing" && child.content?.mod === "routing"));
  return body.children.length !== before;
}

function finish() {
  console.log(dry ? "Dry run. Nothing was written." : removing ? "Uninstalled." : "Installed.");
  for (const note of notes) console.log(`- ${note}`);
}

function withNewline(text) {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function copyMod() {
  notes.push("copy mods/routing into ~/.config/herdr-app/mods/routing");
  if (dry) return;
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(join(home, "mods"), { recursive: true });
  cpSync(join(root, "mods", "routing"), dest, { recursive: true });
}

function install() {
  if (!existsSync(join(home, "layouts"))) die(`No Herdr config at ${home}. Install Herdr first.`);
  copyMod();

  const active = statusLayout();
  let name = active;
  let path = layoutFile(name);
  if (!existsSync(path)) die(`Layout file missing: ${path}`);
  let layout = readJson(path);

  if (SHIPPED.has(name) && !layout.cloned_from) {
    if (!find(layout, "panel-body")) {
      die(`${name} has no Files/Changes panel, so the button was not added.\nSwitch to Herdr's main layout and run this again.\nThe mod ${dry ? "would be" : "is"} at ${dest}.`);
    }
    const as = `${name}-routing`;
    const asPath = layoutFile(as);
    if (!existsSync(asPath)) {
      notes.push(`clone layout ${name} → ${as} and switch to it (ctrl-shift-l goes back to ${name})`);
      if (!dry) herdr(["do", "layout.clone", JSON.stringify({ name, as })]);
    } else if (active !== as) {
      notes.push(`switch to the existing layout ${as} (ctrl-shift-l goes back)`);
      if (!dry) herdr(["do", "layout.switch", JSON.stringify({ name: as })]);
    } else {
      notes.push(`layout ${as} is already on screen`);
    }
    name = as;
    path = asPath;
    if (dry && !existsSync(asPath)) {
      notes.push("add the routing panel and the Routing button on that clone");
      notes.push("run herdr-app check");
      finish();
      return;
    }
    layout = readJson(path);
  } else {
    notes.push(`keep the personal layout ${name} on screen`);
  }

  const panel = ensurePanel(layout);
  if (!panel.ok) die(`${panel.reason}\nThe mod ${dry ? "would be" : "is"} at ${dest}, but this layout cannot show it.`);

  const tabs = find(layout, "tabs");
  let modName = tabs?.content?.mod;
  if (!modName) die("This layout has no tabs block, so the Routing button has nowhere to go.");

  if (modName === "tabs") {
    const as = "tabs-routing";
    const asDir = join(home, "mods", as);
    if (!existsSync(asDir)) {
      notes.push("clone the tabs mod → tabs-routing (Herdr replaces mods/tabs on every start)");
      if (!dry) herdr(["do", "mod.clone", JSON.stringify({ name: "tabs", as })]);
    }
    if (dry && !existsSync(asDir)) {
      notes.push("point the tab bar at tabs-routing and add the Routing button");
      if (panel.changed) notes.push(`add the routing panel to layouts/${name}.json`);
      notes.push("run herdr-app check");
      finish();
      return;
    }
    if (tabs.content.mod !== as) {
      tabs.content.mod = as;
      panel.changed = true;
      notes.push("point the tab bar at tabs-routing");
    }
    modName = as;
  }

  const tabsFile = join(home, "mods", modName, "main.js");
  if (!existsSync(tabsFile)) die(`Tab bar source missing: ${tabsFile}`);
  const patched = patchTabs(readFileSync(tabsFile, "utf8"));
  if (!patched.ok) {
    die(`${patched.reason}.\nEdit ${tabsFile}: add "routing" beside the enabled panels, and a Routing button after Changes:\n  .when(enabled.includes("routing"), el => el.child(panelButton("routing", "Routing", "mods/routing/route.svg")))`);
  }

  notes.push(panel.changed ? `add the routing panel to layouts/${name}.json` : `layouts/${name}.json already has the routing panel`);
  notes.push(patched.changed ? `add the Routing button to mods/${modName}/main.js` : `mods/${modName}/main.js already has the Routing button`);

  if (!dry && panel.changed) writeJson(path, layout);
  if (!dry && patched.changed) writeFileSync(tabsFile, withNewline(patched.src));

  if (dry) notes.push("run herdr-app check");
  else herdr(["check", dest], { inherit: true });
  notes.push("Open Routing, the button after Changes.");
  finish();
}

function uninstall() {
  if (!existsSync(home)) die(`No Herdr config at ${home}.`);
  if (!existsSync(dest)) notes.push("mods/routing is not installed");
  else {
    notes.push("remove ~/.config/herdr-app/mods/routing");
    if (!dry) rmSync(dest, { recursive: true, force: true });
  }

  const layouts = join(home, "layouts");
  if (existsSync(layouts)) {
    for (const file of readdirSync(layouts)) {
      if (!file.endsWith(".json")) continue;
      const name = file.slice(0, -".json".length);
      const path = join(layouts, file);
      const layout = readJson(path);
      if (SHIPPED.has(name) && !layout.cloned_from) continue;
      if (!dropPanel(layout)) continue;
      notes.push(`remove the routing panel from layouts/${file}`);
      if (!dry) writeJson(path, layout);
    }
  }

  const mods = join(home, "mods");
  if (existsSync(mods)) {
    for (const name of readdirSync(mods)) {
      if (name === "tabs" || name === "routing") continue;
      const file = join(mods, name, "main.js");
      if (!existsSync(file)) continue;
      const src = readFileSync(file, "utf8");
      if (!src.includes('panelButton("routing"') && !src.includes("panelButton('routing'") && !src.includes('"routing"')) continue;
      const next = unpatchTabs(src);
      if (!next.changed) continue;
      notes.push(`remove the Routing button from mods/${name}/main.js`);
      if (!dry) writeFileSync(file, withNewline(next.src));
    }
  }

  notes.push("Cloned layouts and tab bars were left in place. ctrl-shift-l switches layouts.");
  finish();
}

if (removing) uninstall();
else install();
