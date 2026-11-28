// The guided walkthrough of the strategic/tactical study, ported step for step from the original
// (src/utils/tutorialSteps.ts). It teaches the manual workflow first (allocate, plan, deploy, recover from a
// failure, abort), then both assistants.
//
// Step fields, as in the original:
//   highlight          data-tutorial anchor to spotlight      cardSide  right | left | bottom | top | center
//   mustInteract       no Next button; the step advances when its action happens (autoAdvanceWhen, or a page event)
//   unsatisfiableWhen  the action has become impossible, so Next comes back with unsatisfiableHint
//   allowClickThrough  the spotlit element stays usable        tryIt / noOverlay / spotlightPadding
//   inMapWindow        shown in the tactical view instead      noOverlayOnPrimary  leave the strategic view visible
//   forceManual / forceAgent  lock the allocation panel to one flow   waitForSuggest  Next waits for the Suggest reveal
// Predicates take (state, ctx), where state is the /strattac/state snapshot.
import { taskRule } from "./study.js";

const recovering = (s) => s.missions.find((m) => m.failureRecoveryPending);
const onMission = (s, m) => s.assets.filter((a) => a.currentMissionId === m.id && a.status === "deployed");
const unfinished = (m) => m.tasks.filter((t) => t.status !== "completed" && t.status !== "failed");

// Mirrors the planner's Deploy/Reassign gate: primary or substitute composition
export function taskCoverableBy(ctx, task, pool) {
    const c = { Blue: 0, Red: 0, Green: 0 };
    for (const a of pool) c[a.type]++;
    const meets = (r) => r && c.Blue >= r.Blue && c.Red >= r.Red && c.Green >= r.Green;
    const rule = taskRule(ctx, task.type);
    return meets(rule.primary) || meets(rule.substitute);
}

function canReassign(s, ctx) {
    const m = recovering(s);
    if (!m) return false;
    const pool = onMission(s, m);
    return pool.length > 0 && unfinished(m).every((t) => taskCoverableBy(ctx, t, pool));
}

