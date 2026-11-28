package server.strattac;

import server.strattac.Model.Comp;
import server.strattac.Model.Pt;
import server.strattac.Model.Strategy;
import server.strattac.Model.Task;
import server.strattac.Model.TaskComp;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static server.strattac.Params.*;

/** The Strategic Assistant (src/utils/copilot.ts): Aggressive and Conservative drone-count cards. */
public final class Copilot {
    private Copilot() {}

    record TC(Comp comp, double baseTime) {}

    private static class VT {
        final String type; double freeAt; Pt pos;
        VT(String type) { this.type = type; this.freeAt = 0; this.pos = HUB.copy(); }
    }

    private static List<VT> pickEarliest(List<VT> tokens, String type, int n) {
        List<VT> c = new ArrayList<>();
        for (VT v : tokens) if (v.type.equals(type)) c.add(v);
        c.sort(Comparator.comparingDouble(v -> v.freeAt));
        return c.subList(0, Math.min(n, c.size()));
    }

    static double simulatePool(Params p, List<Task> tasks, Map<String, TC> comps, Comp pool) {
        List<VT> tokens = new ArrayList<>();
        for (int i = 0; i < pool.Blue; i++) tokens.add(new VT("Blue"));
        for (int i = 0; i < pool.Red; i++) tokens.add(new VT("Red"));
        for (int i = 0; i < pool.Green; i++) tokens.add(new VT("Green"));
        double maxTime = 0;
        for (Task task : tasks) {
            TC c = comps.get(task.id);
            if (c == null || c.comp.total() == 0) continue;
            if (pool.Blue < c.comp.Blue || pool.Red < c.comp.Red || pool.Green < c.comp.Green) return Double.POSITIVE_INFINITY;
            List<VT> picked = new ArrayList<>();
            picked.addAll(pickEarliest(tokens, "Blue", c.comp.Blue));
            picked.addAll(pickEarliest(tokens, "Red", c.comp.Red));
            picked.addAll(pickEarliest(tokens, "Green", c.comp.Green));
            double start = picked.isEmpty() ? 0 : Double.NEGATIVE_INFINITY;
            for (VT v : picked) start = Math.max(start, v.freeAt + p.travelTime(v.pos, task.waypoint, v.type));
            double end = start + c.baseTime;
            if (end > maxTime) maxTime = end;
            for (VT v : picked) { v.freeAt = end; v.pos = task.waypoint.copy(); }
        }
        return maxTime;
    }

    private static Comp cap(Comp pool, Comp reserve) {
        return new Comp(Math.min(pool.Blue, reserve.Blue), Math.min(pool.Red, reserve.Red), Math.min(pool.Green, reserve.Green));
    }

    private static Comp floorOf(List<Task> tasks, Map<String, TC> comps) {
        Comp f = new Comp();
        for (Task t : tasks) {
            TC c = comps.get(t.id);
            if (c == null) continue;
            f.Blue = Math.max(f.Blue, c.comp.Blue); f.Red = Math.max(f.Red, c.comp.Red); f.Green = Math.max(f.Green, c.comp.Green);
        }
        return f;
    }

    private static Map<String, TaskComp> toTaskComps(List<Task> tasks, Map<String, TC> comps, Map<String, TC> prim) {
        Map<String, TaskComp> out = new LinkedHashMap<>();
        for (Task t : tasks) {
            TC c = comps.get(t.id), pc = prim.get(t.id);
            TaskComp tc = new TaskComp();
            tc.Blue = c.comp.Blue; tc.Red = c.comp.Red; tc.Green = c.comp.Green; tc.baseTime = c.baseTime;
            tc.useSubstitute = !c.comp.sameAs(pc.comp);
            out.put(t.id, tc);
        }
        return out;
    }

    private static List<Task> sortedByTypeDesc(List<Task> tasks) {
        List<Task> s = new ArrayList<>(tasks);
        s.sort((a, b) -> b.type - a.type);
        return s;
    }

