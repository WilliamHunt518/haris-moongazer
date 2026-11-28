// The guided tutorial, ported from the original's Tutorial and TacticalTutorial: a card that walks through
// every part of the interface, with a spotlight on the part being explained, then the free-practice checklist.
// It sits over the view (an entry in the view's "overlays").
//   options.role "primary" (default): the strategic view's steps, Skip, and the free-practice box.
//                "secondary": the steps marked inMapWindow (the tactical view).
// The current step lives on the server, so both views follow it; whichever view shows a step moves it on.
import { registerPanel } from "../core/registry.js";
import { esc, TASK_ICON, CATEGORY_ICON } from "../core/study.js";
import { TUTORIAL_STEPS, TACTICAL_STEP_LAST, SERVER_EFFECT_STEPS } from "../core/tutorialSteps.js";

const MARGIN = 12;
const TEXT_COLOUR = { Blue: "#93c5fd", Red: "#fca5a5", Green: "#86efac" };
const TOKEN = /\{(blue|red|green|t[1-5]|cat[a-e])\}/gi;

const clamp = (lo, v, hi) => Math.max(lo, Math.min(hi, v));
const indexOf = (id) => TUTORIAL_STEPS.findIndex((s) => s.id === id);

// {blue} {red} {green} → drone icon + label; {T1}..{T5} → task icon + "T1"; {catA}..{catE} → category icon + "Cat A"
export function tutorialText(ctx, text) {
    const chip = (icon, label, colour) => `<span class="st-tut-chip"><img src="${esc(icon)}" alt=""><b style="color:${colour}">${esc(label)}</b></span>`;
    let out = "", last = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(text)) !== null) {
        out += esc(text.slice(last, m.index));
        const t = m[1].toLowerCase();
        if (t === "blue" || t === "red" || t === "green") {
            const id = t[0].toUpperCase() + t.slice(1), type = ctx.types[id] || {};
            out += chip(type.icon || "", type.label || id, TEXT_COLOUR[id]);
        } else if (t[0] === "t") out += chip(TASK_ICON[+t[1]], "T" + t[1], "#cbd5e1");
        else out += chip(CATEGORY_ICON(t[3]), "Cat " + t[3].toUpperCase(), "#e2e8f0");
        last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
}

function cardPosition(spot, side, vw, vh, w, h, gap) {
    const top0 = clamp(MARGIN, (vh - h) / 2, vh - h - MARGIN), left0 = clamp(MARGIN, (vw - w) / 2, vw - w - MARGIN);
    if (side === "center") return { top: top0, left: left0 };
    if (!spot) {
        if (side === "right") return { top: top0, left: vw - w - MARGIN };
        if (side === "left") return { top: top0, left: MARGIN };
        return { top: top0, left: left0 };
    }
    let top, left;
    if (side === "right") { left = spot.right + gap; top = spot.top; if (left + w > vw - MARGIN) left = spot.left - w - gap; }
    else if (side === "left") { left = spot.left - w - gap; top = spot.top; if (left < MARGIN) left = spot.right + gap; }
    else if (side === "bottom") { top = spot.bottom + gap; left = spot.left; if (top + h > vh - MARGIN) top = spot.top - h - gap; }
    else { top = spot.top - h - gap; left = spot.left; if (top < MARGIN) top = spot.bottom + gap; }
    return { top: clamp(MARGIN, top, vh - h - MARGIN), left: clamp(MARGIN, left, vw - w - MARGIN) };
}

const fmt = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");

