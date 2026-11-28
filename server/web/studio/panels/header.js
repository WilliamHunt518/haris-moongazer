// Header bar. options.items picks and orders its parts:
//   badge, title, session, clock, switchView, start
import { registerPanel } from "../core/registry.js";

function fmtClock(s) {
    s = Math.max(0, Math.ceil(s));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

registerPanel("header", {
    create(el, ctx, options) {
        const items = options.items || ["badge", "title", "session", "clock", "switchView"];
        const bar = document.createElement("div");
        bar.className = "st-header";
        el.appendChild(bar);
        el.style.flex = "none";
        const parts = {};
        const add = (name, node) => { parts[name] = node; bar.appendChild(node); return node; };
        for (const item of items) {
            if (item === "badge" && ctx.view.badge) {
                const b = add("badge", document.createElement("span"));
                b.className = "st-badge";
                b.style.color = ctx.view.accent || "var(--st-accent)";
                b.textContent = ctx.view.badge;
            } else if (item === "title") {
                const t = add("title", document.createElement("span"));
                t.className = "st-title";
                t.textContent = ctx.view.title || "";
            } else if (item === "session") {
                add("session", document.createElement("span")).className = "st-dim";
            } else if (item === "clock") {
                const sp = document.createElement("span"); sp.className = "st-spacer"; bar.appendChild(sp);
                add("clock", document.createElement("span")).className = "st-clock";
            } else if (item === "switchView") {
                // A button per other view, opening it in its own tab
                for (const name of Object.keys(ctx.config.interface.views)) {
                    if (name === ctx.viewName) continue;
                    const btn = add("switch-" + name, document.createElement("button"));
                    btn.className = "st-btn";
                    const v = ctx.config.interface.views[name];
                    btn.textContent = (v.badge ? v.badge.charAt(0) + v.badge.slice(1).toLowerCase() : name) + " →";
                    btn.title = "Open the " + name + " view in its own tab";
                    btn.onclick = () => ctx.openView(name);
                }
            }
        }
        // Until the study start screen exists, the header can start a session
        const start = document.createElement("button");
        start.className = "st-btn st-btn-primary";
        start.textContent = "Start session";
        start.hidden = true;
        start.onclick = () => ctx.send({ type: "START_SESSION" });
        bar.appendChild(start);
        return {
            update(s) {
                if (parts.session) parts.session.textContent = s.sessionNumber ? "Session " + s.sessionNumber : "";
                if (parts.clock) parts.clock.textContent = fmtClock(s.sessionSeconds - s.elapsed);
                start.hidden = s.phase !== "setup";
            },
        };
    },
});
