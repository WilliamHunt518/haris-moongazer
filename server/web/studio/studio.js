// HARIS Studio: builds a view of the strategic/tactical study from the scenario's interface block.
//   studio.html?view=strategic   the strategic view (mission allocation over the whole area)
//   studio.html?view=tactical    the tactical view (drone to task planning inside one mission)
// Each view is meant for its own browser tab or screen. All tabs read the same server state.
import { buildLayout } from "./core/layout.js";
import { fetchConfig, pollState, sendAction } from "./core/client.js";
import "./panels/index.js";

const root = document.getElementById("studio");

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
        // Opens another view in its own tab (re-using it if already open)
        openView(name, extra) {
            const q = new URLSearchParams({ view: name, ...(extra || {}) });
            window.open("studio.html?" + q.toString(), "haris-studio-" + name);
        },
    };

    root.innerHTML = "";
    root.className = "st-root" + (view.frame ? " st-framed" : "");
    if (view.frame) root.style.borderWidth = view.frame + "px";
    const instances = [];
    const top = buildLayout(root, view.layout || { column: [] }, ctx, instances);
    top.style.flex = "1 1 0";

    pollState((state) => {
        ctx.state = state;
        for (const inst of instances) {
            try { inst.update && inst.update(state); } catch (e) { console.error(e); }
        }
    }, () => console.warn("Lost contact with the server"));
}

main();
