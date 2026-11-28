// The tactical view's panels. They share one planner state (core/tactical.js):
//   missionQueue     missions waiting for a tactical plan or a failure recovery
//   tacticalToolbar  the selected mission, Reset, Suggest (the Tactical Assistant), Abort
//   tacticalPlanner  the mission zone: drag a drone onto a task to assign it, Shift+drag to chain
//   taskSchedule     unassigned drones, each task's composition and timing, Deploy / Reassign / Abandon
import { registerPanel } from "../core/registry.js";
import { createWorldMap } from "../core/worldmap.js";
import { getTacticalStore } from "../core/tactical.js";
import { TYPES, TASK_ICON, esc, patch, div, typeOf, droneLabel, fmtSeconds, taskRule } from "../core/study.js";

// The original's tactical planner names categories this way
const CAT_NAMES = { A: "Search", B: "Recovery", C: "Supply", D: "Recon", E: "Command" };
const TASK_NAMES = { 1: "Recce", 2: "Recon", 3: "Supply Drop", 4: "Prec Supply Drop", 5: "Search & Service" };
const HALO = 'paint-order="stroke" stroke="#0b1220" stroke-linejoin="round"';
const LETTER = { Blue: "F", Red: "L", Green: "C" };
const COMP_COLOUR = { Blue: "#60a5fa", Red: "#f87171", Green: "#86efac" };

function compLabel(comp, time) {
    const parts = TYPES.filter((t) => comp[t] > 0).map((t) => comp[t] + LETTER[t]);
    return parts.join(" + ") + " (" + time + "s)";
}

// Panels in a view are created before the first state arrives; each hands new state to the shared store
function hook(ctx, store, render) {
    store.onChange(render);
    return { update(s) { store.sync(s); } };
}

function startSelection(ctx, store) {
    if (ctx._tacticalSelectionHooked) return;
    ctx._tacticalSelectionHooked = true;
    let wanted = ctx.params.get("mission");
    store.onChange(() => {
        if (wanted && store.get().state) { const id = wanted; wanted = null; store.select(id); }
    });
    ctx.onViewMessage((msg) => { if (msg.mission) store.select(msg.mission); });
}

// ── Mission queue ──────────────────────────────────────────────────────────────
registerPanel("missionQueue", {
    create(el, ctx) {
        const store = getTacticalStore(ctx);
        startSelection(ctx, store);
        const box = div("st-tq", el);
        const status = div("st-tq-status", box), head = div("st-tq-head", box), list = div("st-tq-list", box);
        list.addEventListener("click", (e) => {
            const b = e.target.closest("[data-id]");
            if (b && !b.disabled) store.select(b.dataset.id);
        });
        return hook(ctx, store, () => {
            const st = store.get(), s = st.state;
            if (!s) return;
            const active = s.missions.filter((m) => m.status === "active").length;
            const queued = s.missions.filter((m) => m.status === "queued").length;
            patch(status, `<div class="h">Session ${s.sessionNumber}/${s.numSessions}</div><div class="s">${active} active · ${queued} queued</div>`
                + `<div>Score: <b class="st-mono" style="color:#fff">${Math.round(s.score)}</b><span class="st-mono" style="color:#f87171;margin-left:4px">−${Math.round(s.penaltyAccrued)}</span></div>`
                + `<div class="t">${fmtSeconds(s.elapsed)}</div>`);
            const pending = s.missions.filter((m) => (m.tacticalPending && m.pendingAllocation) || m.failureRecoveryPending);
            patch(head, "Pending" + (pending.length ? ` (${pending.length})` : ""));
            const busy = st.suggesting || st.suggestQueue.length > 0;
            if (!pending.length) { patch(list, '<p class="st-tq-empty">No missions pending</p>'); return; }
            patch(list, pending.map((m) => {
                const rec = m.failureRecoveryPending, sel = m.id === st.selectedId, locked = busy && !sel;
                return `<button class="st-tq-item${rec ? " rec" : ""}${sel ? " sel" : ""}" data-id="${esc(m.id)}" ${locked ? 'disabled title="Wait for the current Suggest to finish before switching missions"' : ""}>`
                    + `<div class="row"><span class="id">${esc(m.id)}</span>`
                    + (rec ? `<span class="fail">${m.recoveryReason === "lockout" ? "LOCKOUT" : "FAIL"}</span>` : `<span class="n">${m.pendingAllocation ? m.pendingAllocation.dronePool.length : 0} drones</span>`)
                    + `</div><div class="sub">Cat ${m.category}${!rec && m.pendingAllocation ? ` · ${m.pendingAllocation.taskOrder.length} tasks` : ""}${rec ? ' <span style="margin-left:4px">reassign pending</span>' : ""}</div></button>`;
            }).join(""));
        });
    },
});

