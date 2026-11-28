// Mission list for the strategic view: incoming, committed, active and completed missions, each as a card with its
// task progress bar, penalty histogram and task plan. Allocating a mission opens the strategic panel inside its card:
// the Strategic Assistant's two strategy cards (Aggressive / Conservative) or a manual drone-count picker.
import { registerPanel } from "../core/registry.js";
import {
    TYPES, CATEGORY_NAME, TASK_SHORT, TASK_FULL, TASK_ICON, CATEGORY_ICON, esc, patch, div, typeOf, droneLabel,
    fmtTime, fmtSeconds, taskWeight, taskRule, missionPenalty, urgencyOf, taskDots, missionFloor,
} from "../core/study.js";
import { tutorialInfo } from "../core/tutorialSteps.js";

const GROWTH = 1.15, HIST_H = 36;

registerPanel("missionList", {
    create(el, ctx) {
        const scroll = div("st-scroll st-missions", el);
        const sortBar = div("st-sort", scroll);
        const body = div("", scroll);
        body.dataset.tutorial = "mission-list";
        let tut = { active: false }, anchorId = null;   // the card the tutorial's "first-…" spotlights attach to
        let sortMode = "arrival";
        let last = null;
        const cards = new Map();     // mission id -> { root, slots }
        const labels = new Map();    // section key -> element
        const openPlans = new Set(); // mission ids whose task plan is expanded
        let ui = null;               // local state of the open strategic panel
        let orderSig = "";

        const send = (a) => ctx.send(a);
        const isAgent = () => last && last.config.mode === "agent";

        // ── Strategic panel local state ──────────────────────────────────────
        function panelState(s) {
            const modal = s.strategicModal;
            if (!modal) { ui = null; return null; }
            const key = modal.missionId + "@" + modal.openedAtMs;
            if (!ui || ui.key !== key) {
                const agent = s.config.mode === "agent";
                ui = {
                    key, missionId: modal.missionId,
                    showManual: !agent || modal.strategies.length === 0,
                    selectedIdx: null, confirmCancel: false, editedFromStrategy: null, switchSnapshot: null,
                    manual: modal.manualAllocation ? { ...modal.manualAllocation } : { Blue: 0, Red: 0, Green: 0 },
                    loaded: new Set(), timers: [], eta: undefined, etaKey: null,
                };
                // Each card "analyses" for its own seeded delay before it can be picked (logged by the engine)
                if (agent) modal.strategies.forEach((_, i) => {
                    const delay = (modal.cardRevealDelaysMs && modal.cardRevealDelaysMs[i]) ?? 4500;
                    ui.timers.push(setTimeout(() => { if (ui && ui.key === key) { ui.loaded.add(i); render(); } }, delay));
                });
            }
            return ui;
        }

        function requestEta(m) {
            const a = ui.manual, k = TYPES.map((t) => a[t]).join(",");
            if (ui.etaKey === k) return;
            ui.etaKey = k; ui.eta = undefined;
            const key = ui.key;
            send({ type: "PREVIEW_ALLOCATION", missionId: m.id, allocation: a }).then((r) => {
                if (ui && ui.key === key && ui.etaKey === k) { ui.eta = r.ok ? r.eta : null; render(); }
            });
        }

        // ── Actions (one delegated listener; buttons carry data-act) ──────────
        scroll.addEventListener("click", (e) => {
            const b = e.target.closest("[data-act]");
            if (!b || b.disabled || !last) return;
            const act = b.dataset.act, id = b.dataset.id;
            const modal = last.strategicModal;
            switch (act) {
                case "sort": sortMode = sortMode === "arrival" ? "score" : "arrival"; break;
                case "allocate": send({ type: "OPEN_STRATEGIC", missionId: id }); return;
                case "plan": openPlans.has(id) ? openPlans.delete(id) : openPlans.add(id); break;
                case "pick": {
                    const i = +b.dataset.i;
                    if (!ui || !ui.loaded.has(i)) return;
                    ui.selectedIdx = i;
                    send({ type: "PICK_STRATEGY", strategyIndex: i });
                    break;
                }
                case "to-manual": {
                    if (ui.selectedIdx !== null) {
                        const st = modal.strategies[ui.selectedIdx];
                        ui.manual = { ...st.assets }; ui.editedFromStrategy = st.name;
                    } else ui.editedFromStrategy = null;
                    ui.switchSnapshot = { before: !allLoaded(modal), loaded: ui.loaded.size };
                    ui.showManual = true;
                    if (tut.active && tut.forceManual) document.dispatchEvent(new CustomEvent("tutorial-manual-selected"));
                    break;
                }
                case "to-cards": ui.showManual = false; ui.editedFromStrategy = null; ui.switchSnapshot = null; break;
                case "inc": case "dec": {
                    const t = b.dataset.t, max = last.reserve[t] || 0;
                    const before = ui.manual[t];
                    ui.manual[t] = act === "inc" ? Math.min(max, before + 1) : Math.max(0, before - 1);
                    if (ui.manual[t] !== before) send({ type: "EDIT_MANUAL", allocation: { ...ui.manual } });
                    break;
                }
                case "deploy": {
                    if (ui.showManual || !isAgent()) {
                        send({ type: "APPLY_STRATEGIC", missionId: ui.missionId, source: "manual", strategyIndex: null,
                            manualAllocation: { ...ui.manual }, editedFromStrategy: ui.editedFromStrategy,
                            strategyCardCount: modal.strategies.length,
                            manualBeforeCardsLoaded: ui.switchSnapshot ? ui.switchSnapshot.before : null,
                            cardsLoadedAtManualSwitch: ui.switchSnapshot ? ui.switchSnapshot.loaded : null });
                    } else if (ui.selectedIdx !== null) {
                        send({ type: "APPLY_STRATEGIC", missionId: ui.missionId, source: "agent", strategyIndex: ui.selectedIdx,
                            manualAllocation: null, strategyCardCount: modal.strategies.length });
                    }
                    return;
                }
                case "cancel": ui.confirmCancel = true; break;
                case "cancel-back": ui.confirmCancel = false; break;
                case "dismiss": send({ type: "CLOSE_STRATEGIC" }); return;
                default: return;
            }
            render();
        });

        function allLoaded(modal) {
            const showCards = isAgent() && ui && !ui.showManual;
            return !showCards || modal.strategies.length === 0 || modal.strategies.every((_, i) => ui.loaded.has(i));
        }

        // ── Rendering ─────────────────────────────────────────────────────────
        function render() {
            const s = last;
            if (!s) return;
            panelState(s);
            const sortByScore = (list) => [...list].sort((a, b) => totalPts(b) - totalPts(a));
            const totalPts = (m) => m.tasks.reduce((x, t) => x + taskWeight(ctx, t.type), 0);
            let queued = s.missions.filter((m) => m.status === "queued");
            let active = s.missions.filter((m) => m.status === "active");
            const done = s.missions.filter((m) => m.status === "completed" || m.status === "failed" || m.status === "abandoned");
            if (sortMode === "score") { queued = sortByScore(queued); active = sortByScore(active); }
            const awaitingAlloc = queued.filter((m) => !m.tacticalPending);
            // The tutorial points at the topmost queued card, or at the newest one once the assistants lesson starts
            tut = tutorialInfo(s);
            const newest = [...s.missions].reverse().find((m) => m.status === "queued");
            anchorId = !tut.active || !queued.length ? null : tut.anchorNewest ? (newest || queued[0]).id : queued[0].id;
            const awaitingTac = queued.filter((m) => m.tacticalPending);

            patch(sortBar, queued.length || active.length
                ? `<button data-act="sort" class="${sortMode === "score" ? "on" : ""}">Sort: ${sortMode === "arrival" ? "Arrival ↓" : "Score ↓"}</button>` : "");

            const seq = [];
            const section = (key, text, dot, list, cls) => {
                if (!list.length) return;
                seq.push({ label: key, text, dot, cls: (seq.length ? "st-section-gap " : "") + (cls || "") });
                for (const m of list) seq.push({ card: m.id, faded: !!cls });
            };
            section("alloc", "Incoming — awaiting allocation", "#fbbf24", awaitingAlloc);
            section("tac", "Committed — awaiting tactical plan", "#facc15", awaitingTac);
            section("active", "Active missions", "#60a5fa", active);
            section("done", "Completed", "#6b7280", done.slice(-6), "st-done-section");

            const byId = new Map(s.missions.map((m) => [m.id, m]));
            const sig = seq.map((x) => x.label ? "L" + x.label + x.cls : "C" + x.card + (x.faded ? "f" : "")).join("|");
            if (sig !== orderSig) {
                orderSig = sig;
                body.textContent = "";
                for (const x of seq) {
                    if (x.label) {
                        let l = labels.get(x.label);
                        if (!l) { l = div("st-section-label"); l.innerHTML = `<i style="background:${x.dot}"></i><span>${esc(x.text)}</span>`; labels.set(x.label, l); }
                        l.className = "st-section-label " + x.cls;
                        body.appendChild(l);
                    } else {
                        const c = cardFor(x.card);
                        c.root.style.opacity = x.faded ? ".6" : "";
                        body.appendChild(c.root);
                    }
                }
                if (!seq.length) body.innerHTML = '<div class="st-empty"><span>No missions yet</span><small>Missions will appear here as they arrive</small></div>';
                for (const id of [...cards.keys()]) if (!seq.some((x) => x.card === id)) cards.delete(id);
            }
            for (const x of seq) if (x.card) updateCard(cards.get(x.card), byId.get(x.card), s);
        }

        function cardFor(id) {
            let c = cards.get(id);
            if (!c) {
                const root = div("st-card");
                c = { root, head: div("", root), banner: div("", root), progress: div("st-progress", root), plan: div("", root), strat: div("", root) };
                c.bar = div("", c.progress); c.hist = div("", c.progress);
                cards.set(id, c);
            }
            return c;
        }

        function updateCard(c, m, s) {
            const isQueued = m.status === "queued", isActive = m.status === "active";
            const allocating = s.strategicModal && s.strategicModal.missionId === m.id;
            const deployedHere = s.assets.filter((a) => a.currentMissionId === m.id && a.status === "deployed");
            const activeTaskIds = new Set(deployedHere.map((a) => a.currentTaskId).filter(Boolean));
            const penalty = missionPenalty(ctx, m, s.elapsed);
            const urgency = isQueued || isActive ? urgencyOf(penalty) : "none";

            const state = allocating ? "allocating" : m.failureRecoveryPending ? "recovery" : m.tacticalPending ? "tactical"
                : isQueued ? "queued" : isActive ? "active" : m.status === "failed" ? "failed" : "";
            c.root.className = "st-card " + state + (isQueued && !allocating && !m.tacticalPending ? " pulse" : "");
            const first = m.id === anchorId;
            const anchor = (name) => first ? ` data-tutorial="${name}"` : "";
            if (first) c.root.dataset.tutorial = "first-mission-card"; else delete c.root.dataset.tutorial;
            if (first) { c.bar.dataset.tutorial = "first-task-progress"; c.hist.dataset.tutorial = "first-penalty"; }
            else { delete c.bar.dataset.tutorial; delete c.hist.dataset.tutorial; }

            // Header
            const doneTasks = m.tasks.filter((t) => t.status === "completed").length;
            const doing = m.tasks.filter((t) => activeTaskIds.has(t.id)).length;
            const chainQueued = m.tasks.filter((t) => t.status === "traveling" && !activeTaskIds.has(t.id) && t.assignedAssetIds.length).length;
            let l = `<span class="st-mid">${esc(m.id)}</span><img src="${CATEGORY_ICON(m.category)}" alt="" style="width:20px;height:20px">`
                + `<span class="st-cat st-cat-${m.category}">${m.category} · ${CATEGORY_NAME[m.category]}</span>`;
            if (isActive) l += `<span class="st-xs st-dim">${doneTasks}/${m.tasks.length}${doing ? ` · <span style="color:#60a5fa">${doing} active</span>` : ""}${chainQueued ? ` · <span style="color:#6b7280">${chainQueued} queued</span>` : ""}</span>`;
            if (m.status === "completed") l += '<span class="st-xs" style="color:#4ade80">complete</span>';
            if (m.status === "failed") l += '<span class="st-xs" style="color:#f87171;font-weight:700">✕ failed</span>';
            if (m.status === "abandoned") l += m.abandonedReason === "lockout"
                ? '<span class="st-xs" style="color:#f87171;font-weight:700">✕ failed · lockout</span>'
                : '<span class="st-xs" style="color:#fbbf24">abandoned</span>';
            let r = "";
            if (isActive) {
                const eta = Math.max(0, Math.max(...m.tasks.map((t) => t.completionTime || 0)) - s.elapsed);
                r += `<span class="st-xs st-dim st-mono">ETA ${fmtSeconds(eta)}</span>`;
            }
            if (isQueued && !allocating && !m.tacticalPending) r += `<button class="st-allocate" data-act="allocate" data-id="${esc(m.id)}"${anchor("first-allocate-btn")}>Allocate</button>`;
            if (allocating) r += '<span class="st-xs" style="color:#60a5fa;font-weight:500">Allocating…</span>';
            patch(c.head, `<div class="st-card-head"><div class="l">${l}</div><div class="r">${r}</div></div>`);

            // Help-needed / tactical-pending banner
            let banner = "";
            if (m.failureRecoveryPending) {
                banner = m.recoveryReason === "lockout"
                    ? '<div class="st-banner st-banner-red"><b>⚠ LOCKOUT</b><span style="color:#6b7280">— drones stuck, re-plan the allocation</span></div>'
                    : `<div class="st-banner st-banner-red"><b>DRONE FAILURE</b>${m.failedDroneId ? `<span style="color:#f87171">${esc(droneLabel(ctx, m.failedDroneId))} lost</span>` : ""}<span style="color:#6b7280">— recovery required</span></div>`;
            } else if (m.tacticalPending) {
                banner = `<div class="st-banner st-banner-yellow"${anchor("first-tactical-pending")}>Tactical allocation pending confirmation — review on map</div>`;
            }
            patch(c.banner, banner);

            patch(c.bar, taskBar(m, s, activeTaskIds, isActive, urgency));
            patch(c.hist, histogram(m, s.elapsed));
            patch(c.plan, isActive ? taskPlan(m) : "");
            patch(c.strat, allocating && ui ? strategicPanel(s, m, first) : "");
        }

        function taskBar(m, s, activeIds, isActive, urgency) {
            const total = m.tasks.reduce((x, t) => x + taskWeight(ctx, t.type), 0);
            if (!total) return "";
            const greedy = s.config.tacticalMode === "greedy";
            const earned = m.tasks.filter((t) => t.status === "completed").reduce((x, t) => x + taskWeight(ctx, t.type), 0);
            const hasUpcoming = greedy && isActive && m.tasks.some((t) => t.status === "pending" && !t.assignedAssetIds.length);
            const segClass = (t) => {
                if (t.status === "completed") return "done";
                if (t.status === "failed") return "failed";
                if (t.status === "executing") return "exec";
                if (t.status === "traveling") return isActive && !activeIds.has(t.id) && t.assignedAssetIds.length ? (greedy ? "toplan" : "queued") : "route";
                if (isActive && !t.assignedAssetIds.length) return greedy ? "toplan" : "unassigned";
                return "";
            };
            let html = '<div class="st-bar">';
            for (const t of m.tasks) {
                const w = taskWeight(ctx, t.type), pct = w / total * 100;
                const u = t.status === "completed" || t.status === "failed" || urgency === "none" ? "" : " u-" + urgency;
                html += `<div class="st-seg ${segClass(t)}${u}" style="width:${pct}%" title="${esc(TASK_FULL[t.type])} · +${w} pts · ${t.status}">`;
                if (pct >= 7) html += `<img src="${TASK_ICON[t.type]}" alt="" style="opacity:${t.status === "completed" ? .7 : 1}">`;
                if (pct >= 15) html += `<span class="v">+${w}</span>`;
                if (pct >= 7) html += '<span class="dots">' + taskDots(ctx, t.type).map((d) => `<i style="background:${typeOf(ctx, d).text || typeOf(ctx, d).colour}"></i>`).join("") + "</span>";
                html += "</div>";
            }
            html += "</div>";
            const key = (c, label) => `<span><i style="background:${c}"></i>${label}</span>`;
            html += `<div class="st-bar-legend"><span style="color:#22c55e">+${earned} earned</span><span class="keys">${key("#16a34a", "Done")}${key("#1d4ed8", "Route")}${key("#f59e0b", "Active")}${hasUpcoming ? key("rgba(161,98,7,.6)", "To plan") : key("#374151", "Pending")}</span><span style="color:#6b7280">${total} max</span></div>`;
            return html;
        }

        function histogram(m, elapsed) {
            const rules = ctx.config.rules, interval = rules.chargeInterval;
            const rate = rules.categoryPenaltyRate[m.category];
            const isDone = m.tasks.length > 0 && m.tasks.every((t) => t.status === "completed");
            const end = isDone ? (m.completionTime ?? elapsed) : elapsed;
            const wait = Math.max(0, end - m.arrivalTime);
            const numBars = Math.floor(wait / interval);
            const partial = isDone ? 0 : (wait % interval) / interval;
            const totalW = m.tasks.reduce((x, t) => x + taskWeight(ctx, t.type), 0);
            const pendingFrac = (at) => {
                if (!totalW) return 0;
                let p = 0;
                for (const t of m.tasks) if (!(t.status === "completed" && t.completionTime != null && t.completionTime <= at)) p += taskWeight(ctx, t.type);
                return p / totalW;
            };
            const totalPenalty = Math.round(missionPenalty(ctx, m, elapsed));
            const hasPartial = !isDone && partial > 0;
            const bars = Array.from({ length: numBars }, (_, i) => GROWTH ** i * pendingFrac(m.arrivalTime + (i + .5) * interval));
            const partH = hasPartial ? GROWTH ** numBars * pendingFrac(elapsed) * partial : 0;
            const scale = HIST_H / Math.max(...bars, partH, .001);
            let html = '<div class="st-hist" title="Penalty accrues per task until each task individually completes">';
            if (!numBars && !hasPartial) html += '<span style="color:#374151;font-size:9px;align-self:flex-end;line-height:1">no penalty yet</span>';
            for (const h of bars) html += `<i style="height:${Math.max(1, h * scale)}px"></i>`;
            if (hasPartial) html += `<i class="part" style="height:${Math.max(1, partH * scale)}px"></i>`;
            html += `</div><div class="st-hist-legend"><span style="color:#f87171">−${totalPenalty} pts${isDone ? " (final)" : ""}</span>`;
            if (!isDone) html += `<span style="color:#4b5563">−${(rate * pendingFrac(elapsed)).toFixed(2)}/s · each task reduces rate</span>`;
            return html + "</div>";
        }

        function taskPlan(m) {
            const chains = new Map();
            for (const t of m.tasks) for (const id of t.assignedAssetIds) {
                if (!chains.has(id)) chains.set(id, []);
                chains.get(id).push(t);
            }
            const unassigned = m.tasks.filter((t) => t.status === "pending" && !t.assignedAssetIds.length);
            if (!chains.size && !unassigned.length) return "";
            const pool = { Blue: 0, Red: 0, Green: 0 };
            for (const id of chains.keys()) pool[typeOf(ctx, id).id] = (pool[typeOf(ctx, id).id] || 0) + 1;
            const covers = (c) => c && TYPES.every((k) => pool[k] >= (c[k] || 0));
            const queuedT = [], cannot = [];
            for (const t of unassigned) (covers(taskRule(ctx, t.type).primary) || covers(taskRule(ctx, t.type).substitute) ? queuedT : cannot).push(t);
            const open = openPlans.has(m.id);
            let html = `<div class="st-plan"><button class="st-plan-toggle" data-act="plan" data-id="${esc(m.id)}"><b>Task Plan</b><span>${open ? "▲" : "▼"}</span>`
                + (queuedT.length ? `<span style="color:#60a5fa;margin-left:4px">⏳ ${queuedT.length} queued</span>` : "")
                + (cannot.length ? `<span style="color:#f59e0b;margin-left:4px">⚠ ${cannot.length} cannot fulfil</span>` : "") + "</button>";
            if (open) {
                for (const [id, chain] of [...chains.entries()].sort(([a], [b]) => a.localeCompare(b))) {
                    const t = typeOf(ctx, id);
                    html += `<div class="st-plan-row"><span class="st-mono" style="font-weight:700;color:${esc(t.text || t.colour)}">${esc(droneLabel(ctx, id))}</span>`
                        + chain.map((task, i) => (i ? '<span style="color:#4b5563">→</span>' : "") + `<span class="st-tag st-tag-${task.status}">${TASK_SHORT[task.type]}</span>`).join("") + "</div>";
                }
                if (queuedT.length) html += '<div class="st-plan-row" style="color:#3b82f6"><span>⏳ Queued:</span>' + queuedT.map((t) => `<span class="st-tag" style="background:rgba(30,58,138,.3);border:1px solid rgba(29,78,216,.4)" title="${esc(TASK_FULL[t.type])} waiting for drones to become available">${TASK_SHORT[t.type]}</span>`).join("") + "</div>";
                if (cannot.length) html += '<div class="st-plan-row" style="color:#d97706"><span>⚠ Cannot fulfil:</span>' + cannot.map((t) => `<span class="st-tag" style="background:rgba(120,53,15,.3);border:1px solid rgba(180,83,9,.4)" title="${esc(TASK_FULL[t.type])}: not enough drones of the required type were allocated">${TASK_SHORT[t.type]}</span>`).join("") + "</div>";
            }
            return html + "</div>";
        }

        function strategicPanel(s, m, first) {
            const modal = s.strategicModal, agent = s.config.mode === "agent";
            const showCards = agent && !ui.showManual;
            const loadedAll = allLoaded(modal);
            // The tutorial can lock the panel to the manual flow (first mission) or to the cards (second)
            const forceManual = tut.active && tut.forceManual, forceAgent = tut.active && tut.forceAgent;
            const anchor = (name) => first ? ` data-tutorial="${name}"` : "";
            let html = `<div class="st-strat${showCards && !loadedAll && !forceManual ? " loading" : ""}"${anchor("first-strategic-panel")}>`;
            if (showCards && forceManual) {
                html += '<p class="st-xs" style="color:#6b7280;text-align:center;padding:8px 0;margin:0">Assistant suggestions are disabled for this practice round.</p>';
            } else if (showCards) {
                html += '<div class="st-cards">';
                modal.strategies.forEach((st, i) => { html += strategyCard(st, i, s, first && i === 0); });
                if (!modal.strategies.length) html += '<p class="st-xs" style="grid-column:span 2;color:#6b7280;text-align:center">No feasible strategies with current reserve. Use manual allocation.</p>';
                html += "</div>";
            } else {
                html += manualPicker(s, m);
            }
            if (agent && !forceAgent) {
                if (ui.showManual) { if (!forceManual) html += `<button class="st-link" data-act="to-cards"${anchor("first-manual-toggle")}>← Back to suggestions</button>`; }
                else html += `<button class="st-switch" data-act="to-manual"${anchor("first-manual-toggle")}>${ui.selectedIdx !== null ? "Edit this allocation" : "Set manually instead"}</button>`;
            }
            const canApply = showCards ? ui.selectedIdx !== null && loadedAll : TYPES.some((t) => ui.manual[t] > 0);
            html += `<div class="st-actions"><button class="st-deploy" data-act="deploy" ${canApply ? "" : "disabled"}>${showCards ? "Deploy Selected" : "Deploy"}</button>`;
            html += ui.confirmCancel
                ? '<span class="st-xs" style="color:#fbbf24">Mission stays unallocated.</span><button class="st-cancel sm red" data-act="dismiss">Confirm dismiss</button><button class="st-cancel sm" data-act="cancel-back">Go back</button>'
                : '<button class="st-cancel" data-act="cancel">Cancel</button>';
            return html + "</div></div>";
        }

        function strategyCard(st, i, s, first) {
            const anchor = first ? ' data-tutorial="first-strategy-card"' : "";
            if (!ui.loaded.has(i)) return `<div class="st-scard wait"${anchor}><div class="st-spin"></div><span>Analysing...</span></div>`;
            const sel = ui.selectedIdx === i;
            let html = `<button class="st-scard${sel ? " sel" : ""}" data-act="pick" data-i="${i}"${anchor}><h4>${sel ? '<span style="color:#60a5fa;font-size:12px">✓</span>' : ""}${esc(st.name)}</h4>`;
            if (s.config.testingMode && st.isBadSuggestion) html += `<div class="st-test-flag">⚠ TEST FAILURE: ${esc(st.badSuggestionType)}${st.badSuggestionColour ? " " + esc(st.badSuggestionColour) : ""}</div>`;
            html += `<p>${esc(st.description)}</p><div class="assets">`;
            const used = TYPES.filter((t) => st.assets[t] > 0);
            for (const t of used) { const ty = typeOf(ctx, t); html += `<span style="color:${esc(ty.text || ty.colour)}"><img src="${esc(ty.icon)}" alt="" style="width:14px;height:14px">${st.assets[t]}</span>`; }
            if (!used.length) html += '<span style="color:#4b5563">—</span>';
            html += `</div><div class="line">ETA: ${fmtTime(st.expectedCompletionTime)}</div><div class="line"><span style="color:#4b5563">Res:</span>`;
            for (const t of TYPES) { const ty = typeOf(ctx, t); html += `<span style="display:flex;align-items:center;gap:2px;color:${esc(ty.text || ty.colour)};opacity:.6"><img src="${esc(ty.icon)}" alt="" style="width:12px;height:12px"><span style="font-size:10px">${st.reserveAfter[t]}</span></span>`; }
            html += "</div>";
            const bar = (label, v, colour) => `<div class="st-scorebar"><span>${label}</span><div class="track"><div class="fill" style="width:${Math.round(v * 100)}%;background:${colour}"></div></div><span>${Math.round(v * 100)}%</span></div>`;
            html += '<div style="margin-top:8px">' + bar("Speed", st.speedScore, "#3b82f6") + bar("Reserve", st.reserveScore, "#22c55e") + bar("Resilience", st.redundancyScore, "#f59e0b") + "</div>";
            const buf = TYPES.filter((t) => st.assets[t] > st.minimumAssets[t]).map((t) => `+${st.assets[t] - st.minimumAssets[t]} ${typeOf(ctx, t).label}`);
            return html + `<div style="margin-top:4px;font-size:10px;color:#6b7280">Buffer: ${buf.length ? buf.join(" · ") : "at minimum"}</div></button>`;
        }

        function manualPicker(s, m) {
            const floor = missionFloor(ctx, m.tasks);
            requestEta(m);
            let html = "<div>";
            for (const t of TYPES) {
                const ty = typeOf(ctx, t), n = ui.manual[t], avail = s.reserve[t] || 0, spare = n - floor[t];
                html += `<div class="st-manual-row"><span class="name" style="color:${esc(ty.text || ty.colour)}">${esc(ty.label)} (${avail} avail)</span>`
                    + `<button data-act="dec" data-t="${t}">−</button><span class="n">${n}</span><button data-act="inc" data-t="${t}">+</button>`
                    + `<span style="color:#6b7280">/ ${avail}</span>`
                    + (n > 0 ? `<span style="font-size:10px;color:${spare > 0 ? "#4b5563" : "#374151"}">${spare > 0 ? spare + " can fail" : "no spare"}</span>` : "") + "</div>";
            }
            const none = TYPES.every((t) => !ui.manual[t]);
            let eta;
            if (none) eta = '<span style="color:#f87171">Add drones to see an ETA</span>';
            else if (ui.eta === undefined) eta = '<span style="color:#6b7280">ETA: …</span>';
            else if (ui.eta === null) eta = '<span style="color:#f87171">This team can\'t cover every task</span>';
            else eta = `ETA: <span style="color:#fff">${fmtTime(ui.eta)}</span>`;
            return html + `<div class="st-xs st-dim">${eta}</div></div>`;
        }

        return {
            update(s) { last = s; render(); },
            destroy() { if (ui) ui.timers.forEach(clearTimeout); },
        };
    },
});
