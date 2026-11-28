package server.strattac;

import server.strattac.Model.Blueprint;
import server.strattac.Model.Pt;

import java.util.ArrayList;
import java.util.List;

import static server.strattac.Params.*;

/** Seeded mission schedule (src/utils/missionGen.ts generateSessionPlan), draw for draw. */
public final class MissionGen {
    private MissionGen() {}

    static int[] buildTaskList(Rng rng, String category, String complexity) {
        if ("quick".equals(complexity)) {
            switch (category) {
                case "A": return rng.randFloat(0, 1) < 0.5 ? new int[]{2, 3} : new int[]{1, 3};
                case "B": return new int[]{1, 2, 3, 4};
                case "C": return new int[]{1, 2, 3, 4, 5};
                case "D": return new int[]{1, 2, 3, 4, 5, 5};
                default: return new int[]{1, 1, 2, 3, 4, 5};
            }
        }
        String a = rng.weightedChoice(new String[]{"blue", "red", "green", "mixed"}, new double[]{38, 26, 21, 15});
        switch (category) {
            case "A":
                if (a.equals("blue")) return new int[]{1, 2};
                if (a.equals("red")) return new int[]{3, 5};
                if (a.equals("green")) return new int[]{4, 5};
                return new int[]{1, 3};
            case "B":
                if (a.equals("blue")) return new int[]{1, 2, 2};
                if (a.equals("red")) return new int[]{3, 3, 5};
                if (a.equals("green")) return new int[]{1, 4, 4};
                return new int[]{1, 3, 5};
            case "C":
                if (a.equals("blue")) return new int[]{1, 1, 2, 2};
                if (a.equals("red")) return new int[]{3, 3, 5, 5};
                if (a.equals("green")) return new int[]{1, 4, 4, 4};
                return new int[]{1, 2, 3, 5};
            case "D":
                if (a.equals("blue")) return new int[]{1, 1, 2, 2, 5};
                if (a.equals("red")) return new int[]{3, 3, 3, 5, 5};
                if (a.equals("green")) return new int[]{1, 4, 4, 4, 5};
                return new int[]{1, 2, 3, 3, 5};
            default:
                if (a.equals("blue")) return new int[]{1, 1, 2, 2, 2, 5};
                if (a.equals("red")) return new int[]{3, 3, 3, 5, 5, 5};
                if (a.equals("green")) return new int[]{4, 4, 4, 1, 5, 5};
                return new int[]{1, 2, 3, 3, 4, 5};
        }
    }

