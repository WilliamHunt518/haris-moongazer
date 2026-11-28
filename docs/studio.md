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
        {"panel": "header", "options": {"items": ["badge", "title", "session", "clock", "switchView"]}},
        {"row": [
          {"panel": "missionList", "width": 440},
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

## Writing a panel

Panels live in `server/web/studio/panels/`. Each module registers itself and is imported from `panels/index.js`:

```js
import { registerPanel } from "../core/registry.js";

registerPanel("myPanel", {
  create(el, ctx, options) {
    // el: the panel's cell; ctx: { config, view, viewName, types, state, send(action), openView(name) }
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
