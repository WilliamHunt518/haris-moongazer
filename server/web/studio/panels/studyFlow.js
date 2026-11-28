// The study's screens around the sessions, ported from the original: the start screen, the background
// questionnaire, the surveys after each session, the break between sessions and the end screen.
// It sits over the view (an entry in the view's "overlays") and shows itself whenever the study is not playing.
//   options.role "primary" (default): the screens above, for the strategic view.
//                "secondary": a waiting or paused notice, for the other views.
import { registerPanel } from "../core/registry.js";
import { esc } from "../core/study.js";
import { DEMOGRAPHICS, SURVEYS, surveysForSession, COMPLEXITIES } from "../core/surveys.js";

const STUDY_SEED = 42;
const FAILURE_GRACE_SECONDS = 30;
const BREAK_SECONDS = 30;
const EPS_STEP = 0.05, EPS_MAX = 0.95;
const COMPLEXITY_LABEL = Object.fromEntries(COMPLEXITIES.map((c) => [c.value, c.label]));

const randomSeed = () => Math.floor(Math.random() * 99999) + 1;

// Start screen values: the original's defaults, then the scenario's study block, then URL parameters
// (the original's names: pid, seed, complexity, mode, eps_s, eps_t, tacticalMode, test, fullpaths, fixLockouts,
// failureGrace, numSessions, failuresLive, swapGames). Unlike the original, the URL never starts a study by itself.
function startDefaults(ctx) {
    const d = (ctx.config.strattac && ctx.config.strattac.study) || {};
    const p = ctx.params;
    const cx = p.get("complexity") || d.complexity || "balanced";
    const eps = (raw, dflt) => { const v = parseFloat(raw); return isNaN(v) ? dflt : Math.min(EPS_MAX, Math.max(0, v)); };
    const n = parseInt(p.get("numSessions") || d.numSessions || 1, 10);
    const list = d.sessionComplexities || [];
    return {
        participantId: p.get("pid") || "",
        sessionComplexities: [list[0] || cx, list[1] || cx, list[2] || cx],
        mode: p.get("mode") || d.mode || "agent",
        epsS: eps(p.get("eps_s"), d.agentErrorRate ?? 0),
        epsT: eps(p.get("eps_t"), d.epsilonTactical ?? 0),
        failuresLive: p.has("failuresLive") ? p.get("failuresLive") === "1" : !!d.agentFailuresEnabled,
        tacticalMode: p.get("tacticalMode") || d.tacticalMode || "plan-all",
        seed: String(p.get("seed") || d.seed || STUDY_SEED),
        numSessions: Math.min(3, Math.max(1, isNaN(n) ? 1 : n)),
        testingMode: p.has("test") ? p.get("test") === "1" : !!d.testingMode,
        fullPaths: p.get("fullpaths") === "1",
        fixLockouts: p.has("fixLockouts") ? p.get("fixLockouts") !== "0" : d.fixLockouts !== false,
        grace: String(p.get("failureGrace") ?? d.failureGraceSeconds ?? FAILURE_GRACE_SECONDS),
        scenarioA: "strategic",
        scenarioB: "tactical",
        fastTest: false,
        swapGames: p.has("swapGames") ? p.get("swapGames") === "1" : d.swapGames !== false,
        error: "",
    };
}

const opt = (act, value, on, label, desc) =>
    `<button type="button" class="st-opt-btn${on ? " on" : ""}" data-act="${act}" data-v="${esc(String(value))}"><b>${esc(label)}</b>${desc ? `<span>${esc(desc)}</span>` : ""}</button>`;
const check = (key, on, label, note, tone) =>
    `<label class="st-check${tone ? " st-check-" + tone : ""}"><input type="checkbox" data-key="${key}"${on ? " checked" : ""}><span>${label}${note ? ` <i>${note}</i>` : ""}</span></label>`;
const select = (key, value) =>
    `<select class="st-input" data-key="${key}">${COMPLEXITIES.map((c) => `<option value="${c.value}"${c.value === value ? " selected" : ""}>${esc(c.label)}</option>`).join("")}</select>`;

