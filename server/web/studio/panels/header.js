// Header bar. options.items picks and orders its parts:
//   badge, title, session, mode, test, spacer, testControls, clock, score, switchView, start
// "clock" adds a spacer before itself unless the list has an explicit "spacer".
import { registerPanel } from "../core/registry.js";
import { fmtCountdown, taskWeight } from "../core/study.js";

registerPanel("header", {
    create(el, ctx, options) {
        const items = options.items || ["badge", "title", "session", "clock", "switchView"];
        const bar = document.createElement("div");
        bar.className = "st-header";
        el.appendChild(bar);
        el.style.flex = "none";
        const parts = {};
        const make = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
        const add = (name, node) => { parts[name] = node; bar.appendChild(node); return node; };
        const button = (label, cls, title, onclick) => { const b = make("button", "st-btn st-btn-sm " + cls, label); b.title = title; b.onclick = onclick; return b; };

        for (const item of items) {
            if (item === "badge" && ctx.view.badge) {
                const b = add("badge", make("span", "st-badge", ctx.view.badge));
                b.style.color = ctx.view.accent || "var(--st-accent)";
            } else if (item === "title") {
                add("title", make("span", "st-title", ctx.view.title || ""));
            } else if (item === "session") {
                add("session", make("span", "st-dim")).style.cssText = "font-size:12px;text-transform:uppercase;letter-spacing:.05em";
            } else if (item === "mode") {
                add("mode", make("span", "st-pill"));
            } else if (item === "test") {
                add("test", make("span", "st-pill st-pill-test", "TEST")).hidden = true;
            } else if (item === "spacer") {
                add("spacer", make("span", "st-spacer"));
            } else if (item === "testControls") {
                // Researcher shortcuts, shown only in testing mode
                const box = add("testControls", make("span"));
                box.style.cssText = "display:none;gap:8px";
                box.append(
                    parts.forceArrival = button("New Mission", "st-btn-warn", "Spawn the next mission now", () => ctx.send({ type: "FORCE_MISSION_ARRIVAL" })),
                    parts.forceFailure = button("Force Failure", "st-btn-danger", "Fail a drone on an active mission", () => ctx.send({ type: "FORCE_DRONE_FAILURE" })),
                    button("End Session", "", "End this session now and go to the surveys", () => ctx.send({ type: "FORCE_SESSION_END" })),
                    button("End Study", "", "Skip straight to the end screen", () => ctx.send({ type: "END_STUDY" })));
            } else if (item === "clock") {
                if (!items.includes("spacer")) bar.appendChild(make("span", "st-spacer"));
                add("clock", make("span", "st-clock"));
            } else if (item === "score") {
                const sc = add("score", make("span", "st-score"));
                sc.innerHTML = '<span>Score: <b></b></span><span style="font-size:12px;color:#22c55e" title="Completion points earned"></span><span style="font-size:12px;color:#f87171" title="Accumulated wait penalty"></span>';
            } else if (item === "switchView" && ctx.config.interface) {
                // A button per other view, opening it in its own tab
                for (const name of Object.keys(ctx.config.interface.views)) {
                    if (name === ctx.viewName) continue;
                    const v = ctx.config.interface.views[name];
                    const label = (v.badge ? v.badge.charAt(0) + v.badge.slice(1).toLowerCase() : name) + " →";
                    add("switch-" + name, button(label, "", "Open the " + name + " view in its own tab", () => ctx.openView(name)));
                }
            } else if (item === "start") {
                // Until the study start screen exists (PR 6), this starts a study with the scenario defaults
                const st = add("start", button("Start study", "st-btn-primary", "Start a study with the scenario's settings", () => ctx.send({ type: "START_STUDY", config: {} })));
                st.hidden = true;
            }
        }

        return {
            update(s) {
                const test = !!s.config.testingMode;
                if (parts.session) parts.session.textContent = s.sessionNumber ? `Session ${s.sessionNumber} / ${s.numSessions}` : "";
                if (parts.mode) {
                    const agent = s.config.mode === "agent";
                    parts.mode.className = "st-pill " + (agent ? "st-pill-agent" : "st-pill-manual");
                    parts.mode.textContent = agent ? "Assistant Mode" : "Manual";
                }
                if (parts.test) parts.test.hidden = !test;
                if (parts.testControls) {
                    parts.testControls.style.display = test ? "flex" : "none";
                    parts.forceArrival.disabled = !s.pendingBlueprintCount;
                    parts.forceFailure.disabled = !s.missions.some((m) => m.status === "active" && !m.failureRecoveryPending
                        && s.assets.some((a) => a.currentMissionId === m.id && a.status === "deployed" && a.currentTaskId));
                }
                if (parts.clock) parts.clock.textContent = fmtCountdown(s.elapsed, s.sessionDuration);
                if (parts.score) {
                    const earned = s.missions.flatMap((m) => m.tasks).filter((t) => t.status === "completed")
                        .reduce((x, t) => x + taskWeight(ctx, t.type), 0);
                    const [a, b, c] = parts.score.children;
                    a.querySelector("b").textContent = Math.round(s.score);
                    b.textContent = "+" + earned;
                    c.textContent = "−" + Math.round(s.penaltyAccrued) + " pen";
                }
                if (parts.start) parts.start.hidden = s.phase !== "setup" && s.phase !== "done";
            },
        };
    },
});
