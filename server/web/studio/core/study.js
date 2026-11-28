// Shared helpers for the strategic/tactical study panels: labels, formatting, scoring maths and small DOM tools.
// Game rules (task values, compositions, penalty rates) come from the server in config.rules, never from here.

export const TYPES = ["Blue", "Red", "Green"];
export const CATEGORY_NAME = { A: "Routine", B: "Moderate", C: "Significant", D: "Critical", E: "Mass Casualty" };
export const TASK_SHORT = { 1: "Rcc", 2: "Rcn", 3: "Sup", 4: "PSD", 5: "S&S" };
export const TASK_FULL = { 1: "Recce", 2: "Recon", 3: "Supply Drop", 4: "Prec Supply Drop", 5: "Search & Service" };
export const TASK_ICON = {
    1: "studio/icons/task-t1-recce.svg", 2: "studio/icons/task-t2-recon.svg", 3: "studio/icons/task-t3-minor-drop.svg",
    4: "studio/icons/task-t4-major-drop.svg", 5: "studio/icons/task-t5-search-supply.svg",
};
export const CATEGORY_ICON = (c) => "studio/icons/mission-cat-" + c.toLowerCase() + ".svg";

/** Escapes text for use inside HTML. */
export function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Sets an element's HTML only when it changed, so buttons inside stay put between state updates. */
export function patch(el, html) {
    if (el._html !== html) { el._html = html; el.innerHTML = html; }
}

export function div(cls, parent) {
    const d = document.createElement("div");
    if (cls) d.className = cls;
    if (parent) parent.appendChild(d);
    return d;
}

export function typeOf(ctx, assetIdOrType) {
    const id = String(assetIdOrType);
    if (ctx.types[id]) return ctx.types[id];
    for (const t of Object.values(ctx.types)) if (t.id.charAt(0) === id.charAt(0)) return t;
    return { id, label: id, short: id.charAt(0), colour: "#9ca3af", text: "#d1d5db" };
}

/** "B07" -> "Fast-7" */
export function droneLabel(ctx, id) {
    const t = typeOf(ctx, id);
    const n = parseInt(String(id).slice(1), 10);
    return isNaN(n) ? id : t.label + "-" + n;
}

export function fmtTime(seconds) {
    const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
    return m + "m " + String(s).padStart(2, "0") + "s";
}

export function fmtSeconds(s) {
    if (s < 60) return Math.round(s) + "s";
    return Math.floor(s / 60) + "m" + String(Math.round(s % 60)).padStart(2, "0") + "s";
}

export function fmtCountdown(elapsed, duration) {
    const rem = Math.max(0, duration - elapsed);
    return Math.floor(rem / 60) + ":" + String(Math.floor(rem % 60)).padStart(2, "0");
}

export function taskRule(ctx, type) {
    return ctx.config.rules.tasks[String(type)];
}

export function taskWeight(ctx, type) {
    return taskRule(ctx, type).weight;
}

/** Penalty a mission has accrued so far (each task stops accruing once it completes). */
export function missionPenalty(ctx, m, elapsed) {
    const total = m.tasks.reduce((s, t) => s + taskWeight(ctx, t.type), 0);
    if (!total) return 0;
    const rate = ctx.config.rules.categoryPenaltyRate[m.category];
    let p = 0;
    for (const t of m.tasks) {
        const end = t.status === "completed" ? (t.completionTime ?? elapsed) : elapsed;
        p += rate * taskWeight(ctx, t.type) / total * Math.max(0, end - m.arrivalTime);
    }
    return p;
}

export function urgencyOf(points) {
    return points < 20 ? "none" : points < 50 ? "low" : points < 100 ? "med" : "high";
}

/** The drone types a task's primary composition needs, one entry per drone. */
export function taskDots(ctx, type) {
    const c = taskRule(ctx, type).primary;
    const out = [];
    for (const t of TYPES) for (let i = 0; i < (c[t] || 0); i++) out.push(t);
    return out;
}

/** Per-type minimum for a mission: the largest primary demand of any one task. */
export function missionFloor(ctx, tasks) {
    const f = { Blue: 0, Red: 0, Green: 0 };
    for (const t of tasks) {
        const p = taskRule(ctx, t.type).primary;
        for (const k of TYPES) f[k] = Math.max(f[k], p[k] || 0);
    }
    return f;
}

export function droneIcon(ctx, type, size, extra) {
    const t = typeOf(ctx, type);
    return `<img src="${esc(t.icon)}" alt="" style="width:${size}px;height:${size}px;flex:none" ${extra || ""}>`;
}
