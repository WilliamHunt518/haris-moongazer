package server.strattac;

import server.strattac.Model.Comp;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The study's parameters (src/utils/missionGen.ts, copilot.ts, gameReducer.ts), at study-v1.13 / scenario v2.1.
 * Drone speeds and the study fleet come from the scenario's droneTypes; everything else is fixed here so the
 * games match the original.
 */
public final class Params {
    public static final double MAP_W = 1400, MAP_H = 800;
    public static final Model.Pt HUB = new Model.Pt(MAP_W / 2, MAP_H / 2);
    public static final double ZONE_RADIUS = 90, ZONE_MIN_HUB = 120, ZONE_MIN_ZONE = 200, ZONE_EDGE_MARGIN = 180;

    public static final String[] CATEGORIES = {"A", "B", "C", "D", "E"};
    public static final String[] COMPLEXITIES = {"balanced", "strategic", "tactical", "full", "quick"};

    /** Base execution time (s) per task type 1..5 (index 0 unused). */
    public static final double[] TASK_BASE_TIME = {0, 10, 15, 25, 30, 45};
    public static final double[] TASK_SUB_BASE_TIME = {0, 10, 38, 62, 75, 45};
    public static final Comp[] TASK_PRIMARY = {null,
            new Comp(1, 0, 0), new Comp(2, 0, 0), new Comp(0, 2, 1), new Comp(0, 1, 2), new Comp(1, 1, 1)};
    public static final Comp[] TASK_SUBSTITUTE = {null,
            null, new Comp(1, 0, 0), new Comp(0, 1, 1), new Comp(0, 1, 1), null};
    /** Fraction of a task each drone type must stay for (sections by colour). */
    public static final Map<Integer, Map<String, Double>> TASK_SECTION_DEADLINES = new LinkedHashMap<>();
    static {
        TASK_SECTION_DEADLINES.put(1, ordered("Blue", 1.0));
        TASK_SECTION_DEADLINES.put(2, ordered("Blue", 1.0));
        TASK_SECTION_DEADLINES.put(3, ordered("Red", 0.5, "Green", 1.0));
        TASK_SECTION_DEADLINES.put(4, ordered("Red", 0.5, "Green", 1.0));
        TASK_SECTION_DEADLINES.put(5, ordered("Blue", 0.33, "Red", 0.67, "Green", 1.0));
    }
    public static final String[] TASK_TYPE_NAMES = {"", "Recce", "Recon", "Supply Drop", "Precision Supply", "Search & Service"};

    public static final double SESSION_DURATION = 480;
    public static final double TUTORIAL_SESSION_DURATION = 45 * 60;

    public static double lambda(String complexity) {
        return switch (complexity) {
            case "strategic" -> 37; case "tactical" -> 75; case "full" -> 48; case "quick" -> 42; default -> 62;
        };
    }

    public static double[] categoryWeights(String complexity) {
        return switch (complexity) {
            case "strategic" -> new double[]{40, 38, 16, 5, 1};
            case "tactical" -> new double[]{5, 13, 28, 38, 16};
            case "full" -> new double[]{5, 15, 28, 32, 20};
            case "quick" -> new double[]{35, 30, 20, 12, 3};
            default -> new double[]{20, 30, 28, 17, 5};
        };
    }

    public static Map<String, Double> categoryForecast(String complexity) {
        double[] f = switch (complexity) {
            case "strategic" -> new double[]{0.40, 0.38, 0.16, 0.05, 0.01};
            case "tactical" -> new double[]{0.03, 0.08, 0.22, 0.42, 0.25};
            case "full" -> new double[]{0.05, 0.15, 0.28, 0.32, 0.20};
            case "quick" -> new double[]{0.35, 0.30, 0.20, 0.12, 0.03};
            default -> new double[]{0.20, 0.30, 0.28, 0.17, 0.05};
        };
        Map<String, Double> out = new LinkedHashMap<>();
        for (int i = 0; i < 5; i++) out.put(CATEGORIES[i], f[i]);
        return out;
    }

