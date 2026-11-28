// The strategic map: the whole study area with the hub and the fleet.
// (Mission zones, routes and task markers are added as the engine port lands.)
import { registerPanel } from "../core/registry.js";
import { createWorldMap, svgEl } from "../core/worldmap.js";

registerPanel("strategicMap", {
    create(el, ctx) {
        const map = createWorldMap(el, ctx);
        const hubLayer = map.layer("hub"), droneLayer = map.layer("drones");
        const droneEls = new Map();
        let hubDrawn = false;
        return {
            update(s) {
                if (!hubDrawn) {
                    const [hx, hy] = s.hub;
                    svgEl("circle", { cx: hx, cy: hy, r: 16, fill: "#1e293b", stroke: "#94a3b8", "stroke-width": 2 }, hubLayer);
                    svgEl("text", { x: hx, y: hy + 4, "text-anchor": "middle", fill: "#e2e8f0", "font-size": 10, "font-weight": 700, "font-family": "sans-serif" }, hubLayer).textContent = "HUB";
                    hubDrawn = true;
                }
                const seen = new Set();
                for (const a of s.assets) {
                    seen.add(a.id);
                    if (a.status === "available") { if (droneEls.has(a.id)) droneEls.get(a.id).style.display = "none"; continue; }
                    let g = droneEls.get(a.id);
                    if (!g) {
                        const t = ctx.types[a.type] || {};
                        g = svgEl("g", {}, droneLayer);
                        svgEl("image", { href: t.icon, x: -6, y: -6, width: 12, height: 12 }, g);
                        droneEls.set(a.id, g);
                    }
                    g.style.display = "";
                    g.setAttribute("transform", `translate(${a.x},${a.y})`);
                }
                for (const [id, g] of droneEls) if (!seen.has(id)) { g.remove(); droneEls.delete(id); }
            },
        };
    },
});
