package server.strattac;

import com.google.gson.Gson;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.logging.Logger;

/**
 * The strategic/tactical study engine. One instance holds the whole study state; the simulator's main loop calls
 * {@link #step(double)} and the browser views read {@link #snapshotJson()} and send actions to {@link #dispatch(Map)}.
 *
 * This first version sets up the fleet, the world and the session clock. Missions, tasks, the assistants and
 * scoring follow in later steps of the port.
 */
public class StratTacEngine {

    private static final Gson GSON = new Gson();  // compact: the state is polled ten times a second by every view

    /** One drone type from the scenario's droneTypes list (Fast/Lifter/Camera in the study). */
    public static class DroneType {
        public String id;       // internal id, logged as-is ("Blue", "Red", "Green")
        public String label;    // shown to the operator ("Fast")
        public String shortLabel; // composition shorthand ("F")
        public String colour;
        public double speed;    // world units per second
        public String icon;
        public int count;       // fleet size
    }

    /** A drone in the fleet. Positions are world units (the study map is 1400 x 800 with the hub in the middle). */
    public static class Asset {
        public String id;
        public String type;
        public double x, y;
        public String status = "available";
    }

    private final Logger logger;
    private final Map<String, Object> scenario;
    private final List<DroneType> droneTypes = new ArrayList<>();
    private final double worldW, worldH, hubX, hubY;
    private final double sessionSeconds;

    private String phase = "setup";   // setup, playing, ended
    private double elapsed = 0;       // simulated seconds into the session
    private int sessionNumber = 0;
    private final List<Asset> assets = new ArrayList<>();
    private long version = 0;         // bumped on every change, so views can skip redraws

    @SuppressWarnings("unchecked")
    public StratTacEngine(Map<String, Object> scenario, Logger logger) {
        this.scenario = scenario;
        this.logger = logger;
        Map<String, Object> st = (Map<String, Object>) scenario.get("strattac");
        Map<String, Object> world = st.get("world") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        worldW = num(world.get("width"), 1400);
        worldH = num(world.get("height"), 800);
        List<Object> hub = world.get("hub") instanceof List<?> l ? (List<Object>) l : List.of(worldW / 2, worldH / 2);
        hubX = num(hub.get(0), worldW / 2);
        hubY = num(hub.get(1), worldH / 2);
        sessionSeconds = num(st.get("sessionSeconds"), 480);
        if (st.get("droneTypes") instanceof List<?> types) {
            for (Object o : types) {
                Map<String, Object> t = (Map<String, Object>) o;
                DroneType d = new DroneType();
                d.id = (String) t.get("id");
                d.label = t.get("label") instanceof String s ? s : d.id;
                d.shortLabel = t.get("short") instanceof String s ? s : d.label.substring(0, 1);
                d.colour = t.get("colour") instanceof String s ? s : "#9ca3af";
                d.speed = num(t.get("speed"), 10);
                d.icon = t.get("icon") instanceof String s ? s : null;
                d.count = (int) num(t.get("count"), 0);
                droneTypes.add(d);
            }
        }
        buildFleet();
    }

    private static double num(Object o, double fallback) {
        return o instanceof Number n ? n.doubleValue() : fallback;
    }

    /** Drone ids follow the study: type initial plus a two-digit number (B01..B11). */
    private void buildFleet() {
        assets.clear();
        for (DroneType t : droneTypes) {
            for (int i = 1; i <= t.count; i++) {
                Asset a = new Asset();
                a.id = t.id.charAt(0) + String.format("%02d", i);
                a.type = t.id;
                a.x = hubX;
                a.y = hubY;
                assets.add(a);
            }
        }
    }

    public synchronized void step(double dt) {
        if (!"playing".equals(phase)) return;
        elapsed += dt;
        if (elapsed >= sessionSeconds) {
            elapsed = sessionSeconds;
            phase = "ended";
            logger.info(String.format("STEND; StratTac session ended (session); %d", sessionNumber));
        }
        version++;
    }

    /** Applies one operator action and returns a small JSON result ({"ok":true} or {"ok":false,"error":...}). */
    public synchronized String dispatch(Map<String, Object> action) {
        String type = (String) action.get("type");
        switch (type) {
            case "START_SESSION" -> {
                if (!"setup".equals(phase)) return error("A session is already running");
                sessionNumber++;
                elapsed = 0;
                phase = "playing";
                logger.info(String.format("STSTART; StratTac session started (session); %d", sessionNumber));
            }
            default -> {
                return error("Unknown action " + type);
            }
        }
        version++;
        return "{\"ok\":true}";
    }

    private static String error(String msg) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", false);
        out.put("error", msg);
        return GSON.toJson(out);
    }

    public synchronized String snapshotJson() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("version", version);
        out.put("phase", phase);
        out.put("sessionNumber", sessionNumber);
        out.put("elapsed", elapsed);
        out.put("sessionSeconds", sessionSeconds);
        out.put("hub", List.of(hubX, hubY));
        out.put("assets", assets);
        return GSON.toJson(out);
    }
}