    public static double penaltyRate(String category) {
        return switch (category) { case "A" -> 0.05; case "B" -> 0.10; case "C" -> 0.15; case "D" -> 0.25; default -> 0.40; };
    }

    public static final int[] TASK_WEIGHT = {0, 20, 40, 60, 80, 100};

    /** Game rules the interface needs for display (task values, compositions, penalty rates), so views never hard-code them. */
    public static Map<String, Object> rules() {
        Map<String, Object> r = new LinkedHashMap<>();
        Map<String, Object> tasks = new LinkedHashMap<>();
        for (int t = 1; t <= 5; t++) {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("name", TASK_TYPE_NAMES[t]);
            d.put("weight", TASK_WEIGHT[t]);
            d.put("baseTime", TASK_BASE_TIME[t]);
            d.put("primary", TASK_PRIMARY[t]);
            d.put("substitute", TASK_SUBSTITUTE[t]);
            d.put("substituteBaseTime", TASK_SUBSTITUTE[t] == null ? null : TASK_SUB_BASE_TIME[t]);
            tasks.put(String.valueOf(t), d);
        }
        r.put("tasks", tasks);
        Map<String, Object> pen = new LinkedHashMap<>();
        for (String c : CATEGORIES) pen.put(c, penaltyRate(c));
        r.put("categoryPenaltyRate", pen);
        r.put("chargeInterval", CHARGE_INTERVAL);
        r.put("zoneRadius", ZONE_RADIUS);
        return r;
    }
    public static final double CHARGE_INTERVAL = 15;
    public static final double FAILURE_RATE_PER_DRONE_SECOND = 1.0 / 900;
    public static final double FAILURE_GRACE_SECONDS = 30;
    public static final double FAILURE_ROLL_INTERVAL = 1;
    public static final double TRUST_PROBE_INTERVAL = 90;
    public static final double STATE_SNAPSHOT_INTERVAL = 10;

    public static final double CONSERVATIVE_TOP_UP = 0.15;
    public static final int CONSERVATIVE_REDUNDANCY_BUFFER = 1;
    public static final int STRATEGIC_OVER_DELTA = 3;
    public static final int TACTICAL_FAILURE_MIN_HOPS = 2, TACTICAL_FAILURE_MAX_HOPS = 4;
    public static final int FAILURE_BALANCE_BATCH_SIZE = 20;
    public static final long STRATEGIC_FAILURE_SALT = 0xba1a, TACTICAL_FAILURE_SALT = 0xba1b;
    public static final long CARD_REVEAL_MIN_MS = 4000, CARD_REVEAL_SPAN_MS = 1000;

    /** Build identifier written into session_start; the original study's build plus the HARIS port marker. */
    public static final String APP_VERSION = "study-v1.13";

    // Per scenario
    private final Map<String, Double> speed = new LinkedHashMap<>();
    private final Comp studyFleet;

    public Params(Map<String, Double> speeds, Comp studyFleet) {
        speed.put("Blue", 11.0); speed.put("Red", 10.0); speed.put("Green", 9.0);
        if (speeds != null) speed.putAll(speeds);
        this.studyFleet = studyFleet != null ? studyFleet : new Comp(11, 11, 11);
    }

    public double speed(String type) { return speed.get(type); }
    public Map<String, Double> speeds() { return speed; }

    public Comp fleet(String complexity, boolean tutorial) {
        if (tutorial) return new Comp(6, 6, 6);
        if ("quick".equals(complexity)) return new Comp(5, 5, 5);
        return studyFleet.copy();
    }

    public double travelTime(Model.Pt from, Model.Pt to, String type) {
        return JsMath.dist(from, to) / speed(type);
    }

    private static Map<String, Double> ordered(Object... kv) {
        Map<String, Double> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], (Double) kv[i + 1]);
        return m;
    }

    public static String droneLabel(String id) {
        String p = switch (id.charAt(0)) { case 'B' -> "Fast"; case 'R' -> "Lifter"; case 'G' -> "Camera"; default -> null; };
        return p == null ? id : p + "-" + Integer.parseInt(id.substring(1));
    }
}