export const TUTORIAL_STEPS = [
    { id: "welcome", title: "Welcome to SAR Command", cardSide: "center", body: [
        "You are the operator of a search-and-rescue drone fleet. When distress signals are detected, missions arrive and it is your job to allocate drone teams to respond.",
        "This tutorial walks you through every part of the interface step by step. Click Next to proceed at your own pace, or Skip to go straight to the real session."] },
    { id: "session-score", title: "Sessions & Scoring", cardSide: "center", body: [
        "Each session lasts 8 minutes. When it ends you will answer a short survey before the next one begins.",
        "Your goal is to maximise your score. Points are earned by completing mission tasks. Waiting too long costs penalty points — so speed matters."] },
    { id: "header", title: "The Header Bar", highlight: "header", cardSide: "bottom", body: [
        "The header gives you a constant at-a-glance view of the session state. Let's step through its parts."] },
    { id: "timer", title: "Session Timer", highlight: "timer", cardSide: "bottom", body: [
        "The amber countdown shows the time remaining in the session."] },
    { id: "score", title: "Your Score", highlight: "score", cardSide: "bottom", body: [
        "Your live score is shown here. The green number shows completion points earned from finished tasks. The red number shows accumulated wait penalty.",
        "Score = completion points − penalty. Complete tasks quickly to keep that gap wide."] },
    { id: "reserve", title: "Your Drone Reserve", highlight: "reserve-strip", cardSide: "bottom", spotlightPadding: 6, body: [
        "Your reserve holds three drone types — {blue}, {red}, {green} — covered in detail next.",
        "This strip shows how many drones are available at the hub. The bold number is ready to deploy; the small text shows your total fleet of that type, and how many are currently out on missions.",
        "Watch your reserve — if it runs low you cannot respond to new missions quickly."] },
    { id: "drone-types", title: "Three Drone Types", highlight: "reserve-strip", cardSide: "bottom", spotlightPadding: 6, body: [
        "{blue} drones are your fastest type — used for reconnaissance tasks.",
        "{red} drones carry and place supplies — used for supply drops and precision deliveries.",
        "{green} drones are your slowest type, but carry the thermal camera some tasks specifically require."] },
    { id: "mission-queue", title: "The Mission Queue", highlight: "mission-list", cardSide: "right", spotlightPadding: 6, body: [
        "A mission has arrived — you can see it here. We will run through a complete manual workflow first: allocate a team, plan the drone assignments, and deploy. After that you will try both AI agents.",
        "Missions are grouped by status: Incoming (awaiting allocation), Active (drones deployed), and Completed. Keep Incoming short."] },
    { id: "mission-card", title: "Reading a Mission Card", highlight: "first-mission-card", cardSide: "right", body: [
        "Each card shows the mission ID, a category badge ({catA} Routine through {catE} Mass Casualty), and task completion status.",
        "Higher-category missions score more points but require more varied drone types. The amber border means it is waiting for drone allocation."] },
    { id: "task-progress", title: "Task Progress Bar", highlight: "first-task-progress", cardSide: "right", spotlightPadding: 4, body: [
        "This bar shows each task's status. Segment width reflects the task's point value.",
        "Gray = pending, blue = drone traveling to task, amber = executing, green = complete. A red border at the top grows with penalty urgency."] },
    { id: "penalty", title: "Penalty Histogram", highlight: "first-penalty", cardSide: "right", spotlightPadding: 4, body: [
        "The histogram below shows how penalty has accumulated over time. Each bar is a time interval since the mission arrived — taller bars mean faster accrual.",
        "The red number shows total penalty so far. Each task that completes immediately reduces the growth rate."] },
    { id: "allocate", title: "Allocating a Mission", highlight: "first-allocate-btn", cardSide: "right", allowClickThrough: true, mustInteract: true,
        autoAdvanceWhen: (s) => s.strategicModal !== null, autoAdvanceDelay: 0, spotlightPadding: 6, forceManual: true, body: [
        "When a mission is queued, an amber Allocate button appears on its card. Click it now to open the allocation panel."] },
    { id: "panel-intro", title: "Manual Allocation", highlight: "first-manual-toggle", cardSide: "right", allowClickThrough: true, mustInteract: true,
        forceManual: true, spotlightPadding: 6, body: [
        "The allocation panel has two modes. Assistant suggestions are disabled for this first mission — we will cover those on the next one.",
        'Click "Set manually instead" below to switch to manual mode.'] },
    { id: "manual-picker", title: "Set Your Allocation & Deploy", highlight: "first-mission-card", cardSide: "right", allowClickThrough: true, mustInteract: true,
        autoAdvanceWhen: (s) => s.missions.some((m) => m.tacticalPending),
        unsatisfiableWhen: (s) => !s.strategicModal && !s.missions.some((m) => m.tacticalPending),
        unsatisfiableHint: "The allocation panel is closed and nothing was committed — click Next, or re-open it from the mission card.",
        forceManual: true, spotlightPadding: 8, body: [
        "Check the task bars to see what drone types each task requires. A sensible minimum here is 1 {blue} + 2 {red} + 1 {green} — enough to cover every task at full speed. A second {blue} would let the two {T1} Recce tasks run in parallel instead of one after another.",
        'Use the ± buttons to set your allocation — the number after the slash is your available reserve. The ETA preview updates as you adjust. When you are happy, click "Deploy" to commit the team. The tutorial will advance automatically.'] },
    // Entering this step swaps in the fixed training team on the server (explained in tac-welcome)
    { id: "tactical-pending", title: "Tactical Planning Pending", highlight: "first-tactical-pending", cardSide: "right", body: [
        "Your committed team is already on its way to the mission zone — but they still need instructions on which drone handles which task.",
        "You give those instructions in the Tactical Planner. If the drones arrive before you finish planning, they simply hold at the zone edge and wait."] },
    { id: "map-overview", title: "The Strategic Map", cardSide: "center", body: [
        "A quick recap of the strategic map: the hub (blue circle), all mission zones (coloured circles), and drone travel routes. Zone colours: amber = queued, blue = active.",
        "Click Next, then follow the tutorial on the Tactical Planner screen — it should already be open on your second screen."] },

    // Tactical view, phase 1
    { id: "tac-welcome", title: "The Tactical Planner", cardSide: "center", inMapWindow: true, body: [
        "Welcome. This window is where you plan exactly which drones do which tasks and in what order before they begin work at the zone.",
        "For this training mission we set your team to 2 {blue} + 1 {red} + 1 {green} so you can practise every control here. In the real session you always choose your own allocation.",
        "Use the Back and Next buttons on this card to navigate."] },
    { id: "tac-queue", title: "Mission Queue", highlight: "tac-mission-list", cardSide: "right", inMapWindow: true, body: [
        "This left panel lists missions that are waiting for tactical planning (yellow border) or have a drone failure needing recovery (red border)."] },
    { id: "tac-select", title: "Select Your Mission", highlight: "tac-mission-list", cardSide: "right", allowClickThrough: true, mustInteract: true, inMapWindow: true,
        advanceOn: "tutorial-mission-selected", body: [
        "Click on the pending mission in the left panel to open its tactical plan. You should see a mission with a yellow border — that is the one you just allocated."] },
    { id: "tac-header", title: "Planner Header", highlight: "tac-header", cardSide: "bottom", inMapWindow: true, body: [
        "The header shows the mission ID, category, and mode. The buttons on the right let you Reset the assignments or Abort Mission. Deploy sits at the foot of the schedule panel on the right.",
        "A third button, Suggest, asks the Tactical Assistant to fill the plan for you. It appears later — you will plan this mission by hand first.",
        '"Drag → assign · Shift+drag → chain · hover a drone for its full path" summarises the controls — we will practise these shortly.'] },
    { id: "tac-zone", title: "The Mission Zone", highlight: "tac-svg-container", cardSide: "left", inMapWindow: true, body: [
        'The main area shows the mission zone as a blue circle. The dashed line and "HUB" label show the direction back to base.',
        "Drone icons sit around the zone perimeter — one icon per drone in the team. Task circles inside the zone represent the work to be done."] },
    { id: "tac-task-reqs", title: "Check Task Requirements", highlight: "tac-schedule", cardSide: "left", inMapWindow: true, body: [
        "Before assigning drones, look at the task schedule on the right. Each row shows which drone types a task needs to execute — a task cannot start until its requirements are met.",
        "Different tasks need different combinations of {blue}, {red}, and {green} drones, so check each row before you start dragging."] },
    { id: "tac-unassigned", title: "Your Available Drones", highlight: "tac-unassigned", cardSide: "left", inMapWindow: true, body: [
        "This panel lists drones that have not yet been assigned to any task — each chip shows the drone type icon and its callsign."] },
    { id: "tac-manual", title: "Assigning Drones to Tasks", highlight: "tac-svg-container", cardSide: "left", allowClickThrough: true, mustInteract: true, inMapWindow: true,
        advanceOn: "tutorial-drone-assigned", body: [
        "Drag a drone icon from the mission zone map onto a task circle to assign it — a dashed arrow will appear. You can also drag a chip from the Unassigned panel above onto a task circle.",
        "A normal drag moves the drone exclusively to that task. Practise now: drag one drone onto a task circle to continue."] },
    { id: "tac-chain", title: "Chaining One Drone Through Multiple Tasks", highlight: "tac-svg-container", cardSide: "left", allowClickThrough: true, mustInteract: true, inMapWindow: true,
        advanceOn: "tutorial-drone-chained", advanceCount: 2, body: [
        "A drone can visit more than one task before returning to the hub. Hold Shift while dragging a drone icon onto a second task circle — the drone keeps its current assignment and is added to the new task.",
        "Example: drag a {blue} drone to the first {T1} Recce, then Shift+drag the same {blue} to a second task. That drone will fly hub → {T1} → next task in one trip.",
        "Practise now: Shift+drag a drone onto a second task twice. The tutorial advances after two successful chains."] },
    { id: "tac-fill", title: "Complete the Plan", highlight: "tac-svg-container", cardSide: "left", allowClickThrough: true, mustInteract: true, inMapWindow: true,
        advanceOn: "tutorial-plan-complete", body: [
        "Good — you've practised chaining. Now assign drones to any remaining tasks. Every row in the schedule panel must show at least one drone before you can deploy.",
        "Check the task types: {T1} Recce needs {blue} drones, {T3} Supply Drop needs {red} drones, {T5} Search & Service needs {green} drones. Use normal drags for new assignments and Shift+drag to add a drone to an additional task.",
        "The tutorial advances automatically once all tasks are covered."] },
    { id: "tac-schedule", title: "Task Schedule", highlight: "tac-schedule", cardSide: "left", inMapWindow: true, body: [
        "The schedule lists each task with its required drone composition, assigned drones (drag chips here to reassign or click × to remove), and estimated start and end times.",
        'Counters like "0/1F" mean 0 of 1 required {blue} drones are currently assigned — F/L/C are short for {blue}/{red}/{green}.',
        "A task turns green when its composition requirement is fully met. The footer shows the overall estimated completion time.",
        "One drone can cover the work of two, just slower: {T3} normally wants two {red} + one {green}, but with only one {red} a single {red} + {green} still completes it — much more slowly."] },
    { id: "tac-deploy", title: "Deploy the Mission", highlight: "tac-deploy-btn", cardSide: "left", allowClickThrough: true, mustInteract: true, inMapWindow: true,
        autoAdvanceWhen: (s) => s.missions.some((m) => m.status === "active" || m.status === "completed"), body: [
        'When you are satisfied with the assignments, click "Deploy ✓" to send the drones to their tasks — they move from the zone edge straight to work.',
        "You have now completed the full manual workflow. Once deployed, we will demo a drone failure."] },

    // Failure demo (the server fails a drone 5 s after this step starts)
    { id: "failure-incoming", title: "Watch the Deployment", cardSide: "right", noOverlay: true, mustInteract: true,
        mustInteractHint: "Waiting for the failure to trigger — this step advances automatically.",
        autoAdvanceWhen: (s) => s.missions.some((m) => m.failureRecoveryPending), autoAdvanceDelay: 1200,
        unsatisfiableWhen: (s) => !s.missions.some((m) => m.status === "active" || m.failureRecoveryPending),
        unsatisfiableHint: "The mission finished before the fault could trigger — click Next to carry on.", body: [
        "Your drones have departed — switch to the map window to watch them flying. This is what a live mission looks like.",
        "A drone is about to experience a technical fault. Watch the mission queue here: the affected mission will appear with a red border when the failure triggers."] },
    { id: "failure-tac-view", title: "Mission Failure Alert", highlight: "tac-mission-list", cardSide: "right", allowClickThrough: true, mustInteract: true,
        mustInteractHint: "Click the red-bordered mission in the queue to continue.", advanceOn: "tutorial-mission-selected",
        unsatisfiableWhen: (s) => !s.missions.some((m) => m.failureRecoveryPending),
        unsatisfiableHint: "There is no mission awaiting recovery any more — click Next to carry on.", inMapWindow: true, noOverlayOnPrimary: true, body: [
        'Your mission now has a red border and a "FAIL" badge in the queue. Click it to open its recovery plan.'] },
    { id: "failure-recovery-explain", title: "Recovery Planner", highlight: "tac-svg-container", cardSide: "left", spotlightPadding: 6, inMapWindow: true, body: [
        "The planner has switched to recovery mode. The failed drone has been removed from its task — that task is now uncovered and highlighted on the map.",
        "Your remaining team drones are still available to cover the gap. Click Next, and on the following step you will reassign one to the open task."] },
    { id: "failure-recovery-do", title: "Reassign Now", cardSide: "left", noOverlay: true, mustInteract: true, inMapWindow: true, advanceOnRecovered: true,
        mustInteractHint: 'Drag a drone onto the uncovered task, then click "Reassign ✓".',
        unsatisfiableWhen: (s, ctx) => !canReassign(s, ctx),
        unsatisfiableHint: "This mission's remaining drones can no longer cover every task, so Reassign stays disabled — click Next, or abandon the mission.", body: [
        'Drag an available drone from the zone edge onto the uncovered task circle, then click "Reassign ✓". The tutorial advances automatically once recovery is confirmed.',
        'This is still the manual workflow — the Tactical Assistant comes later. Its "Suggest" button is hidden for this step so you get the practice.'] },
    { id: "failure-lesson", title: "Why Redundancy Matters", cardSide: "center", body: [
        "Failures like that happen in the real session too. Allocating extra drones above the mission minimum creates a buffer — one failure still leaves the task coverable.",
        "The Strategic Assistant's Aggressive strategy always includes one redundant drone per type. The manual picker shows the same buffer for your own allocation next to each row — \"1 can fail\" when you have a spare, \"no spare\" when you are on the bare minimum."] },

    // Abort lesson (entering abort-explain fails the drone this mission cannot do without)
    { id: "abort-explain", title: "When You Cannot Recover", cardSide: "center", body: [
        "Recovery can only draw on drones already deployed on that mission, not your hub reserve. If the failed drone was the only one of its type, the task can't be covered — and the only option is to abort.",
        "Partial completions still score; remaining tasks re-queue as a residual mission.",
        "The tutorial will now fail the one drone this mission cannot do without. Switch to the Tactical Planner to abort it."] },
    { id: "abort-select", title: "Reopen the Failed Mission", highlight: "tac-mission-list", cardSide: "right", allowClickThrough: true, mustInteract: true,
        mustInteractHint: "Click the red-bordered mission in the queue to open its recovery plan.", advanceOn: "tutorial-mission-selected",
        unsatisfiableWhen: (s) => !s.missions.some((m) => m.failureRecoveryPending),
        unsatisfiableHint: "No mission is awaiting recovery (the earlier one was already resolved or abandoned) — click Next to carry on.", inMapWindow: true, noOverlayOnPrimary: true, body: [
        'Your mission has a fresh drone failure — it is back in the queue with a red border and a "FAIL" badge.',
        "Click it to reopen its recovery plan. This time you will find the failure cannot be covered."] },
    { id: "abort-do", title: "Abort the Mission", cardSide: "left", noOverlay: true, mustInteract: true,
        mustInteractHint: 'Click "Abandon Mission" at the bottom of the recovery panel.',
        autoAdvanceWhen: (s) => s.missions.some((m) => m.status === "abandoned"),
        unsatisfiableWhen: (s) => !s.missions.some((m) => m.failureRecoveryPending),
        unsatisfiableHint: "There is no mission left to abort — click Next to carry on.", inMapWindow: true, noOverlayOnPrimary: true, body: [
        'A drone has failed and no survivor on this mission can take over its task — the schedule shows that task uncovered and "Reassign" is disabled.',
        'Click "Abandon Mission" at the bottom of the recovery panel. Partial completions still score and the remaining tasks re-queue automatically.'] },

    // The assistants (entering agent-intro spawns the second mission)
    { id: "agent-intro", title: "Now Try the Assistants", cardSide: "center", body: [
        "Good work — you've completed the full manual workflow. A second mission has arrived.",
        "Strategic vs Tactical: the Strategic Assistant decides how many drones to commit overall; the Tactical Assistant then decides which specific drones do which tasks. You'll use both for this mission."] },
    { id: "allocate-agent", title: "Allocate the Second Mission", highlight: "first-allocate-btn", cardSide: "right", allowClickThrough: true, mustInteract: true,
        autoAdvanceWhen: (s) => s.strategicModal !== null, autoAdvanceDelay: 0, spotlightPadding: 6, body: [
        "Click the amber Allocate button on the queued mission to open the allocation panel. This time agent suggestions will be active."] },
    { id: "agent-panel-intro", title: "The Strategic Assistant", highlight: "first-strategic-panel", cardSide: "right", forceAgent: true, body: [
        "The Strategic Assistant offers two pre-computed strategies — Aggressive (more drones, faster mission) and Conservative (fewer drones, preserves your reserve).",
        "Both meet the mission's task requirements. Compare them and choose the one that fits your situation."] },
    { id: "strategy-detail", title: "Reading a Strategy Card", highlight: "first-strategy-card", cardSide: "right", forceAgent: true, body: [
        "Each card shows: the drone composition (e.g. 2 {blue}, 1 {red}, 1 {green}), the estimated completion time for all tasks, and how many drones of each type remain in reserve after deployment."] },
    { id: "score-bars", title: "Strategy Score Bars", highlight: "first-strategy-card", cardSide: "right", forceAgent: true, body: [
        "Three bars summarise each strategy: Speed (mission completion time), Reserve (drones left available), and Resilience (redundancy against failures).",
        "There is no single correct choice — weigh speed against keeping reserve for upcoming missions."] },
    { id: "deploy-agent", title: "Select a Strategy & Deploy", highlight: "first-strategic-panel", cardSide: "right", allowClickThrough: true, mustInteract: true,
        autoAdvanceWhen: (s) => s.missions.filter((m) => m.tacticalPending).length >= 1,
        unsatisfiableWhen: (s) => !s.strategicModal && !s.missions.some((m) => m.tacticalPending),
        unsatisfiableHint: "The allocation panel is closed and nothing was committed — click Next, or re-open it from the mission card.",
        spotlightPadding: 6, forceAgent: true, body: [
        'Click one of the strategy cards to select it (a blue ✓ will appear), then click "Deploy Selected" to commit that drone team. The mission will move to tactical planning.'] },

    // Tactical view, phase 2
    { id: "tac-suggest-intro", title: "The Tactical Assistant", cardSide: "center", inMapWindow: true, body: [
        "The mission you just allocated is waiting for tactical planning. This time, instead of assigning drones manually, you will use the Tactical Assistant.",
        "The agent fills in all drone-to-task assignments automatically. You can then accept the plan or drag to override individual assignments before deploying."] },
    { id: "tac-select-m2", title: "Select the New Mission", highlight: "tac-mission-list", cardSide: "right", allowClickThrough: true, mustInteract: true,
        mustInteractHint: "Click the yellow-bordered mission in the queue to continue.", advanceOn: "tutorial-mission-selected",
        unsatisfiableWhen: (s) => !s.missions.some((m) => m.tacticalPending),
        unsatisfiableHint: "No mission is waiting for tactical planning — click Next to carry on.", inMapWindow: true, body: [
        "The mission you just allocated is waiting in the queue with a yellow border. Click it to open its plan in the planner."] },
    { id: "tac-suggest", title: "Let the Tactical Assistant Fill the Plan", highlight: "tac-suggest-btn", cardSide: "bottom", allowClickThrough: true, mustInteract: true,
        mustInteractHint: 'Click the "Suggest" button to continue.', advanceOn: "tutorial-suggest-clicked", inMapWindow: true, body: [
        'Click the "Suggest" button in the planner header. The agent fills in all drone-to-task assignments automatically.',
        "You will see dashed arrows appear on the map and the schedule update."] },
    { id: "tac-override", title: "Review and Override", highlight: "tac-svg-container", cardSide: "left", allowClickThrough: true, tryIt: true,
        tryItHint: "Optionally drag to override an assignment, then click Next →.", waitForSuggest: true, inMapWindow: true, body: [
        "The agent has filled in a plan. You can accept it as-is, or drag any drone to a different task to override individual assignments.",
        'When the Deploy button reads "Deploy ✓" all tasks are covered. Click Next when ready.'] },
    { id: "tac-deploy2", title: "Deploy Mission 2", highlight: "tac-deploy-btn", cardSide: "left", allowClickThrough: true, mustInteract: true, inMapWindow: true,
        autoAdvanceWhen: (s) => !s.missions.some((m) => m.tacticalPending), body: [
        'When you are satisfied with the assignments, click "Deploy ✓" to dispatch the drones.'] },
    { id: "ready", title: "You're Ready — Good Luck!", cardSide: "center", body: [
        "That covers the full interface. Key things to remember: complete tasks quickly to keep penalty low, watch your drone reserve, and treat agent suggestions as helpful guidance — not guaranteed truth.",
        "You are always in control and can override any suggestion. Press Finish to close this tutorial."] },
];