    private static Pt sampleInCircle(Rng rng, double cx, double cy, double r) {
        for (;;) {
            double x = cx + rng.randFloat(-r, r);
            double y = cy + rng.randFloat(-r, r);
            if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < r * r) return new Pt(x, y);
        }
    }

    private static boolean farFromAll(Pt pt, List<Pt> existing, double minDist) {
        for (Pt e : existing) if (JsMath.hypot(pt.x - e.x, pt.y - e.y) < minDist) return false;
        return true;
    }

    private static Pt sampleInCircleNoOverlap(Rng rng, double cx, double cy, double r, List<Pt> existing, double minDist) {
        for (int attempt = 0; attempt < 250; attempt++) {
            Pt pt = sampleInCircle(rng, cx, cy, r);
            if (farFromAll(pt, existing, minDist)) return pt;
        }
        for (double d = minDist * 0.75; d >= 25; d *= 0.8) {
            for (int attempt = 0; attempt < 100; attempt++) {
                Pt pt = sampleInCircle(rng, cx, cy, r);
                if (farFromAll(pt, existing, d)) return pt;
            }
        }
        Pt best = sampleInCircle(rng, cx, cy, r);
        double bestMin = 0;
        for (int attempt = 0; attempt < 150; attempt++) {
            Pt pt = sampleInCircle(rng, cx, cy, r);
            double minD = Double.POSITIVE_INFINITY;
            for (Pt e : existing) minD = Math.min(minD, JsMath.hypot(pt.x - e.x, pt.y - e.y));
            if (minD > bestMin) { bestMin = minD; best = pt; }
        }
        return best;
    }

    private static Pt placeZone(Rng rng, List<Pt> existing) {
        double margin = Math.max(ZONE_RADIUS + 10, ZONE_EDGE_MARGIN);
        double noOverlapMin = ZONE_RADIUS * 2 + 4;
        for (int attempt = 0; attempt < 200; attempt++) {
            Pt pt = new Pt(rng.randFloat(margin, MAP_W - margin), rng.randFloat(margin, MAP_H - margin));
            if (JsMath.dist(pt, HUB) < ZONE_MIN_HUB) continue;
            if (!farFromAll(pt, existing, ZONE_MIN_ZONE)) continue;
            return pt;
        }
        for (int attempt = 0; attempt < 200; attempt++) {
            Pt pt = new Pt(rng.randFloat(margin, MAP_W - margin), rng.randFloat(margin, MAP_H - margin));
            if (JsMath.dist(pt, HUB) < ZONE_MIN_HUB) continue;
            if (!farFromAll(pt, existing, noOverlapMin)) continue;
            return pt;
        }
        // Saturated map: scan a polar grid, preferring no overlap, then overlapping the oldest zone
        final int ANGLES = 144;
        Pt bestPt = null;
        boolean bestOverlap = false;
        double bestClear = 0, bestConflict = 0;
        for (int a = 0; a < ANGLES; a++) {
            double angle = ((double) a / ANGLES) * Math.PI * 2;
            for (double rr = ZONE_MIN_HUB; rr <= 380; rr += 15) {
                Pt pt = new Pt(Math.min(MAP_W - margin, Math.max(margin, HUB.x + StrictMath.cos(angle) * rr)),
                        Math.min(MAP_H - margin, Math.max(margin, HUB.y + StrictMath.sin(angle) * rr)));
                double clearance = noOverlapMin, earliest = Double.POSITIVE_INFINITY;
                if (!existing.isEmpty()) {
                    clearance = Double.POSITIVE_INFINITY;
                    for (int idx = 0; idx < existing.size(); idx++) {
                        double d = JsMath.dist(pt, existing.get(idx));
                        if (d < clearance) clearance = d;
                        if (d < noOverlapMin && idx < earliest) earliest = idx;
                    }
                }
                boolean overlapping = earliest != Double.POSITIVE_INFINITY;
                boolean better;
                if (bestPt == null) better = true;
                else if (overlapping != bestOverlap) better = !overlapping;
                else if (!overlapping) better = clearance > bestClear;
                else if (earliest != bestConflict) better = earliest < bestConflict;
                else better = clearance > bestClear;
                if (better) { bestPt = pt; bestOverlap = overlapping; bestClear = clearance; bestConflict = earliest; }
            }
        }
        return bestPt != null ? bestPt : new Pt(HUB.x, HUB.y - ZONE_MIN_HUB - 30);
    }

    public static List<Blueprint> generateSessionPlan(Rng rng, String complexity, double duration, List<Pt> seedCenters) {
        double lambda = lambda(complexity);
        double[] catWeights = categoryWeights(complexity);
        List<Blueprint> blueprints = new ArrayList<>();
        List<Pt> used = new ArrayList<>(seedCenters);
        double time = 0;
        int seq = 0;
        while (true) {
            double interval = rng.exponential(lambda);
            int n = blueprints.size();
            double capped = n == 0 ? Math.min(interval, 3) : n <= 2 ? Math.min(interval, 60) : interval;
            time += capped;
            if (time > duration - 60) break;
            String category = rng.weightedChoice(CATEGORIES, catWeights);
            int[] taskTypes = buildTaskList(rng, category, complexity);
            Pt zone = placeZone(rng, used);
            used.add(zone);
            Blueprint bp = new Blueprint();
            for (int i = 0; i < taskTypes.length; i++)
                bp.waypoints.add(sampleInCircleNoOverlap(rng, zone.x, zone.y, ZONE_RADIUS, bp.waypoints, 50));
            bp.id = String.format("M%03d", ++seq);
            bp.arrivalTime = time;
            bp.category = category;
            bp.taskTypes = taskTypes;
            bp.zoneCenter = zone;
            blueprints.add(bp);
        }
        return blueprints;
    }
}
