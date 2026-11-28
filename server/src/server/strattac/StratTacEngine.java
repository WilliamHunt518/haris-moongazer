package server.strattac;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import server.strattac.Model.Asset;
import server.strattac.Model.BalancedRollState;
import server.strattac.Model.Blueprint;
import server.strattac.Model.Comp;
import server.strattac.Model.Mission;
import server.strattac.Model.PendingAllocation;
import server.strattac.Model.Pt;
import server.strattac.Model.RecoveryOption;
import server.strattac.Model.StrategicModal;
import server.strattac.Model.Strategy;
import server.strattac.Model.Task;
import server.strattac.Model.TaskComp;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import java.util.logging.Logger;

import static server.strattac.Params.*;

/**
 * The strategic/tactical study engine: a port of the study's reducer (src/store/gameReducer.ts, study-v1.13).
 *
 * One instance holds the whole study. The simulator's main loop calls {@link #step(double)}; the browser views read
 * {@link #snapshotJson()} and send operator actions to {@link #dispatch(Map)}. Every method is synchronized, so the
 * loop and the web server never see a half-applied change.
 *
 * Randomness, mission generation and both assistants reproduce the original draw for draw. Time advances in the
 * simulator's fixed ticks rather than browser frames, so event times can differ by up to one tick.
 */
public class StratTacEngine {

    private static final Gson GSON = new GsonBuilder().serializeNulls().create();
    private static final Gson PRETTY = new GsonBuilder().serializeNulls().setPrettyPrinting().create();
    private static final DateTimeFormatter ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    /** The study configuration (StudyConfig). Defaults come from the scenario's "study" block. */
    public static class StudyConfig {
        public String participantId = "";
        public String condition = "none";
        public String mode = "agent";
        public String complexity = "strategic";
        public List<String> sessionComplexities;
        public long seed = 42;
        public double agentErrorRate = 0;
        public double epsilonTactical = 0;
        public String tacticalMode = "plan-all";
        public boolean testingMode = false;
        public Boolean fixLockouts = true;
        public Double failureGraceSeconds = FAILURE_GRACE_SECONDS;
        public boolean tutorialMode = false;
        public Boolean skipToFreePlay;
        public int numSessions = 1;
        public Boolean fullPathsOnHover;
        public Boolean collectDemographics;
        public Boolean fastTest;
        public Boolean agentFailuresEnabled = false;
        public Boolean swapGames = false;
    }

    private final Logger logger;
    private final Params params;
    private final Map<String, Object> studyDefaults;
    /** Called with each logged event (the study log writer hooks in here). */
    private Consumer<Map<String, Object>> eventSink = e -> {};
    /** Where the study's log files go (see StudyLogWriter); null logs nothing to disk. */
    private StudyLog studyLog;

    /** Receives the study log: each event as it happens, and the participant file at each session boundary. */
    public interface StudyLog {
        /** A new study started; files for it should be opened. */
        void studyStarted(StudyConfig config);
        /** One logged event, already frozen. */
        void event(Map<String, Object> event);
        /** The participant payload, written when a session ends (survey) and when the study is done. */
        void checkpoint(Map<String, Object> payload, boolean done);
    }

    // ── GameState ────────────────────────────────────────────────────────────
    private StudyConfig config;
    private String phase = "setup";        // setup (start screen), demographics, playing, survey, between, done
    private Map<String, Object> demographics;
    private int sessionNumber = 0;
    private double elapsed = 0;
    private double rawElapsed = 0;
    /** Session clock in whole microseconds, so 0.1 s ticks give exactly the elapsed values the browser's ms clock gives. */
    private long rawMicros = 0;
    private boolean sessionClockStarted = false;
    private List<Asset> assets = new ArrayList<>();
    private List<Mission> missions = new ArrayList<>();
    private List<Blueprint> pendingBlueprints = new ArrayList<>();
    private long score = 0;
    private long penaltyAccrued = 0;
    private final List<Long> completedSessionScores = new ArrayList<>();
    private double sessionDuration = SESSION_DURATION;
    private Map<String, Double> categoryForecast = Params.categoryForecast("balanced");
    private StrategicModal strategicModal;
    private boolean trustProbeActive = false;
    private double nextTrustProbeAt = TRUST_PROBE_INTERVAL;
    private double nextSnapshotAt = 0;
    private double nextFailureRollAt = FAILURE_ROLL_INTERVAL;
    private BalancedRollState strategicFailureRoll = new BalancedRollState();
    private BalancedRollState tacticalFailureRoll = new BalancedRollState();
    private final List<List<Map<String, Object>>> events = new ArrayList<>();
    private long eventSeq = 0;
    /** The browser that started the current session (START_STUDY / NEXT_SESSION carry it), for session_start. */
    private String clientUserAgent = "headless";
    private Object clientViewport = null;
    private long version = 0;

    @SuppressWarnings("unchecked")
    public StratTacEngine(Map<String, Object> scenario, Logger logger) {
        this.logger = logger;
        Map<String, Object> st = (Map<String, Object>) scenario.get("strattac");
        Map<String, Double> speeds = new LinkedHashMap<>();
        Comp fleet = new Comp(11, 11, 11);
        if (st.get("droneTypes") instanceof List<?> types) {
            for (Object o : types) {
                Map<String, Object> t = (Map<String, Object>) o;
                String id = (String) t.get("id");
                if (t.get("speed") instanceof Number n) speeds.put(id, n.doubleValue());
                if (t.get("count") instanceof Number n) fleet.set(id, n.intValue());
            }
        }
        this.params = new Params(speeds, fleet);
        this.studyDefaults = st.get("study") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        this.config = configFrom(Map.of());
        this.assets = createInitialAssets(config.complexity);
    }

    public Params params() { return params; }

    public synchronized void setEventSink(Consumer<Map<String, Object>> sink) {
        this.eventSink = sink == null ? e -> {} : sink;
    }

    public synchronized void setStudyLog(StudyLog log) {
        this.studyLog = log;
    }

    /** Writes the participant file when a session ends, when its surveys are done, and at the end of the study. */
    private void checkpointIfBoundary(String before) {
        if (studyLog == null || phase.equals(before)) return;
        if (!"survey".equals(phase) && !"between".equals(phase) && !"done".equals(phase)) return;
        try { studyLog.checkpoint(studyPayloadMap(), "done".equals(phase)); }
        catch (RuntimeException e) { logger.warning("StratTac study log checkpoint failed: " + e); }
    }

    // ── Config helpers ───────────────────────────────────────────────────────

    /** Builds a StudyConfig from the scenario defaults overlaid with the start screen's values. */
    @SuppressWarnings("unchecked")
    StudyConfig configFrom(Map<String, Object> overrides) {
        Map<String, Object> m = new LinkedHashMap<>(studyDefaults);
        m.putAll(overrides);
        StudyConfig c = new StudyConfig();
        if (m.get("participantId") instanceof String s) c.participantId = s;
        if (m.get("mode") instanceof String s && (s.equals("agent") || s.equals("no-agent"))) c.mode = s;
        if (m.get("complexity") instanceof String s && Arrays.asList(COMPLEXITIES).contains(s)) c.complexity = s;
        if (m.get("sessionComplexities") instanceof List<?> l) {
            c.sessionComplexities = new ArrayList<>();
            for (Object o : l) c.sessionComplexities.add(String.valueOf(o));
        }
        if (m.get("seed") instanceof Number n) c.seed = n.longValue();
        if (m.get("agentErrorRate") instanceof Number n) c.agentErrorRate = clampEps(n.doubleValue());
        if (m.get("epsilonTactical") instanceof Number n) c.epsilonTactical = clampEps(n.doubleValue());
        if ("greedy".equals(m.get("tacticalMode"))) c.tacticalMode = "greedy";
        if (m.get("testingMode") instanceof Boolean b) c.testingMode = b;
        if (m.get("fixLockouts") instanceof Boolean b) c.fixLockouts = b;
        if (m.get("failureGraceSeconds") instanceof Number n) c.failureGraceSeconds = Math.max(0, n.doubleValue());
        if (m.get("tutorialMode") instanceof Boolean b) c.tutorialMode = b;
        if (m.get("numSessions") instanceof Number n) c.numSessions = Math.max(1, n.intValue());
        if (m.get("fullPathsOnHover") instanceof Boolean b) c.fullPathsOnHover = b;
        if (m.get("collectDemographics") instanceof Boolean b) c.collectDemographics = b;
        if (m.get("fastTest") instanceof Boolean b) c.fastTest = b;
        if (m.get("agentFailuresEnabled") instanceof Boolean b) c.agentFailuresEnabled = b;
        if (m.get("swapGames") instanceof Boolean b) c.swapGames = b;
        return c;
    }

    private static double clampEps(double v) { return Math.min(0.95, Math.max(0, v)); }

    private boolean isFixLockouts() { return !Boolean.FALSE.equals(config.fixLockouts); }
    private double graceSeconds() { return config.failureGraceSeconds == null ? FAILURE_GRACE_SECONDS : Math.max(0, config.failureGraceSeconds); }
    private boolean failuresEnabled() { return Boolean.TRUE.equals(config.agentFailuresEnabled); }
    private double epsS() { return failuresEnabled() ? config.agentErrorRate : 0; }
    private double epsT() { return failuresEnabled() ? config.epsilonTactical : 0; }
    private boolean isAgentMode() { return "agent".equals(config.mode); }
    private boolean isGreedy() { return "greedy".equals(config.tacticalMode); }

    private int planSeedIndex(int session) {
        return Boolean.TRUE.equals(config.swapGames) && config.numSessions >= 2 ? config.numSessions + 1 - session : session;
    }

    private String complexityForSession(int session) {
        if (config.sessionComplexities != null && session - 1 < config.sessionComplexities.size())
            return config.sessionComplexities.get(session - 1);
        return config.complexity;
    }

    private double sessionDurationFor(String complexity) {
        if (Boolean.TRUE.equals(config.fastTest)) return 10;
        if (config.tutorialMode) return TUTORIAL_SESSION_DURATION;
        return SESSION_DURATION;
    }

    private List<Asset> createInitialAssets(String complexity) {
        List<Asset> out = new ArrayList<>();
        Comp fleet = params.fleet(complexity, config.tutorialMode);
        for (String type : Model.TYPES) {
            for (int i = 1; i <= fleet.get(type); i++) {
                Asset a = new Asset();
                a.id = type.charAt(0) + String.format("%02d", i);
                a.type = type;
                a.position = HUB.copy(); a.travelFrom = HUB.copy(); a.targetPosition = HUB.copy();
                out.add(a);
            }
        }
        return out;
    }

    // ── Lookups ──────────────────────────────────────────────────────────────

    private Mission mission(String id) {
        if (id == null) return null;
        for (Mission m : missions) if (m.id.equals(id)) return m;
        return null;
    }

    private Asset asset(String id) {
        if (id == null) return null;
        for (Asset a : assets) if (a.id.equals(id)) return a;
        return null;
    }

    private Map<String, Asset> assetMap() {
        Map<String, Asset> m = new HashMap<>();
        for (Asset a : assets) m.put(a.id, a);
        return m;
    }

    private static boolean isTerminal(Task t) { return "completed".equals(t.status) || "failed".equals(t.status); }

    private double timeRemaining() { return Math.max(0, sessionDuration - elapsed); }

    private long nowMs() { return JsMath.round(elapsed * 1000); }

    // ── Logging ──────────────────────────────────────────────────────────────