registerPanel("tutorial", {
    create(el, ctx, options) {
        const primary = (options.role || "primary") === "primary";
        const CARD_W = primary ? 390 : 370, GAP = primary ? 16 : 14;
        el.classList.add("st-tut");
        if (!primary) el.classList.add("st-tut-secondary");
        el.hidden = true;
        el.innerHTML = '<div class="st-tut-dim"></div><div class="st-tut-ring"></div><div class="st-tut-card"></div><div class="st-tut-free"></div>';
        const [dimHost, ring, card, freeBox] = el.children;
        let last = null, step = -1, cardKey = "", spot = null, sending = false;
        let suggestLoading = false, eventCount = 0, sawRecovery = false, recoveredFired = false;
        const fired = new Set();   // auto-advance fired for these steps (re-armed when a step is re-entered)

        const owns = (cur) => !!cur && !!cur.inMapWindow !== primary;

        // ── Moving between steps ─────────────────────────────────────────────
        function target(from, dir) {
            let idx = from + dir;
            // Going back, step over a must-do step whose action is already done (as the original)
            while (dir === -1 && idx > 0) {
                const st = TUTORIAL_STEPS[idx];
                if (!st.mustInteract || !st.autoAdvanceWhen || !st.autoAdvanceWhen(last, ctx)) break;
                idx--;
            }
            return clamp(0, idx, TUTORIAL_STEPS.length - 1);
        }
        async function go(to) {
            if (sending || !last) return;
            sending = true;
            const reached = SERVER_EFFECT_STEPS.filter((id) => indexOf(id) <= to);
            try { await ctx.send({ type: "TUTORIAL_STEP", from: step, to, reached }); } finally { sending = false; }
        }
        const next = () => go(target(step, 1));
        const back = () => go(target(step, -1));
        const finish = () => ctx.send({ type: "TUTORIAL_FINISH" });

        // Page events from the other panels (tactical view): a mission picked, a drag, a chain, the plan complete...
        for (const name of ["tutorial-mission-selected", "tutorial-drone-assigned", "tutorial-drone-chained", "tutorial-plan-complete", "tutorial-suggest-clicked", "tutorial-manual-selected"]) {
            document.addEventListener(name, () => {
                const cur = TUTORIAL_STEPS[step];
                if (!last || !owns(cur)) return;
                if (name === "tutorial-manual-selected" && cur.id === "panel-intro") { next(); return; }
                if (cur.advanceOn !== name) return;
                eventCount++;
                if (eventCount >= (cur.advanceCount || 1)) { const from = step; setTimeout(() => { if (step === from) next(); }, cur.advanceCount ? 400 : 0); }
            });
        }
        document.addEventListener("tutorial-suggest-loading", (e) => { suggestLoading = !!e.detail; draw(true); });
        window.addEventListener("keydown", (e) => {
            if (e.code !== "Space" || !last) return;
            const cur = TUTORIAL_STEPS[step];
            if (!owns(cur) || gated(cur) || (cur.waitForSuggest && suggestLoading)) return;
            if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
            e.preventDefault();
            step === TUTORIAL_STEPS.length - 1 ? finish() : next();
        });
        el.addEventListener("click", (e) => {
            const b = e.target.closest("[data-act]");
            if (!b || b.disabled) return;
            const act = b.dataset.act;
            if (act === "next") step === TUTORIAL_STEPS.length - 1 ? finish() : next();
            else if (act === "back") back();
            else if (act === "skip") finish();
            else if (act === "skipFree") ctx.send({ type: "FREE_PLAY_END" });
        });
        window.addEventListener("resize", () => draw(true));
        const timer = setInterval(() => { if (!el.hidden) measure(); }, 250);

        // ── Drawing ──────────────────────────────────────────────────────────
        const stuck = (cur) => !!cur.mustInteract && !!cur.unsatisfiableWhen && cur.unsatisfiableWhen(last, ctx);
        const gated = (cur) => !!cur.mustInteract && !stuck(cur);

        function measure() {
            const cur = TUTORIAL_STEPS[step];
            let s = null;
            if (cur && owns(cur) && cur.highlight) {
                const t = document.querySelector(`[data-tutorial="${cur.highlight}"]`);
                if (t && t.getClientRects().length) {
                    const r = t.getBoundingClientRect(), pad = cur.spotlightPadding ?? 8;
                    s = { top: Math.max(0, r.top - pad), left: Math.max(0, r.left - pad), right: Math.min(innerWidth, r.right + pad), bottom: Math.min(innerHeight, r.bottom + pad) };
                }
            }
            const changed = JSON.stringify(s) !== JSON.stringify(spot);
            spot = s;
            if (changed) layout();
        }

        function layout() {
            const cur = TUTORIAL_STEPS[step];
            if (!cur || !owns(cur)) return;
            const tryIt = !!cur.tryIt && !cur.mustInteract;
            // A spotlight whose element is not on screen must not leave a blocking dim behind
            const missing = !!cur.highlight && !spot;
            const passThrough = tryIt || missing;
            let dim = "";
            if (!cur.noOverlay) {
                const pe = passThrough ? "none" : "auto";
                if (spot) {
                    const w = spot.right - spot.left, h = spot.bottom - spot.top;
                    dim = `<i style="top:0;left:0;right:0;height:${spot.top}px;pointer-events:${pe}"></i>`
                        + `<i style="top:${spot.bottom}px;left:0;right:0;bottom:0;pointer-events:${pe}"></i>`
                        + `<i style="top:${spot.top}px;left:0;width:${spot.left}px;height:${h}px;pointer-events:${pe}"></i>`
                        + `<i style="top:${spot.top}px;left:${spot.right}px;right:0;height:${h}px;pointer-events:${pe}"></i>`
                        + (!cur.allowClickThrough && !tryIt ? `<b style="top:${spot.top}px;left:${spot.left}px;width:${w}px;height:${h}px"></b>` : "");
                } else dim = `<i style="inset:0;pointer-events:${pe}"></i>`;
            }
            dimHost.innerHTML = dim;
            ring.hidden = !spot || !!cur.noOverlay;
            if (spot) Object.assign(ring.style, { top: spot.top + "px", left: spot.left + "px", width: spot.right - spot.left + "px", height: spot.bottom - spot.top + "px" });
            const pos = cardPosition(spot, cur.cardSide || "center", innerWidth, innerHeight, CARD_W, card.offsetHeight || 280, GAP);
            Object.assign(card.style, { top: pos.top + "px", left: pos.left + "px", width: CARD_W + "px" });
        }

        function draw(force) {
            const s = last;
            const cur = TUTORIAL_STEPS[step];
            if (!s || !cur) return;
            if (!owns(cur)) {
                // The other view's step: the strategic view blacks out and points across, unless the step says not to
                const away = primary && !cur.noOverlayOnPrimary;
                dimHost.innerHTML = away ? '<i style="inset:0;pointer-events:auto;background:rgba(2,6,23,.88)"></i>' : "";
                ring.hidden = true;
                card.className = "st-tut-card st-tut-away";
                card.hidden = !away;
                if (away) {
                    card.innerHTML = `<span>Tutorial</span><p>See the Tactical Planner window →</p><small>${step + 1} / ${TUTORIAL_STEPS.length}</small>`;
                    Object.assign(card.style, { top: "50%", left: "50%", width: "" });
                }
                cardKey = "";
                return;
            }
            card.hidden = false;
            card.className = "st-tut-card";
            const isStuck = stuck(cur), isGated = gated(cur), blocked = !!cur.waitForSuggest && suggestLoading;
            const isLast = step === TUTORIAL_STEPS.length - 1;
            const firstOfPhase = !primary && !(TUTORIAL_STEPS[step - 1] || {}).inMapWindow;
            const key = [step, isStuck, isGated, blocked].join("|");
            if (key !== cardKey || force) {
                cardKey = key;
                const body = cur.body.length === 1
                    ? `<p>${tutorialText(ctx, cur.body[0])}</p>`
                    : "<ul>" + cur.body.map((b) => `<li>${tutorialText(ctx, b)}</li>`).join("") + "</ul>";
                let h = `<div class="st-tut-meta"><span>Tutorial</span><small>${step + 1} / ${TUTORIAL_STEPS.length}</small></div>`
                    + `<div class="st-tut-progress"><i style="width:${((step + 1) / TUTORIAL_STEPS.length) * 100}%"></i></div>`
                    + `<h3>${esc(cur.title)}</h3><div class="st-tut-body">${body}</div>`;
                if (cur.mustInteract) h += `<div class="st-tut-hint${isStuck ? " stuck" : ""}">${esc(isStuck
                    ? (cur.unsatisfiableHint || "This step can no longer be completed — click Next to carry on.")
                    : (cur.mustInteractHint || "Perform the highlighted action above to continue."))}</div>`;
                if (cur.tryIt && !cur.mustInteract) h += `<div class="st-tut-hint try">${esc(cur.tryItHint || "Try the highlighted element, then click Next to continue.")}</div>`;
                h += '<div class="st-tut-nav"><button type="button" class="skip" data-act="skip">Skip tutorial</button><div>';
                if (step > 0 && !firstOfPhase) h += '<button type="button" class="back" data-act="back">← Back</button>';
                if (!isGated && !(!primary && step === TACTICAL_STEP_LAST)) h += `<button type="button" class="next" data-act="next"${blocked ? " disabled" : ""}>${isLast ? "Finish" : "Next →"}</button>`;
                card.innerHTML = h + "</div></div>";
            }
            layout();
            measure();
        }

        function freePlay(s) {
            const fp = s.tutorial && s.tutorial.freePlay;
            if (!fp || !fp.active || s.phase !== "playing") { freeBox.hidden = true; return; }
            freeBox.hidden = false;
            const all = fp.achievements.length > 0 && fp.achievements.every((a) => a.done);
            const flash = all && fp.canFinish;
            freeBox.className = "st-tut-free" + (flash ? " done" : "");
            freeBox.innerHTML = `<div class="st-tut-meta"><span>${flash ? "All done!" : "Free Practice"}</span><small${fp.secondsLeft < 60 ? ' class="late"' : ""}>${flash ? "" : fmt(fp.secondsLeft)}</small></div>`
                + fp.achievements.map((a) => `<div class="st-tut-ach${a.done ? " on" : ""}"><i>${a.done ? "✓" : ""}</i><span>${esc(a.label)}</span></div>`).join("")
                + (primary ? `<button type="button" data-act="skipFree">${flash ? "Continuing…" : "Skip free play →"}</button>` : "");
        }

        return {
            update(s) {
                last = s;
                const t = s.tutorial || {};
                const playing = s.phase === "playing";
                const active = playing && !!t.active;
                freePlay(s);
                el.hidden = !active && freeBox.hidden;
                dimHost.hidden = card.hidden = !active;
                if (!active) { ring.hidden = true; step = -1; return; }
                if (t.step !== step) {
                    step = t.step;
                    fired.delete(step);
                    eventCount = 0;
                    sawRecovery = false; recoveredFired = false;
                }
                const cur = TUTORIAL_STEPS[step];
                if (cur && owns(cur)) {
                    // Auto-advance on the game state
                    if (cur.autoAdvanceWhen && !fired.has(step) && cur.autoAdvanceWhen(s, ctx)) {
                        fired.add(step);
                        const from = step;
                        setTimeout(() => { if (step === from) next(); }, cur.autoAdvanceDelay ?? 500);
                    }
                    // Recovery confirmed: the mission's recovery flag went up and came down again
                    if (cur.advanceOnRecovered) {
                        const pending = s.missions.some((m) => m.failureRecoveryPending);
                        if (pending) sawRecovery = true;
                        else if (sawRecovery && !recoveredFired) { recoveredFired = true; const from = step; setTimeout(() => { if (step === from) next(); }, 600); }
                    }
                }
                draw(false);
            },
            destroy() { clearInterval(timer); },
        };
    },
});
