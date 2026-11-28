// The tactical planner's working state, shared by the tactical panels (mission queue, toolbar, planner map and task
// schedule) of one tab. The plan being built lives here, in the browser, until the operator deploys it: only then is it
// sent to the server, as in the original study. Every drag is still logged as it happens (TACTICAL_ASSIGN_CHANGED).
import { TYPES, typeOf, taskRule } from "./study.js";

const STATUS_PRIORITY = { executing: 0, traveling: 1, pending: 2 };
const REVEAL_MS = 1000;

export function getTacticalStore(ctx) {
    if (!ctx.tactical) ctx.tactical = createStore(ctx);
    return ctx.tactical;
}

/** Tasks lying on a dependency cycle of the plan (a task that can reach itself through the drones' sequences). */
export function tasksInCycles(assignments, sequences) {
    const graph = new Map();
    const ensure = (id) => { if (!graph.has(id)) graph.set(id, new Set()); };
    for (const tid of Object.keys(assignments)) ensure(tid);
    for (const seq of Object.values(sequences)) for (let i = 1; i < seq.length; i++) {
        ensure(seq[i - 1]); ensure(seq[i]); graph.get(seq[i - 1]).add(seq[i]);
    }
    const out = new Set();
    for (const start of graph.keys()) {
        const seen = new Set(), stack = [...graph.get(start)];
        while (stack.length) {
            const n = stack.pop();
            if (n === start) { out.add(start); break; }
            if (seen.has(n)) continue;
            seen.add(n);
            for (const m of graph.get(n) || []) stack.push(m);
        }
    }
    return out;
}

function countTypes(ctx, ids, assetById) {
    const c = { Blue: 0, Red: 0, Green: 0 };
    for (const id of ids) {
        const a = assetById.get(id);
        const t = a ? a.type : typeOf(ctx, id).id;
        c[t] = (c[t] || 0) + 1;
    }
    return c;
}
const meets = (c, req) => !!req && TYPES.every((t) => (c[t] || 0) >= (req[t] || 0));

