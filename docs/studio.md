# HARIS Studio: configurable interfaces

HARIS Studio (`server/web/studio.html`) builds a study interface from the scenario file instead of from hand-written
page code. It was added to host the strategic/tactical drone study (StratTac), and any scenario can use it.

## Opening a view

A scenario names the page the launcher opens with a top-level `"page"` key, for example
`"page": "studio.html?view=strategic"`. Without it the launcher opens the sandbox as before.

Each view is its own browser tab: `studio.html?view=strategic`, `studio.html?view=tactical`, and so on. The header's
view buttons open the other views in their own tabs. Every tab polls the same server state (`GET /strattac/state`)
and sends operator actions to `POST /strattac/action`, so no tab is in charge and any tab can be closed and reopened.

## The `interface` block

```json
"interface": {
  "views": {
    "strategic": {
      "title": "SAR Command", "badge": "STRATEGIC", "accent": "#22d3ee", "frame": 5,
      "layout": {"column": [
        {"panel": "header", "options": {"items": ["badge", "title", "session", "mode", "spacer", "clock", "score", "switchView"]}},
        {"row": [
          {"column": [{"panel": "reserve"}, {"panel": "missionList", "flex": 1}], "width": 440},
          {"panel": "strategicMap", "flex": 1}
        ], "flex": 1}
      ]}
    }
  }
}
```

- `title`, `badge`, `accent` and `frame` (border width in pixels, in the accent colour) style the view.
- `layout` is a tree. `{"row": [...]}` and `{"column": [...]}` arrange their children; `{"panel": "name"}` places a
  panel. Any node can take `width` or `height` (pixels) or `flex` (share of the remaining space). `options` is passed
  to the panel.
- A panel name that is not registered shows a placeholder, so a layout can be written before its panels exist.

## Built-in panels

| Panel | Shows | Options |
|---|---|---|
| `header` | View badge and title, session, mode, clock, score, buttons to the other views. In testing mode, researcher shortcuts (new mission, force a failure, end the session or study). | `items`: any of `badge`, `title`, `session`, `mode`, `test`, `spacer`, `testControls`, `clock`, `score`, `switchView`, `start`, in display order. `tint`: amber-tinted bar, as in the tactical view. |
| `reserve` | Drones of each type at the hub, how many are out, and the forecast mix of incoming mission categories. | |
| `missionList` | Mission cards grouped as incoming, committed, active and completed, each with its task bar, penalty histogram and task plan. *Allocate* opens the strategic panel in the card: the Strategic Assistant's Aggressive and Conservative cards, which "analyse" for their logged reveal delay before they can be picked, or a manual drone-count picker with a live ETA. | |
| `strategicMap` | The whole study area: mission zones, drone routes and positions, task waypoints, the hub. Scroll to zoom, drag to pan, Low/Mid/Full detail button. Clicking a queued zone allocates it; clicking a committed or active one opens it in the tactical view. | `detail` (0–2, default 2), `cover` (default true: zoomed out, the map still fills the panel, as in the original). |
| `missionQueue` | Tactical view: missions waiting for a tactical plan or a failure recovery, most urgent first, with their pending penalty. Clicking one opens it in the planner. | |
| `tacticalToolbar` | Tactical view: the selected mission, its wait timer, and the *Suggest* (Tactical Assistant), *Reset*, *Abort Mission* and *Abandon Mission* buttons. | |
| `tacticalPlanner` | Tactical view: the mission zone with its task waypoints. Drag a drone onto a task to assign it, back to the Unassigned tray to free it. The Tactical Assistant's plan is revealed one drone per second. | |
| `taskSchedule` | Tactical view: per drone, the order and timing of its tasks, with lockout warnings, and the *Deploy* (or *Reassign*, in a recovery) button. | |

The four tactical panels share one plan per tab (`core/tactical.js`): the plan stays in the page until *Deploy*, and every
change is sent to the server as `TACTICAL_ASSIGN_CHANGED` so it is logged.

