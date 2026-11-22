package server.controller;

import lsl.LslMarkerStream;
import server.Simulator;
import server.model.Coordinate;
import server.model.State;
import server.model.agents.Agent;
import server.model.agents.AgentVirtual;
import server.model.task.Task;

import java.util.*;

/**
 * Swarm degradation study (Will Hunt, ported from exp_degradation_coloured, which includes exp_degradation and
 * feat_nBack). Turned on by an "episodes" list in the scenario.
 * <p>
 * Each episode clears the map and spawns {@code numAgents} colour-coded drones. One leader flies off towards
 * {@code targetPos} and the rest flock after it. {@code degradationTime} seconds in, one drone of colour
 * {@code degColour} disappears; the participant presses Space (or the button) when they notice. Episodes follow one
 * another straight away. With "episodeReview" set to "each" or "end", a questionnaire (mental demand and confidence,
 * 1 to 7) is shown after every episode or after the last one.
 * <p>
 * Log lines (one row per episode is rebuilt from these by {@code tool.LogProcessor}):
 * NEWEP (episode start), DEGTR (drone removed), DGCLK (key press), DGNOC (episode ended with no press),
 * WKLD and PRCP (questionnaire answers), EPEND (episode end), EPSDONE (all episodes done).
 * Optional extras: LSL event markers ("lslMarkers": true) and per-episode screen recordings ("recordEpisodes": true).
 */
public class EpisodeController extends AbstractController {

    public static final String PHASE_RUNNING = "running";
    public static final String PHASE_REVIEW = "review";
    public static final String PHASE_DONE = "done";

    private static final List<String> FALLBACK_PALETTE = List.of("red", "green", "blue", "yellow");

    private final List<Episode> episodes = new ArrayList<>();
    private String reviewMode = "none";        // none | each | end
    private boolean lslWanted = false;
    private boolean recordWanted = false;

    private int index = -1;
    private String phase = null;
    private double episodeEnd;
    private double degradationAt;
    private boolean degraded;
    private long degradedWallMs;
    private double degradedSimTime;
    private boolean pressed;
    private int falsePresses;
    private long episodeWallStartMs;
    private Integer pendingWorkload, pendingPerformance;

    private Double previousTickRate = null;   // restored when the study ends
    private LslMarkerStream lsl;
    private EpisodeRecorder recorder;

    public EpisodeController(Simulator simulator) {
        super(simulator, EpisodeController.class.getName());
    }

    /** One episode as read from the scenario. */
    private record Episode(double length, int numAgents, double degradationTime, List<String> colours,
                           String degColour, int prevAgents, String code, String agentPos, String targetPos,
                           List<String> markers) {}

    public void reset() {
        if (recorder != null)
            recorder.stop();
        if (lsl != null)
            lsl.close();
        recorder = null;
        lsl = null;
        if (previousTickRate != null)
            simulator.setTiming(null, previousTickRate);
        previousTickRate = null;
        episodes.clear();
        reviewMode = "none";
        lslWanted = false;
        recordWanted = false;
        index = -1;
        phase = null;
        pendingWorkload = null;
        pendingPerformance = null;
    }

    public boolean isEnabled() {
        return !episodes.isEmpty();
    }

    /** Reads the "episodes" list and the study options from a scenario. */
    @SuppressWarnings("unchecked")
    public void configure(Map<String, Object> scenario) {
        Object list = scenario.get("episodes");
        if (!(list instanceof List<?> items))
            return;
        for (Object o : items) {
            if (!(o instanceof Map<?, ?> raw))
                continue;
            Map<String, Object> e = (Map<String, Object>) raw;
            int n = num(e.get("numAgents"), 8).intValue();
            List<String> colours = new ArrayList<>();
            if (e.get("colours") instanceof List<?> cs)
                cs.forEach(c -> colours.add(String.valueOf(c)));
            List<String> markers = new ArrayList<>();
            if (e.get("markers") instanceof List<?> ms)
                ms.forEach(m -> {
                    String rep = markerString(m);
                    if (rep != null) markers.add(rep);
                });
            episodes.add(new Episode(
                    num(e.get("episodeLength"), 7).doubleValue(),
                    n,
                    num(e.get("degradationTime"), -1).doubleValue(),
                    colours,
                    e.get("degColour") == null ? null : String.valueOf(e.get("degColour")),
                    num(e.get("prevAgents"), 0).intValue(),
                    e.get("episodeCode") == null ? "EP-" + (episodes.size() + 1) : String.valueOf(e.get("episodeCode")),
                    e.get("agentPos") == null ? "C" : String.valueOf(e.get("agentPos")),
                    e.get("targetPos") == null ? "R" : String.valueOf(e.get("targetPos")),
                    markers));
        }
        if (scenario.get("episodeReview") instanceof String r && List.of("none", "each", "end").contains(r))
            reviewMode = r;
        lslWanted = Boolean.TRUE.equals(scenario.get("lslMarkers"));
        recordWanted = Boolean.TRUE.equals(scenario.get("recordEpisodes"));
        LOGGER.info(String.format("%s; EPCFG; Episodes configured (count, review, lsl, record); %s; %s; %s; %s",
                state().getTime(), episodes.size(), reviewMode, lslWanted, recordWanted));
        publish();
    }

