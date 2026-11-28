// Talks to the server: reads the study config and polls the engine state; sends operator actions.
export async function fetchConfig() {
    const r = await fetch("/strattac/config", { cache: "no-store" });
    if (!r.ok) throw new Error("config " + r.status);
    return r.json();
}

// Actions that start a session carry the browser's details, which session_start logs as the original did
const CLIENT_ACTIONS = new Set(["START_STUDY", "NEXT_SESSION"]);

export async function sendAction(action) {
    if (CLIENT_ACTIONS.has(action.type) && !action.client) {
        action = { ...action, client: {
            userAgent: navigator.userAgent,
            viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
        } };
    }
    const r = await fetch("/strattac/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
    });
    const out = await r.json().catch(() => ({ ok: false, error: "Bad response " + r.status }));
    if (!out.ok) console.warn("Action refused", action.type, out.error);
    return out;
}

// Polls /strattac/state and calls onState(state) whenever the engine has moved on.
// Polling keeps every tab independent (no tab is a host) and survives a tab being hidden.
export function pollState(onState, onLost, intervalMs = 100) {
    let lastVersion = -1, stopped = false, failures = 0;
    async function tick() {
        if (stopped) return;
        try {
            const r = await fetch("/strattac/state", { cache: "no-store" });
            if (!r.ok) throw new Error("state " + r.status);
            const s = await r.json();
            failures = 0;
            if (s.version !== lastVersion) { lastVersion = s.version; onState(s); }
        } catch (e) {
            if (++failures === 20) onLost && onLost(e);
        }
        setTimeout(tick, intervalMs);
    }
    tick();
    return () => { stopped = true; };
}
