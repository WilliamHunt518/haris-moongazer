// HARIS Studio: builds a view of the strategic/tactical study from the scenario's interface block.
//   studio.html?view=strategic   the strategic view (mission allocation over the whole area)
//   studio.html?view=tactical    the tactical view (drone to task planning inside one mission)
// Each view is meant for its own browser tab or screen. All tabs read the same server state.
import { buildLayout, buildOverlay } from "./core/layout.js";
import { fetchConfig, pollState, sendAction } from "./core/client.js";
import "./panels/index.js";

const root = document.getElementById("studio");
const channel = "BroadcastChannel" in window ? new BroadcastChannel("haris-studio") : null;

function message(html) {
    root.className = "st-root";
    root.style.borderWidth = "";
    root.innerHTML = '<div class="st-message">' + html + "</div>";
}

async function main() {
    let config;
    try {
        config = await fetchConfig();
    } catch (e) {
        message("Cannot reach the HARIS server.");
        return;
    }
    if (!config.enabled) {
        message('No strategic/tactical scenario is loaded. Launch one from the <a href="index.html">launcher</a>.');
        return;
    }
    // The simulator's main loop drives the engine; start it if this is the first tab to open
    try {
        const running = await (await fetch("/mode/in-progress", { cache: "no-store" })).json();
        if (!running) await fetch("/mode/scenario/start", { method: "POST" });
    } catch (e) { /* the server reports problems through the state poll */ }

    const ui = config.interface || {};
    const views = ui.views || {};
    const params = new URLSearchParams(location.search);
    const viewName = params.get("view") || Object.keys(views)[0];
    const view = views[viewName];
    if (!view) {
        message("This scenario has no view called <b></b>.");
        root.querySelector("b").textContent = viewName;
        return;
    }
    document.title = (view.badge ? view.badge.charAt(0) + view.badge.slice(1).toLowerCase() + " · " : "") + (config.gameId || "HARIS Studio");
    if (view.accent) document.documentElement.style.setProperty("--st-accent", view.accent);

    const types = {};
    for (const t of (config.strattac && config.strattac.droneTypes) || []) types[t.id] = t;

    const ctx = {
        config, viewName, view, types, params,
        state: null,
        send: sendAction,
        // Opens another view in its own tab. If that tab is already open it is told what to show (for example
        // which mission) instead of reloading, so whatever the operator had open there survives.
        openView(name, extra) {
            const url = "studio.html?" + new URLSearchParams({ view: name, ...(extra || {}) }).toString();
            const target = "haris-studio-" + name;
            let w = null;
            try { w = window.open("", target); } catch (e) { /* popup blocked */ }
            let fresh = true;
            try { fresh = !w || !w.location.pathname.endsWith("studio.html"); } catch (e) { /* not readable yet */ }
            if (fresh) { if (w) w.location.href = url; else window.open(url, target); return; }
            channel && channel.postMessage({ view: name, ...(extra || {}) });
            w.focus();
        },
        // Calls fn(message) when another tab asks this view to show something (see openView)
        onViewMessage(fn) { viewListeners.push(fn); },
    };
    const viewListeners = [];
    if (channel) channel.onmessage = (e) => {
        if (e.data && e.data.view === viewName) for (const fn of viewListeners) fn(e.data);
    };

    root.innerHTML = "";
    root.className = "st-root" + (view.frame ? " st-framed" : "");
    if (view.frame) root.style.borderWidth = view.frame + "px";
    const instances = [];
    const top = buildLayout(root, view.layout || { column: [] }, ctx, instances);
    top.style.flex = "1 1 0";
    for (const node of view.overlays || []) buildOverlay(root, node, ctx, instances);

    pollState((state) => {
        ctx.state = state;
        for (const inst of instances) {
            try { inst.update && inst.update(state); } catch (e) { console.error(e); }
        }
    }, () => console.warn("Lost contact with the server"));
}

main();