// ── Toolbar ────────────────────────────────────────────────────────────────────
registerPanel("tacticalToolbar", {
    create(el, ctx) {
        el.style.flex = "none";
        const store = getTacticalStore(ctx);
        startSelection(ctx, store);
        const bar = div("st-tt", el);
        bar.addEventListener("click", (e) => {
            const b = e.target.closest("[data-act]");
            if (!b || b.disabled) return;
            ({ back: store.back, reset: store.reset, suggest: store.suggest, abort: store.abort })[b.dataset.act]();
        });
        return hook(ctx, store, () => {
            const st = store.get(), m = store.mission();
            el.style.display = m ? "" : "none";
            if (!m) { patch(bar, ""); return; }
            const rec = st.mode === "recovery", s = st.state;
            let html = '<button class="back" data-act="back">← Back</button><div class="sep"></div>'
                + `<span class="mid">${esc(m.id)}</span><span class="cat">Cat ${m.category} · ${CAT_NAMES[m.category] || ""}</span>`
                + (rec ? '<span class="tag rec">⚠ DRONE FAILURE — Reassign</span>' : '<span class="tag plan">Tactical View</span>');
            const p = st.pending;
            if (s.config.testingMode && p.hasTacticalError && p.agentDroneSequences && Object.keys(p.agentDroneSequences).length) {
                const seqs = Object.values(p.agentDroneSequences);
                html += `<span class="tag test">⚠ TEST FAILURE: route — ${seqs.length} drone(s) detoured (1 real stop each · ${seqs.reduce((x, q) => x + q.length, 0)} drawn)</span>`;
            }
            html += '<span class="st-spacer"></span><span class="hint">Drag → assign · Shift+drag → chain · hover a drone for its full path</span>'
                + '<button class="b" data-act="reset">Reset</button>';
            if (s.config.mode === "agent") {
                const busy = st.suggesting || st.suggestQueue.length > 0;
                html += `<button class="b sug" data-act="suggest" ${busy ? "disabled" : ""}>${busy ? '<span class="st-spin-sm"></span>Suggesting…' : "Suggest"}</button>`;
            }
            if (st.suggestNote) html += `<span class="note">${esc(st.suggestNote)}</span>`;
            if (!rec) html += '<button class="b" data-act="abort">Abort Mission</button>';
            patch(bar, html);
        });
    },
});