registerPanel("studyFlow", {
    create(el, ctx, options) {
        const role = options.role || "primary";
        el.classList.add("st-flow");
        el.hidden = true;
        let screen = "", last = null, ui = {};
        let start = startDefaults(ctx);
        let prevPhase = null, breakTimer = null;

        function keep(fn) {
            // Redraw without losing the scroll position of the long forms
            const body = el.querySelector(".st-flow-body");
            const top = body ? body.scrollTop : 0;
            fn();
            const nb = el.querySelector(".st-flow-body");
            if (nb) nb.scrollTop = top;
        }

        // ── Start screen ─────────────────────────────────────────────────────
        function drawStart() {
            const s = start, agent = s.mode === "agent";
            const acc = (key, label, eps) => `<div class="st-acc"><span>${label}</span><div>`
                + `<button type="button" data-act="eps" data-k="${key}" data-d="1"${eps >= EPS_MAX ? " disabled" : ""}>−</button>`
                + `<p><b>${Math.round((1 - eps) * 100)}%</b><i>ε = ${eps.toFixed(2)}</i></p>`
                + `<button type="button" data-act="eps" data-k="${key}" data-d="-1"${eps <= 0 ? " disabled" : ""}>+</button></div></div>`;
            let h = '<div class="st-flow-card"><div class="st-flow-pad">'
                + '<h1>SAR Command Platform</h1><p class="st-flow-sub">Search &amp; Rescue — Human Factors Study</p><hr>'
                + `<label class="st-flow-label">Participant ID <i>leave blank to auto-assign</i></label>`
                + `<input class="st-input" type="text" data-key="participantId" placeholder="e.g. P001 (optional)" value="${esc(s.participantId)}">`
                + '<label class="st-flow-label">Mode</label><div class="st-opts">'
                + opt("mode", "no-agent", !agent, "Manual Control", "All allocations made by operator")
                + opt("mode", "agent", agent, "Assistant Mode", "Assistant suggests strategic & tactical options") + "</div>";
            if (agent) {
                h += '<label class="st-flow-label">Assistant Accuracy <i>how often each assistant\'s suggestion is correct</i></label>'
                    + `<div class="st-opts">${acc("epsS", "Strategic Assistant", s.epsS)}${acc("epsT", "Tactical Assistant", s.epsT)}</div>`
                    + check("failuresLive", s.failuresLive, "Failures LIVE for this session", "(off = accuracy above is dialled but never fires — safe for tuning with Testing Mode)", "small")
                    + '<label class="st-flow-label">Tactical Assistant Style</label><div class="st-opts">'
                    + opt("tacticalMode", "plan-all", s.tacticalMode === "plan-all", "Plan All", "Full sequence, confirm once")
                    + opt("tacticalMode", "greedy", s.tacticalMode === "greedy", "Greedy", "Next task only, auto-replans") + "</div>";
            }
            if (s.numSessions === 1) {
                h += '<label class="st-flow-label">Complexity</label><div class="st-opts">'
                    + COMPLEXITIES.map((c) => opt("complexity", c.value, s.sessionComplexities[0] === c.value, c.label, c.desc)).join("") + "</div>";
            } else {
                h += '<label class="st-flow-label">Complexity per session <i>study builder — chain different presets</i></label>';
                for (let i = 0; i < s.numSessions; i++) h += `<div class="st-flow-line"><span>Session ${i + 1}</span>${select("cx" + i, s.sessionComplexities[i])}</div>`;
            }
            h += '<label class="st-flow-label">Session Seed <i>determines all randomness</i></label>'
                + `<div class="st-flow-line"><input class="st-input st-mono" type="number" data-key="seed" value="${esc(s.seed)}"><button type="button" class="st-btn" data-act="randomise">Randomise</button></div>`
                + '<label class="st-flow-label">Sessions</label><div class="st-opts st-opts-3">'
                + [1, 2, 3].map((n) => opt("sessions", n, s.numSessions === n, n + (n === 1 ? " session" : " sessions"))).join("") + "</div>"
                + check("testingMode", s.testingMode, "Testing mode", "(infinite time, manual mission/failure triggers)", "warn")
                + check("fullPaths", s.fullPaths, "Full paths on hover", "(hover a drone or mission on the map to reveal its full planned route)")
                + check("fixLockouts", s.fixLockouts, "Fix lockouts", "(on = the assistant silently reroutes a stuck deadlock so every task completes; off = flag it red \"help needed\" for the operator to re-plan, like a drone failure. Default on — the tutorial teaches no lockout lesson, so leave it on unless you are deliberately studying that path.)")
                + `<div class="st-flow-line st-check"><span>Failure grace <i>(seconds a mission is exempt from further drone failures after one fires, measured from when the operator finishes the recovery — stops a second failure landing on a mission while the first is still being fixed. 0 = off.)</i></span>`
                + `<input class="st-input st-num" type="number" min="0" step="5" data-key="grace" value="${esc(s.grace)}"></div>`
                + (s.error ? `<p class="st-flow-error">${esc(s.error)}</p>` : "")
                + '<div class="st-flow-study"><p><b>Participant Study</b>Background questionnaire, then two scenarios back-to-back (blinded), each followed by its surveys. '
                + "Uses the Participant ID, Mode and Accuracy set above. Run the tutorial separately.</p>"
                + `<div class="st-opts"><div><label>Scenario 1</label>${select("scenarioA", s.scenarioA)}</div><div><label>Scenario 2</label>${select("scenarioB", s.scenarioB)}</div></div>`
                + check("swapGames", s.swapGames, "Swap games", "(play the two mission streams in reversed order. Default on: everyone up to P30 ran them unswapped, so new participants balance game difficulty against scenario order. Keep alternating Scenario 1 as usual.)")
                + check("fastTest", s.fastTest, "Fast test", "(10s scenarios, no form validation — walk the whole flow quickly)", "warn")
                + '<button type="button" class="st-btn st-btn-big st-btn-emerald" data-act="beginStudy">Begin Participant Study →</button></div>'
                + '<div class="st-flow-or"><span>advanced / single-session</span></div>'
                + '<button type="button" class="st-btn st-btn-big st-btn-primary" data-act="startStudy">Start Study</button>'
                + '<button type="button" class="st-btn st-btn-big" data-act="openTactical">Open Tactical Planner →</button>'
                + '<p class="st-flow-note">Open the tactical view on a second screen before starting.</p>'
                + "</div></div>";
            keep(() => { el.innerHTML = h; });
        }

        function baseConfig() {
            const s = start, agent = s.mode === "agent";
            const g = parseFloat(s.grace);
            return {
                participantId: s.participantId.trim() || "P-" + (randomSeed() % 9000 + 1000),
                condition: "none",
                mode: s.mode,
                agentErrorRate: agent ? s.epsS : 0,
                epsilonTactical: agent ? s.epsT : 0,
                agentFailuresEnabled: agent ? s.failuresLive : false,
                tacticalMode: agent ? s.tacticalMode : "plan-all",
                tutorialMode: false,
                fullPathsOnHover: s.fullPaths,
                fixLockouts: s.fixLockouts,
                failureGraceSeconds: s.grace.trim() === "" || isNaN(g) ? FAILURE_GRACE_SECONDS : Math.max(0, g),
            };
        }

        // Actions go one at a time, so responses are logged in the order they were given
        let queue = Promise.resolve();
        function send(action) {
            const p = queue.then(() => sendNow(action));
            queue = p.catch(() => {});
            return p;
        }
        async function sendNow(action) {
            const out = await ctx.send(action);
            if (!out.ok) { start.error = out.error || "The server refused that."; if (screen.startsWith("setup") || screen.startsWith("done")) drawStart(); }
            return out;
        }

        function startStudy(participant) {
            const s = start;
            let seed = parseInt(s.seed, 10);
            if (isNaN(seed) || seed < 1) {
                if (!(participant && s.fastTest)) { s.error = "Seed must be a positive integer."; drawStart(); return; }
                seed = STUDY_SEED;
            }
            s.error = "";
            const config = participant
                ? { ...baseConfig(), complexity: s.scenarioA, sessionComplexities: [s.scenarioA, s.scenarioB], seed, testingMode: false,
                    numSessions: 2, collectDemographics: true, fastTest: s.fastTest, swapGames: s.swapGames }
                : { ...baseConfig(), complexity: s.sessionComplexities[0], sessionComplexities: s.sessionComplexities.slice(0, s.numSessions), seed,
                    testingMode: s.testingMode, numSessions: s.numSessions };
            send({ type: "START_STUDY", config });
        }

        // ── Background questionnaire ─────────────────────────────────────────
        const answered = (q) => {
            if (q.type === "info") return true;
            const v = ui.responses[q.id];
            if (q.type === "number" || q.type === "scale") return typeof v === "number" && !isNaN(v);
            return v !== undefined && v !== "";
        };
        function drawDemographics(s) {
            const relaxed = !!s.config.fastTest;
            const can = relaxed || DEMOGRAPHICS.every(answered);
            let h = '<div class="st-flow-card st-flow-wide"><div class="st-flow-head"><p class="st-flow-kicker">Before we begin</p><h2>Background questionnaire</h2>'
                + "<p>These questions are about you and your prior experience. There are no right or wrong answers.</p>"
                + (relaxed ? '<p class="st-flow-warn">Fast-test mode — validation relaxed; you can submit without answering.</p>' : "")
                + '</div><div class="st-flow-body">';
            DEMOGRAPHICS.forEach((q, i) => {
                if (i === 0 || DEMOGRAPHICS[i - 1].section !== q.section) h += `<p class="st-flow-section">${esc(q.section)}</p>`;
                if (q.type === "info") { h += `<p class="st-flow-info">${esc(q.label)}</p>`; return; }
                const v = ui.responses[q.id];
                h += `<div class="st-q"><p>${esc(q.label)}</p>${q.help ? `<p class="st-q-help">${esc(q.help)}</p>` : ""}`;
                if (q.type === "text") h += `<input class="st-input" type="text" data-q="${q.id}" value="${esc(v ?? "")}">`;
                else if (q.type === "number") h += `<input class="st-input st-num st-mono" type="number" min="${q.min}" max="${q.max}" data-q="${q.id}" data-num="1" value="${v === undefined ? "" : esc(String(v))}">`;
                else if (q.type === "choice") h += '<div class="st-choices">' + q.options.map((o) => `<button type="button" class="st-choice${v === o ? " on" : ""}" data-act="answer" data-q="${q.id}" data-v="${esc(o)}">${esc(o)}</button>`).join("") + "</div>";
                else if (q.type === "scale") {
                    h += '<div class="st-scale">';
                    for (let k = q.min; k <= q.max; k++) h += `<button type="button" class="st-choice${v === k ? " on" : ""}" data-act="answer" data-q="${q.id}" data-v="${k}" data-num="1">${k}</button>`;
                    h += `</div><div class="st-scale-ends"><span>${esc(q.minLabel)}</span><span>${esc(q.maxLabel)}</span></div>`;
                }
                h += "</div>";
            });
            h += `</div><div class="st-flow-foot"><span>${can ? "Ready to continue" : "Please answer all questions to continue"}</span>`
                + `<button type="button" class="st-btn st-btn-primary" data-act="submitDemographics"${can ? "" : " disabled"}>Begin session 1 →</button></div></div>`;
            keep(() => { el.innerHTML = h; });
        }

        // ── Surveys after a session ──────────────────────────────────────────
        function surveyResponses(name) {
            const r = {};
            if (SURVEYS[name].type === "nasa") for (const it of SURVEYS[name].items) r[it.id] = 10;
            return r;
        }
        function drawSurvey(s) {
            const names = surveysForSession(s.sessionNumber), name = names[ui.page], def = SURVEYS[name];
            const last = ui.page === names.length - 1, finalSession = s.sessionNumber >= s.numSessions;
            const all = def.items.every((it) => ui.responses[it.id] !== undefined);
            let h = '<div class="st-flow-card st-flow-wide"><div class="st-flow-head st-flow-headrow"><div>'
                + `<p class="st-flow-kicker">Session ${s.sessionNumber} survey — ${ui.page + 1} / ${names.length}</p><h2>${esc(def.title)}</h2><p>${esc(def.subtitle)}</p></div>`
                + '<div class="st-dots">' + names.map((_, i) => `<i class="${i < ui.page ? "done" : i === ui.page ? "now" : ""}"></i>`).join("") + "</div>"
                + '</div><div class="st-flow-body">';
            for (const it of def.items) {
                const v = ui.responses[it.id];
                if (def.type === "nasa") {
                    h += `<div class="st-q"><p>${esc(it.question)}</p>${it.help ? `<p class="st-q-warn">⚠ ${esc(it.help)}</p>` : ""}`
                        + `<div class="st-slider"><span>${esc(it.leftLabel)}</span><input type="range" min="0" max="20" value="${v}" data-q="${it.id}" data-num="1"><span>${esc(it.rightLabel)}</span><b>${v}</b></div></div>`;
                } else {
                    h += `<div class="st-q"><p>${esc(it.question)}</p><div class="st-scale">`;
                    for (let k = 1; k <= 7; k++) h += `<button type="button" class="st-choice${v === k ? " on" : ""}" data-act="answer" data-q="${it.id}" data-v="${k}" data-num="1">${k}</button>`;
                    h += '</div><div class="st-scale-ends"><span>Strongly disagree</span><span>Strongly agree</span></div></div>';
                }
            }
            h += `</div><div class="st-flow-foot"><span>${all ? "All questions answered" : "Please answer all questions to continue"}</span>`
                + `<button type="button" class="st-btn st-btn-primary" data-act="nextSurvey"${all ? "" : " disabled"}>${last ? (finalSession ? "Finish study" : "Continue →") : "Next →"}</button></div></div>`;
            keep(() => { el.innerHTML = h; });
        }

        // ── Break between sessions ───────────────────────────────────────────
        function drawBetween(s) {
            const left = Math.max(0, Math.ceil((ui.until - Date.now()) / 1000));
            const done = s.sessionNumber, next = done + 1, score = s.completedSessionScores[done - 1] ?? 0;
            const h = '<div class="st-flow-card st-flow-narrow st-center">'
                + (s.config.collectDemographics
                    ? `<div><p class="st-flow-kicker">Session ${done} complete</p><p class="st-flow-note">Take a short break.</p></div>`
                    : `<div><p class="st-flow-kicker">Session ${done} complete</p><p class="st-big">${score}</p><p class="st-flow-note">points</p></div><hr>`)
                + `<div><p class="st-flow-sub">Session ${next} starts in</p><p class="st-count">${left}</p></div>`
                + `<button type="button" class="st-btn st-btn-big st-btn-primary" data-act="nextSession"${left > 0 ? " disabled" : ""}>${left > 0 ? `Continue in ${left}s…` : `Start Session ${next}`}</button></div>`;
            el.innerHTML = h;
            if (left > 0) breakTimer = setTimeout(() => { if (screen.startsWith("between") && last) drawBetween(last); }, 250);
        }

        // ── End screen ───────────────────────────────────────────────────────
        function download() {
            const a = document.createElement("a");
            a.href = "/strattac/results";
            a.click();
        }
        function drawDone(s) {
            const c = s.config, scores = s.completedSessionScores, n = scores.length;
            const cxs = Array.from({ length: c.numSessions }, (_, i) => (c.sessionComplexities && c.sessionComplexities[i]) || c.complexity);
            const summary = cxs.every((x) => x === cxs[0]) ? (COMPLEXITY_LABEL[cxs[0]] || cxs[0]) : cxs.map((x) => COMPLEXITY_LABEL[x] || x).join(" → ");
            const row = (k, v) => `<div class="st-kv"><span>${k}</span><b>${esc(String(v))}</b></div>`;
            let h = '<div class="st-flow-card st-flow-narrow st-center"><div><div class="st-tick">✓</div><p class="st-flow-kicker st-green">Study Complete</p><h2>All sessions finished</h2>'
                + `<p class="st-flow-note">You have completed ${n === 1 ? "the session" : `all ${n} sessions`}${c.collectDemographics ? "." : ` (${esc(summary)} complexity).`}</p></div>`
                + '<div class="st-flow-box">' + row("Participant", c.participantId) + row("Condition", c.condition)
                + (c.collectDemographics ? "" : row("Complexity", summary)) + row("Seed", c.seed) + "</div>";
            if (!c.collectDemographics) {
                h += '<div class="st-flow-box">' + scores.map((v, i) => row("Session " + (i + 1), v + " pts")).join("")
                    + `<div class="st-kv st-kv-total"><span>Total</span><b>${scores.reduce((a, b) => a + b, 0)} pts</b></div></div>`;
            }
            h += '<p class="st-flow-note">Please ask the researcher to confirm your data has been saved.</p>'
                + '<button type="button" class="st-btn st-btn-big st-btn-green" data-act="download">Download Study Data</button>'
                + '<button type="button" class="st-btn st-btn-sm st-wide" data-act="download">Download Again</button>'
                + '<p class="st-flow-fine">A copy is also saved on the HARIS server, in <code>log/strattac</code>. '
                + '<a href="#" data-act="newStudy">Back to the start screen</a></p></div>';
            el.innerHTML = h;
        }

        // ── Events ───────────────────────────────────────────────────────────
        el.addEventListener("click", (e) => {
            const b = e.target.closest("[data-act]");
            if (!b || b.disabled) return;
            const act = b.dataset.act, v = b.dataset.v;
            if (act === "download" || act === "newStudy") e.preventDefault();
            if (act === "mode") { start.mode = v; drawStart(); }
            else if (act === "tacticalMode") { start.tacticalMode = v; drawStart(); }
            else if (act === "complexity") { start.sessionComplexities[0] = v; drawStart(); }
            else if (act === "sessions") { start.numSessions = +v; drawStart(); }
            else if (act === "eps") {
                const k = b.dataset.k, d = +b.dataset.d;
                start[k] = Math.round(Math.min(EPS_MAX, Math.max(0, start[k] + d * EPS_STEP)) * 100) / 100;
                drawStart();
            }
            else if (act === "randomise") { start.seed = String(randomSeed()); drawStart(); }
            else if (act === "startStudy") startStudy(false);
            else if (act === "beginStudy") startStudy(true);
            else if (act === "openTactical") ctx.openView("tactical");
            else if (act === "answer") {
                ui.responses[b.dataset.q] = b.dataset.num ? +v : v;
                if (screen.startsWith("demographics")) drawDemographics(last); else drawSurvey(last);
            }
            else if (act === "submitDemographics") send({ type: "SUBMIT_DEMOGRAPHICS", responses: ui.responses });
            else if (act === "nextSurvey") {
                const names = surveysForSession(last.sessionNumber), name = names[ui.page];
                send({ type: "SUBMIT_SURVEY", surveyName: name, responses: ui.responses });
                if (ui.page === names.length - 1) { b.disabled = true; send({ type: "FINISH_SURVEYS" }); }
                else { ui.page++; ui.responses = surveyResponses(names[ui.page]); drawSurvey(last); el.querySelector(".st-flow-body").scrollTop = 0; }
            }
            else if (act === "nextSession") send({ type: "NEXT_SESSION" });
            else if (act === "download") download();
            else if (act === "newStudy") send({ type: "RESET_STUDY" });
        });
        el.addEventListener("input", (e) => {
            const t = e.target;
            if (t.dataset.key) {
                const k = t.dataset.key;
                if (t.type === "checkbox") { start[k] = t.checked; return; }
                if (k.startsWith("cx")) { start.sessionComplexities[+k.slice(2)] = t.value; return; }
                start[k] = t.value;
            } else if (t.dataset.q) {
                ui.responses[t.dataset.q] = t.dataset.num ? (t.value === "" ? "" : Number(t.value)) : t.value;
                if (t.type === "range") { t.parentElement.querySelector("b").textContent = t.value; return; }
                // Only the footer depends on typing, so leave the focused field alone
                const can = !!last.config.fastTest || DEMOGRAPHICS.every(answered);
                const foot = el.querySelector(".st-flow-foot");
                foot.querySelector("span").textContent = can ? "Ready to continue" : "Please answer all questions to continue";
                foot.querySelector("button").disabled = !can;
            }
        });

        function secondary(s) {
            const playing = s.phase === "playing";
            el.hidden = playing;
            if (playing) { screen = ""; return; }
            const key = "s:" + s.phase;
            if (key === screen) return;
            screen = key;
            el.classList.toggle("st-flow-dim", s.phase !== "setup");
            el.innerHTML = s.phase === "setup"
                ? '<div class="st-message">Waiting for the study to start…<br><small>Start it in the strategic view, then plan missions here.</small></div>'
                : '<div class="st-message">Paused<br><small>Continue in the strategic view.</small></div>';
        }

        return {
            update(s) {
                last = s;
                if (role !== "primary") { secondary(s); return; }
                const playing = s.phase === "playing";
                el.hidden = playing;
                if (s.phase === "done" && prevPhase && prevPhase !== "done") download();   // as the original, save as soon as it ends
                prevPhase = s.phase;
                if (playing) { screen = ""; return; }
                const key = s.phase + ":" + s.sessionNumber + ":" + (s.config.participantId || "");
                if (key === screen) return;
                screen = key;
                clearTimeout(breakTimer);
                if (s.phase === "setup") { start.error = ""; drawStart(); }
                else if (s.phase === "demographics") { ui = { responses: {} }; drawDemographics(s); }
                else if (s.phase === "survey") { const names = surveysForSession(s.sessionNumber); ui = { page: 0, responses: surveyResponses(names[0]) }; drawSurvey(s); }
                else if (s.phase === "between") { ui = { until: Date.now() + (s.config.fastTest ? 3 : BREAK_SECONDS) * 1000 }; drawBetween(s); }
                else if (s.phase === "done") drawDone(s);
            },
            destroy() { clearTimeout(breakTimer); },
        };
    },
});
