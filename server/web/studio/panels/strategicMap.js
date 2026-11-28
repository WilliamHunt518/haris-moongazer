// The strategic map: the whole study area with mission zones, drone routes and positions, task waypoints and the hub.
// Clicking a queued zone opens its allocation; clicking a committed or active one opens it in the tactical view.
// options.detail: starting detail level, 0 (low), 1 (mid) or 2 (full, default)
import { registerPanel } from "../core/registry.js";
import { createWorldMap } from "../core/worldmap.js";
import { TASK_FULL, TASK_ICON, esc, typeOf, droneLabel } from "../core/study.js";

const ZONE_STROKE = { queued: "#f59e0b", active: "#3b82f6", completed: "#6b7280", failed: "#ef4444" };
const ZONE_FILL = { queued: "rgba(120,53,15,0.34)", active: "rgba(11,18,32,0.34)", completed: "rgba(17,24,39,0.30)", failed: "rgba(127,29,29,0.30)" };
const ZONE_ORDER = { completed: 0, failed: 0, abandoned: 0, queued: 1, active: 2 };
const HALO = 'paint-order="stroke" stroke="#0b1220" stroke-linejoin="round"';

function setSvg(g, html) {
    if (g._html !== html) { g._html = html; g.innerHTML = html; }
}

registerPanel("strategicMap", {
    create(el, ctx, options) {
        const map = createWorldMap(el, ctx, { cover: options.cover !== false });
        const zones = map.layer("zones"), routes = map.layer("routes"), drones = map.layer("drones");
        const waypoints = map.layer("waypoints"), hub = map.layer("hub");
        routes.style.pointerEvents = drones.style.pointerEvents = waypoints.style.pointerEvents = hub.style.pointerEvents = "none";
        let detail = options.detail ?? 2, last = null;

        const chrome = document.createElement("div");
        chrome.className = "st-map-chrome";
        chrome.innerHTML = '<button type="button"></button><span>Scroll/drag to navigate · click queued zone to allocate</span>';
        el.appendChild(chrome);
        const detailBtn = chrome.querySelector("button");
        const labelDetail = () => { detailBtn.textContent = ["Low", "Mid", "Full"][detail]; };
        labelDetail();
        detailBtn.onclick = () => { detail = (detail + 1) % 3; labelDetail(); if (last) draw(last); };

        zones.addEventListener("click", (e) => {
            const g = e.target.closest("[data-mission]");
            if (!g || !last) return;
            const m = last.missions.find((x) => x.id === g.dataset.mission);
            if (!m) return;
            if (m.tacticalPending || m.failureRecoveryPending || m.status === "active") ctx.openView("tactical", { mission: m.id });
            else if (m.status === "queued" && !m.pendingAllocation) ctx.send({ type: "OPEN_STRATEGIC", missionId: m.id });
        });

        function draw(s) {
            const [hx, hy] = s.hub;
            // Mission zones
            let z = "";
            for (const m of [...s.missions].sort((a, b) => (ZONE_ORDER[a.status] ?? 0) - (ZONE_ORDER[b.status] ?? 0))) {
                const allocatable = m.status === "queued" && !m.pendingAllocation && !m.tacticalPending;
                const tactical = m.tacticalPending || m.failureRecoveryPending;
                const clickable = allocatable || tactical || m.status === "active";
                const { x, y } = m.zoneCenter;
                z += `<g data-mission="${esc(m.id)}" style="cursor:${clickable ? "pointer" : "default"}">`
                    + `<circle cx="${x}" cy="${y}" r="${m.zoneRadius}" fill="${ZONE_FILL[m.status] || "rgba(55,65,81,0.04)"}" stroke="${tactical ? "#d97706" : (ZONE_STROKE[m.status] || "#374151")}" stroke-width="${tactical ? 2 : 1.5}"${tactical ? ' stroke-dasharray="6 3"' : ""}/>`
                    + `<text x="${x}" y="${y - 4}" text-anchor="middle" fill="white" font-size="11" font-weight="bold" font-family="monospace" ${HALO} stroke-width="2.5">${esc(m.id)}</text>`
                    + `<text x="${x}" y="${y + 10}" text-anchor="middle" fill="#e2e8f0" font-size="8" font-family="sans-serif" ${HALO} stroke-width="2">Cat ${m.category}</text>`;
                if (m.failureRecoveryPending) z += `<text x="${x}" y="${y + 22}" text-anchor="middle" fill="#f87171" font-size="7" font-family="sans-serif">FAILURE</text>`;
                else if (m.tacticalPending) z += `<text x="${x}" y="${y + 22}" text-anchor="middle" fill="#fbbf24" font-size="7" font-family="sans-serif">TACTICAL</text>`;
                else if (allocatable) z += `<text x="${x}" y="${y + 22}" text-anchor="middle" fill="#f59e0b" font-size="7" font-family="sans-serif">allocate</text>`;
                z += "</g>";
            }
            setSvg(zones, z);

            // Route lines and drones
            let r = "", d = "";
            for (const a of s.assets) {
                const t = typeOf(ctx, a.type), colour = t.text || t.colour;
                if (a.status === "deployed" || a.status === "returning") {
                    r += `<line x1="${a.travelFrom.x}" y1="${a.travelFrom.y}" x2="${a.targetPosition.x}" y2="${a.targetPosition.y}" stroke="${colour}" stroke-width="${detail >= 1 ? 1.5 : 0.5}" opacity="0.2"/>`;
                }
                if (a.status === "available" || a.status === "failed") continue;
                const { x, y } = a.position;
                d += `<g opacity="${a.status === "returning" ? 0.5 : 1}"><circle cx="${x}" cy="${y}" r="5" fill="${colour}" fill-opacity="0.15"/>`
                    + `<image href="${esc(t.icon)}" x="${x - 4}" y="${y - 4}" width="8" height="8"/>`;
                if (detail >= 1) d += `<text x="${x + 7}" y="${y - 4}" fill="${colour}" font-size="7" font-family="monospace" ${HALO} stroke-width="1.6">${esc(droneLabel(ctx, a.id))}</text>`;
                d += "</g>";
            }
            setSvg(routes, r);
            drones.innerHTML = d;

            // Task waypoints: active missions from mid detail, queued missions' planned tasks at full detail
            let w = "";
            if (detail >= 1) for (const m of s.missions) if (m.status === "active") for (const t of m.tasks) {
                const { x, y } = t.waypoint;
                if (t.status === "executing" || t.status === "completed") {
                    const p = t.status === "completed" ? 1 : t.startTime != null && t.baseTime > 0 ? Math.min(1, Math.max(0, (s.elapsed - t.startTime) / t.baseTime)) : 0;
                    if (p > 0) {
                        const R = 8, c = 2 * Math.PI * R;
                        w += `<circle cx="${x}" cy="${y}" r="${R}" fill="none" stroke="${t.status === "completed" ? "#10b981" : "#3b82f6"}" stroke-width="1.5" stroke-dasharray="${c} ${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 ${x} ${y})" opacity="0.8"/>`;
                    }
                }
                const fill = t.status === "completed" ? "rgba(16,185,129,0.2)" : t.status === "executing" ? "rgba(245,158,11,0.2)" : "rgba(30,41,59,0.8)";
                const stroke = t.status === "completed" ? "#4ade80" : t.status === "executing" ? "#f59e0b" : "#475569";
                w += `<circle cx="${x}" cy="${y}" r="5" fill="${fill}" stroke="${stroke}" stroke-width="0.8"/><image href="${TASK_ICON[t.type]}" x="${x - 4}" y="${y - 4}" width="8" height="8"/>`;
                if (detail === 2) w += `<text x="${x}" y="${y + 10}" text-anchor="middle" fill="#94a3b8" font-size="6" font-family="sans-serif">${TASK_FULL[t.type]}</text>`;
            }
            if (detail === 2) for (const m of s.missions) if (m.status === "queued") for (const t of m.tasks) {
                const { x, y } = t.waypoint;
                w += `<g opacity="0.45"><circle cx="${x}" cy="${y}" r="4" fill="rgba(30,41,59,0.5)" stroke="#374151" stroke-width="0.7" stroke-dasharray="2 2"/>`
                    + `<image href="${TASK_ICON[t.type]}" x="${x - 3}" y="${y - 3}" width="6" height="6"/>`
                    + `<text x="${x}" y="${y + 8}" text-anchor="middle" fill="#cbd5e1" font-size="5.5" font-family="sans-serif" ${HALO} stroke-width="1.6">${TASK_FULL[t.type]}</text></g>`;
            }
            waypoints.innerHTML = w;

            setSvg(hub, `<circle cx="${hx}" cy="${hy}" r="9" fill="#1e3a8a" stroke="#3b82f6" stroke-width="1.5"/>`
                + `<text x="${hx}" y="${hy + 22}" text-anchor="middle" fill="#60a5fa" font-size="9" font-family="monospace">HUB</text>`);
        }

        return {
            update(s) { last = s; draw(s); },
            destroy() { map.destroy(); },
        };
    },
});