// ── Planner map ────────────────────────────────────────────────────────────────
registerPanel("tacticalPlanner", {
    create(el, ctx) {
        const store = getTacticalStore(ctx);
        startSelection(ctx, store);
        const map = createWorldMap(el, ctx, { gestures: "none" });
        const zoneL = map.layer("zone"), arrowL = map.layer("arrows"), dragL = map.layer("drag"), taskL = map.layer("tasks"), droneL = map.layer("drones");
        for (const l of [zoneL, arrowL, dragL, taskL]) l.style.pointerEvents = "none";
        map.svg.insertAdjacentHTML("afterbegin", '<defs>'
            + ["blue:#60a5fa", "red:#f87171", "green:#4ade80", "drag:#94a3b8"].map((x) => { const [n, c] = x.split(":"); return `<marker id="tp-arr-${n}" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="${c}"/></marker>`; }).join("")
            + "</defs>");
        const wait = div("st-wait", el);
        let fittedKey = null;

        const nearestTask = (p) => {
            const m = store.mission();
            let best = null, min = 18;
            for (const t of m.tasks) {
                if (t.status === "completed") continue;
                const d = Math.hypot(p.x - t.waypoint.x, p.y - t.waypoint.y);
                if (d < min) { min = d; best = t.id; }
            }
            return best;
        };

        // Dragging a drone icon on the map
        map.svg.addEventListener("pointerdown", (e) => {
            const g = e.target.closest("[data-drone]");
            if (!g || !store.mission()) return;
            map.svg.setPointerCapture(e.pointerId);
            const p = map.clientToWorld(e.clientX, e.clientY);
            store.setHover({ dragging: { droneId: g.dataset.drone, x: p.x, y: p.y }, hoverTask: null });
            e.preventDefault();
        });
        map.svg.addEventListener("pointermove", (e) => {
            const st = store.get();
            if (!st.dragging) return;
            const p = map.clientToWorld(e.clientX, e.clientY);
            store.setHover({ dragging: { ...st.dragging, x: p.x, y: p.y }, hoverTask: nearestTask(p) });
        });
        map.svg.addEventListener("pointerup", (e) => {
            const st = store.get();
            if (!st.dragging) return;
            const { droneId } = st.dragging, target = st.hoverTask;
            store.setHover({ dragging: null, hoverTask: null });
            if (target) store.moveDrone(droneId, target, e.shiftKey);
            else if (e.shiftKey) {
                // Shift+drag to empty space backs out only the drone's last hop
                const seq = store.sequences()[droneId] || [];
                if (seq.length) store.removeDrone(droneId, seq[seq.length - 1]);
            } else store.unassignDrone(droneId);
        });
        // Dropping an unassigned drone from the schedule panel's list
        el.addEventListener("dragover", (e) => {
            if (!store.mission()) return;
            const t = nearestTask(map.clientToWorld(e.clientX, e.clientY));
            if (t) e.preventDefault();
            if (t !== store.get().hoverTask) store.setHover({ hoverTask: t });
        });
        el.addEventListener("drop", (e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData("text/plain"), t = store.get().hoverTask;
            store.setHover({ hoverTask: null });
            if (id && t) store.moveDrone(id, t, e.shiftKey);
        });
        droneL.addEventListener("pointerover", (e) => {
            const g = e.target.closest("[data-drone]");
            if (g && !store.get().dragging && store.get().hoverDrone !== g.dataset.drone) store.setHover({ hoverDrone: g.dataset.drone });
        });
        droneL.addEventListener("pointerout", (e) => {
            const g = e.target.closest("[data-drone]");
            if (g && !g.contains(e.relatedTarget) && store.get().hoverDrone) store.setHover({ hoverDrone: null });
        });

        function render() {
            const st = store.get(), m = store.mission(), s = st.state;
            if (!m) {
                wait.style.display = "";
                patch(wait, "<span>Select a mission from the panel</span>"
                    + (s && !s.missions.some((x) => (x.tacticalPending && x.pendingAllocation) || x.failureRecoveryPending) ? '<span class="sub">No missions currently require tactical assignment</span>' : ""));
                for (const l of [zoneL, arrowL, dragL, taskL, droneL]) l.innerHTML = "";
                fittedKey = null;
                return;
            }
            wait.style.display = "none";
            const p = st.pending, rec = st.mode === "recovery";
            const hub = { x: s.hub[0], y: s.hub[1] };
            const { x: cx, y: cy } = m.zoneCenter, r = m.zoneRadius;
            const byId = new Map(s.assets.map((a) => [a.id, a]));
            const seqs = store.sequences();
            const cycle = store.cycleTasks(seqs), present = store.presentByTask();

            // Frame the zone and the drones round it
            if (fittedKey !== st.key + st.pendingKey) {
                fittedKey = st.key + st.pendingKey;
                const ext = Object.values(st.positions).reduce((mx, q) => Math.max(mx, Math.hypot(q.x - cx, q.y - cy)), r + 30);
                const half = r + Math.max(22, ext - r + 12);
                map.fit({ x: cx - half, y: cy - half, w: 2 * half, h: 2 * half });
            }

            // Zone and the way back to the hub
            const ha = Math.atan2(hub.y - cy, hub.x - cx);
            const ex = cx + r * Math.cos(ha), ey = cy + r * Math.sin(ha), lx = cx + (r + 22) * Math.cos(ha), ly = cy + (r + 22) * Math.sin(ha);
            let z = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(11,18,32,0.34)" stroke="#3b82f6" stroke-width="2"/>`
                + `<line x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" stroke="#64748b" stroke-width="1" stroke-dasharray="5 3"/>`
                + `<line x1="${ex}" y1="${ey}" x2="${lx}" y2="${ly}" stroke="#94a3b8" stroke-width="1" marker-end="url(#tp-arr-drag)"/>`
                + `<text x="${lx}" y="${ly}" dy="3" text-anchor="middle" fill="#cbd5e1" font-size="8" font-family="monospace" ${HALO} stroke-width="2">HUB</text>`;
            if (rec && m.failedDroneId && byId.has(m.failedDroneId)) {
                const fd = byId.get(m.failedDroneId), fx = lx + 18, fy = ly;
                z += `<g opacity="0.45"><circle cx="${fx}" cy="${fy}" r="9" fill="#1e293b" stroke="#6b7280" stroke-width="1.5" stroke-dasharray="3 2"/>`
                    + `<image href="${esc(typeOf(ctx, fd.type).icon)}" x="${fx - 6}" y="${fy - 6}" width="12" height="12" style="filter:grayscale(1)"/>`
                    + `<text x="${fx}" y="${fy + 15}" text-anchor="middle" fill="#cbd5e1" font-size="7" font-family="monospace" ${HALO} stroke-width="2">${esc(droneLabel(ctx, fd.id))}</text>`
                    + `<line x1="${fx - 7}" y1="${fy - 7}" x2="${fx + 7}" y2="${fy + 7}" stroke="#ef4444" stroke-width="1.5"/><line x1="${fx + 7}" y1="${fy - 7}" x2="${fx - 7}" y2="${fy + 7}" stroke="#ef4444" stroke-width="1.5"/></g>`;
            }
            patch(zoneL, z);

            // Assignment arrows: the first leg of each drone's route, or its whole route while hovered
            let a = "";
            const assignees = {};
            for (const t of m.tasks) assignees[t.id] = p.dronePool.filter((id) => (st.assignments[t.id] || []).includes(id));
            for (const id of p.dronePool) {
                const seq = seqs[id] || [], pos = st.positions[id];
                if (!seq.length || !pos) continue;
                const type = byId.has(id) ? byId.get(id).type : typeOf(ctx, id).id;
                const colour = COMP_COLOUR[type] === "#86efac" ? "#4ade80" : COMP_COLOUR[type];
                const pts = [{ ...pos, taskId: null }];
                for (const tid of seq) { const t = m.tasks.find((x) => x.id === tid); if (t) pts.push({ ...t.waypoint, taskId: tid }); }
                const hl = st.hoverDrone === id;
                const legs = hl ? pts.length - 1 : 1;
                for (let i = 0; i < legs && i + 1 < pts.length; i++) {
                    const from = pts[i], to = pts[i + 1];
                    let qx = (from.x + to.x) / 2, qy = (from.y + to.y) / 2;
                    const n = (assignees[to.taskId] || []).length;
                    if (n > 1) {
                        const spread = ((assignees[to.taskId].indexOf(id)) - (n - 1) / 2) * 10;
                        const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy) || 1;
                        qx += (-dy / len) * spread; qy += (dx / len) * spread;
                    }
                    const bx = .25 * from.x + .5 * qx + .25 * to.x, by = .25 * from.y + .5 * qy + .25 * to.y;
                    a += `<path d="M ${from.x} ${from.y} Q ${qx} ${qy} ${to.x} ${to.y}" fill="none" stroke="${colour}" stroke-width="${hl ? 2.5 : 1.5}" stroke-opacity="${hl ? 1 : 0.6}" stroke-dasharray="6 4" marker-end="url(#tp-arr-${type.toLowerCase()})"/>`
                        + `<circle cx="${bx}" cy="${by}" r="4.5" fill="${colour}" opacity="0.9"/><text x="${bx}" y="${by}" text-anchor="middle" dominant-baseline="central" fill="white" font-size="5.5" font-weight="bold" font-family="monospace">${i + 1}</text>`;
                }
            }
            patch(arrowL, a);

            // Live drag wire
            let d = "";
            if (st.dragging) {
                const pos = st.positions[st.dragging.droneId] || { x: cx, y: cy };
                const snap = st.hoverTask ? m.tasks.find((t) => t.id === st.hoverTask) : null;
                const tx = snap ? snap.waypoint.x : st.dragging.x, ty = snap ? snap.waypoint.y : st.dragging.y;
                const type = byId.has(st.dragging.droneId) ? byId.get(st.dragging.droneId).type : "Blue";
                d = `<line x1="${pos.x}" y1="${pos.y}" x2="${tx}" y2="${ty}" stroke="${COMP_COLOUR[type]}" stroke-width="2" stroke-dasharray="5 3" opacity="0.75" marker-end="url(#tp-arr-drag)"/>`;
            }
            dragL.innerHTML = d;

            // Task waypoints with their composition badges
            let t = "";
            for (const task of m.tasks) {
                const { x, y } = task.waypoint, rule = taskRule(ctx, task.type), req = rule.primary, sub = rule.substitute;
                const name = `<text x="${x}" y="${y + (task.status === "completed" || task.status === "failed" ? 24 : 21)}" text-anchor="middle" fill="${task.status === "completed" || task.status === "failed" ? "#94a3b8" : "#cbd5e1"}" font-size="8" font-family="sans-serif" ${HALO} stroke-width="2">${TASK_NAMES[task.type]}</text>`;
                if (task.status === "completed") {
                    const R = 14, c = 2 * Math.PI * R;
                    t += `<circle cx="${x}" cy="${y}" r="${R}" fill="none" stroke="#10b981" stroke-width="2" opacity="0.5" stroke-dasharray="${c} ${c}" transform="rotate(-90 ${x} ${y})"/>`
                        + `<circle cx="${x}" cy="${y}" r="11" fill="rgba(16,185,129,0.06)" stroke="#374151" stroke-width="1" opacity="0.6"/>`
                        + `<image href="${TASK_ICON[task.type]}" x="${x - 6.5}" y="${y - 6.5}" width="13" height="13" opacity="0.35"/>` + name
                        + `<text x="${x}" y="${y + 33}" text-anchor="middle" fill="#94a3b8" font-size="7" font-family="monospace" ${HALO} stroke-width="2">✓ done</text>`;
                    continue;
                }
                if (task.status === "failed") {
                    t += `<circle cx="${x}" cy="${y}" r="11" fill="rgba(239,68,68,0.06)" stroke="#7f1d1d" stroke-width="1" opacity="0.6"/>`
                        + `<image href="${TASK_ICON[task.type]}" x="${x - 6.5}" y="${y - 6.5}" width="13" height="13" opacity="0.3"/>` + name
                        + `<text x="${x}" y="${y + 33}" text-anchor="middle" fill="#f87171" font-size="7" font-family="monospace" ${HALO} stroke-width="2">✕ failed</text>`;
                    continue;
                }
                const counts = store.counts(task.id);
                const meetsP = TYPES.every((k) => counts[k] >= (req[k] || 0));
                const meetsS = !!sub && TYPES.every((k) => counts[k] >= (sub[k] || 0));
                const complete = store.taskComplete(task);
                const hovered = st.hoverTask === task.id && !!st.dragging;
                const presentComp = rec && store.isLockout() && task.status === "pending" ? (present[task.id] || { Blue: 0, Red: 0, Green: 0 }) : null;
                const blocking = cycle.has(task.id);
                const statusMark = rec && task.status !== "pending" ? (task.status === "executing" ? "⟳" : task.status === "traveling" ? "→" : null) : null;
                const prog = task.status === "executing" && task.startTime != null && task.baseTime > 0 ? Math.min(1, Math.max(0, (s.elapsed - task.startTime) / task.baseTime)) : 0;
                if (prog > 0) { const R = 14, c = 2 * Math.PI * R; t += `<circle cx="${x}" cy="${y}" r="${R}" fill="none" stroke="#3b82f6" stroke-width="2" stroke-dasharray="${c} ${c}" stroke-dashoffset="${c * (1 - prog)}" transform="rotate(-90 ${x} ${y})"/>`; }
                const fill = blocking ? "rgba(220,38,38,0.14)" : complete ? "rgba(16,185,129,0.15)" : statusMark ? "rgba(245,158,11,0.08)" : hovered ? "rgba(59,130,246,0.25)" : "rgba(15,23,42,0.9)";
                const stroke = blocking ? "#dc2626" : complete ? "#10b981" : statusMark ? "#f59e0b" : hovered ? "#3b82f6" : "#475569";
                t += `<circle cx="${x}" cy="${y}" r="${hovered ? 14 : 11}" fill="${fill}" stroke="${stroke}" stroke-width="${hovered || blocking ? 2 : 1.5}"/>`;
                if (statusMark) t += `<text x="${x + 10}" y="${y - 8}" text-anchor="middle" fill="${statusMark === "⟳" ? "#f59e0b" : "#60a5fa"}" font-size="9" font-family="monospace">${statusMark}</text>`;
                t += `<image href="${TASK_ICON[task.type]}" x="${x - 6.5}" y="${y - 6.5}" width="13" height="13"/>` + name;
                if (complete && !blocking) {
                    t += `<text x="${x}" y="${y + 33}" text-anchor="middle" fill="#4ade80" font-size="7" font-family="monospace">✓</text>`;
                } else {
                    const spans = TYPES.filter((k) => req[k] > 0).map((k, i) => {
                        const col = meetsP ? "#4ade80" : meetsS ? "#facc15" : counts[k] >= req[k] ? "#9ca3af" : COMP_COLOUR[k];
                        return `<tspan fill="${col}">${i ? " " : ""}${counts[k]}/${req[k]}${LETTER[k]}</tspan>`;
                    }).join("");
                    t += `<text x="${x}" y="${y + 33}" text-anchor="middle" font-size="7" font-family="monospace" ${HALO} stroke-width="2">${spans}</text>`;
                    if (sub && !presentComp) t += `<text x="${x}" y="${y + 42}" text-anchor="middle" fill="#9ca3af" font-size="6.5" font-family="monospace" ${HALO} stroke-width="1.6">OR ${TYPES.filter((k) => sub[k] > 0).map((k) => sub[k] + LETTER[k]).join("+")} </text>`;
                }
                if (presentComp) {
                    const spans = TYPES.filter((k) => req[k] > 0).map((k, i) => {
                        const missing = presentComp[k] < req[k];
                        return `<tspan fill="${COMP_COLOUR[k]}"${missing ? ' font-weight="bold"' : ""}>${i ? " " : ""}${missing ? "!" : ""}${presentComp[k]}/${req[k]}${LETTER[k]}</tspan>`;
                    }).join("");
                    t += `<text x="${x}" y="${y + 42}" text-anchor="middle" font-size="6.5" font-family="monospace" ${HALO} stroke-width="1.6"><tspan fill="#94a3b8">now </tspan>${spans}</text>`;
                }
                if (blocking) t += `<circle cx="${x + 11}" cy="${y - 11}" r="5" fill="#dc2626" stroke="#0b1220" stroke-width="0.8"/><text x="${x + 11}" y="${y - 11}" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="7.5" font-weight="bold" font-family="sans-serif">!</text>`;
            }
            patch(taskL, t);

            // Drone icons round the zone edge
            let dr = "";
            for (const id of p.dronePool) {
                const pos = st.positions[id];
                if (!pos) continue;
                const type = byId.has(id) ? byId.get(id).type : typeOf(ctx, id).id, ty = typeOf(ctx, type);
                const colour = COMP_COLOUR[type] === "#86efac" ? "#4ade80" : COMP_COLOUR[type];
                const dragging = st.dragging && st.dragging.droneId === id, hov = st.hoverDrone === id;
                dr += `<g data-drone="${esc(id)}" style="cursor:${dragging ? "grabbing" : "grab"}"><circle cx="${pos.x}" cy="${pos.y}" r="8" fill="#1e293b" stroke="${hov ? "#fbbf24" : colour}" stroke-width="${dragging || hov ? 2.5 : 1.5}"/>`
                    + `<image href="${esc(ty.icon)}" x="${pos.x - 5}" y="${pos.y - 5}" width="10" height="10" pointer-events="none"/>`
                    + `<text x="${pos.x}" y="${pos.y + 14}" text-anchor="middle" fill="${colour}" font-size="6.5" font-family="monospace" pointer-events="none" ${HALO} stroke-width="1.6">${esc(droneLabel(ctx, id))}</text></g>`;
            }
            patch(droneL, dr);
        }
        return hook(ctx, store, render);
    },
});