    private static Number num(Object o, Number fallback) {
        return o instanceof Number n ? n : fallback;
    }

    /**
     * Turns a scenario marker object into the string form kept in the state and drawn by the map:
     * {@code circle,lat,lng,radius}, {@code textMarker,lat,lng,text} or {@code banner,background,textColour,text}.
     */
    @SuppressWarnings("unchecked")
    public static String markerString(Object o) {
        if (!(o instanceof Map<?, ?> raw))
            return null;
        Map<String, Object> m = (Map<String, Object>) raw;
        String shape = String.valueOf(m.get("shape"));
        return switch (shape) {
            case "circle" -> shape + "," + m.get("centreLat") + "," + m.get("centreLng") + "," + m.get("radius");
            case "textMarker" -> shape + "," + m.get("lat") + "," + m.get("lng") + "," + m.get("text");
            case "banner" -> shape + "," + m.getOrDefault("colorBg", "#ffcc00") + ","
                    + m.getOrDefault("colorTxt", m.getOrDefault("colourTxt", "#000")) + "," + m.get("text");
            default -> null;
        };
    }

    private State state() {
        return simulator.getState();
    }

    /** Called once when the simulation starts. Opens the optional LSL stream and recorder. */
    public void start() {
        if (!isEnabled())
            return;
        // The study ran in real time at 15 ticks per second; its flocking timing is tuned to that.
        if (previousTickRate == null)
            previousTickRate = simulator.getTickRate();
        simulator.setTiming(1.0, 15.0);
        simulator.changeView(1);  // the study runs in the monitor view
        if (lslWanted && lsl == null) {
            lsl = new LslMarkerStream();
            if (!lsl.isOpen())
                lsl = null;
        }
        if (recordWanted && recorder == null) {
            recorder = EpisodeRecorder.fromEnvironment(state().getGameId());
            if (recorder != null)
                recorder.startSession();
        }
    }

    /**
     * Advances the episode sequence. Call once per tick.
     * @return true when every episode (and any final questionnaire) is done and the run should end.
     */
    public synchronized boolean step() {
        if (!isEnabled())
            return false;
        double now = state().getTime();
        if (phase == null) {
            startNext();
            return false;
        }
        switch (phase) {
            case PHASE_RUNNING -> {
                if (!degraded && degradationAt >= 0 && now >= degradationAt)
                    degrade();
                if (now >= episodeEnd) {
                    endEpisode();
                    boolean last = index >= episodes.size() - 1;
                    if (reviewMode.equals("each") || (reviewMode.equals("end") && last)) {
                        phase = PHASE_REVIEW;
                        state().softReset();
                        marker("REVIEW");
                        publish();
                    } else if (!last) {
                        startNext();
                    } else {
                        finishAll();
                    }
                }
            }
            case PHASE_REVIEW -> {
                if (pendingWorkload != null && pendingPerformance != null) {
                    LOGGER.info(String.format("%s; WKLD; User set workload level to (level); %s", now, pendingWorkload));
                    LOGGER.info(String.format("%s; PRCP; User set Subjective performance level to (level); %s", now, pendingPerformance));
                    pendingWorkload = null;
                    pendingPerformance = null;
                    if (index < episodes.size() - 1)
                        startNext();
                    else
                        finishAll();
                }
            }
            default -> { }
        }
        return PHASE_DONE.equals(phase);
    }