function createStore(ctx) {
    const listeners = [];
    const st = {
        state: null, selectedId: null, mode: null, key: null, pending: null, pendingKey: "",
        assignments: {}, chainOrder: {}, positions: {},
        suggestQueue: [], suggestNote: null, recoverySuggestUsed: false, suggesting: false,
        hoverDrone: null, dragging: null, hoverTask: null,
    };
    let revealTimer = null;

    const emit = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } };
    const mission = () => st.state && st.selectedId ? st.state.missions.find((m) => m.id === st.selectedId) || null : null;
    const assetById = () => new Map(st.state.assets.map((a) => [a.id, a]));
    const needsTactical = (m) => (m.tacticalPending && !!m.pendingAllocation) || m.failureRecoveryPending;

    function buildRecoveryAllocation(m) {
        const pool = st.state.assets.filter((a) => a.currentMissionId === m.id && a.status === "deployed").map((a) => a.id);
        const poolSet = new Set(pool);
        const taskOrder = m.tasks.filter((t) => t.status !== "completed" && t.status !== "failed")
            .sort((a, b) => (STATUS_PRIORITY[a.status] ?? 3) - (STATUS_PRIORITY[b.status] ?? 3) || b.type - a.type).map((t) => t.id);
        const taskAssignments = {};
        for (const tid of taskOrder) taskAssignments[tid] = m.tasks.find((t) => t.id === tid).assignedAssetIds.filter((id) => poolSet.has(id));
        return { dronePool: pool, taskOrder, taskAssignments, hasTacticalError: false, suppressedTaskId: null };
    }

    function initialAssignments() {
        const p = st.pending;
        if (st.mode === "recovery") return Object.fromEntries(Object.entries(p.taskAssignments).map(([k, v]) => [k, [...v]]));
        return Object.fromEntries(Object.keys(p.taskAssignments).map((k) => [k, []]));
    }

    // A lockout recovery starts from the deadlocked order itself, so the cycle is visible and Deploy blocked
    function initialChainOrder(m) {
        if (!(st.mode === "recovery" && m.recoveryReason === "lockout")) return {};
        const poolSet = new Set(st.pending.dronePool), taskSet = new Set(st.pending.taskOrder), out = {};
        for (const [id, seq] of Object.entries(m.droneSequences || {})) {
            if (!poolSet.has(id)) continue;
            const f = seq.filter((t) => taskSet.has(t));
            if (f.length) out[id] = f;
        }
        return out;
    }

    // Keeps the operator's work when the pool or the task list moves underneath the plan
    function prune() {
        const poolSet = new Set(st.pending.dronePool), taskSet = new Set(st.pending.taskOrder);
        const a = {};
        for (const tid of st.pending.taskOrder) a[tid] = (st.assignments[tid] || []).filter((id) => poolSet.has(id));
        const c = {};
        for (const [id, seq] of Object.entries(st.chainOrder)) {
            if (!poolSet.has(id)) continue;
            const kept = seq.filter((t) => taskSet.has(t) && a[t] && a[t].includes(id));
            if (kept.length) c[id] = kept;
        }
        st.assignments = a; st.chainOrder = c;
    }

    function entryAngle(wp, cx, cy, r, hub) {
        const dx = wp.x - hub.x, dy = wp.y - hub.y, fx = hub.x - cx, fy = hub.y - cy;
        const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
        const disc = b * b - 4 * a * c;
        if (disc < 0 || a < 0.001) return Math.atan2(wp.y - cy, wp.x - cx);
        const t = (-b - Math.sqrt(disc)) / (2 * a);
        return Math.atan2(hub.y + t * dy - cy, hub.x + t * dx - cx);
    }

    // Drone icons sit round the zone edge, each near where its first task is entered from the hub
    function computePositions(m) {
        const pool = st.pending.dronePool;
        if (!pool.length) return {};
        const hub = { x: st.state.hub[0], y: st.state.hub[1] };
        const { x: cx, y: cy } = m.zoneCenter, r = m.zoneRadius, R = r + 28, TWO_PI = Math.PI * 2;
        const hubAngle = Math.atan2(hub.y - cy, hub.x - cx);
        const desired = {};
        for (const id of pool) {
            const first = st.pending.taskOrder.find((tid) => (st.pending.taskAssignments[tid] || []).includes(id));
            desired[id] = first ? entryAngle(m.tasks.find((t) => t.id === first).waypoint, cx, cy, r, hub) : hubAngle;
        }
        const norm = (a) => ((a % TWO_PI) + TWO_PI) % TWO_PI;
        const sorted = [...pool].sort((a, b) => norm(desired[a]) - norm(desired[b]));
        const minGap = Math.min(22 / R, TWO_PI / sorted.length);
        const ang = sorted.map((id) => norm(desired[id]));
        for (let i = 1; i < ang.length; i++) while (ang[i] < ang[i - 1]) ang[i] += TWO_PI;
        for (let i = 1; i < ang.length; i++) if (ang[i] < ang[i - 1] + minGap) ang[i] = ang[i - 1] + minGap;
        const span = ang.length > 1 ? ang[ang.length - 1] - ang[0] : 0, maxSpan = TWO_PI - minGap;
        if (span > maxSpan) for (let i = 1; i < ang.length; i++) ang[i] = ang[0] + (ang[i] - ang[0]) * maxSpan / span;
        const mid = Math.floor(sorted.length / 2), shift = norm(desired[sorted[mid]]) - ang[mid];
        const out = {};
        sorted.forEach((id, i) => { out[id] = { x: cx + R * Math.cos(ang[i] + shift), y: cy + R * Math.sin(ang[i] + shift) }; });
        return out;
    }

    function stopReveal() { st.suggestQueue = []; if (revealTimer) { clearInterval(revealTimer); revealTimer = null; } }

    function log(op, droneId, taskId) {
        const m = mission();
        if (m) ctx.send({ type: "TACTICAL_ASSIGN_CHANGED", missionId: m.id, op, droneId, taskId, recoveryMode: st.mode === "recovery" });
    }

    // The tutorial panel listens for these to advance its steps
    const tut = (name, detail) => document.dispatchEvent(new CustomEvent("tutorial-" + name, { detail }));

    const api = {
        get: () => st,
        mission,
        onChange(fn) { listeners.push(fn); },

        select(id) {
            if (st.suggesting || st.suggestQueue.length) return;
            st.selectedId = id; st.key = null; st.synced = false;
            api.sync(st.state);
            tut("mission-selected", id);
        },
        back() { stopReveal(); st.selectedId = null; st.key = null; st.synced = false; api.sync(st.state); },

        /** Called with every new server state. */
        sync(s) {
            if (!s || (s === st.state && st.synced)) return;
            st.synced = true;
            st.state = s;
            let m = mission();
            // A mission leaves the planner as soon as it no longer needs a tactical decision (deployed, resolved)
            if (st.selectedId && (!m || !needsTactical(m))) { stopReveal(); st.selectedId = null; st.key = null; m = null; }
            if (m) {
                st.mode = m.failureRecoveryPending ? "recovery" : "plan";
                st.pending = st.mode === "recovery" ? buildRecoveryAllocation(m) : m.pendingAllocation;
                const key = m.id + ":" + st.mode;
                const pk = st.pending.dronePool.join(",") + "|" + st.pending.taskOrder.join(",");
                if (key !== st.key) {
                    stopReveal();
                    st.key = key; st.pendingKey = pk;
                    st.assignments = initialAssignments(); st.chainOrder = initialChainOrder(m);
                    st.suggestNote = null; st.recoverySuggestUsed = false; st.dragging = null; st.hoverTask = null;
                    st.positions = computePositions(m);
                } else if (pk !== st.pendingKey) {
                    st.pendingKey = pk; prune(); st.positions = computePositions(m);
                }
            } else {
                st.mode = null; st.pending = null;
            }
            emit();
        },

        sequences() {
            const out = {};
            if (!st.pending) return out;
            for (const id of st.pending.dronePool) {
                const user = st.chainOrder[id];
                out[id] = user && user.length
                    ? user.filter((t) => (st.assignments[t] || []).includes(id))
                    : st.pending.taskOrder.filter((t) => (st.assignments[t] || []).includes(id));
            }
            return out;
        },

        /** Estimated start time of each task and how long early drones wait there, from the drones' current positions. */
        timings(seqs) {
            const m = mission(), byId = assetById(), arrivals = {};
            for (const id of st.pending.dronePool) {
                const a = byId.get(id);
                if (!a) continue;
                const speed = typeOf(ctx, a.type).speed || 10;
                arrivals[id] = {};
                let pos = a.position, time = 0;
                for (const tid of seqs[id] || []) {
                    const t = m.tasks.find((x) => x.id === tid);
                    if (!t) continue;
                    arrivals[id][tid] = time + Math.hypot(t.waypoint.x - pos.x, t.waypoint.y - pos.y) / speed;
                    time = arrivals[id][tid] + t.baseTime;
                    pos = t.waypoint;
                }
            }
            const taskStarts = {}, droneWaits = {};
            for (const tid of Object.keys(st.assignments)) {
                const ids = st.assignments[tid] || [];
                const arr = ids.map((id) => arrivals[id] && arrivals[id][tid]).filter((x) => x != null);
                if (!arr.length) continue;
                const ts = Math.max(...arr);
                taskStarts[tid] = ts; droneWaits[tid] = {};
                for (const id of ids) {
                    const at = arrivals[id] && arrivals[id][tid];
                    if (at != null && ts - at > 3) droneWaits[tid][id] = Math.round(ts - at);
                }
            }
            return { taskStarts, droneWaits };
        },

        counts(taskId) { return countTypes(ctx, st.assignments[taskId] || [], assetById()); },

        taskComplete(task) {
            if (st.pending.hasTacticalError && task.id === st.pending.suppressedTaskId) return true;
            const c = api.counts(task.id), r = taskRule(ctx, task.type);
            return meets(c, r.primary) || meets(c, r.substitute);
        },

        isLockout() { const m = mission(); return st.mode === "recovery" && m && m.recoveryReason === "lockout"; },
        cycleTasks(seqs) { return api.isLockout() ? tasksInCycles(st.assignments, seqs) : new Set(); },

        /** Drones physically parked at each task (lockout recovery shows what actually reached where). */
        presentByTask() {
            const m = mission(), out = {};
            if (!api.isLockout()) return out;
            const byId = assetById();
            const pts = st.pending.taskOrder.map((tid) => { const t = m.tasks.find((x) => x.id === tid); return t ? { tid, wp: t.waypoint } : null; }).filter(Boolean);
            for (const id of st.pending.dronePool) {
                const a = byId.get(id);
                if (!a) continue;
                let best = null;
                for (const { tid, wp } of pts) { const d = Math.hypot(a.position.x - wp.x, a.position.y - wp.y); if (!best || d < best.d) best = { tid, d }; }
                if (best && best.d < 20) { const c = out[best.tid] || (out[best.tid] = { Blue: 0, Red: 0, Green: 0 }); c[a.type]++; }
            }
            return out;
        },

        canDeploy(seqs) {
            if (!st.pending) return false;
            if (api.cycleTasks(seqs).size) return false;
            const m = mission();
            const check = st.state.config.tacticalMode === "greedy" && st.mode !== "recovery" ? st.pending.taskOrder.slice(0, 1) : st.pending.taskOrder;
            return check.every((tid) => api.taskComplete(m.tasks.find((t) => t.id === tid)));
        },

        // ── Editing ────────────────────────────────────────────────────────────
        moveDrone(droneId, taskId, chain) {
            st.suggestNote = null;
            log(chain ? "chain" : "assign", droneId, taskId);
            const existing = st.chainOrder[droneId] || st.pending.taskOrder.filter((t) => (st.assignments[t] || []).includes(droneId));
            if (!chain) {
                for (const tid of Object.keys(st.assignments)) st.assignments[tid] = st.assignments[tid].filter((id) => id !== droneId);
                st.assignments[taskId] = [...(st.assignments[taskId] || []), droneId];
                st.chainOrder = { ...st.chainOrder, [droneId]: [taskId] };
            } else {
                if (!(st.assignments[taskId] || []).includes(droneId)) st.assignments[taskId] = [...(st.assignments[taskId] || []), droneId];
                if (!existing.includes(taskId)) st.chainOrder = { ...st.chainOrder, [droneId]: [...existing, taskId] };
            }
            emit();
            if (!chain) tut("drone-assigned", { droneId, taskId });
            else if (!existing.includes(taskId)) tut("drone-chained", { droneId, taskId });
        },
        removeDrone(droneId, taskId) {
            log("remove", droneId, taskId);
            st.assignments[taskId] = (st.assignments[taskId] || []).filter((id) => id !== droneId);
            st.chainOrder = { ...st.chainOrder, [droneId]: (st.chainOrder[droneId] || []).filter((t) => t !== taskId) };
            emit();
        },
        unassignDrone(droneId) {
            log("unassign", droneId, null);
            for (const tid of Object.keys(st.assignments)) st.assignments[tid] = st.assignments[tid].filter((id) => id !== droneId);
            st.chainOrder = { ...st.chainOrder, [droneId]: [] };
            emit();
        },
        reset() {
            stopReveal();
            st.suggestNote = null; st.recoverySuggestUsed = false;
            st.assignments = initialAssignments(); st.chainOrder = initialChainOrder(mission());
            emit();
        },
        setHover(patch) { Object.assign(st, patch); emit(); },

        // ── The Tactical Assistant ─────────────────────────────────────────────
        async suggest() {
            const m = mission();
            if (!m || st.suggesting) return;
            st.suggestNote = null;
            tut("suggest-clicked");
            const recovery = st.mode === "recovery";
            // Lockout with every task already staffed: keep the drones, just untangle the order (canonical order is acyclic)
            if (api.isLockout()) {
                const pendingIds = st.pending.taskOrder.filter((tid) => (m.tasks.find((t) => t.id === tid) || {}).status === "pending");
                if (pendingIds.length && pendingIds.every((tid) => api.taskComplete(m.tasks.find((t) => t.id === tid)))) {
                    st.chainOrder = {}; st.recoverySuggestUsed = true;
                    ctx.send({ type: "TACTICAL_SUGGEST", missionId: m.id, recoveryMode: true, currentAssignments: st.assignments });
                    emit();
                    return;
                }
            }
            st.suggesting = true; emit(); tut("suggest-loading", true);
            const r = await ctx.send({ type: "TACTICAL_SUGGEST", missionId: m.id, recoveryMode: recovery, currentAssignments: recovery ? st.assignments : undefined });
            st.suggesting = false; tut("suggest-loading", false);
            const now = mission();
            if (!r.ok || !now || now.id !== m.id) { emit(); return; }
            const suggestion = r.taskAssignments || {};
            const entries = [];
            for (const tid of st.pending.taskOrder) for (const droneId of suggestion[tid] || []) entries.push({ taskId: tid, droneId });
            if (recovery && !entries.length) {
                const byId = assetById();
                const short = st.pending.taskOrder.filter((tid) => {
                    const t = m.tasks.find((x) => x.id === tid);
                    if (!t || t.status !== "pending") return false;
                    const c = countTypes(ctx, (st.assignments[tid] || []).filter((id) => byId.has(id)), byId), rule = taskRule(ctx, t.type);
                    return !(meets(c, rule.primary) || meets(c, rule.substitute));
                });
                st.suggestNote = short.length ? "No workable plan with the drones left on this mission." : "Plan already covers every remaining task.";
                emit();
                return;
            }
            if (recovery) {
                const tasks = new Set(entries.map((e) => e.taskId)), drones = new Set(entries.map((e) => e.droneId));
                st.assignments = Object.fromEntries(Object.entries(st.assignments).filter(([tid]) => !tasks.has(tid)));
                st.chainOrder = Object.fromEntries(Object.entries(st.chainOrder).filter(([id]) => !drones.has(id)));
                st.recoverySuggestUsed = true;
            } else {
                st.assignments = {};
                // A tactical route failure hands over the assistant's actual (detour-first) routes, as the original does
                st.chainOrder = r.droneSequences
                    ? Object.fromEntries(Object.entries(r.droneSequences).filter(([id]) => st.pending.dronePool.includes(id)))
                    : {};
            }
            st.suggestQueue = entries;
            // The plan appears one drone a second, as in the original
            revealTimer = setInterval(() => {
                const next = st.suggestQueue.shift();
                if (!next) { stopReveal(); emit(); return; }
                const cur = st.assignments[next.taskId] || [];
                if (!cur.includes(next.droneId)) st.assignments[next.taskId] = [...cur, next.droneId];
                if (!st.suggestQueue.length) stopReveal();
                emit();
            }, REVEAL_MS);
            emit();
        },
        stopSuggest() { stopReveal(); emit(); },

        deploy() {
            const m = mission();
            if (!m) return;
            const seqs = api.sequences();
            if (st.mode === "recovery") ctx.send({ type: "CONFIRM_FAILURE_RECOVERY", missionId: m.id, taskAssignments: st.assignments, droneSequences: seqs, wasAgentSuggested: st.recoverySuggestUsed });
            else ctx.send({ type: "CONFIRM_TACTICAL", missionId: m.id, taskAssignments: st.assignments, droneSequences: seqs });
        },
        abort() { const m = mission(); if (m) ctx.send({ type: "OVERRIDE_TACTICAL", missionId: m.id }); },
        abandon() { const m = mission(); if (m) ctx.send({ type: "ABANDON_MISSION", missionId: m.id }); },
    };
    return api;
}
