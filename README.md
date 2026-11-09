# Routing for Herdr

**English** · [Español](README.es.md)

A side panel that shows [Magpie](https://github.com/yetone/magpie) routing inside Herdr, right next to Files and Changes.

Magpie's window is a Wails webview and Herdr panels are gpui, so the app itself cannot be embedded. Instead, the panel reads the same data Magpie's Routing page reads:

- **Live:** `GET http://127.0.0.1:<gateway>/v1/magpie/trace` (long-polled while the panel is open)
- **Today:** `~/.config/magpie/routing/<YYYY-MM-DD>.jsonl`

## What it shows

One stage: the agent, Magpie, and the **accounts** it weighed, laid out as rows. Every request in flight is its own bird, in its agent's color, so several agents can be watched at once.

- **In-flight strip** (two or more at once): the agent, its Herdr space, what it is waiting on, and a live clock. Click one to follow it.
- **Accounts are shared rows.** A row shows how many requests are on it, in their agents' colors. A failing account turns red with its status; the request goes back to Magpie and out to the next account.
- **Herdr link.** Magpie records the folder as a short label (`deepseek-harness/mod-magpie`), which is matched to a terminal's live folder, so the agent card and the log show which space sent the request. Click the agent card to jump to that terminal. When several agents share one folder, the one that is working wins.
- **Request log.** Click a request to replay its journey; "Back to live" follows the newest one again.
- **Demo** (header): a scripted afternoon with three agents, five requests, and one double failover, so you can see the panel without sending anything.

Keys (click the panel first): `↑`/`↓` or `j`/`k` move through requests, `Esc` returns to live, `r` replays, `m` hides names, and `d` toggles the demo.

## Install

The layout in use is the personal `main-graph` layout (`tabs-graph` draws the tab bar). Shipped Herdr layouts are replaced on update; this one is a clone.

```sh
node scripts/install.mjs        # copies the mod, wires the panel and the tab-bar button, runs herdr-app check
node scripts/check-logic.mjs    # no gateway or log needed
```

`layouts/main-graph.json` needs a `routing` child in the `panel-body` stack, and `mods/tabs-graph/main.js` needs the Routing button after Changes. The install script adds both and leaves them alone when they are already there.

## How it is built

- `mods/routing/logic.js`: no UI, no I/O. It reads a route, lays out the wires (`wiresOf`), runs the flight choreography (`advance`), and provides `frame()`, which decides every frame which requests fly and on which rows. Wires are orthogonal with rounded corners (8 px radius): down from Magpie to a horizontal bus, left to a lane beside the accounts, then down and into each account. Each static wire is drawn once (`base`: the agent wire plus one per account). `check-logic.mjs` plays the demo through `frame()` and asserts on the result, and checks the wire and flight geometry at three panel widths.
- `mods/routing/main.js`: three views. `Routing` owns the data and the log. `Stage` is the card (redrawn when what it shows changes, and four times a second for clocks). `Flight` is what moves (dashed wires, birds, packets). Flights run at about 60 fps (a 16 ms timer), the wait at Magpie at about 30 fps, and the hold on an account uses no JS frames at all: the wire stays lit and the dot pulses natively. Banking and turning follow real time, not the frame count, so they look the same at either rate.

## Cost

With nothing in flight, the panel adds nothing (the app idles at about 10% of a core on this machine, with or without it). Worst case, four birds in the air continuously (the demo): about +30–40% of a core, measured over 40 s windows with 1 s CPU-time resolution. That figure was measured when flights ran at 30 fps. Flights now run at about 60 fps, and a request waiting on an account no longer costs any frames; the cost has not been measured again since, so treat the figure as out of date. Most of it is the window repainting, which any animation in Herdr pays for; the avoidable parts are gone (the feed is merged once per change, wire geometry is measured once, static wires are drawn once, and the layout tree is read four times a second).
