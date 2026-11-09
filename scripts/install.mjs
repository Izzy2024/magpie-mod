// Copies the mod into Herdr and, on the personal main-graph layout, adds the
// Routing panel and the tab-bar button. Shipped layouts are left alone.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = join(homedir(), ".config/herdr-app");
const dest = join(home, "mods/routing");
rmSync(dest, { recursive: true, force: true });
mkdirSync(join(home, "mods"), { recursive: true });
cpSync(join(root, "mods/routing"), dest, { recursive: true });

const layoutPath = join(home, "layouts/main-graph.json");
const layout = JSON.parse(readFileSync(layoutPath, "utf8"));
const body = find(layout, "panel-body");
if (body && !body.children.some((child) => child.id === "routing")) {
  const at = body.children.findIndex((child) => child.id === "graph");
  const block = { id: "routing", type: "block", content: { mod: "routing" } };
  body.children.splice(at < 0 ? body.children.length : at, 0, block);
  writeFileSync(layoutPath, JSON.stringify(layout, null, 2) + "\n");
}

const tabsPath = join(home, "mods/tabs-graph/main.js");
let tabs = readFileSync(tabsPath, "utf8");
if (!tabs.includes('panelButton("routing"')) {
  tabs = tabs.replace(
    '[...(shared("workspace.panels") ?? ["files", "changes"]), "graph"]',
    '[...(shared("workspace.panels") ?? ["files", "changes"]), "routing", "graph"]',
  );
  tabs = tabs.replace(
    '.when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))\n',
    '.when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))\n      .when(enabled.includes("routing"), el => el.child(panelButton("routing", "Routing", "mods/routing/route.svg")))\n',
  );
  writeFileSync(tabsPath, tabs);
}

execFileSync("herdr-app", ["check", dest], { stdio: "inherit" });

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const hit = find(child, id);
    if (hit) return hit;
  }
  return null;
}