    private void startNext() {
        Episode previous = index >= 0 ? episodes.get(index) : null;
        if (previous != null)
            previous.markers().forEach(state()::removeMarker);
        index++;
        Episode ep = episodes.get(index);
        state().softReset();
        spawn(ep);
        ep.markers().forEach(state()::addMarker);

        double now = state().getTime();
        episodeEnd = now + ep.length();
        degradationAt = ep.degradationTime() >= 0 ? now + ep.degradationTime() : -1;
        degraded = false;
        pressed = false;
        falsePresses = 0;
        episodeWallStartMs = System.currentTimeMillis();
        phase = PHASE_RUNNING;
        LOGGER.info(String.format("%s; NEWEP; New episode (code, prev, N, degColour, degT, index); %s; %s; %s; %s; %s; %s",
                now, ep.code(), ep.prevAgents(), ep.numAgents(), ep.degColour(), ep.degradationTime(), index + 1));
        marker(ep.code());
        publish();
    }

    private void endEpisode() {
        Episode ep = episodes.get(index);
        double now = state().getTime();
        if (!pressed)
            LOGGER.info(String.format("%s; DGNOC; Episode ended with no key press (code, N, degraded); %s; %s; %s",
                    now, ep.code(), ep.numAgents(), degraded));
        LOGGER.info(String.format("%s; EPEND; Episode end (code); %s", now, ep.code()));
        if (recorder != null) {
            long end = episodeWallStartMs + Math.round(ep.length() * 1000);
            recorder.cutEpisodeAsync(ep.code(), index + 1, episodes.size(), episodeWallStartMs, end);
        }
    }

    private void finishAll() {
        phase = PHASE_DONE;
        state().softReset();
        LOGGER.info(String.format("%s; EPSDONE; All episodes done (count); %s", state().getTime(), episodes.size()));
        marker("END");
        publish();
        if (recorder != null)
            recorder.stop();
        if (lsl != null)
            lsl.close();
        recorder = null;
        lsl = null;
    }

    /** Removes one free drone of the episode's degradation colour (any free drone if none of that colour is left). */
    private void degrade() {
        Episode ep = episodes.get(index);
        String wanted = ep.degColour() == null ? null : "UAV-" + ep.degColour();
        List<Agent> candidates = new ArrayList<>();
        synchronized (state().getAgents()) {
            for (Agent a : state().getAgents())
                if (a instanceof AgentVirtual av && av.isAlive() && av.getTask() == null)
                    candidates.add(a);
        }
        Optional<Agent> victim = candidates.stream().filter(a -> wanted != null && wanted.equals(a.getMarker())).findAny();
        if (victim.isEmpty())
            victim = candidates.stream().findAny();
        degraded = true;
        degradedWallMs = System.currentTimeMillis();
        degradedSimTime = state().getTime();
        victim.ifPresent(a -> {
            simulator.getAgentController().deleteAgent(a.getId());
            LOGGER.info(String.format("%s; DEGTR; Degradation triggered (agentId, marker, targetDegColour); %s; %s; %s",
                    state().getTime(), a.getId(), a.getMarker(), ep.degColour()));
        });
        marker("DEG");
    }

    /** The participant reported a disappearance (Space or the button). */
    public synchronized void press() {
        if (!PHASE_RUNNING.equals(phase))
            return;
        Episode ep = episodes.get(index);
        boolean success = degraded && !pressed;
        double reactionMs = degraded ? System.currentTimeMillis() - degradedWallMs : 0;
        double simReaction = degraded ? state().getTime() - degradedSimTime : 0;
        if (!degraded)
            falsePresses++;
        LOGGER.info(String.format("%s; DGCLK; Key press (code, N, prev, success, reactionMs, simReactionS, first); %s; %s; %s; %s; %.0f; %.3f; %s",
                state().getTime(), ep.code(), ep.numAgents(), ep.prevAgents(), success, reactionMs, simReaction, !pressed));
        marker(success ? "CLTT" : "CLTF");
        if (degraded)
            pressed = true;
        publish();
    }