Game rules the panels display (task values and compositions, penalty rates) come from the server in `/strattac/config`
under `rules`, so they are never repeated in the page code.

When one view opens another (for example a mission in the tactical view), an already open tab for that view is told
over a `BroadcastChannel` instead of being reloaded. Panels listen with `ctx.onViewMessage(fn)`.

## Writing a panel

Panels live in `server/web/studio/panels/`. Each module registers itself and is imported from `panels/index.js`:

```js
import { registerPanel } from "../core/registry.js";

registerPanel("myPanel", {
  create(el, ctx, options) {
    // el: the panel's cell; ctx: { config, view, viewName, types, state, send(action), openView(name, params), onViewMessage(fn) }
    return { update(state) { /* redraw from the latest server state */ } };
  },
});
```

## Maps

`core/worldmap.js` gives panels a map in study world units (StratTac uses a 1400 x 800 world). With a Google Maps key
the world is laid over terrain inside `strattac.map.bbox`; without one it is drawn on a plain grid. Panels draw into
an SVG whose units are world units, so they never handle latitude and longitude.

## Drone types

`strattac.droneTypes` lists each type with an internal `id` (kept in logs), the `label` and `short` letter operators
see, its `colour`, `speed` (world units per second), `count` in the fleet, and `icon`.

## The study engine

`server/src/server/strattac/` holds the StratTac game: mission generation (`MissionGen`), the Strategic Assistant
(`Copilot`), the Tactical Assistant and recovery planner (`Tactical`), and the game loop and actions
(`StratTacEngine`). The simulator steps it every tick, and views send it actions through `POST /strattac/action`.

Actions take the same names and fields as the original study's reducer: `START_STUDY`, `OPEN_STRATEGIC`,
`CLOSE_STRATEGIC`, `PICK_STRATEGY`, `EDIT_MANUAL`, `PREVIEW_ALLOCATION`, `APPLY_STRATEGIC`, `TACTICAL_SUGGEST`,
`TACTICAL_ASSIGN_CHANGED`, `CONFIRM_TACTICAL`, `OVERRIDE_TACTICAL`, `CONFIRM_FAILURE_RECOVERY`, `ABANDON_MISSION`,
`RECALL_ASSET`, `SUBMIT_TRUST_PROBE`, `DISMISS_TRUST_PROBE`, `SUBMIT_DEMOGRAPHICS`, `SUBMIT_SURVEY`, `FINISH_SURVEYS`,
`NEXT_SESSION`, `END_STUDY`, `RESET_STUDY`, and in testing mode `FORCE_MISSION_ARRIVAL`, `FORCE_DRONE_FAILURE` and
`FORCE_SESSION_END`. A refused action returns `{"ok": false, "error": ...}` and changes nothing.

### Engine parity

The port keeps the original's arithmetic (the same seeded Mulberry32 generator, JavaScript's `Math.hypot`, stable sorts
and insertion-ordered maps), and the session clock advances in fixed 0.1 s ticks. Checked against the original
`study-v1.13` code:

- Mission plans: identical for 6,064 missions (5 complexities × 60 seeds × 2 game indices).
- Strategic Assistant cards: identical for 2,466 cards, 810 of them with the ε failure forced on.
- Tactical Assistant plans: identical for 3,204 plans, plan-all and greedy.
- Whole sessions with a scripted operator (always takes the Aggressive card, confirms the tactical plan, recovers
  failures with Suggest): identical score, penalty, completions, task failures, drone failures and lockouts in all 80
  sessions tried (4 scenarios × 20 seeds, 403 drone failures between them).

Run the check yourself with [`tools/strattac-parity/run.sh`](../tools/strattac-parity/README.md) and a checkout of the
original study code.

Not yet ported: the tutorial actions (PR 7) and the reducer's older `ACCEPT_RECOVERY`, `APPLY_MANUAL_RECOVERY` and
`REPRIORITISE_TASK` actions, which the original's own interface no longer sends.
