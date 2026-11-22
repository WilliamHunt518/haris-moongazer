# Agent icons for the Modern look

The Modern look draws agents as top-down quadrotors (plus a fixed wing, a ground vehicle and a hub pad).
The Classic look keeps the original icons in `server/web/icons/used/` and `server/web/icons/`, untouched.

- `make_agent_icons.py` writes the SVG sources to `server/web/icons/modern/src/`.
- `render_agent_icons.js` rasterises them to 60x60 PNGs in `server/web/icons/modern/` (same size and anchor as the classic icons, so battery bars and rotation work the same). Needs Playwright with Chromium.

```
python3 tools/icons/make_agent_icons.py
node tools/icons/render_agent_icons.js
```

Icons point north; the map rotates each marker by the agent's heading. The front rotors and nose are orange so the heading reads.
The marker names a scenario can use (`mkr`) are listed in [docs/scenarios.md](../../docs/scenarios.md).
Map wiring: `this.icons` in `server/web/app/views/map.js`. A marker can have its own selected icon named `<marker>Selected`.