    static Map<String, Object> ev(String type, Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("type", type);
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    private Map<String, Object> buildContext() {
        Map<String, Object> c = new LinkedHashMap<>();
        int mq = 0, ma = 0, mc = 0, mf = 0, mab = 0, tp = 0, tt = 0, te = 0, tc = 0, tf = 0, da = 0, dd = 0, dr = 0, df = 0;
        List<String> tacPending = new ArrayList<>(), recPending = new ArrayList<>();
        for (Mission m : missions) {
            switch (m.status) {
                case "queued" -> mq++; case "active" -> ma++; case "completed" -> mc++; case "failed" -> mf++; case "abandoned" -> mab++;
            }
            if (m.tacticalPending) tacPending.add(m.id);
            if (m.failureRecoveryPending) recPending.add(m.id);
            for (Task t : m.tasks) {
                switch (t.status) {
                    case "pending" -> tp++; case "traveling" -> tt++; case "executing" -> te++; case "completed" -> tc++; case "failed" -> tf++;
                }
            }
        }
        for (Asset a : assets) {
            switch (a.status) {
                case "available" -> da++; case "deployed" -> dd++; case "returning" -> dr++; case "failed" -> df++;
            }
        }
        c.put("score", score); c.put("penaltyAccrued", penaltyAccrued);
        c.put("missionsQueued", mq); c.put("missionsActive", ma); c.put("missionsCompleted", mc);
        c.put("missionsFailed", mf); c.put("missionsAbandoned", mab);
        c.put("tasksPending", tp); c.put("tasksTraveling", tt); c.put("tasksExecuting", te);
        c.put("tasksCompletedTotal", tc); c.put("tasksFailedTotal", tf);
        c.put("dronesAvailable", da); c.put("dronesDeployed", dd); c.put("dronesReturning", dr); c.put("dronesFailed", df);
        c.put("tacticalPendingMissionIds", tacPending);
        c.put("recoveryPendingMissionIds", recPending);
        c.put("strategicModalMissionId", strategicModal == null ? null : strategicModal.missionId);
        return c;
    }

    private void logEvent(Map<String, Object> event) {
        Map<String, Object> full = new LinkedHashMap<>(event);
        full.put("seq", eventSeq);
        full.put("timestamp", nowMs());
        full.put("wallClock", ISO.format(Instant.now()));
        full.put("sessionId", config.participantId + "_" + config.seed + "_s" + sessionNumber);
        full.put("sessionNumber", sessionNumber);
        full.put("elapsed", elapsed);
        full.put("reserveState", reserveCount(false));
        full.put("reserveStateAvailable", reserveCount(true));
        full.put("context", buildContext());
        full.put("platform", "haris");
        // Deep-copy through JSON so later state changes cannot alter a logged event
        @SuppressWarnings("unchecked")
        Map<String, Object> frozen = (Map<String, Object>) jsNumbers(GSON.fromJson(GSON.toJson(full), LinkedHashMap.class));
        int idx = Math.max(0, sessionNumber - 1);
        while (events.size() <= idx) events.add(new ArrayList<>());
        events.get(idx).add(frozen);
        eventSeq++;
        try { eventSink.accept(frozen); } catch (RuntimeException e) { logger.warning("StratTac event sink failed: " + e); }
        if (studyLog != null) {
            try { studyLog.event(frozen); } catch (RuntimeException e) { logger.warning("StratTac study log failed: " + e); }
        }
    }

    // ── Reserve ──────────────────────────────────────────────────────────────

    /** Drones at the hub; with excludePending, minus drones already committed to a pending tactical plan. */
    public Comp reserveCount(boolean excludePending) {
        Set<String> locked = new LinkedHashSet<>();
        if (excludePending)
            for (Mission m : missions)
                if (m.tacticalPending && m.pendingAllocation != null) locked.addAll(m.pendingAllocation.dronePool);
        Comp c = new Comp();
        for (Asset a : assets) if ("available".equals(a.status) && !locked.contains(a.id)) c.inc(a.type);
        return c;
    }

    private List<Asset> availableExcludingPending(List<Mission> ms, String excludeMissionId) {
        Set<String> locked = new LinkedHashSet<>();
        for (Mission m : ms) {
            if (m.id.equals(excludeMissionId)) continue;
            if (m.tacticalPending && m.pendingAllocation != null) locked.addAll(m.pendingAllocation.dronePool);
        }
        List<Asset> out = new ArrayList<>();
        for (Asset a : assets) if ("available".equals(a.status) && !locked.contains(a.id)) out.add(a);
        return out;
    }

    private static Comp countTypes(List<Asset> as) {
        Comp c = new Comp();
        for (Asset a : as) c.inc(a.type);
        return c;
    }

    // ── Movement helpers ─────────────────────────────────────────────────────

    static Pt loiterSlot(Mission m, String droneId) {
        double cx = m.zoneCenter.x, cy = m.zoneCenter.y, r = m.zoneRadius;
        double hubAngle = StrictMath.atan2(HUB.y - cy, HUB.x - cx);
        double arc = Math.PI * 0.9;
        double frac = (Rng.hashId(droneId) % 997) / 997.0;
        double a = hubAngle - arc / 2 + arc * frac;
        return new Pt(cx + r * StrictMath.cos(a), cy + r * StrictMath.sin(a));
    }

    static Pt interpolate(Asset a, double t) {
        if (a.travelEndElapsed <= a.travelStartElapsed) return a.targetPosition.copy();
        double frac = Math.min(1, Math.max(0, (t - a.travelStartElapsed) / (a.travelEndElapsed - a.travelStartElapsed)));
        return new Pt(a.travelFrom.x + (a.targetPosition.x - a.travelFrom.x) * frac,
                a.travelFrom.y + (a.targetPosition.y - a.travelFrom.y) * frac);
    }

    private void fly(Asset a, Pt from, Pt to, double now) {
        double tt = params.travelTime(from, to, a.type);
        a.travelFrom = from.copy();
        a.targetPosition = to.copy();
        a.travelStartElapsed = now;
        a.travelEndElapsed = now + tt;
    }

    private void launchToLoiter(Mission m, List<String> pool, double now) {
        Set<String> set = new LinkedHashSet<>(pool);
        for (Asset a : assets) {
            if (!set.contains(a.id) || !"available".equals(a.status)) continue;
            Pt slot = loiterSlot(m, a.id);
            double tt = params.travelTime(HUB, slot, a.type);
            a.status = "deployed"; a.currentMissionId = m.id; a.currentTaskId = null;
            a.position = HUB.copy(); a.travelFrom = HUB.copy(); a.targetPosition = slot;
            a.travelStartElapsed = now; a.travelEndElapsed = now + tt; a.availableAt = now + tt;
        }
    }

    /** Parks a drone where it is, on its mission and free for a new plan. */
    private void park(Asset a, double now) {
        Pt pos = interpolate(a, now);
        a.currentTaskId = null; a.position = pos; a.travelFrom = pos.copy(); a.targetPosition = pos.copy();
        a.travelStartElapsed = now; a.travelEndElapsed = now; a.availableAt = now;
    }

    // ── Task assignment ──────────────────────────────────────────────────────

    static class TaskAssignment {
        String taskId; List<String> assetIds; double startTime, travelTime, baseTime; boolean useSubstitute;
    }

    private static class VAsset {
        final String id, type; double freeAt; Pt pos;
        VAsset(String id, String type, double freeAt) { this.id = id; this.type = type; this.freeAt = freeAt; this.pos = HUB.copy(); }
    }

    private static List<Task> sortTypeDesc(List<Task> tasks) {
        List<Task> s = new ArrayList<>(tasks);
        s.sort((a, b) -> b.type - a.type);
        return s;
    }

    /** Virtual-timeline greedy assignment with sequential reuse (greedyAssign). */
    private List<TaskAssignment> greedyAssign(List<Task> tasks, List<Asset> available, Comp committed, double now,
                                              Map<String, TaskComp> plan, List<String> taskOrderIds) {
        List<VAsset> vPool = new ArrayList<>();
        for (String type : Model.TYPES) {
            int n = 0;
            for (Asset a : available) if (a.type.equals(type) && n < committed.get(type)) { vPool.add(new VAsset(a.id, type, now)); n++; }
        }
        List<Task> sorted;
        if (taskOrderIds != null && !taskOrderIds.isEmpty()) {
            sorted = new ArrayList<>();
            for (String id : taskOrderIds) for (Task t : tasks) if (t.id.equals(id)) { sorted.add(t); break; }
            List<Task> rest = new ArrayList<>();
            for (Task t : tasks) if (!taskOrderIds.contains(t.id)) rest.add(t);
            sorted.addAll(sortTypeDesc(rest));
        } else sorted = sortTypeDesc(tasks);

        Comp avail = new Comp();
        for (VAsset v : vPool) avail.inc(v.type);
        List<TaskAssignment> out = new ArrayList<>();
        for (Task task : sorted) {
            Comp req; double baseTime; boolean useSub;
            TaskComp planned = plan == null ? null : plan.get(task.id);
            if (planned != null) {
                req = new Comp(planned.Blue, planned.Red, planned.Green); baseTime = planned.baseTime; useSub = planned.useSubstitute;
            } else {
                Comp prim = TASK_PRIMARY[task.type], sub = TASK_SUBSTITUTE[task.type];
                if (avail.covers(prim)) { req = prim; baseTime = TASK_BASE_TIME[task.type]; useSub = false; }
                else if (sub != null && avail.covers(sub)) { req = sub; baseTime = TASK_SUB_BASE_TIME[task.type]; useSub = true; }
                else continue;
            }
            if (!avail.covers(req) && !useSub) {
                Comp sub = TASK_SUBSTITUTE[task.type];
                if (sub != null && avail.covers(sub)) { req = sub; baseTime = TASK_SUB_BASE_TIME[task.type]; useSub = true; }
            }
            List<VAsset> picked = new ArrayList<>();
            boolean ok = true;
            for (String type : Model.TYPES) {
                List<VAsset> c = new ArrayList<>();
                for (VAsset v : vPool) if (v.type.equals(type)) c.add(v);
                c.sort(Comparator.comparingDouble(v -> v.freeAt));
                if (c.size() < req.get(type)) { ok = false; break; }
                picked.addAll(c.subList(0, req.get(type)));
            }
            if (!ok) continue;
            double start = now;
            for (VAsset v : picked) start = Math.max(start, v.freeAt + params.travelTime(v.pos, task.waypoint, v.type));
            double completion = start + baseTime;
            for (VAsset v : picked) { v.freeAt = completion; v.pos = task.waypoint.copy(); }
            TaskAssignment ta = new TaskAssignment();
            ta.taskId = task.id;
            ta.assetIds = new ArrayList<>();
            for (VAsset v : picked) ta.assetIds.add(v.id);
            ta.startTime = start; ta.travelTime = start - now; ta.baseTime = baseTime; ta.useSubstitute = useSub;
            out.add(ta);
        }
        return out;
    }

    private Comp compOf(List<String> ids, Map<String, Asset> byId) {
        Comp c = new Comp();
        for (String id : ids) { Asset a = byId.get(id); if (a != null) c.inc(a.type); }
        return c;
    }

    private boolean taskMeetsComposition(Task task, List<String> ids, Map<String, Asset> byId) {
        Comp prim = TASK_PRIMARY[task.type], sub = TASK_SUBSTITUTE[task.type];
        Set<String> done = new LinkedHashSet<>(task.completedSectionTypes == null ? List.of() : task.completedSectionTypes);
        Comp c = compOf(ids, byId);
        boolean meetsPrim = true, meetsSub = sub != null;
        for (String t : Model.TYPES) {
            if (done.contains(t)) continue;
            if (c.get(t) < prim.get(t)) meetsPrim = false;
            if (sub != null && c.get(t) < sub.get(t)) meetsSub = false;
        }
        return meetsPrim || meetsSub;
    }

    private boolean usesSubstitute(Task task, List<String> ids, Map<String, Asset> byId) {
        Comp prim = TASK_PRIMARY[task.type], sub = TASK_SUBSTITUTE[task.type];
        if (sub == null) return false;
        Comp c = compOf(ids, byId);
        return !c.covers(prim) && c.covers(sub);
    }

    private double manualBaseTime(Task task, List<String> ids, Map<String, Asset> byId) {
        return usesSubstitute(task, ids, byId) ? TASK_SUB_BASE_TIME[task.type] : TASK_BASE_TIME[task.type];
    }

    /** Start times for an operator-built plan by bounded relaxation over each drone's chain (buildManualAssignments). */
    private List<TaskAssignment> buildManualAssignments(Mission mission, Map<String, List<String>> ta,
                                                        Map<String, List<String>> seqs, double now) {
        Map<String, Asset> byId = assetMap();
        List<String> allDrones = new ArrayList<>(new LinkedHashSet<>(ta.values().stream().flatMap(List::stream).toList()));
        Map<String, Double> starts = new LinkedHashMap<>();
        int maxPasses = ta.size() + 1;
        for (int pass = 0; pass < maxPasses; pass++) {
            Map<String, Double> freeAt = new HashMap<>();
            Map<String, Pt> pos = new HashMap<>();
            for (String id : allDrones) {
                freeAt.put(id, now);
                Asset a = byId.get(id);
                pos.put(id, a != null && "deployed".equals(a.status) ? interpolate(a, now) : HUB.copy());
            }
            boolean changed = false;
            for (String droneId : allDrones) {
                Asset a = byId.get(droneId);
                if (a == null) continue;
                for (String taskId : seqs.getOrDefault(droneId, List.of())) {
                    Task task = mission.task(taskId);
                    if (task == null) continue;
                    double arrival = freeAt.get(droneId) + params.travelTime(pos.get(droneId), task.waypoint, a.type);
                    Double prev = starts.get(taskId);
                    double next = prev == null ? arrival : Math.max(prev, arrival);
                    if (prev == null || next != prev) changed = true;
                    starts.put(taskId, next);
                    freeAt.put(droneId, next + manualBaseTime(task, ta.getOrDefault(taskId, List.of()), byId));
                    pos.put(droneId, task.waypoint.copy());
                }
            }
            if (!changed) break;
        }
        List<TaskAssignment> out = new ArrayList<>();
        for (Map.Entry<String, List<String>> e : ta.entrySet()) {
            Task task = mission.task(e.getKey());
            List<String> ids = e.getValue();
            if (task == null || ids.isEmpty() || !starts.containsKey(e.getKey())) continue;
            if (!taskMeetsComposition(task, ids, byId)) continue;
            TaskAssignment x = new TaskAssignment();
            x.taskId = e.getKey(); x.assetIds = new ArrayList<>(ids);
            x.startTime = starts.get(e.getKey()); x.travelTime = x.startTime - now;
            x.baseTime = manualBaseTime(task, ids, byId); x.useSubstitute = usesSubstitute(task, ids, byId);
            out.add(x);
        }
        return out;
    }

    private static TaskAssignment pickFirstAssignment(List<TaskAssignment> mine, List<String> seq) {
        if (seq != null && !seq.isEmpty()) {
            for (String tid : seq) for (TaskAssignment a : mine) if (a.taskId.equals(tid)) return a;
        }
        TaskAssignment min = mine.get(0);
        for (TaskAssignment a : mine) if (a.startTime < min.startTime) min = a;
        return min;
    }

    /** Recomputes start times for not-yet-started tasks from the drones' current positions. */
    private void rescheduleTasks(Mission mission, List<String> taskIds, double now) {
        Map<String, List<String>> ta = new LinkedHashMap<>();
        for (String tid : taskIds) {
            Task t = mission.task(tid);
            if (t != null && ("traveling".equals(t.status) || "pending".equals(t.status)) && !t.assignedAssetIds.isEmpty())
                ta.put(tid, t.assignedAssetIds);
        }
        if (ta.isEmpty()) return;
        Map<String, List<String>> seqs = new LinkedHashMap<>();
        for (Map.Entry<String, List<String>> e : mission.droneSequences.entrySet()) {
            List<String> f = new ArrayList<>();
            for (String tid : e.getValue()) if (ta.containsKey(tid)) f.add(tid);
            if (!f.isEmpty()) seqs.put(e.getKey(), f);
        }
        List<TaskAssignment> fresh = buildManualAssignments(mission, ta, seqs, now);
        for (TaskAssignment a : fresh) {
            Task t = mission.task(a.taskId);
            if (t == null || !("traveling".equals(t.status) || "pending".equals(t.status))) continue;
            t.status = "traveling"; t.startTime = a.startTime; t.completionTime = a.startTime + a.baseTime;
            t.baseTime = a.baseTime; t.travelTime = Math.max(0, a.startTime - now); t.useSubstitute = a.useSubstitute;
        }
    }

    /** Repairs a scheduling deadlock without failing anything: one canonical visit order over the cyclic tasks. */
    private void rerouteDeadlock(Mission mission, List<String> cycle, double now) {
        Set<String> cyc = new LinkedHashSet<>(cycle);
        List<Task> ranked = new ArrayList<>();
        for (Task t : mission.tasks) if (cyc.contains(t.id)) ranked.add(t);
        ranked.sort((a, b) -> b.type != a.type ? b.type - a.type : (a.id.compareTo(b.id) < 0 ? -1 : 1));
        Map<String, Integer> rank = new HashMap<>();
        for (int i = 0; i < ranked.size(); i++) rank.put(ranked.get(i).id, i);
        Map<String, List<String>> newSeqs = new LinkedHashMap<>();
        for (Map.Entry<String, List<String>> e : mission.droneSequences.entrySet()) {
            List<String> ordered = new ArrayList<>();
            for (String t : e.getValue()) if (cyc.contains(t)) ordered.add(t);
            ordered.sort(Comparator.comparingInt(rank::get));
            List<String> seq = new ArrayList<>();
            int k = 0;
            for (String t : e.getValue()) seq.add(cyc.contains(t) ? ordered.get(k++) : t);
            newSeqs.put(e.getKey(), seq);
        }
        mission.droneSequences = newSeqs;
        List<String> notStarted = new ArrayList<>();
        for (Task t : mission.tasks)
            if (("traveling".equals(t.status) || "pending".equals(t.status)) && !t.assignedAssetIds.isEmpty()) notStarted.add(t.id);
        rescheduleTasks(mission, notStarted, now);
        for (Asset a : assets) {
            if (!mission.id.equals(a.currentMissionId) || !"deployed".equals(a.status)) continue;
            Task cur = a.currentTaskId == null ? null : mission.task(a.currentTaskId);
            if (cur != null && "executing".equals(cur.status)) continue;
            String first = null;
            for (String tid : newSeqs.getOrDefault(a.id, List.of())) {
                Task t = mission.task(tid);
                if (t != null && !isTerminal(t)) { first = tid; break; }
            }
            if (first == null || first.equals(a.currentTaskId)) continue;
            Task target = mission.task(first);
            Pt pos = interpolate(a, now);
            a.currentTaskId = first;
            a.position = pos;
            fly(a, pos, target.waypoint, now);
        }
    }

    // ── Missions and scoring ─────────────────────────────────────────────────

    private static Mission spawnMission(Blueprint bp) {
        Mission m = new Mission();
        m.id = bp.id;
        m.category = bp.category;
        m.zoneCenter = bp.zoneCenter;
        m.zoneRadius = ZONE_RADIUS;
        m.arrivalTime = bp.arrivalTime;
        for (int i = 0; i < bp.taskTypes.length; i++) {
            Task t = new Task();
            t.id = bp.id + "-T" + (i + 1);
            t.missionId = bp.id;
            t.type = bp.taskTypes[i];
            t.waypoint = bp.waypoints.get(i);
            t.baseTime = TASK_BASE_TIME[t.type];
            m.tasks.add(t);
        }
        return m;
    }

    private static Map<String, Object> buildTaskCompositions(List<Task> tasks) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Task t : tasks) {
            Comp sub = TASK_SUBSTITUTE[t.type];
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("primary", TASK_PRIMARY[t.type]);
            c.put("substitute", sub);
            c.put("baseTime", TASK_BASE_TIME[t.type]);
            c.put("subBaseTime", sub != null ? TASK_SUB_BASE_TIME[t.type] : null);
            out.put(t.id, c);
        }
        return out;
    }

    static long computeCompletionPoints(List<Mission> ms) {
        long pts = 0;
        for (Mission m : ms) for (Task t : m.tasks) if ("completed".equals(t.status)) pts += TASK_WEIGHT[t.type];
        return pts;
    }

    static long computePenaltyAccrued(List<Mission> ms, double now) {
        double penalty = 0;
        for (Mission m : ms) {
            int totalWeight = 0;
            for (Task t : m.tasks) totalWeight += TASK_WEIGHT[t.type];
            if (totalWeight == 0) continue;
            double rate = penaltyRate(m.category);
            for (Task t : m.tasks) {
                double taskRate = rate * TASK_WEIGHT[t.type] / totalWeight;
                double cutoff = "abandoned".equals(m.status) && m.abandonedAt != null ? m.abandonedAt : now;
                double end = "completed".equals(t.status) ? (t.completionTime != null ? t.completionTime : cutoff) : cutoff;
                penalty += taskRate * Math.max(0, end - m.arrivalTime);
            }
        }
        return JsMath.round(penalty);
    }

    private static int maxReward(Mission m) {
        int s = 0;
        for (Task t : m.tasks) s += TASK_WEIGHT[t.type];
        return s;
    }

    private Map<String, Object> missionArrivedPayload(Mission m, String parentId) {
        List<Map<String, Object>> tasks = new ArrayList<>();
        for (Task t : m.tasks) { Map<String, Object> x = new LinkedHashMap<>(); x.put("id", t.id); x.put("type", t.type); tasks.add(x); }
        return ev("mission_arrived", "missionId", m.id, "category", m.category, "tasks", tasks, "zoneCenter", m.zoneCenter,
                "arrivalTime", m.arrivalTime, "timeRemainingInSession", Math.max(0, sessionDuration - m.arrivalTime),
                "taskCompositions", buildTaskCompositions(m.tasks), "penaltyRate", penaltyRate(m.category),
                "maxReward", maxReward(m), "isResidual", parentId != null, "parentMissionId", parentId);
    }

    private Map<String, Object> taskFailedPayload(Mission m, Task t, String reason, double now) {
        return ev("task_failed", "missionId", m.id, "missionCategory", m.category, "taskId", t.id, "taskType", t.type,
                "reason", reason, "statusBefore", t.status, "assignedAssetIds", new ArrayList<>(t.assignedAssetIds),
                "startTime", t.startTime, "rewardForgone", TASK_WEIGHT[t.type],
                "waitFromMissionArrival", Math.max(0, now - m.arrivalTime),
                "missionWasAllocated", m.allocationTime != null, "missionStatusBefore", m.status);
    }

    private void recomputeScore() {
        long completion = computeCompletionPoints(missions);
        long penalty = computePenaltyAccrued(missions, elapsed);
        score = Math.max(0, completion - penalty);
        penaltyAccrued = penalty;
    }

    private Map<String, Object> recoveryOpenedPayload(Mission m, String reason, String failedDroneId, List<Task> affected) {
        Asset failed = asset(failedDroneId);
        List<String> pool = new ArrayList<>();
        for (Asset a : assets) {
            if (!m.id.equals(a.currentMissionId) || !"deployed".equals(a.status)) continue;
            Task cur = a.currentTaskId == null ? null : m.task(a.currentTaskId);
            if (cur == null || !"executing".equals(cur.status)) pool.add(a.id);
        }
        Map<String, Asset> byId = assetMap();
        boolean feasible = true;
        for (Task t : affected) if (!taskMeetsComposition(t, pool, byId)) feasible = false;
        List<String> ids = new ArrayList<>();
        List<Integer> types = new ArrayList<>();
        for (Task t : affected) { ids.add(t.id); types.add(t.type); }
        int remaining = 0;
        for (Task t : m.tasks) if (!isTerminal(t)) remaining++;
        return ev("recovery_opened", "missionId", m.id, "missionCategory", m.category, "recoveryReason", reason,
                "failedDroneId", failedDroneId, "failedDroneType", failed == null ? null : failed.type,
                "affectedTaskIds", ids, "affectedTaskTypes", types, "onMissionDroneIds", pool,
                "reserveAvailable", reserveCount(true), "feasibleWithOnMissionDrones", feasible,
                "tasksRemaining", remaining, "timeRemainingInSession", timeRemaining());
    }

    private Map<String, Object> buildStateSnapshot() {
        List<Map<String, Object>> ms = new ArrayList<>();
        for (Mission m : missions) {
            List<Map<String, Object>> ts = new ArrayList<>();
            for (Task t : m.tasks) {
                Map<String, Object> x = new LinkedHashMap<>();
                x.put("id", t.id); x.put("type", t.type); x.put("status", t.status);
                x.put("assignedAssetIds", new ArrayList<>(t.assignedAssetIds)); x.put("startTime", t.startTime);
                x.put("completionTime", t.completionTime); x.put("useSubstitute", t.useSubstitute);
                ts.add(x);
            }
            Map<String, Object> x = new LinkedHashMap<>();
            x.put("id", m.id); x.put("category", m.category); x.put("status", m.status); x.put("arrivalTime", m.arrivalTime);
            x.put("allocationTime", m.allocationTime); x.put("completionTime", m.completionTime);
            x.put("chosenStrategyName", m.chosenStrategyName); x.put("agentInteraction", m.agentInteraction);
            x.put("tacticalPending", m.tacticalPending); x.put("failureRecoveryPending", m.failureRecoveryPending);
            x.put("recoveryReason", m.recoveryReason);
            x.put("penaltyAccruedSoFar", computePenaltyAccrued(List.of(m), elapsed));
            x.put("tasks", ts);
            x.put("droneSequences", m.droneSequences);
            ms.add(x);
        }
        List<Map<String, Object>> as = new ArrayList<>();
        for (Asset a : assets) {
            Pt p = interpolate(a, elapsed);
            Map<String, Object> x = new LinkedHashMap<>();
            x.put("id", a.id); x.put("type", a.type); x.put("status", a.status);
            x.put("currentMissionId", a.currentMissionId); x.put("currentTaskId", a.currentTaskId);
            x.put("x", JsMath.round(p.x)); x.put("y", JsMath.round(p.y));
            as.add(x);
        }
        return ev("state_snapshot", "missions", ms, "assets", as);
    }

    private List<RecoveryOption> buildRecoveryOptions(Mission m, Task failedTask, String failedDroneId) {
        Map<String, Asset> byId = assetMap();
        Asset other = null;
        for (Asset a : assets) {
            if (!m.id.equals(a.currentMissionId) || a.id.equals(failedDroneId) || !"deployed".equals(a.status)) continue;
            Task cur = a.currentTaskId == null ? null : m.task(a.currentTaskId);
            if (cur != null && "executing".equals(cur.status)) continue;
            List<String> ids = new ArrayList<>();
            for (String id : failedTask.assignedAssetIds) if (!id.equals(a.id) && !id.equals(failedDroneId)) ids.add(id);
            ids.add(a.id);
            if (taskMeetsComposition(failedTask, ids, byId)) { other = a; break; }
        }
        RecoveryOption o = new RecoveryOption();
        o.type = "redistribute";
        o.label = "Redistribute";
        o.description = other != null ? "Reassign task to " + other.id + " (currently between tasks)" : "No available drone within mission to reassign";
        o.taskId = failedTask.id;
        o.redistributeToAssetId = other == null ? null : other.id;
        o.expectedTimeImpact = other != null ? 60 : 0;
        o.feasible = other != null;
        return new ArrayList<>(List.of(o));
    }

    // ── Drone failure (shared by the testing/tutorial forced failures) ───────

    private void applyForcedDroneFailure(Mission mission, Asset failedDrone, List<String> alsoRevert) {
        Set<String> wanted = new LinkedHashSet<>(alsoRevert);
        if (failedDrone.currentTaskId != null) wanted.add(failedDrone.currentTaskId);
        for (Task t : mission.tasks)
            if (!"executing".equals(t.status) && t.assignedAssetIds.contains(failedDrone.id)) wanted.add(t.id);
        List<Task> revert = new ArrayList<>();
        for (Task t : mission.tasks) if (wanted.contains(t.id) && !isTerminal(t)) revert.add(t);
        Task failedTask = null;
        for (Task t : revert) if (t.id.equals(failedDrone.currentTaskId)) failedTask = t;
        if (failedTask == null && !revert.isEmpty()) failedTask = revert.get(0);
        if (failedTask == null) return;
        Set<String> revertIds = new LinkedHashSet<>();
        Set<String> release = new LinkedHashSet<>();
        for (Task t : revert) { revertIds.add(t.id); for (String id : t.assignedAssetIds) if (!id.equals(failedDrone.id)) release.add(id); }
        double now = elapsed;
        String failedType = failedDrone.type, failedId = failedDrone.id;
        failedDrone.status = "failed"; failedDrone.failedAt = now; failedDrone.currentMissionId = null; failedDrone.currentTaskId = null;
        for (Asset a : assets) {
            if (!release.contains(a.id)) continue;
            Pt slot = loiterSlot(mission, a.id);
            double tt = params.travelTime(a.position, slot, a.type);
            a.currentTaskId = null; a.travelFrom = a.position.copy(); a.targetPosition = slot;
            a.travelStartElapsed = now; a.travelEndElapsed = now + tt; a.availableAt = now + tt;
        }
        // Recovery options are built from the mission before its tasks revert (as the original does)
        Mission before = mission.copy();
        mission.droneFailuresFired++;
        mission.failedDroneId = failedId;
        mission.failureRecoveryPending = true;
        mission.recoveryReason = "drone_failure";
        mission.recoveryOpenedAtMs = JsMath.round(now * 1000);
        mission.failureExemptUntil = now + graceSeconds();
        for (Task t : mission.tasks) if (revertIds.contains(t.id)) { t.status = "pending"; t.assignedAssetIds = new ArrayList<>(); t.startTime = null; t.completionTime = null; }
        mission.pendingRecoveryOptions = buildRecoveryOptions(before, before.task(failedTask.id), failedId);
        logEvent(ev("drone_failure", "missionId", mission.id, "missionCategory", mission.category, "droneId", failedId,
                "droneType", failedType, "taskId", failedTask.id, "taskType", failedTask.type, "timeRemainingInSession", timeRemaining()));
        List<Task> affected = new ArrayList<>();
        for (Task t : mission.tasks) if (revertIds.contains(t.id)) affected.add(t);
        logEvent(recoveryOpenedPayload(mission, "drone_failure", failedId, affected));
    }

    // ── Tactical commit ──────────────────────────────────────────────────────

    private void applyTacticalAllocation(Mission mission, List<TaskAssignment> asgns, PendingAllocation pending,
                                         List<String> taskOrder, boolean modified, Map<String, List<String>> droneSequences,
                                         boolean chainingUsed, List<String> changedTaskIds, boolean loiterAll) {
        double now = elapsed;
        Set<String> allAssigned = new LinkedHashSet<>();
        for (TaskAssignment a : asgns) allAssigned.addAll(a.assetIds);
        Map<String, TaskAssignment> byTask = new LinkedHashMap<>();
        for (TaskAssignment a : asgns) if (!byTask.containsKey(a.taskId)) byTask.put(a.taskId, a);
        Mission original = mission.copy();
        for (Task t : mission.tasks) {
            TaskAssignment a = byTask.get(t.id);
            if (a == null) continue;
            t.status = "traveling";
            t.assignedAssetIds = new ArrayList<>(new LinkedHashSet<>(a.assetIds));
            t.allocatedAt = now; t.travelTime = a.travelTime; t.baseTime = a.baseTime; t.useSubstitute = a.useSubstitute;
            t.startTime = a.startTime; t.completionTime = a.startTime + a.baseTime; t.recallDelay = 0;
        }
        // Tasks are reordered into the plan's order, then any not in it
        List<Task> ordered = new ArrayList<>();
        for (String id : taskOrder) { Task t = mission.task(id); if (t != null) ordered.add(t); }
        for (Task t : mission.tasks) if (!taskOrder.contains(t.id)) ordered.add(t);
        mission.tasks = ordered;
        mission.status = "active";
        mission.allocationTime = now;
        mission.tacticalPending = false;
        mission.pendingAllocation = null;
        mission.droneSequences = new LinkedHashMap<>(droneSequences);
        mission.agentInteraction = modified ? "overridden" : pending.isAgentSuggested ? "followed" : "manual";
        mission.chosenStrategyName = pending.strategyName;
        mission.manualPriorityIds = new ArrayList<>();

        Set<String> poolSet = new LinkedHashSet<>(pending.dronePool);
        for (Asset a : assets) {
            List<TaskAssignment> mine = new ArrayList<>();
            for (TaskAssignment x : asgns) if (x.assetIds.contains(a.id)) mine.add(x);
            if (mine.isEmpty()) {
                if (loiterAll && poolSet.contains(a.id) && "available".equals(a.status)) {
                    Pt slot = loiterSlot(mission, a.id);
                    double tt = params.travelTime(HUB, slot, a.type);
                    a.status = "deployed"; a.currentMissionId = mission.id; a.currentTaskId = null;
                    a.travelFrom = HUB.copy(); a.targetPosition = slot; a.travelStartElapsed = now;
                    a.travelEndElapsed = now + tt; a.availableAt = now + tt;
                }
                continue;
            }
            boolean loiteringHere = "deployed".equals(a.status) && mission.id.equals(a.currentMissionId) && a.currentTaskId == null;
            if (!"available".equals(a.status) && !loiteringHere) continue;
            Pt origin = loiteringHere ? interpolate(a, now) : HUB.copy();
            TaskAssignment first = pickFirstAssignment(mine, droneSequences.get(a.id));
            Task task = mission.task(first.taskId);
            double tt = params.travelTime(origin, task.waypoint, a.type);
            a.status = "deployed"; a.currentMissionId = mission.id; a.currentTaskId = task.id;
            a.position = origin; a.travelFrom = origin.copy(); a.targetPosition = task.waypoint.copy();
            a.travelStartElapsed = now; a.travelEndElapsed = now + tt;
            a.availableAt = now + tt + first.baseTime + params.travelTime(task.waypoint, HUB, a.type);
        }

        List<Map<String, Object>> agentPlan = new ArrayList<>();
        int order = 0;
        for (String tid : pending.taskOrder) {
            List<String> ids = pending.taskAssignments.getOrDefault(tid, List.of());
            if (ids.isEmpty()) continue;
            agentPlan.add(planEntry(tid, original.task(tid).type, ids, order++));
        }
        List<Map<String, Object>> finalPlan = new ArrayList<>();
        for (int i = 0; i < taskOrder.size(); i++) {
            TaskAssignment a = null;
            for (TaskAssignment x : asgns) if (x.taskId.equals(taskOrder.get(i))) { a = x; break; }
            if (a == null) continue;
            finalPlan.add(planEntry(a.taskId, original.task(a.taskId).type, a.assetIds, i));
        }
        Map<String, Integer> useCount = new LinkedHashMap<>();
        for (TaskAssignment a : asgns) for (String id : a.assetIds) useCount.merge(id, 1, Integer::sum);
        double finalProjected = 0;
        if (!asgns.isEmpty()) {
            finalProjected = Double.NEGATIVE_INFINITY;
            for (TaskAssignment a : asgns) finalProjected = Math.max(finalProjected, a.startTime + a.baseTime);
        }
        List<Map<String, Object>> planned = new ArrayList<>();
        List<String> subIds = new ArrayList<>();
        for (TaskAssignment a : asgns) {
            Map<String, Object> x = new LinkedHashMap<>();
            x.put("taskId", a.taskId); x.put("taskType", original.task(a.taskId).type); x.put("assetIds", a.assetIds);
            x.put("startTime", a.startTime); x.put("baseTime", a.baseTime); x.put("useSubstitute", a.useSubstitute);
            planned.add(x);
            if (a.useSubstitute) subIds.add(a.taskId);
        }
        List<String> unassigned = new ArrayList<>();
        for (Task t : original.tasks) if (!isTerminal(t) && !byTask.containsKey(t.id)) unassigned.add(t.id);
        List<String> chained = new ArrayList<>();
        for (Map.Entry<String, Integer> e : useCount.entrySet()) if (e.getValue() > 1) chained.add(e.getKey());
        logEvent(ev("tactical_confirmed", "missionId", mission.id, "missionCategory", mission.category,
                "wasAgentSuggested", pending.isAgentSuggested, "modifiedFromAgentPlan", modified,
                "changedTaskIds", changedTaskIds, "chainingUsed", chainingUsed, "assetsDeployed", new ArrayList<>(allAssigned),
                "timeRemainingInSession", Math.max(0, sessionDuration - now),
                "latencyMs", original.tacticalOpenedAtMs != null ? JsMath.round(now * 1000) - original.tacticalOpenedAtMs : 0,
                "suggestUsedCount", original.tacticalSuggestCount == null ? 0 : original.tacticalSuggestCount,
                "agentPlan", agentPlan, "finalPlan", finalPlan, "agentProjectedCompletion", pending.expectedCompletionTime,
                "finalProjectedCompletion", finalProjected, "plannedTasks", planned, "unassignedTaskIds", unassigned,
                "substituteTaskIds", subIds, "chainedDroneIds", chained, "tacticalFailureFired", pending.hasTacticalError));
    }

    private static Map<String, Object> planEntry(String taskId, int type, List<String> ids, int order) {
        Map<String, Object> x = new LinkedHashMap<>();
        x.put("taskId", taskId); x.put("taskType", type); x.put("assetIds", ids); x.put("order", order);
        return x;
    }

    // ── Greedy one-step replanning ───────────────────────────────────────────

    private static List<String> pickDronesForTask(Task task, List<Asset> free, Comp req) {
        List<String> ids = new ArrayList<>();
        for (String col : Model.TYPES) {
            List<String> c = new ArrayList<>();
            for (Asset a : free) if (a.type.equals(col) && !ids.contains(a.id) && c.size() < req.get(col)) c.add(a.id);
            if (c.size() < req.get(col)) return null;
            ids.addAll(c);
        }
        return ids;
    }

    private void applyGreedyReplan(double now) {
        for (Mission mission : new ArrayList<>(missions)) {
            if (!"active".equals(mission.status)) continue;
            if (mission.failureRecoveryPending && "lockout".equals(mission.recoveryReason)) continue;
            List<Asset> free = new ArrayList<>();
            for (Asset a : assets) if (mission.id.equals(a.currentMissionId) && "deployed".equals(a.status) && a.currentTaskId == null) free.add(a);
            if (free.isEmpty()) continue;
            List<Task> pend = new ArrayList<>();
            for (Task t : mission.tasks)
                if ("pending".equals(t.status) && t.assignedAssetIds.isEmpty() && !t.id.equals(mission.tacticallySuppressedTaskId)) pend.add(t);
            pend = sortTypeDesc(pend);
            if (pend.isEmpty()) continue;
            Set<String> used = new LinkedHashSet<>();
            for (Task task : pend) {
                List<Asset> avail = new ArrayList<>();
                for (Asset a : free) if (!used.contains(a.id)) avail.add(a);
                List<String> ids = pickDronesForTask(task, avail, TASK_PRIMARY[task.type]);
                boolean sub = false;
                double base = TASK_BASE_TIME[task.type];
                if (ids == null && TASK_SUBSTITUTE[task.type] != null) {
                    ids = pickDronesForTask(task, avail, TASK_SUBSTITUTE[task.type]);
                    sub = true; base = TASK_SUB_BASE_TIME[task.type];
                }
                if (ids == null) continue;
                double longest = Double.NEGATIVE_INFINITY;
                for (String id : ids) { Asset a = asset(id); longest = Math.max(longest, params.travelTime(a.position, task.waypoint, a.type)); }
                double start = now + longest;
                used.addAll(ids);
                task.status = "traveling"; task.assignedAssetIds = new ArrayList<>(ids); task.allocatedAt = now;
                task.useSubstitute = sub; task.baseTime = base; task.travelTime = Math.max(0, start - now);
                task.startTime = start; task.completionTime = start + base; task.recallDelay = 0;
                for (String id : ids) {
                    mission.droneSequences.put(id, new ArrayList<>(List.of(task.id)));
                    Asset a = asset(id);
                    a.currentTaskId = task.id;
                    fly(a, a.position, task.waypoint, now);
                }
            }
        }
    }

    // ── TICK ─────────────────────────────────────────────────────────────────

    /** Advances the session clock by dt simulated seconds (called by the simulator's main loop). */
    public synchronized void step(double dt) {
        if (!"playing".equals(phase)) return;
        rawMicros += Math.round(dt * 1e6);
        rawElapsed = rawMicros / 1e6;
        tick(config.testingMode ? rawElapsed : Math.min(sessionDuration, rawElapsed));
        version++;
        checkpointIfBoundary("playing");
    }

    private void tick(double now) {
        elapsed = now;
        if (!sessionClockStarted) {
            sessionClockStarted = true;
            logSessionStart();
        }

        // 1. Spawn missions whose arrival time has passed
        List<Blueprint> toSpawn = new ArrayList<>();
        if (!config.testingMode) for (Blueprint bp : pendingBlueprints) if (bp.arrivalTime <= now) toSpawn.add(bp);
        if (!toSpawn.isEmpty()) {
            pendingBlueprints.removeAll(toSpawn);
            for (Blueprint bp : toSpawn) {
                Mission m = spawnMission(bp);
                missions.add(m);
                logEvent(missionArrivedPayload(m, null));
            }
        }

        // 1b. Ambient drone failure hazard on a fixed simulated-second grid
        if (!config.testingMode && FAILURE_RATE_PER_DRONE_SECOND > 0 && now >= nextFailureRollAt) failureRolls(now);

        // 2. Advance task status
        Map<String, Asset> snap = assetMap();
        List<Mission> updated = new ArrayList<>();
        for (Mission mission : missions) {
            if (!"active".equals(mission.status)) { updated.add(mission); continue; }
            Mission copy = mission.copy();
            boolean changed = false;
            for (Task task : copy.tasks) {
                if ("traveling".equals(task.status) && task.startTime != null && now >= task.startTime) {
                    task.status = "executing"; changed = true; continue;
                }
                if ("executing".equals(task.status)) {
                    if (task.startTime != null && task.baseTime > 0) {
                        double prog = Math.min(1, (now - task.startTime) / task.baseTime);
                        Map<String, Double> sections = TASK_SECTION_DEADLINES.getOrDefault(task.type, Map.of());
                        Comp comp = task.useSubstitute && TASK_SUBSTITUTE[task.type] != null ? TASK_SUBSTITUTE[task.type] : TASK_PRIMARY[task.type];
                        Set<String> done = new LinkedHashSet<>(task.completedSectionTypes == null ? List.of() : task.completedSectionTypes);
                        boolean sectionFail = false;
                        for (Map.Entry<String, Double> e : sections.entrySet()) {
                            if (done.contains(e.getKey())) continue;
                            if (e.getValue() < 1.0 && prog >= e.getValue()) continue;
                            int required = comp.get(e.getKey());
                            if (required == 0) continue;
                            int present = 0;
                            for (String id : task.assignedAssetIds) {
                                Asset a = snap.get(id);
                                if (a != null && !"failed".equals(a.status) && task.id.equals(a.currentTaskId) && a.type.equals(e.getKey())) present++;
                            }
                            if (present < required) { sectionFail = true; break; }
                        }
                        if (sectionFail) { task.status = "failed"; changed = true; continue; }
                    }
                    if (task.completionTime != null && now >= task.completionTime) { task.status = "completed"; changed = true; }
                }
            }
            if (!changed) { updated.add(mission); continue; }
            boolean allDone = true;
            for (Task t : copy.tasks) if (!isTerminal(t)) allDone = false;
            copy.status = allDone ? "completed" : "active";
            if (allDone) copy.completionTime = now;
            updated.add(copy);
        }

        // 3. Task completion and failure events (logged against the state before this step, as the original)
        for (int mi = 0; mi < missions.size(); mi++) {
            Mission oldM = missions.get(mi), newM = updated.get(mi);
            if (oldM == newM) continue;
            for (int ti = 0; ti < oldM.tasks.size(); ti++) {
                Task oldT = oldM.tasks.get(ti), newT = newM.tasks.get(ti);
                if (!"completed".equals(oldT.status) && "completed".equals(newT.status)) {
                    double ct = newT.completionTime != null ? newT.completionTime : now;
                    logEvent(ev("task_completed", "missionId", newM.id, "missionCategory", newM.category, "taskId", newT.id,
                            "taskType", newT.type, "assetsUsed", newT.assignedAssetIds, "completionTime", ct,
                            "detectedAtElapsed", now, "startTime", newT.startTime, "travelTime", newT.travelTime,
                            "baseTime", newT.baseTime, "useSubstitute", newT.useSubstitute, "rewardEarned", TASK_WEIGHT[newT.type],
                            "waitFromMissionArrival", Math.max(0, ct - newM.arrivalTime)));
                }
                if (!"failed".equals(oldT.status) && "failed".equals(newT.status))
                    logEvent(taskFailedPayload(newM, oldT, "drone_failure", now));
            }
        }
        // 3a. Mission completion events
        for (int mi = 0; mi < updated.size(); mi++) {
            Mission oldM = missions.get(mi), newM = updated.get(mi);
            if ("completed".equals(oldM.status) || !"completed".equals(newM.status)) continue;
            int nDone = 0, nFailed = 0, reward = 0;
            for (Task t : newM.tasks) {
                if ("completed".equals(t.status)) { nDone++; reward += TASK_WEIGHT[t.type]; }
                if ("failed".equals(t.status)) nFailed++;
            }
            logEvent(ev("mission_completed", "missionId", newM.id, "missionCategory", newM.category, "completionTime", now,
                    "outcome", nDone == 0 ? "none_completed" : nDone == newM.tasks.size() ? "all_completed" : "partial",
                    "tasksCompleted", nDone, "tasksFailed", nFailed, "rewardEarned", reward,
                    "penaltyAccrued", computePenaltyAccrued(List.of(newM), now), "arrivalTime", newM.arrivalTime,
                    "allocationTime", newM.allocationTime,
                    "timeToAllocate", newM.allocationTime != null ? newM.allocationTime - newM.arrivalTime : null,
                    "durationFromAllocation", newM.allocationTime != null ? now - newM.allocationTime : null,
                    "maxReward", maxReward(newM), "chosenStrategyName", newM.chosenStrategyName,
                    "agentInteraction", newM.agentInteraction, "hadTacticalError", newM.tacticallySuppressedTaskId != null,
                    "suppressedTaskId", newM.tacticallySuppressedTaskId, "droneFailureCount", newM.droneFailuresFired));
        }
        missions = updated;

        // 3c. Live scheduling-deadlock detection
        detectDeadlocks(now);

        // 4. Asset availability and positions
        moveAssets(now);

        // 4b. Greedy one-step replanning
        if (isGreedy()) applyGreedyReplan(now);

        // 5. Score
        recomputeScore();

        // 5b. Periodic full-state dump
        if (now >= nextSnapshotAt) {
            logEvent(buildStateSnapshot());
            long missed = (long) Math.floor((now - nextSnapshotAt) / STATE_SNAPSHOT_INTERVAL) + 1;
            nextSnapshotAt += missed * STATE_SNAPSHOT_INTERVAL;
        }

        // 6. Trust probe
        if (!trustProbeActive && now >= nextTrustProbeAt) trustProbeActive = true;

        // 7. Forecast
        if (!toSpawn.isEmpty()) categoryForecast = computeForecast();

        // 8. Session end
        if (!config.testingMode && now >= sessionDuration) endSession("timer");
    }

    private void logSessionStart() {
        String cx = complexityForSession(sessionNumber);
        Map<String, Object> cw = new LinkedHashMap<>();
        double[] w = categoryWeights(cx);
        for (int i = 0; i < 5; i++) cw.put(CATEGORIES[i], w[i]);
        Map<String, Object> base = new LinkedHashMap<>(), sub = new LinkedHashMap<>(), prim = new LinkedHashMap<>(),
                subc = new LinkedHashMap<>(), weight = new LinkedHashMap<>(), pen = new LinkedHashMap<>();
        for (int t = 1; t <= 5; t++) {
            String k = String.valueOf(t);
            base.put(k, TASK_BASE_TIME[t]); sub.put(k, TASK_SUB_BASE_TIME[t]); prim.put(k, TASK_PRIMARY[t]);
            subc.put(k, TASK_SUBSTITUTE[t]); weight.put(k, TASK_WEIGHT[t]);
        }
        for (String c : CATEGORIES) pen.put(c, penaltyRate(c));
        logEvent(ev("session_start", "participantId", config.participantId, "condition", config.condition, "mode", config.mode,
                "complexity", cx, "seed", config.seed, "epsilonStrategic", epsS(), "epsilonTactical", epsT(),
                "agentFailuresEnabled", failuresEnabled(), "strategicFailureOverDelta", STRATEGIC_OVER_DELTA,
                "tacticalFailureMinHops", TACTICAL_FAILURE_MIN_HOPS, "tacticalFailureMaxHops", TACTICAL_FAILURE_MAX_HOPS,
                "failureBalanceBatchSize", FAILURE_BALANCE_BATCH_SIZE, "tacticalMode", config.tacticalMode,
                "fixLockouts", isFixLockouts(), "numSessions", config.numSessions, "sessionDuration", sessionDuration,
                "fleet", params.fleet(cx, config.tutorialMode), "assetSpeeds", params.speeds(), "taskBaseTime", base,
                "taskSubBaseTime", sub, "taskPrimary", prim, "taskSubstitute", subc, "taskWeight", weight,
                "categoryPenaltyRate", pen, "categoryWeights", cw, "arrivalLambda", lambda(cx),
                "failureRatePerDroneSecond", FAILURE_RATE_PER_DRONE_SECOND, "failureRollIntervalSec", FAILURE_ROLL_INTERVAL,
                "failureGraceSeconds", graceSeconds(), "swapGames", Boolean.TRUE.equals(config.swapGames),
                "planSeedIndex", planSeedIndex(sessionNumber), "conservativeTopUp", CONSERVATIVE_TOP_UP,
                "conservativeRedundancyBuffer", CONSERVATIVE_REDUNDANCY_BUFFER, "snapshotIntervalSec", STATE_SNAPSHOT_INTERVAL,
                "trustProbeIntervalSec", TRUST_PROBE_INTERVAL, "appVersion", APP_VERSION, "userAgent", clientUserAgent,
                "viewport", clientViewport));
    }

    private void failureRolls(double now) {
        Map<String, Mission> byId = new HashMap<>();
        for (Mission m : missions) byId.put(m.id, m);
        List<Asset> eligible = new ArrayList<>();
        for (Asset a : assets) {
            if (!"deployed".equals(a.status) || a.currentMissionId == null) continue;
            Mission m = byId.get(a.currentMissionId);
            if (m == null || !"active".equals(m.status) || m.failureRecoveryPending) continue;
            if (m.failureExemptUntil == null || now >= m.failureExemptUntil) eligible.add(a);
        }
        double pFail = FAILURE_RATE_PER_DRONE_SECOND * FAILURE_ROLL_INTERVAL;
        List<Long> due = new ArrayList<>();
        for (double at = nextFailureRollAt; at <= now; at += FAILURE_ROLL_INTERVAL) due.add(JsMath.round(at / FAILURE_ROLL_INTERVAL));
        nextFailureRollAt += due.size() * FAILURE_ROLL_INTERVAL;
        Asset failed = null;
        for (long roll : due) {
            for (Asset a : eligible) {
                Rng r = new Rng(Rng.u32(config.seed ^ Rng.hashId(a.id) ^ Rng.imul(roll, 0x9E3779B1L) ^ 0xF411));
                r.next(); r.next();
                if (r.next() < pFail) { failed = a; break; }
            }
            if (failed != null) break;
        }
        if (failed == null) return;

        Mission mission = byId.get(failed.currentMissionId);
        Task failedTask = failed.currentTaskId == null ? null : mission.task(failed.currentTaskId);
        Rng rr = new Rng(Rng.u32(config.seed ^ Rng.hashId(failed.id) ^ 0x4E3B ^ mission.droneFailuresFired));
        double replacementDelay = 30 + rr.randFloat(0, 15);
        String fid = failed.id, ftype = failed.type;

        if (failedTask == null) {
            failed.status = "failed"; failed.failedAt = now; failed.currentMissionId = null; failed.currentTaskId = null;
            failed.replacementAt = now + replacementDelay;
            mission.droneFailuresFired++;
            mission.failedDroneId = fid;
            logEvent(ev("drone_failure", "missionId", mission.id, "missionCategory", mission.category, "droneId", fid,
                    "droneType", ftype, "taskId", null, "taskType", null, "timeRemainingInSession", timeRemaining()));
            return;
        }
        double deadline = TASK_SECTION_DEADLINES.getOrDefault(failedTask.type, Map.of()).getOrDefault(ftype, 1.0);
        boolean graceful = deadline < 1.0 && failedTask.startTime != null && now >= failedTask.startTime + failedTask.baseTime * deadline;
        Set<String> release = new LinkedHashSet<>();
        if (!graceful) for (String id : failedTask.assignedAssetIds) if (!id.equals(fid)) release.add(id);
        Mission before = mission.copy();
        failed.status = "failed"; failed.failedAt = now; failed.currentMissionId = null; failed.currentTaskId = null;
        failed.replacementAt = now + replacementDelay;
        for (Asset a : assets) {
            if (!release.contains(a.id)) continue;
            Pt pos = interpolate(a, now);
            Pt slot = loiterSlot(mission, a.id);
            double tt = params.travelTime(pos, slot, a.type);
            a.position = pos; a.currentTaskId = null; a.travelFrom = pos.copy(); a.targetPosition = slot;
            a.travelStartElapsed = now; a.travelEndElapsed = now + tt; a.availableAt = now + tt;
        }
        mission.droneFailuresFired++;
        mission.failedDroneId = fid;
        if (graceful) {
            failedTask.assignedAssetIds.remove(fid);
            Set<String> done = new LinkedHashSet<>(failedTask.completedSectionTypes == null ? List.of() : failedTask.completedSectionTypes);
            done.add(ftype);
            failedTask.completedSectionTypes = new ArrayList<>(done);
        } else {
            mission.failureRecoveryPending = true;
            mission.failureExemptUntil = now + graceSeconds();
            failedTask.status = "pending"; failedTask.assignedAssetIds = new ArrayList<>(); failedTask.startTime = null; failedTask.completionTime = null;
            mission.pendingRecoveryOptions = buildRecoveryOptions(before, before.task(failedTask.id), fid);
        }
        logEvent(ev("drone_failure", "missionId", mission.id, "missionCategory", mission.category, "droneId", fid,
                "droneType", ftype, "taskId", failedTask.id, "taskType", failedTask.type, "timeRemainingInSession", timeRemaining()));
        if (!graceful) {
            logEvent(recoveryOpenedPayload(mission, "drone_failure", fid, List.of(failedTask)));
            mission.recoveryReason = "drone_failure";
            mission.recoveryOpenedAtMs = JsMath.round(now * 1000);
        }
    }

    private void detectDeadlocks(double now) {
        boolean fix = isFixLockouts();
        for (Mission mission : new ArrayList<>(missions)) {
            if (!"active".equals(mission.status) || mission.failureRecoveryPending) continue;
            Map<String, List<String>> ta = new LinkedHashMap<>();
            for (Task t : mission.tasks) if (!isTerminal(t) && !t.assignedAssetIds.isEmpty()) ta.put(t.id, t.assignedAssetIds);
            Map<String, List<String>> seqs = new LinkedHashMap<>();
            for (Map.Entry<String, List<String>> e : mission.droneSequences.entrySet()) {
                List<String> f = new ArrayList<>();
                for (String tid : e.getValue()) if (ta.containsKey(tid)) f.add(tid);
                if (!f.isEmpty()) seqs.put(e.getKey(), f);
            }
            List<String> cyc = Tactical.findSchedulingCycle(ta, seqs);
            if (cyc == null) continue;
            List<String> cycleDrones = new ArrayList<>(new LinkedHashSet<>(cyc.stream().flatMap(t -> ta.getOrDefault(t, List.of()).stream()).toList()));
            boolean stuck = !cycleDrones.isEmpty();
            for (String id : cycleDrones) {
                Asset a = asset(id);
                if (a == null || !"deployed".equals(a.status) || now < a.travelEndElapsed) { stuck = false; break; }
                Task t = a.currentTaskId == null ? null : mission.task(a.currentTaskId);
                if (t != null && "executing".equals(t.status)) { stuck = false; break; }
            }
            if (!stuck) continue;
            if (fix) {
                rerouteDeadlock(mission, cyc, now);
                logEvent(ev("lockout_detected", "missionId", mission.id, "missionCategory", mission.category,
                        "taskIds", cyc, "droneIds", cycleDrones, "resolution", "rerouted"));
            } else {
                Set<String> cycleSet = new LinkedHashSet<>(cycleDrones);
                Set<String> affected = new LinkedHashSet<>(cyc);
                for (Task t : mission.tasks) {
                    if (isTerminal(t) || "executing".equals(t.status)) continue;
                    for (String id : t.assignedAssetIds) if (cycleSet.contains(id)) { affected.add(t.id); break; }
                }
                Set<String> freed = new LinkedHashSet<>();
                for (Task t : mission.tasks) if (affected.contains(t.id)) freed.addAll(t.assignedAssetIds);
                for (Asset a : assets) {
                    if (!freed.contains(a.id) || !"deployed".equals(a.status)) continue;
                    Task cur = a.currentTaskId == null ? null : mission.task(a.currentTaskId);
                    if (cur != null && "executing".equals(cur.status) && !affected.contains(cur.id)) continue;
                    park(a, now);
                }
                mission.failureRecoveryPending = true;
                mission.recoveryReason = "lockout";
                mission.failedDroneId = null;
                mission.pendingRecoveryOptions = new ArrayList<>();
                for (Task t : mission.tasks)
                    if (affected.contains(t.id)) { t.status = "pending"; t.startTime = null; t.completionTime = null; t.allocatedAt = null; }
                logEvent(ev("lockout_detected", "missionId", mission.id, "missionCategory", mission.category,
                        "taskIds", cyc, "droneIds", cycleDrones, "resolution", "help_needed"));
                List<Task> aff = new ArrayList<>();
                for (Task t : mission.tasks) if (affected.contains(t.id)) aff.add(t);
                logEvent(recoveryOpenedPayload(mission, "lockout", null, aff));
                mission.recoveryOpenedAtMs = JsMath.round(now * 1000);
            }
        }
    }

    private void moveAssets(double now) {
        for (Asset a : assets) {
            if ("failed".equals(a.status) && a.replacementAt != null && now >= a.replacementAt) {
                a.status = "available"; a.failedAt = null; a.replacementAt = null; a.currentMissionId = null; a.currentTaskId = null;
                a.position = HUB.copy(); a.travelFrom = HUB.copy(); a.targetPosition = HUB.copy(); a.availableAt = now;
                continue;
            }
            if ("failed".equals(a.status)) continue;
            Pt newPos = interpolate(a, now);
            String newStatus = a.status;
            if ("returning".equals(a.status) && now >= a.availableAt) newStatus = "available";

            if ("deployed".equals(a.status) && a.currentTaskId != null) {
                Mission cm = mission(a.currentMissionId);
                Task task = cm == null ? null : cm.task(a.currentTaskId);
                boolean recallReady = task != null && ("failed".equals(task.status) ||
                        ("completed".equals(task.status) && now >= (task.completionTime != null ? task.completionTime : 0) + task.recallDelay));
                if (recallReady) {
                    List<String> seq = cm.droneSequences.getOrDefault(a.id, List.of());
                    int idx = seq.indexOf(a.currentTaskId);
                    String nextId = null;
                    if (idx >= 0) for (String tid : seq.subList(idx + 1, seq.size())) {
                        Task t = cm.task(tid);
                        if (t != null && !isTerminal(t)) { nextId = tid; break; }
                    }
                    Task next = null;
                    if (nextId != null) next = cm.task(nextId);
                    else if (seq.isEmpty() || cm.needsGreedyReplan) {
                        for (Task t : cm.tasks)
                            if (!t.id.equals(a.currentTaskId) && t.assignedAssetIds.contains(a.id) && !isTerminal(t)) { next = t; break; }
                    }
                    if (next != null) {
                        a.currentTaskId = next.id;
                        fly(a, task.waypoint, next.waypoint, now);
                        a.position = newPos;
                        continue;
                    }
                    if (isGreedy() && "active".equals(cm.status)) {
                        a.currentTaskId = null;
                        fly(a, newPos, loiterSlot(cm, a.id), now);
                        a.position = newPos;
                        continue;
                    }
                    double rt = params.travelTime(task.waypoint, HUB, a.type);
                    a.status = "returning"; a.currentMissionId = null; a.currentTaskId = null;
                    fly(a, task.waypoint, HUB, now);
                    a.availableAt = now + rt;
                    a.position = newPos;
                    continue;
                }
            }
            if ("deployed".equals(a.status) && a.currentTaskId == null && a.currentMissionId != null) {
                Mission lm = mission(a.currentMissionId);
                boolean still = lm != null && ("active".equals(lm.status) || lm.tacticalPending);
                if (!still) {
                    double rt = params.travelTime(a.position, HUB, a.type);
                    a.status = "returning"; a.currentMissionId = null; a.currentTaskId = null;
                    fly(a, a.position, HUB, now);
                    a.availableAt = now + rt;
                    a.position = newPos;
                    continue;
                }
                a.position = newPos;
                continue;
            }
            a.status = newStatus;
            a.position = newPos;
        }
    }

    private Map<String, Double> computeForecast() {
        Map<String, Double> out = new LinkedHashMap<>();
        if (pendingBlueprints.isEmpty()) { for (String c : CATEGORIES) out.put(c, 0.2); return out; }
        List<Blueprint> window = pendingBlueprints.subList(0, Math.min(5, pendingBlueprints.size()));
        for (String c : CATEGORIES) {
            int n = 0;
            for (Blueprint bp : window) if (bp.category.equals(c)) n++;
            out.put(c, (double) n / window.size());
        }
        return out;
    }

    // ── Session lifecycle ────────────────────────────────────────────────────

    private void takeClient(Map<String, Object> a) {
        Map<?, ?> cl = a.get("client") instanceof Map<?, ?> m ? m : Map.of();
        clientUserAgent = cl.get("userAgent") instanceof String ua ? ua : "headless";
        clientViewport = cl.get("viewport");
    }

    private void startStudy(Map<String, Object> cfg) {
        config = configFrom(cfg);
        events.clear();
        eventSeq = 0;
        completedSessionScores.clear();
        strategicFailureRoll = new BalancedRollState();
        tacticalFailureRoll = new BalancedRollState();
        demographics = null;
        if (studyLog != null) {
            try { studyLog.studyStarted(config); } catch (RuntimeException e) { logger.warning("StratTac study log failed to start: " + e); }
        }
        beginSession(1);
        phase = Boolean.TRUE.equals(config.collectDemographics) ? "demographics" : "playing";
    }

    private void beginSession(int n) {
        sessionNumber = n;
        String cx = complexityForSession(n);
        pendingBlueprints = MissionGen.generateSessionPlan(new Rng(Rng.u32(config.seed ^ planSeedIndex(n))), cx,
                SESSION_DURATION, new ArrayList<>());
        elapsed = 0; rawElapsed = 0; rawMicros = 0; sessionClockStarted = false;
        assets = createInitialAssets(cx);
        missions = new ArrayList<>();
        score = 0; penaltyAccrued = 0;
        sessionDuration = sessionDurationFor(cx);
        categoryForecast = Params.categoryForecast(cx);
        strategicModal = null;
        trustProbeActive = false;
        nextTrustProbeAt = TRUST_PROBE_INTERVAL;
        nextSnapshotAt = 0;
        nextFailureRollAt = FAILURE_ROLL_INTERVAL;
        while (events.size() < Math.max(n, config.numSessions)) events.add(new ArrayList<>());
    }

    private void endSession(String reason) {
        List<String> inFlight = new ArrayList<>();
        for (Mission m : missions) if ("queued".equals(m.status) || "active".equals(m.status)) inFlight.add(m.id);
        List<Mission> before = new ArrayList<>();
        for (Mission m : missions) before.add(m.copy());
        for (Mission m : missions) {
            if ("completed".equals(m.status) || "abandoned".equals(m.status)) continue;
            boolean any = false;
            for (Task t : m.tasks) {
                if ("pending".equals(t.status) || "traveling".equals(t.status) || "executing".equals(t.status)) t.status = "failed";
                if ("completed".equals(t.status)) any = true;
            }
            m.status = any ? "completed" : "failed";
        }
        int idx = sessionNumber - 1;
        long completion = computeCompletionPoints(missions);
        long penalty = computePenaltyAccrued(missions, elapsed);
        long finalScore = Math.max(0, completion - penalty);
        double greenEff = computeGreenEfficiency(missions), meanTime = computeMeanMissionTime(missions);
        List<Map<String, Object>> evs = events.get(idx);
        int choices = 0, followed = 0, agentPlans = 0, unmodified = 0;
        for (Map<String, Object> e : evs) {
            if ("strategic_choice".equals(e.get("type"))) { choices++; if (Boolean.TRUE.equals(e.get("wasAgentSuggestion"))) followed++; }
            if ("tactical_confirmed".equals(e.get("type")) && Boolean.TRUE.equals(e.get("wasAgentSuggested"))) {
                agentPlans++;
                if (!Boolean.TRUE.equals(e.get("modifiedFromAgentPlan"))) unmodified++;
            }
        }
        score = finalScore;
        penaltyAccrued = penalty;
        for (int mi = 0; mi < before.size(); mi++) {
            Mission b = before.get(mi), a = missions.get(mi);
            if ("abandoned".equals(b.status)) continue;
            for (int ti = 0; ti < b.tasks.size(); ti++)
                if (!"failed".equals(b.tasks.get(ti).status) && "failed".equals(a.tasks.get(ti).status))
                    logEvent(taskFailedPayload(b, b.tasks.get(ti), "session_ended", elapsed));
        }
        Map<String, Integer> byReason = new LinkedHashMap<>();
        int neverAllocated = 0, completed = 0, failed = 0, requeued = 0;
        for (Map<String, Object> e : events.get(idx)) {
            Object type = e.get("type");
            if ("task_completed".equals(type)) completed++;
            if ("task_requeued".equals(type)) requeued++;
            if (!"task_failed".equals(type)) continue;
            failed++;
            byReason.merge(e.get("reason") == null ? "unknown" : String.valueOf(e.get("reason")), 1, Integer::sum);
            if (Boolean.FALSE.equals(e.get("missionWasAllocated"))) neverAllocated++;
        }
        Map<String, Object> outcomes = new LinkedHashMap<>();
        outcomes.put("completed", completed); outcomes.put("failed", failed); outcomes.put("requeued", requeued);
        outcomes.put("failuresByReason", byReason); outcomes.put("failedOnNeverAllocatedMissions", neverAllocated);
        logEvent(ev("session_ended", "score", finalScore, "penaltyAccrued", penalty, "completionPoints", completion,
                "greenEfficiency", greenEff, "meanMissionTime", meanTime,
                "agentFollowRate", choices > 0 ? (double) followed / choices : 0,
                "tacticalFollowRate", agentPlans > 0 ? (double) unmodified / agentPlans : 0,
                "reason", reason, "inFlightMissionIds", inFlight, "taskOutcomes", outcomes));
        logEvent(ev("phase_change", "fromPhase", phase, "toPhase", "survey"));
        completedSessionScores.add(finalScore);
        phase = "survey";
        logger.info(String.format("STEND; StratTac session ended (session, score); %d; %d", sessionNumber, finalScore));
    }

    private static double computeGreenEfficiency(List<Mission> ms) {
        double onT45 = 0, total = 0;
        for (Mission m : ms) for (Task t : m.tasks) {
            if (t.completionTime == null || t.startTime == null || t.completionTime == 0 || t.startTime == 0) continue;
            double time = t.completionTime - t.startTime;
            boolean green = false;
            for (String id : t.assignedAssetIds) if (id.startsWith("G")) green = true;
            if (green) { total += time; if (t.type == 4 || t.type == 5) onT45 += time; }
        }
        return total > 0 ? onT45 / total : 1;
    }

    private static double computeMeanMissionTime(List<Mission> ms) {
        double sum = 0;
        int n = 0;
        for (Mission m : ms) {
            if (!"completed".equals(m.status) || m.completionTime == null || m.allocationTime == null || m.completionTime == 0 || m.allocationTime == 0) continue;
            sum += m.completionTime - m.allocationTime;
            n++;
        }
        return n == 0 ? 0 : sum / n;
    }

    // ── Actions ──────────────────────────────────────────────────────────────

    /** Thrown to refuse an action; the refusal is returned to the browser and nothing changes. */
    private static class Refused extends RuntimeException {
        Refused(String msg) { super(msg, null, false, false); }
    }

    private static String str(Map<String, Object> a, String k) {
        return a.get(k) instanceof String s ? s : null;
    }

    private static Comp comp(Object o) {
        if (!(o instanceof Map<?, ?> m)) return null;
        Comp c = new Comp();
        for (String t : Model.TYPES) if (m.get(t) instanceof Number n) c.set(t, Math.max(0, n.intValue()));
        return c;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, List<String>> idMap(Object o) {
        Map<String, List<String>> out = new LinkedHashMap<>();
        if (!(o instanceof Map<?, ?> m)) return out;
        for (Map.Entry<?, ?> e : m.entrySet()) {
            List<String> ids = new ArrayList<>();
            if (e.getValue() instanceof List<?> l) for (Object x : l) if (x instanceof String s) ids.add(s);
            out.put(String.valueOf(e.getKey()), ids);
        }
        return out;
    }

    private void requirePlaying() {
        if (!"playing".equals(phase)) throw new Refused("No session is running");
    }

    /** Applies one operator action. Returns a JSON object: {"ok":true,...} or {"ok":false,"error":...}. */
    public synchronized String dispatch(Map<String, Object> action) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ok", true);
        String before = phase;
        try {
            apply(action, result);
            version++;
            checkpointIfBoundary(before);
        } catch (Refused r) {
            result.clear();
            result.put("ok", false);
            result.put("error", r.getMessage());
        }
        return GSON.toJson(result);
    }

    private void apply(Map<String, Object> a, Map<String, Object> result) {
        String type = (String) a.get("type");
        switch (type) {
            case "START_STUDY" -> {
                if (!"setup".equals(phase) && !"done".equals(phase)) throw new Refused("A study is already running");
                takeClient(a);
                startStudy(a.get("config") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of());
                logger.info(String.format("STSTART; StratTac study started (participant, seed); %s; %d", config.participantId, config.seed));
            }
            case "RESET_STUDY" -> {
                phase = "setup";
                sessionNumber = 0;
                missions = new ArrayList<>();
                strategicModal = null;
            }
            case "OPEN_STRATEGIC" -> { requirePlaying(); openStrategic(str(a, "missionId")); }
            case "CLOSE_STRATEGIC" -> { requirePlaying(); closeStrategic(); }
            case "PICK_STRATEGY" -> { requirePlaying(); pickStrategy(a.get("strategyIndex") instanceof Number n ? n.intValue() : -1); }
            case "EDIT_MANUAL" -> { requirePlaying(); editManual(comp(a.get("allocation"))); }
            case "PREVIEW_ALLOCATION" -> {
                Mission m = mission(str(a, "missionId"));
                Comp pool = comp(a.get("allocation"));
                if (m == null || pool == null) throw new Refused("Unknown mission");
                double eta = Copilot.previewAllocation(params, m.tasks, pool);
                result.put("eta", Double.isFinite(eta) ? eta : null);
            }
            case "APPLY_STRATEGIC" -> { requirePlaying(); applyStrategic(a); }
            case "TACTICAL_SUGGEST" -> { requirePlaying(); tacticalSuggest(a, result); }
            case "TACTICAL_ASSIGN_CHANGED" -> { requirePlaying(); tacticalAssignChanged(a); }
            case "CONFIRM_TACTICAL" -> { requirePlaying(); confirmTactical(a); }
            case "OVERRIDE_TACTICAL" -> { requirePlaying(); overrideTactical(str(a, "missionId")); }
            case "CONFIRM_FAILURE_RECOVERY" -> { requirePlaying(); confirmFailureRecovery(a); }
            case "ABANDON_MISSION" -> { requirePlaying(); abandonMission(str(a, "missionId")); }
            case "RECALL_ASSET" -> { requirePlaying(); recallAsset(str(a, "assetId")); }
            case "SUBMIT_TRUST_PROBE" -> {
                logEvent(ev("trust_probe", "trust", a.get("trust"), "workload", a.get("workload")));
                trustProbeActive = false;
                nextTrustProbeAt = elapsed + TRUST_PROBE_INTERVAL;
            }
            case "DISMISS_TRUST_PROBE" -> {
                logEvent(ev("trust_probe_dismissed"));
                trustProbeActive = false;
                nextTrustProbeAt = elapsed + TRUST_PROBE_INTERVAL;
            }
            case "SUBMIT_DEMOGRAPHICS" -> {
                if (!"demographics".equals(phase)) throw new Refused("Not collecting demographics");
                demographics = a.get("responses") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
                logEvent(ev("phase_change", "fromPhase", phase, "toPhase", "playing"));
                phase = "playing";
            }
            case "SUBMIT_SURVEY" -> logEvent(ev("survey_response", "surveyName", a.get("surveyName"), "responses", a.get("responses")));
            case "FINISH_SURVEYS" -> {
                if (!"survey".equals(phase)) throw new Refused("No surveys are open");
                String to = sessionNumber < config.numSessions ? "between" : "done";
                logEvent(ev("phase_change", "fromPhase", phase, "toPhase", to));
                phase = to;
            }
            case "NEXT_SESSION" -> {
                if (!"between".equals(phase)) throw new Refused("Not between sessions");
                takeClient(a);
                logEvent(ev("phase_change", "fromPhase", phase, "toPhase", "playing"));
                beginSession(sessionNumber + 1);
                phase = "playing";
            }
            case "END_STUDY" -> {
                logEvent(ev("phase_change", "fromPhase", phase, "toPhase", "done"));
                phase = "done";
            }
            case "FORCE_MISSION_ARRIVAL" -> {
                if (!config.testingMode || pendingBlueprints.isEmpty()) throw new Refused("Only in testing mode");
                Blueprint bp = pendingBlueprints.remove(0);
                bp.arrivalTime = elapsed;
                Mission m = spawnMission(bp);
                missions.add(m);
                logEvent(missionArrivedPayload(m, null));
            }
            case "FORCE_DRONE_FAILURE" -> {
                if (!config.testingMode) throw new Refused("Only in testing mode");
                Mission m = null;
                for (Mission x : missions) if ("active".equals(x.status) && !x.failureRecoveryPending) { m = x; break; }
                if (m == null) throw new Refused("No active mission");
                List<Asset> deployed = new ArrayList<>(), executing = new ArrayList<>();
                for (Asset x : assets) if (m.id.equals(x.currentMissionId) && "deployed".equals(x.status) && x.currentTaskId != null) deployed.add(x);
                for (Asset x : deployed) { Task t = m.task(x.currentTaskId); if (t != null && "executing".equals(t.status)) executing.add(x); }
                List<Asset> cands = executing.isEmpty() ? deployed : executing;
                if (cands.isEmpty()) throw new Refused("No drone to fail");
                applyForcedDroneFailure(m, cands.get(0), List.of());
            }
            case "FORCE_SESSION_END" -> {
                if (!config.testingMode) throw new Refused("Only in testing mode");
                requirePlaying();
                endSession("forced");
            }
            default -> throw new Refused("Unknown action " + type);
        }
    }

    private void resolveStrategicFailure(Mission m) {
        if (m.strategicFailureFired != null) return;
        boolean fired = Tactical.drawBalancedRoll(strategicFailureRoll, epsS(), config.seed, STRATEGIC_FAILURE_SALT);
        Rng rng = new Rng(Rng.u32(config.seed ^ Rng.hashId(m.id)));
        m.strategicFailureFired = fired;
        m.strategicFailureColour = fired ? Model.TYPES[rng.randInt(0, 3)] : null;
    }

    private List<Long> drawCardRevealDelays(String missionId, int count) {
        Rng rng = new Rng(Rng.u32(config.seed ^ Rng.hashId(missionId) ^ 0x5ea1));
        List<Long> out = new ArrayList<>();
        for (int i = 0; i < count; i++) out.add(JsMath.round(CARD_REVEAL_MIN_MS + rng.next() * CARD_REVEAL_SPAN_MS));
        return out;
    }

    private void openStrategicModal(Mission m, Comp manual, List<Mission> missionsForReserve) {
        if (isAgentMode()) resolveStrategicFailure(m);
        Comp reserve = countTypes(availableExcludingPending(missionsForReserve, m.id));
        List<Strategy> strategies = isAgentMode()
                ? Copilot.generateStrategies(params, m.tasks, reserve, Boolean.TRUE.equals(m.strategicFailureFired), m.strategicFailureColour)
                : new ArrayList<>();
        StrategicModal modal = new StrategicModal();
        modal.missionId = m.id;
        modal.strategies = strategies;
        modal.manualAllocation = manual;
        modal.openedAtMs = nowMs();
        modal.cardRevealDelaysMs = drawCardRevealDelays(m.id, strategies.size());
        long activeCount = missions.stream().filter(x -> "active".equals(x.status)).count();
        long penaltyBefore = penaltyAccrued;
        strategicModal = modal;
        List<Map<String, Object>> presented = new ArrayList<>();
        for (int i = 0; i < strategies.size(); i++) {
            Strategy s = strategies.get(i);
            Map<String, Object> x = new LinkedHashMap<>();
            x.put("name", s.name); x.put("description", s.description); x.put("displayedAssets", s.assets);
            x.put("trueAssets", s.trueAssets); x.put("displayedCompletionTime", s.expectedCompletionTime);
            x.put("reserveAfter", s.reserveAfter); x.put("speedScore", s.speedScore); x.put("reserveScore", s.reserveScore);
            x.put("redundancyScore", s.redundancyScore); x.put("isBadSuggestion", s.isBadSuggestion);
            x.put("badSuggestionType", s.badSuggestionType); x.put("badSuggestionColour", s.badSuggestionColour);
            x.put("revealDelayMs", modal.cardRevealDelaysMs.get(i));
            presented.add(x);
        }
        logEvent(ev("strategic_modal_opened", "missionId", m.id, "missionCategory", m.category,
                "timeRemainingInSession", timeRemaining(), "activeMissions", activeCount,
                "currentPenaltyAccrued", penaltyBefore, "strategiesPresented", presented));
    }

    private void openStrategic(String missionId) {
        Mission m = mission(missionId);
        if (m == null || !"queued".equals(m.status)) throw new Refused("That mission cannot be allocated");
        openStrategicModal(m, new Comp(), missions);
    }

    private void closeStrategic() {
        StrategicModal modal = strategicModal;
        Mission m = modal == null ? null : mission(modal.missionId);
        if (modal != null && m != null)
            logEvent(ev("strategic_dismissed", "missionId", modal.missionId, "missionCategory", m.category,
                    "latencyMs", nowMs() - modal.openedAtMs, "timeRemainingInSession", timeRemaining()));
        strategicModal = null;
    }

    private void pickStrategy(int index) {
        StrategicModal modal = strategicModal;
        if (modal == null) throw new Refused("No allocation is open");
        modal.selectedStrategyIndex = index;
        Mission m = mission(modal.missionId);
        String name = index >= 0 && index < modal.strategies.size() ? modal.strategies.get(index).name : null;
        if (m != null && name != null)
            logEvent(ev("strategic_card_previewed", "missionId", modal.missionId, "missionCategory", m.category,
                    "strategyIndex", index, "strategyName", name, "latencyMs", nowMs() - modal.openedAtMs,
                    "timeRemainingInSession", timeRemaining()));
    }

    private void editManual(Comp allocation) {
        StrategicModal modal = strategicModal;
        if (modal == null || allocation == null) throw new Refused("No allocation is open");
        modal.manualAllocation = allocation;
        Mission m = mission(modal.missionId);
        if (m != null)
            logEvent(ev("manual_allocation_edited", "missionId", modal.missionId, "missionCategory", m.category,
                    "allocation", allocation, "latencyMs", nowMs() - modal.openedAtMs, "timeRemainingInSession", timeRemaining()));
    }

    private void applyStrategic(Map<String, Object> a) {
        Mission mission = mission(str(a, "missionId"));
        if (mission == null || !"queued".equals(mission.status)) throw new Refused("That mission cannot be allocated");
        StrategicModal modal = strategicModal;
        if (modal == null) throw new Refused("No allocation is open");
        boolean fromAgent = "agent".equals(a.get("source")) && a.get("strategyIndex") instanceof Number;
        Comp composition;
        String strategyName;
        Map<String, TaskComp> taskComps = null;
        boolean isBad = false;
        String badType = null, badColour = null;
        if (fromAgent) {
            int idx = ((Number) a.get("strategyIndex")).intValue();
            if (idx < 0 || idx >= modal.strategies.size()) throw new Refused("No such strategy");
            Strategy s = modal.strategies.get(idx);
            composition = s.trueAssets; taskComps = s.trueTaskComps; strategyName = s.name;
            isBad = s.isBadSuggestion; badType = s.badSuggestionType; badColour = s.badSuggestionColour;
        } else {
            composition = comp(a.get("manualAllocation"));
            if (composition == null) composition = new Comp();
            strategyName = "Manual";
        }
        double now = elapsed;
        List<Asset> available = availableExcludingPending(missions, mission.id);
        List<String> taskOrder = new ArrayList<>();
        for (Task t : sortTypeDesc(mission.tasks)) taskOrder.add(t.id);

        List<String> dronePool;
        Map<String, List<String>> taskMap = new LinkedHashMap<>();
        double expected = 0;
        if (fromAgent) {
            List<TaskAssignment> asg = greedyAssign(mission.tasks, available, composition, now, taskComps, taskOrder);
            if (composition.total() == 0) throw new Refused("Nothing to deploy");
            Set<String> pool = new LinkedHashSet<>();
            for (TaskAssignment x : asg) pool.addAll(x.assetIds);
            if (pool.isEmpty()) {
                for (String t : Model.TYPES) {
                    int n = 0;
                    for (Asset x : available) if (x.type.equals(t) && n < composition.get(t)) { pool.add(x.id); n++; }
                }
                if (pool.isEmpty()) throw new Refused("No drones available");
            }
            for (String t : Model.TYPES) {
                int n = 0;
                for (Asset x : available) if (x.type.equals(t) && n < composition.get(t)) { pool.add(x.id); n++; }
            }
            dronePool = new ArrayList<>(pool);
            for (TaskAssignment x : asg) taskMap.put(x.taskId, x.assetIds);
            if (!asg.isEmpty()) {
                expected = Double.NEGATIVE_INFINITY;
                for (TaskAssignment x : asg) expected = Math.max(expected, x.startTime + x.baseTime);
            }
        } else {
            Comp have = countTypes(available);
            if (!have.covers(composition)) throw new Refused("Not enough drones in the reserve");
            dronePool = new ArrayList<>();
            for (String t : Model.TYPES) {
                int n = 0;
                for (Asset x : available) if (x.type.equals(t) && n < composition.get(t)) { dronePool.add(x.id); n++; }
            }
            if (isAgentMode()) {
                List<TaskAssignment> asg = greedyAssign(mission.tasks, available, composition, now, null, taskOrder);
                for (TaskAssignment x : asg) taskMap.put(x.taskId, x.assetIds);
                if (!asg.isEmpty()) {
                    expected = Double.NEGATIVE_INFINITY;
                    for (TaskAssignment x : asg) expected = Math.max(expected, x.startTime + x.baseTime);
                }
            }
        }

        boolean hasTacticalError = false;
        Map<String, List<String>> agentSeqs = new LinkedHashMap<>();
        Boolean tacFired = mission.tacticalFailureFired;
        if (fromAgent && epsT() > 0) {
            if (tacFired == null) tacFired = Tactical.drawBalancedRoll(tacticalFailureRoll, epsT(), config.seed, TACTICAL_FAILURE_SALT);
            hasTacticalError = tacFired;
            if (hasTacticalError) {
                Rng tacRng = new Rng(Rng.u32(config.seed ^ Rng.hashId(mission.id) ^ 0x7ac1));
                Tactical.FailurePlan fp = Tactical.buildTacticalFailurePlan(mission.tasks, taskMap, tacRng);
                taskMap = fp.taskAssignments();
                agentSeqs = fp.droneSequences();
            }
        }
        if (isGreedy()) {
            String f = taskOrder.get(0);
            Map<String, List<String>> only = new LinkedHashMap<>();
            if (taskMap.containsKey(f)) only.put(f, taskMap.get(f));
            taskMap = only;
        }
        PendingAllocation pending = new PendingAllocation();
        pending.strategyName = strategyName; pending.composition = composition; pending.dronePool = dronePool;
        pending.taskAssignments = taskMap; pending.taskOrder = taskOrder; pending.expectedCompletionTime = expected;
        pending.isAgentSuggested = fromAgent; pending.isBadSuggestion = isBad; pending.badSuggestionType = badType;
        pending.hasTacticalError = hasTacticalError; pending.suppressedTaskId = null; pending.agentDroneSequences = agentSeqs;

        Strategy aggCard = null, consCard = null;
        for (Strategy s : modal.strategies) { if ("Aggressive".equals(s.name)) aggCard = s; if ("Conservative".equals(s.name)) consCard = s; }
        long deployEnabledAt = 0;
        if (fromAgent) for (long d : modal.cardRevealDelaysMs) deployEnabledAt = Math.max(deployEnabledAt, d);
        logEvent(ev("strategic_choice", "missionId", mission.id, "missionCategory", mission.category,
                "choiceType", strategyName.toLowerCase(), "wasAgentSuggestion", fromAgent, "agentSuggestionWasBad", isBad,
                "badSuggestionType", badType, "badSuggestionColour", badColour, "assetsChosen", composition,
                "editedFromStrategy", str(a, "editedFromStrategy"), "timeRemainingInSession", Math.max(0, sessionDuration - now),
                "latencyMs", JsMath.round(now * 1000) - modal.openedAtMs,
                "deltaVsAggressive", aggCard == null ? null : diff(composition, aggCard.trueAssets),
                "deltaVsConservative", consCard == null ? null : diff(composition, consCard.trueAssets),
                "strategyCardCount", modal.strategies.size(),
                "manualBeforeCardsLoaded", fromAgent ? null : a.get("manualBeforeCardsLoaded"),
                "cardsLoadedAtManualSwitch", fromAgent ? null : a.get("cardsLoadedAtManualSwitch"),
                "cardRevealDelaysMs", modal.cardRevealDelaysMs, "deployEnabledAtMs", deployEnabledAt));
        List<Map<String, Object>> agentPlan = new ArrayList<>();
        int order = 0;
        for (String tid : taskOrder) {
            List<String> ids = taskMap.getOrDefault(tid, List.of());
            if (!ids.isEmpty()) agentPlan.add(planEntry(tid, mission.task(tid).type, ids, order++));
        }
        List<String> unassigned = new ArrayList<>();
        for (Task t : mission.tasks) if (taskMap.getOrDefault(t.id, List.of()).isEmpty()) unassigned.add(t.id);
        logEvent(ev("tactical_opened", "missionId", mission.id, "missionCategory", mission.category,
                "strategyChosen", strategyName, "agentPlan", agentPlan, "timeRemainingInSession", Math.max(0, sessionDuration - now),
                "hasTacticalError", hasTacticalError, "suppressedTaskId", null, "agentDroneSequences", agentSeqs,
                "dronePool", dronePool, "agentProjectedCompletion", expected, "unassignedTaskIds", unassigned));
        mission.tacticalPending = true;
        mission.pendingAllocation = pending;
        mission.agentInteraction = fromAgent ? "shown" : "manual";
        mission.chosenStrategyName = strategyName;
        mission.tacticalOpenedAtMs = JsMath.round(now * 1000);
        mission.tacticalSuggestCount = 0;
        mission.tacticalFailureFired = tacFired;
        launchToLoiter(mission, dronePool, now);
        strategicModal = null;
    }

    private static Comp diff(Comp a, Comp b) {
        return new Comp(a.Blue - b.Blue, a.Red - b.Red, a.Green - b.Green);
    }

    /** Logs the Suggest click and returns the assistant's plan for the planner to reveal. */
    private void tacticalSuggest(Map<String, Object> a, Map<String, Object> result) {
        Mission m = mission(str(a, "missionId"));
        if (m == null) throw new Refused("Unknown mission");
        boolean recovery = Boolean.TRUE.equals(a.get("recoveryMode"));
        if (!recovery && (!m.tacticalPending || m.pendingAllocation == null)) throw new Refused("No tactical plan is open");
        if (recovery && !m.failureRecoveryPending) throw new Refused("No recovery is open");
        int count = (m.tacticalSuggestCount == null ? 0 : m.tacticalSuggestCount) + 1;
        m.tacticalSuggestCount = count;
        logEvent(ev("tactical_suggest_used", "missionId", m.id, "missionCategory", m.category,
                "suggestCountThisMission", count, "timeRemainingInSession", timeRemaining(), "recoveryMode", recovery));
        Map<String, List<String>> plan;
        if (recovery) {
            List<String> pool = new ArrayList<>(), order = new ArrayList<>();
            for (Asset x : assets) if (m.id.equals(x.currentMissionId) && "deployed".equals(x.status)) pool.add(x.id);
            for (Task t : sortTypeDesc(m.tasks)) if (!isTerminal(t)) order.add(t.id);
            plan = Tactical.computeRecoverySuggestion(params, m, pool, order, assets, idMap(a.get("currentAssignments")));
        } else if (m.pendingAllocation.hasTacticalError) {
            plan = m.pendingAllocation.taskAssignments;   // the bad plan is handed over as-is
        } else {
            PendingAllocation p = m.pendingAllocation;
            plan = Tactical.computeTacticalSuggestion(params, p.dronePool, p.taskOrder, m.tasks, assets, isGreedy(), false);
        }
        result.put("taskAssignments", plan);
        if (!recovery && m.pendingAllocation.hasTacticalError) result.put("droneSequences", m.pendingAllocation.agentDroneSequences);
    }

    private void tacticalAssignChanged(Map<String, Object> a) {
        Mission m = mission(str(a, "missionId"));
        if (m == null) throw new Refused("Unknown mission");
        String droneId = str(a, "droneId"), taskId = str(a, "taskId");
        Asset d = asset(droneId);
        Task t = taskId == null ? null : m.task(taskId);
        logEvent(ev("tactical_assignment_changed", "missionId", m.id, "missionCategory", m.category, "op", a.get("op"),
                "droneId", droneId, "droneType", d == null ? null : d.type, "taskId", taskId, "taskType", t == null ? null : t.type,
                "recoveryMode", Boolean.TRUE.equals(a.get("recoveryMode")), "timeRemainingInSession", timeRemaining()));
    }

    private void confirmTactical(Map<String, Object> a) {
        Mission m = mission(str(a, "missionId"));
        if (m == null || !m.tacticalPending || m.pendingAllocation == null) throw new Refused("No tactical plan is open");
        PendingAllocation pending = m.pendingAllocation;
        boolean provided = a.get("taskAssignments") instanceof Map;
        Map<String, List<String>> ta = idMap(a.get("taskAssignments"));
        Map<String, List<String>> seqs = idMap(a.get("droneSequences"));
        List<TaskAssignment> asgns;
        if (provided) asgns = buildManualAssignments(m, ta, seqs, elapsed);
        else {
            List<Asset> pool = new ArrayList<>();
            for (Asset x : assets) if (pending.dronePool.contains(x.id)) pool.add(x);
            asgns = greedyAssign(m.tasks, pool, pending.composition, elapsed, null, pending.taskOrder);
        }
        if (asgns.isEmpty()) throw new Refused("The plan does not cover any task");
        List<String> changed = new ArrayList<>();
        if (provided)
            for (String tid : pending.taskAssignments.keySet())
                if (!norm(pending.taskAssignments.get(tid)).equals(norm(ta.get(tid)))) changed.add(tid);
        boolean chaining = false;
        if (provided) {
            Map<String, Integer> n = new HashMap<>();
            for (List<String> ids : ta.values()) for (String id : ids) n.merge(id, 1, Integer::sum);
            for (int c : n.values()) if (c > 1) chaining = true;
        }
        applyTacticalAllocation(m, asgns, pending, pending.taskOrder, !changed.isEmpty(), seqs, chaining, changed, isGreedy());
        if (pending.hasTacticalError && pending.suppressedTaskId != null) m.tacticallySuppressedTaskId = pending.suppressedTaskId;
        if (isGreedy()) m.needsGreedyReplan = true;
    }

    private static String norm(List<String> ids) {
        List<String> s = new ArrayList<>(ids == null ? List.of() : ids);
        s.sort(null);
        return String.join(",", s);
    }

    private void overrideTactical(String missionId) {
        Mission m = mission(missionId);
        if (m == null || !m.tacticalPending) throw new Refused("No tactical plan is open");
        m.tacticalPending = false;
        m.pendingAllocation = null;
        openStrategicModal(m, null, missions);
    }

    private void confirmFailureRecovery(Map<String, Object> a) {
        Mission m = mission(str(a, "missionId"));
        if (m == null || !m.failureRecoveryPending) throw new Refused("No recovery is open");
        double now = elapsed;
        Map<String, Asset> byId = assetMap();
        java.util.function.Predicate<String> recoverable = id -> {
            Asset x = byId.get(id);
            return x != null && !"failed".equals(x.status) &&
                    ("available".equals(x.status) || ("deployed".equals(x.status) && m.id.equals(x.currentMissionId)));
        };
        Map<String, List<String>> given = idMap(a.get("taskAssignments"));
        Map<String, List<String>> rta = new LinkedHashMap<>();
        for (Task t : m.tasks) {
            if (!"pending".equals(t.status) && !"traveling".equals(t.status)) continue;
            List<String> ids = new ArrayList<>();
            for (String id : given.getOrDefault(t.id, List.of())) if (recoverable.test(id)) ids.add(id);
            if (!ids.isEmpty()) rta.put(t.id, ids);
        }
        Map<String, List<String>> fromAction = idMap(a.get("droneSequences"));
        Map<String, List<String>> rseqs = new LinkedHashMap<>();
        for (String id : new LinkedHashSet<>(rta.values().stream().flatMap(List::stream).toList())) {
            List<String> fa = fromAction.get(id);
            List<String> seq = new ArrayList<>();
            if (fa != null && !fa.isEmpty()) { for (String tid : fa) if (rta.getOrDefault(tid, List.of()).contains(id)) seq.add(tid); }
            else for (Map.Entry<String, List<String>> e : rta.entrySet()) if (e.getValue().contains(id)) seq.add(e.getKey());
            if (!seq.isEmpty()) rseqs.put(id, seq);
        }
        List<TaskAssignment> rasg = buildManualAssignments(m, rta, rseqs, now);
        Map<String, TaskAssignment> byTask = new LinkedHashMap<>();
        for (TaskAssignment x : rasg) byTask.put(x.taskId, x);

        List<String> repaired = new ArrayList<>();
        for (String tid : rta.keySet()) {
            Task before = m.task(tid);
            List<String> after = rta.get(tid);
            if ("pending".equals(before.status) || before.assignedAssetIds.size() != after.size() || !after.containsAll(before.assignedAssetIds))
                repaired.add(tid);
        }
        List<Map<String, Object>> repairedAsg = new ArrayList<>();
        for (String tid : repaired) { Map<String, Object> x = new LinkedHashMap<>(); x.put("taskId", tid); x.put("assetIds", rta.get(tid)); repairedAsg.add(x); }
        List<String> still = new ArrayList<>();
        for (Task t : m.tasks) if ("pending".equals(t.status) && rta.getOrDefault(t.id, List.of()).isEmpty()) still.add(t.id);
        logEvent(ev("failure_recovery", "missionId", m.id, "missionCategory", m.category, "recoveryType", "manual",
                "wasAgentSuggested", Boolean.TRUE.equals(a.get("wasAgentSuggested")), "timeRemainingInSession", Math.max(0, sessionDuration - now),
                "recoveryReason", m.recoveryReason,
                "latencyMs", m.recoveryOpenedAtMs != null ? JsMath.round(now * 1000) - m.recoveryOpenedAtMs : 0,
                "repairedTaskIds", repaired, "repairedAssignments", repairedAsg, "tasksStillUnassigned", still));

        // Park drones the revised plan took off an unstarted task, then dispatch each reassigned drone
        Map<String, String> curTask = new HashMap<>();
        for (Asset x : assets) curTask.put(x.id, x.currentTaskId);
        for (Task t : m.tasks) {
            TaskAssignment x = byTask.get(t.id);
            if (x == null || (!"pending".equals(t.status) && !"traveling".equals(t.status))) continue;
            t.status = "traveling"; t.assignedAssetIds = new ArrayList<>(x.assetIds); t.allocatedAt = now;
            t.travelTime = x.travelTime; t.baseTime = x.baseTime; t.useSubstitute = x.useSubstitute;
            t.startTime = x.startTime; t.completionTime = x.startTime + x.baseTime; t.recallDelay = 0;
        }
        for (Asset x : assets) {
            List<TaskAssignment> mine = new ArrayList<>();
            for (TaskAssignment y : rasg) if (y.assetIds.contains(x.id)) mine.add(y);
            if (mine.isEmpty() || !recoverable.test(x.id)) {
                String from = curTask.get(x.id);
                if (m.id.equals(x.currentMissionId) && from != null && rta.containsKey(from) && !rta.get(from).contains(x.id)) park(x, now);
                continue;
            }
            TaskAssignment first = pickFirstAssignment(mine, rseqs.get(x.id));
            Task task = m.task(first.taskId);
            Pt origin = "deployed".equals(x.status) ? interpolate(x, now) : HUB.copy();
            double tt = params.travelTime(origin, task.waypoint, x.type);
            x.status = "deployed"; x.currentMissionId = m.id; x.currentTaskId = task.id;
            x.position = origin; x.travelFrom = origin.copy(); x.targetPosition = task.waypoint.copy();
            x.travelStartElapsed = now; x.travelEndElapsed = now + tt;
            x.availableAt = now + tt + first.baseTime + params.travelTime(task.waypoint, HUB, x.type);
        }
        m.droneSequences.putAll(rseqs);
        m.failureRecoveryPending = false;
        m.failureExemptUntil = now + graceSeconds();
        m.pendingRecoveryOptions = null;
    }

    private void abandonMission(String missionId) {
        Mission m = mission(missionId);
        if (m == null || !"active".equals(m.status)) throw new Refused("Only an active mission can be abandoned");
        double now = elapsed;
        List<Task> incomplete = new ArrayList<>();
        for (Task t : m.tasks) if ("pending".equals(t.status) || "traveling".equals(t.status) || "executing".equals(t.status)) incomplete.add(t);
        Mission residual = null;
        List<Object[]> carry = new ArrayList<>();
        if (!incomplete.isEmpty()) {
            residual = m.copy();
            residual.id = m.id + "-R";
            residual.status = "queued";
            residual.tasks = new ArrayList<>();
            for (int i = 0; i < incomplete.size(); i++) {
                Task t = incomplete.get(i);
                double exec = "executing".equals(t.status) && t.startTime != null ? Math.max(0, now - t.startTime) : 0;
                double remaining = Math.max(5, t.baseTime - exec);
                Task r = t.copy();
                r.id = m.id + "-R-T" + (i + 1);
                r.missionId = m.id + "-R";
                r.status = "pending"; r.assignedAssetIds = new ArrayList<>(); r.allocatedAt = null; r.travelTime = 0;
                r.baseTime = remaining; r.startTime = null; r.completionTime = null; r.useSubstitute = false; r.recallDelay = 0;
                residual.tasks.add(r);
                carry.add(new Object[]{t, r.id, exec, remaining});
            }
            residual.allocationTime = null; residual.completionTime = null; residual.arrivalTime = now;
            residual.agentInteraction = "none"; residual.chosenStrategyName = null; residual.manualPriorityIds = new ArrayList<>();
            residual.tacticalPending = false; residual.pendingAllocation = null; residual.droneSequences = new LinkedHashMap<>();
            residual.droneFailuresFired = 0; residual.failedDroneId = null; residual.failureRecoveryPending = false;
            residual.failureExemptUntil = null; residual.pendingRecoveryOptions = null; residual.tacticallySuppressedTaskId = null;
            residual.abandonedAt = null; residual.isResidual = true; residual.needsGreedyReplan = false;
        }
        int rewardCarried = 0;
        List<String> carriedIds = new ArrayList<>();
        for (Object[] c : carry) {
            Task t = (Task) c[0];
            carriedIds.add(t.id);
            rewardCarried += TASK_WEIGHT[t.type];
            logEvent(ev("task_requeued", "missionId", m.id, "missionCategory", m.category, "taskId", t.id, "taskType", t.type,
                    "residualMissionId", m.id + "-R", "residualTaskId", c[1], "statusBefore", t.status,
                    "assignedAssetIds", new ArrayList<>(t.assignedAssetIds), "rewardDeferred", TASK_WEIGHT[t.type],
                    "executionProgress", Math.round((double) c[2] * 10) / 10.0, "remainingBaseTime", c[3],
                    "waitFromMissionArrival", Math.max(0, now - m.arrivalTime)));
        }
        int completedCount = 0;
        for (Task t : m.tasks) if ("completed".equals(t.status)) completedCount++;
        logEvent(ev("mission_abandoned", "missionId", m.id, "missionCategory", m.category, "completedTaskCount", completedCount,
                "remainingTaskCount", incomplete.size(), "residualMissionId", residual == null ? null : residual.id,
                "carriedTaskIds", carriedIds, "rewardCarriedOver", rewardCarried, "rewardLost", 0));
        if (residual != null) logEvent(missionArrivedPayload(residual, m.id));
        for (Asset x : assets) {
            if (!m.id.equals(x.currentMissionId)) continue;
            double rt = params.travelTime(x.position, HUB, x.type);
            x.status = "returning"; x.currentMissionId = null; x.currentTaskId = null;
            fly(x, x.position, HUB, now);
            x.availableAt = now + rt;
        }
        m.status = "abandoned"; m.abandonedAt = now; m.abandonedReason = "operator";
        m.failureRecoveryPending = false; m.pendingRecoveryOptions = null;
        if (residual != null) missions.add(residual);
    }

    private void recallAsset(String assetId) {
        Asset x = asset(assetId);
        if (x == null || !"deployed".equals(x.status)) throw new Refused("That drone cannot be recalled");
        String taskId = x.currentTaskId, missionId = x.currentMissionId;
        double now = elapsed;
        double rt = params.travelTime(x.position, HUB, x.type);
        Mission m = mission(missionId);
        Task cur = m == null || taskId == null ? null : m.task(taskId);
        boolean done = cur != null && isTerminal(cur);
        logEvent(ev("asset_recalled", "assetId", x.id, "missionId", missionId, "taskId", taskId));
        x.status = "returning"; x.currentMissionId = null; x.currentTaskId = null;
        fly(x, x.position, HUB, now);
        x.availableAt = now + rt;
        if (done || m == null || cur == null) return;
        logEvent(taskFailedPayload(m, cur, "asset_recalled", now));
        cur.status = "failed";
    }

    // ── Snapshot for the views ───────────────────────────────────────────────

    public synchronized String snapshotJson() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("version", version);
        out.put("phase", phase);
        out.put("config", config);
        out.put("sessionNumber", sessionNumber);
        out.put("numSessions", config.numSessions);
        out.put("elapsed", elapsed);
        out.put("sessionDuration", sessionDuration);
        out.put("hub", List.of(HUB.x, HUB.y));
        out.put("assets", assets);
        out.put("missions", missions);
        out.put("pendingBlueprintCount", pendingBlueprints.size());
        out.put("score", score);
        out.put("penaltyAccrued", penaltyAccrued);
        out.put("completedSessionScores", completedSessionScores);
        out.put("categoryForecast", categoryForecast);
        out.put("strategicModal", strategicModal);
        out.put("trustProbeActive", trustProbeActive);
        out.put("reserve", reserveCount(true));
        out.put("eventCount", eventSeq);
        return GSON.toJson(out);
    }

    /** The participant file, in the original study's download format (study_<participant>_<condition>_<seed>.json). */
    public synchronized String studyPayloadJson() {
        return PRETTY.toJson(studyPayloadMap());
    }

    private Map<String, Object> studyPayloadMap() {
        List<String> complexities = new ArrayList<>();
        for (int i = 1; i <= config.numSessions; i++) complexities.add(complexityForSession(i));
        long total = 0;
        for (long v : completedSessionScores) total += v;
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("participantId", config.participantId);
        out.put("condition", config.condition);
        out.put("mode", config.mode);
        out.put("complexities", complexities);
        out.put("seed", config.seed);
        out.put("epsilonStrategic", config.agentErrorRate);
        out.put("epsilonTactical", config.epsilonTactical);
        out.put("demographics", demographics);
        out.put("sessionScores", completedSessionScores);
        out.put("totalScore", total);
        out.put("sessions", events);
        out.put("platform", "haris");
        return out;
    }

    /** A mid-session snapshot, in the original study's Snapshot format: config, progress, live state and all events so far. */
    public synchronized String snapshotPayloadJson() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("snapshotTime", ISO.format(Instant.now()));
        out.put("snapshotType", "mid_session");
        out.put("participantId", config.participantId);
        out.put("condition", config.condition);
        out.put("mode", config.mode);
        out.put("complexity", complexityForSession(Math.max(1, sessionNumber)));
        out.put("seed", config.seed);
        out.put("epsilonStrategic", config.agentErrorRate);
        out.put("epsilonTactical", config.epsilonTactical);
        out.put("testingMode", config.testingMode);
        out.put("sessionNumber", sessionNumber);
        out.put("elapsed", round1(elapsed));
        out.put("score", score);
        out.put("penaltyAccrued", penaltyAccrued);
        out.put("sessionScores", completedSessionScores);
        Map<String, Object> live = new LinkedHashMap<>();
        live.put("elapsed", round1(elapsed));
        live.put("score", score);
        live.put("penaltyAccrued", penaltyAccrued);
        live.put("reserve", reserveCount(false));
        live.put("effectiveReserve", reserveCount(true));
        List<Map<String, Object>> ms = new ArrayList<>();
        for (Mission m : missions) {
            Map<String, Object> mm = new LinkedHashMap<>();
            mm.put("id", m.id);
            mm.put("category", m.category);
            mm.put("status", m.status);
            mm.put("allocationTime", m.allocationTime == null ? null : round1(m.allocationTime));
            mm.put("completionTime", m.completionTime == null ? null : round1(m.completionTime));
            mm.put("agentInteraction", m.agentInteraction);
            mm.put("chosenStrategy", m.chosenStrategyName);
            mm.put("tacticalPending", m.tacticalPending);
            mm.put("failureRecoveryPending", m.failureRecoveryPending);
            mm.put("tacticallySuppressedTaskId", m.tacticallySuppressedTaskId);
            List<Map<String, Object>> ts = new ArrayList<>();
            for (Task t : m.tasks) {
                Map<String, Object> tm = new LinkedHashMap<>();
                tm.put("id", t.id);
                tm.put("type", t.type);
                tm.put("status", t.status);
                tm.put("assignedAssetIds", t.assignedAssetIds);
                tm.put("startTime", t.startTime == null ? null : round1(t.startTime));
                tm.put("completionTime", t.completionTime == null ? null : round1(t.completionTime));
                ts.add(tm);
            }
            mm.put("tasks", ts);
            ms.add(mm);
        }
        live.put("missions", ms);
        List<Map<String, Object>> as = new ArrayList<>();
        for (Asset a : assets) {
            Map<String, Object> am = new LinkedHashMap<>();
            am.put("id", a.id);
            am.put("type", a.type);
            am.put("status", a.status);
            am.put("currentMissionId", a.currentMissionId);
            am.put("currentTaskId", a.currentTaskId);
            am.put("failedAt", a.failedAt);
            as.add(am);
        }
        live.put("assets", as);
        out.put("liveSession", live);
        out.put("sessions", events);
        out.put("platform", "haris");
        return PRETTY.toJson(out);
    }

    /** Gson reads every number as a double; whole ones go back to longs so the log prints 12, not 12.0, as the browser did. */
    @SuppressWarnings("unchecked")
    private static Object jsNumbers(Object o) {
        if (o instanceof Double d) {
            double v = d;
            return v == Math.rint(v) && Math.abs(v) < 9.007199254740992E15 && !(v == 0 && 1 / v < 0) ? (Object) (long) v : d;
        }
        if (o instanceof Map<?, ?> m) {
            for (Map.Entry<String, Object> e : ((Map<String, Object>) m).entrySet()) e.setValue(jsNumbers(e.getValue()));
            return m;
        }
        if (o instanceof List<?> l) {
            List<Object> lo = (List<Object>) l;
            for (int i = 0; i < lo.size(); i++) lo.set(i, jsNumbers(lo.get(i)));
            return lo;
        }
        return o;
    }

    private static double round1(double v) { return Math.round(v * 10) / 10.0; }

    /** The whole study's events, one list per session (for the participant export). */
    public synchronized String eventsJson() {
        return GSON.toJson(events);
    }

    public synchronized String phase() { return phase; }
    public synchronized StudyConfig studyConfig() { return config; }
    public synchronized int sessionNumber() { return sessionNumber; }
}