    private static double redundancy(Comp pool, Comp floor) {
        int total = pool.total();
        if (total == 0) return 0;
        int buffer = Math.max(0, pool.Blue - floor.Blue) + Math.max(0, pool.Red - floor.Red) + Math.max(0, pool.Green - floor.Green);
        return Math.min(1, (double) buffer / total);
    }

    private record Trial(Comp badPool, String colour) {}

    private static Comp tryColour(Comp truePool, Comp floor, Comp reserve, String type, String colour) {
        Comp bad = truePool.copy();
        if (type.equals("over")) bad.set(colour, Math.min(reserve.get(colour), truePool.get(colour) + STRATEGIC_OVER_DELTA));
        else {
            if (floor.get(colour) <= 0) return null;
            bad.set(colour, Math.max(floor.get(colour), truePool.get(colour) - 1));
        }
        return bad.get(colour) != truePool.get(colour) ? bad : null;
    }

    private static Trial pickImpactful(Comp truePool, Comp floor, Comp reserve, String type, String preferred) {
        List<String> order = new ArrayList<>();
        order.add(preferred);
        for (String t : Model.TYPES) if (!t.equals(preferred)) order.add(t);
        for (String c : order) {
            Comp bad = tryColour(truePool, floor, reserve, type, c);
            if (bad != null) return new Trial(bad, c);
        }
        return null;
    }

    private static double clamp01(double n) {
        return Double.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
    }

    /**
     * @param fires   whether the epsilon-Strategic failure fires for this mission (drawn by the caller)
     * @param colour  the colour it prefers to corrupt
     */
    public static List<Strategy> generateStrategies(Params p, List<Task> tasks, Comp reserve, boolean fires, String colour) {
        List<Task> sorted = sortedByTypeDesc(tasks);
        Map<String, TC> prim = new LinkedHashMap<>();
        for (Task t : sorted) prim.put(t.id, new TC(TASK_PRIMARY[t.type], TASK_BASE_TIME[t.type]));

        Comp aggFloor = floorOf(sorted, prim);
        Comp parallel = new Comp();
        for (Task t : sorted) {
            Comp c = prim.get(t.id).comp;
            parallel.Blue += c.Blue; parallel.Red += c.Red; parallel.Green += c.Green;
        }
        Comp aggWith = new Comp(
                aggFloor.Blue > 0 ? Math.max(parallel.Blue, aggFloor.Blue + 1) : 0,
                aggFloor.Red > 0 ? Math.max(parallel.Red, aggFloor.Red + 1) : 0,
                aggFloor.Green > 0 ? Math.max(parallel.Green, aggFloor.Green + 1) : 0);
        Comp aggTruePool = cap(aggWith, reserve);
        double aggTrueTime = simulatePool(p, sorted, prim, aggTruePool);
        Map<String, TaskComp> aggTaskComps = toTaskComps(sorted, prim, prim);

        Map<String, TC> cons = new LinkedHashMap<>();
        for (Task t : sorted) {
            Comp pr = TASK_PRIMARY[t.type], sub = TASK_SUBSTITUTE[t.type];
            boolean lacks = reserve.Blue < pr.Blue || reserve.Red < pr.Red || reserve.Green < pr.Green;
            if (lacks && sub != null) cons.put(t.id, new TC(sub, TASK_SUB_BASE_TIME[t.type]));
            else cons.put(t.id, new TC(pr, TASK_BASE_TIME[t.type]));
        }
        Comp consBase = cap(floorOf(sorted, cons), reserve);
        Comp consTruePool = new Comp();
        for (String ty : Model.TYPES) {
            int base = consBase.get(ty);
            consTruePool.set(ty, Math.min(reserve.get(ty),
                    base + (int) Math.floor((reserve.get(ty) - base) * CONSERVATIVE_TOP_UP) + (base > 0 ? CONSERVATIVE_REDUNDANCY_BUFFER : 0)));
        }
        double consTrueTime = simulatePool(p, sorted, cons, consTruePool);
        Map<String, TaskComp> consTaskComps = toTaskComps(sorted, cons, prim);
        Comp consFloor = floorOf(sorted, cons);

        Trial aggTrial = fires ? pickImpactful(aggTruePool, aggFloor, reserve, "over", colour) : null;
        Trial consTrial = fires ? pickImpactful(consTruePool, consFloor, reserve, "under", colour) : null;
        boolean both = aggTrial != null && consTrial != null;

        Strategy agg = card(p, sorted, "Aggressive",
                "Maximum parallel deployment — all tasks run simultaneously for minimum mission time. At least one spare drone per type deployed as a failure buffer.",
                aggTruePool, aggTrueTime, both ? aggTrial : null, prim, "over", aggFloor, aggTaskComps);
        Strategy con = card(p, sorted, "Conservative",
                "Failure-tolerant deployment — commits a spare of every type used, above the minimum needed, so one drone loss cannot stall the mission. Tasks run mostly in series.",
                consTruePool, consTrueTime, both ? consTrial : null, cons, "under", consFloor, consTaskComps);

        // Scores are relative to the faster displayed card and to the reserve
        double best = Double.POSITIVE_INFINITY;
        for (double t : new double[]{agg.expectedCompletionTime, con.expectedCompletionTime})
            if (t > 0 && t < Double.POSITIVE_INFINITY) best = Math.min(best, t);
        if (best == Double.POSITIVE_INFINITY) best = 0;
        int reserveTotal = reserve.total();
        List<Strategy> out = new ArrayList<>();
        for (Strategy s : new Strategy[]{agg, con}) {
            double t = s.expectedCompletionTime;
            s.speedScore = best > 0 && t > 0 && t < Double.POSITIVE_INFINITY ? clamp01(best / t) : 0;
            s.reserveAfter = reserveAfter(reserve, s.assets);
            s.reserveScore = reserveTotal <= 0 ? 0 : clamp01((double) s.reserveAfter.total() / reserveTotal);
        }
        if (aggTrueTime < Double.POSITIVE_INFINITY) out.add(agg);
        if (consTrueTime < Double.POSITIVE_INFINITY) out.add(con);
        return out;
    }