const index = (id) => {
    const i = TUTORIAL_STEPS.findIndex((s) => s.id === id);
    if (i < 0) throw new Error("No tutorial step " + id);
    return i;
};
export const TACTICAL_STEP_LAST = index("tac-deploy2");
export const AGENT_INTRO_STEP = index("agent-intro");
export const TACTICAL_AGENT_STEP = index("tac-suggest-intro");

// Steps whose arrival makes the server act (see TUTORIAL_STEP in the engine)
export const SERVER_EFFECT_STEPS = ["tactical-pending", "failure-incoming", "abort-explain", "agent-intro"];

// What the other panels need to know about the walkthrough right now
export function tutorialInfo(s) {
    const t = s && s.tutorial;
    if (!t || !t.active) return { active: false };
    const current = TUTORIAL_STEPS[t.step] || TUTORIAL_STEPS[0];
    return {
        active: true, step: t.step, current,
        forceManual: !!current.forceManual, forceAgent: !!current.forceAgent,
        anchorNewest: t.step >= AGENT_INTRO_STEP,
        hideSuggest: t.step < TACTICAL_AGENT_STEP,
    };
}

// Recap shown instead of the surveys when a tutorial session ends
export const RECAP = [
    { title: "Missions & your reserve", body: "Distress calls arrive in the mission queue. You respond by committing drones from your reserve of {blue}, {red}, and {green} assets — each type has different speeds and capabilities." },
    { title: "Strategic allocation — how many to send", body: "When you start a mission the Strategic Assistant offers an Aggressive and a Conservative strategy: bundles of drone counts with projected ETA, speed, and reserve scores. Pick one, or set the counts yourself." },
    { title: "Tactical planning — which drone does what", body: "Once allocated, the Tactical Assistant fills in a drone→task plan in the map planner. Accept it as-is, or drag any drone to a different task to override individual assignments." },
    { title: "Failures & recovery", body: "Drones can fail mid-mission. Reassign a spare to recover, or abort if the mission can no longer be completed — keeping some redundancy makes recovery easier." },
    { title: "Scoring", body: "Complete tasks quickly to keep your penalty low, and watch your reserve so you can respond to the next call." },
];