    /** Questionnaire answers (1 to 7). The next episode starts once both have been given. */
    public synchronized void submitReview(Integer workload, Integer performance) {
        if (!PHASE_REVIEW.equals(phase))
            return;
        if (workload != null)
            pendingWorkload = workload;
        if (performance != null)
            pendingPerformance = performance;
    }

    private void marker(String code) {
        if (lsl != null)
            lsl.send(code);
    }

    private void publish() {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("index", index + 1);
        s.put("total", episodes.size());
        s.put("phase", phase == null ? "waiting" : phase);
        s.put("review", reviewMode);
        s.put("pressed", pressed);
        state().setEpisode(s);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Spawning

    /** Position codes used by the study: T, B, L, R, TL, TR, BL, BR and C, around the game centre. */
    private Coordinate positionFor(String pos) {
        Coordinate centre = state().getGameCentre();
        double lat = 0.008, lng = 0.024;
        return switch (pos) {
            case "TL" -> new Coordinate(centre.getLatitude() + lat, centre.getLongitude() - lng);
            case "TR" -> new Coordinate(centre.getLatitude() + lat, centre.getLongitude() + lng);
            case "BL" -> new Coordinate(centre.getLatitude() - lat, centre.getLongitude() - lng);
            case "BR" -> new Coordinate(centre.getLatitude() - lat, centre.getLongitude() + lng);
            case "T" -> new Coordinate(centre.getLatitude() + lat, centre.getLongitude());
            case "B" -> new Coordinate(centre.getLatitude() - lat, centre.getLongitude());
            case "L" -> new Coordinate(centre.getLatitude(), centre.getLongitude() - lng);
            case "R" -> new Coordinate(centre.getLatitude(), centre.getLongitude() + lng);
            default -> new Coordinate(centre.getLatitude(), centre.getLongitude());
        };
    }

    /**
     * Places the leader at {@code agentPos} with a waypoint far beyond {@code targetPos}, then the other drones at
     * least 150 m apart around the group, each with its colour from the episode's list.
     */
    private void spawn(Episode ep) {
        AgentController agents = simulator.getAgentController();
        Random random = simulator.getRandom();
        List<String> colours = new ArrayList<>(ep.colours());
        if (colours.size() != ep.numAgents()) {
            colours.clear();
            for (int i = 0; i < ep.numAgents(); i++)
                colours.add(FALLBACK_PALETTE.get(i % FALLBACK_PALETTE.size()));
        }

        Coordinate start = positionFor(ep.agentPos());
        Coordinate target = positionFor(ep.targetPos());
        double angle = start.getAngle(target);
        Agent leader = agents.addVirtualAgent(start.getLatitude(), start.getLongitude(), Math.toDegrees(angle));
        leader.setMarker("UAV-" + colours.get(0));
        leader.setHeading(Math.toDegrees(angle));

        double separation = 150;
        List<Coordinate> placed = new ArrayList<>(List.of(start));
        for (int i = 1; i < ep.numAgents(); i++) {
            Coordinate spot = null;
            for (int attempt = 0; attempt < 50 && spot == null; attempt++) {
                Coordinate anchor = placed.get(random.nextInt(placed.size()));
                double a = 2 * Math.PI * random.nextDouble();
                double offset = (separation * 1.5) / 111139d;  // about 225 m in degrees of latitude
                Coordinate candidate = new Coordinate(
                        anchor.getLatitude() + offset * Math.cos(a),
                        anchor.getLongitude() + offset * Math.sin(a) / Math.cos(Math.toRadians(anchor.getLatitude())));
                if (placed.stream().allMatch(p -> p.getDistance(candidate) >= separation))
                    spot = candidate;
            }
            if (spot == null) {
                LOGGER.warning("Could not place drone " + (i + 1) + " of episode " + ep.code());
                continue;
            }
            Agent agent = agents.addVirtualAgent(spot.getLatitude(), spot.getLongitude(), 180 + Math.toDegrees(angle));
            agent.setMarker("UAV-" + colours.get(i));
            placed.add(spot);
        }

        Coordinate far = target.getCoordinate(100000, angle);
        Task task = simulator.getTaskController().createTask(Task.TASK_WAYPOINT, far.getLatitude(), far.getLongitude());
        simulator.getAllocator().putInTempAllocation(leader.getId(), task.getId());
        simulator.getAllocator().confirmAllocation(state().getTempAllocation());
    }
}