// ── Task schedule ──────────────────────────────────────────────────────────────
registerPanel("taskSchedule", {
    create(el, ctx) {
        const store = getTacticalStore(ctx);
        startSelection(ctx, store);
        const box = div("st-ts", el);
        const banner = div("", box), unassigned = div("", box), list = div("st-ts-list", box), foot = div("st-ts-foot", box);
        box.addEventListener("click", (e) => {
            const b = e.target.closest("[data-act]");
            if (!b || b.disabled) return;
            const act = b.dataset.act;
            if (act === "remove") store.removeDrone(b.dataset.drone, b.dataset.task);
            else if (act === "deploy") store.deploy();
            else if (act === "stop") store.stopSuggest();
            else if (act === "abandon") store.abandon();
        });
        unassigned.addEventListener("dragstart", (e) => {
            const c = e.target.closest("[data-drone]");
            if (c) e.dataTransfer.setData("text/plain", c.dataset.drone);
        });

        return hook(ctx, store, () => {
            const st = store.get(), m = store.mission();
            box.style.visibility = m ? "" : "hidden";
            if (!m) return;
            const s = st.state, p = st.pending, rec = st.mode === "recovery", lockout = store.isLockout();
            const byId = new Map(s.assets.map((a) => [a.id, a]));
            const typeOfId = (id) => byId.has(id) ? byId.get(id).type : typeOf(ctx, id).id;
            const seqs = store.sequences(), timings = store.timings(seqs), cycle = store.cycleTasks(seqs), present = store.presentByTask();
            const canDeploy = store.canDeploy(seqs), revealing = st.suggestQueue.length > 0;

            // Help-needed banner
            let b = "";
            if (lockout) {
                b = '<div class="st-ts-banner"><b>⚠ Lockout — help needed</b><p>These drones deadlocked (each waiting on the other). The current — still broken — plan is shown below. Change it into a workable order (drag drones to reorder) or click <span style="color:#d8b4fe;font-weight:500">Suggest</span> for a fix, then Reassign. Or abandon.</p>'
                    + (cycle.size ? '<p style="color:#f87171;font-weight:600">Still deadlocked — Reassign is disabled until the cycle is broken.</p>' : "") + "</div>";
            } else if (rec && m.failedDroneId && byId.has(m.failedDroneId)) {
                const fd = byId.get(m.failedDroneId);
                b = `<div class="st-ts-banner"><div style="display:flex;align-items:center;gap:8px"><b>⚠ Drone Failed</b><span style="display:flex;align-items:center;gap:4px;padding:2px 6px;border-radius:4px;border:1px solid rgba(153,27,27,.5);background:rgba(127,29,29,.2)"><img src="${esc(typeOf(ctx, fd.type).icon)}" alt="" style="width:14px;height:14px;filter:grayscale(1);opacity:.5"><span class="st-mono" style="font-size:14px;color:#6b7280;text-decoration:line-through">${esc(droneLabel(ctx, fd.id))}</span></span></div>`
                    + '<p>Reassign its task using remaining mission drones (or click <span style="color:#d8b4fe;font-weight:500">Suggest</span> for a fix), or abandon.</p></div>';
            }
            patch(banner, b);

            // Drones not on any task yet (drag them onto the map)
            const free = p.dronePool.filter((id) => !p.taskOrder.some((tid) => (st.assignments[tid] || []).includes(id)));
            patch(unassigned, free.length ? `<div class="st-ts-un"><p class="st-ts-label">Unassigned (${free.length})</p><div class="st-chips">`
                + free.map((id) => `<div class="st-chip ${typeOfId(id)}" draggable="true" data-drone="${esc(id)}" title="Drag to task on map · hold Shift to chain"><img src="${esc(typeOf(ctx, typeOfId(id)).icon)}" alt="" style="width:14px;height:14px">${esc(droneLabel(ctx, id))}</div>`).join("")
                + "</div></div>" : "");

            // Task cards in their expected execution order
            const order = [...p.taskOrder].sort((x, y) => {
                const a = timings.taskStarts[x], c = timings.taskStarts[y];
                if (a != null && c != null) return a - c;
                if (a != null) return -1;
                if (c != null) return 1;
                return p.taskOrder.indexOf(x) - p.taskOrder.indexOf(y);
            });
            let html = '<p class="st-ts-label" style="margin-bottom:4px">Task Schedule</p>';
            order.forEach((tid, idx) => {
                const task = m.tasks.find((t) => t.id === tid);
                if (!task) return;
                const rule = taskRule(ctx, task.type), req = rule.primary, sub = rule.substitute;
                const assigned = st.assignments[tid] || [], counts = store.counts(tid);
                const meetsP = TYPES.every((k) => counts[k] >= (req[k] || 0)), meetsS = !!sub && TYPES.every((k) => counts[k] >= (sub[k] || 0));
                const complete = store.taskComplete(task), ts = timings.taskStarts[tid];
                html += `<div class="st-tcard${complete ? " ok" : ""}"><div class="hd"><span class="num">#${idx + 1}</span><img src="${TASK_ICON[task.type]}" alt="" style="width:16px;height:16px"><span class="nm">${TASK_NAMES[task.type]}</span>${complete ? '<span style="margin-left:auto;color:#4ade80;font-size:14px">✓</span>' : ""}</div>`
                    + `<div><div class="req"><span>Req:</span><span style="color:#d1d5db">${compLabel(req, rule.baseTime)}</span></div>`
                    + (sub ? `<div class="req"><span style="color:#4b5563">OR:</span><span style="color:#6b7280">${compLabel(sub, rule.substituteBaseTime)}</span></div>` : "") + "</div>";
                if (lockout && task.status === "pending") {
                    const pr = present[tid] || { Blue: 0, Red: 0, Green: 0 }, blocking = cycle.has(tid);
                    html += '<div style="display:flex;align-items:center;gap:6px;font-size:14px">'
                        + (blocking ? '<span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:#dc2626;color:#fff;font-size:12px;font-weight:700">!</span>' : "")
                        + '<span style="color:#6b7280">Present now:</span><span class="st-mono">'
                        + TYPES.filter((k) => req[k] > 0).map((k, i) => `<span style="color:${COMP_COLOUR[k]};${pr[k] < req[k] ? "font-weight:700" : ""}">${i ? " " : ""}${pr[k] < req[k] ? "!" : ""}${pr[k]}/${req[k]}${LETTER[k]}</span>`).join("")
                        + "</span>" + (blocking ? '<span style="color:rgba(248,113,113,.8)">blocking</span>' : "") + "</div>";
                }
                if (assigned.length) {
                    html += '<div class="st-chips">' + assigned.map((id) => `<div class="st-chip sm ${typeOfId(id)}">${esc(droneLabel(ctx, id))}<button data-act="remove" data-drone="${esc(id)}" data-task="${esc(tid)}" title="Remove">×</button></div>`).join("") + "</div>";
                    if (rec && task.status !== "pending") html += `<div class="st-mono" style="font-size:14px;color:${task.status === "executing" ? "#fbbf24" : "#60a5fa"}">${task.status === "executing" ? "⟳ executing" : "→ traveling"}</div>`;
                    if (!complete) html += `<div class="st-mono" style="font-size:14px;color:${meetsP ? "#4ade80" : meetsS ? "#facc15" : "#fbbf24"}">${TYPES.filter((k) => req[k] > 0).map((k) => counts[k] + "/" + req[k] + LETTER[k]).join(" ") || "—"}</div>`;
                } else html += '<p class="none">No drones assigned</p>';
                if (ts != null) html += `<div class="tm">Start ~${Math.round(ts)}s · Done ~${Math.round(ts + rule.baseTime)}s</div>`;
                if (complete) for (const [id, w] of Object.entries(timings.droneWaits[tid] || {})) html += `<div class="wt">${esc(droneLabel(ctx, id))} waiting ${w} seconds</div>`;
                html += "</div>";
            });
            patch(list, html);

            // Footer: ETA, stop the assistant, deploy / reassign, abandon
            let latest = null;
            for (const tid of p.taskOrder) {
                const ts = timings.taskStarts[tid], task = m.tasks.find((x) => x.id === tid);
                if (ts != null && task) latest = Math.max(latest ?? -Infinity, ts + task.baseTime);
            }
            let f = latest != null ? `<div class="eta">Est. completion: <b>~${Math.round(latest)}s</b></div>` : "";
            if (revealing) f += '<button class="stop" data-act="stop">Stop Assistant — take over</button>';
            const label = rec ? (canDeploy ? "Reassign ✓" : cycle.size ? "Reassign (still deadlocked)" : "Reassign (incomplete)")
                : revealing ? "Deploy (allocation in progress…)" : canDeploy ? "Deploy ✓" : "Deploy (incomplete)";
            f += `<button class="deploy" data-act="deploy" ${!canDeploy || (!rec && revealing) ? "disabled" : ""}>${label}</button>`;
            if (rec) f += '<button class="abandon" data-act="abandon">Abandon Mission</button>';
            patch(foot, f);
        });
    },
});