    private static Strategy card(Params p, List<Task> sorted, String name, String desc, Comp truePool, double trueTime,
                                 Trial trial, Map<String, TC> comps, String type, Comp floor, Map<String, TaskComp> taskComps) {
        Strategy s = new Strategy();
        s.name = name;
        s.description = desc;
        if (trial == null) {
            s.assets = truePool.copy();
            s.expectedCompletionTime = trueTime;
            s.trueAssets = truePool.copy();
        } else {
            double raw = simulatePool(p, sorted, comps, trial.badPool);
            s.assets = trial.badPool;
            s.expectedCompletionTime = raw < Double.POSITIVE_INFINITY ? raw : trueTime;
            s.trueAssets = trial.badPool.copy();
            s.isBadSuggestion = true;
            s.badSuggestionType = type;
            s.badSuggestionColour = trial.colour;
        }
        s.redundancyScore = redundancy(s.assets, floor);
        s.minimumAssets = floor;
        s.taskComps = taskComps;
        s.trueTaskComps = taskComps;
        return s;
    }

    private static Comp reserveAfter(Comp reserve, Comp a) {
        return new Comp(Math.max(0, reserve.Blue - a.Blue), Math.max(0, reserve.Red - a.Red), Math.max(0, reserve.Green - a.Green));
    }

    /** ETA for a manually chosen pool (the manual picker's preview); infinity if it cannot cover every task. */
    public static double previewAllocation(Params p, List<Task> tasks, Comp pool) {
        Map<String, TC> comps = new LinkedHashMap<>();
        for (Task t : tasks) {
            Comp pr = TASK_PRIMARY[t.type], sub = TASK_SUBSTITUTE[t.type];
            if (pool.covers(pr)) comps.put(t.id, new TC(pr, TASK_BASE_TIME[t.type]));
            else if (sub != null && pool.covers(sub)) comps.put(t.id, new TC(sub, TASK_SUB_BASE_TIME[t.type]));
            else return Double.POSITIVE_INFINITY;
        }
        if (comps.isEmpty()) return 0;
        return simulatePool(p, sortedByTypeDesc(tasks), comps, pool);
    }
}
