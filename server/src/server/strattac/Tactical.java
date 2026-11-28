package server.strattac;

import server.strattac.Model.Asset;
import server.strattac.Model.BalancedRollState;
import server.strattac.Model.Comp;
import server.strattac.Model.Mission;
import server.strattac.Model.Pt;
import server.strattac.Model.Task;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static server.strattac.Params.*;

/**
 * The Tactical Assistant and the planning helpers shared with the planner (src/utils/tacticalSuggest.ts,
 * scheduling.ts, coverage.ts, balancedRoll.ts).
 */
public final class Tactical {
    private Tactical() {}

    // ── Coverage ─────────────────────────────────────────────────────────────

    public static Comp countByType(List<Asset> pool) {
        Comp c = new Comp();
        for (Asset a : pool) c.inc(a.type);
        return c;
    }

    public static boolean taskCoverableBy(Task task, List<Asset> pool) {
        Comp counts = countByType(pool);
        Comp sub = TASK_SUBSTITUTE[task.type];
        return counts.covers(TASK_PRIMARY[task.type]) || (sub != null && counts.covers(sub));
    }

    // ── Suggest ──────────────────────────────────────────────────────────────

    /** Earliest-free assignment of the pool to the tasks in order (computeTacticalSuggestion). */
    public static Map<String, List<String>> computeTacticalSuggestion(Params p, List<String> dronePool, List<String> taskOrder,
                                                                       List<Task> tasks, List<Asset> assets,
                                                                       boolean greedy, boolean useLivePositions) {
        Map<String, Asset> byId = new HashMap<>();
        for (Asset a : assets) byId.put(a.id, a);
        Map<String, Double> freeAt = new HashMap<>();
        Map<String, Pt> freePos = new HashMap<>();
        for (String id : dronePool) {
            freeAt.put(id, 0.0);
            Asset a = byId.get(id);
            freePos.put(id, useLivePositions && a != null && "deployed".equals(a.status) ? a.position.copy() : HUB.copy());
        }
        Map<String, List<String>> result = new LinkedHashMap<>();
        Set<String> used = new LinkedHashSet<>();
        for (String tid : taskOrder) {
            Task task = null;
            for (Task t : tasks) if (t.id.equals(tid)) { task = t; break; }
            if (task == null) continue;
            final Task tk = task;
            java.util.function.ToDoubleFunction<String> arrivalAt = id -> {
                Asset a = byId.get(id);
                if (a == null) return Double.POSITIVE_INFINITY;
                return freeAt.get(id) + JsMath.dist(freePos.get(id), tk.waypoint) / p.speed(a.type);
            };
            java.util.function.BiFunction<Comp, Double, Boolean> tryAssign = (req, baseTime) -> {
                List<String> picked = new ArrayList<>();
                for (String type : Model.TYPES) {
                    List<String> cands = new ArrayList<>();
                    for (String id : dronePool) {
                        Asset a = byId.get(id);
                        if (a != null && a.type.equals(type) && (!greedy || !used.contains(id))) cands.add(id);
                    }
                    if (useLivePositions) cands.sort((x, y) -> Double.compare(arrivalAt.applyAsDouble(x), arrivalAt.applyAsDouble(y)));
                    else cands.sort((x, y) -> Double.compare(freeAt.get(x), freeAt.get(y)));
                    int n = req.get(type);
                    if (cands.size() < n) return false;
                    picked.addAll(cands.subList(0, n));
                }
                double start = Double.NEGATIVE_INFINITY;
                for (String id : picked) {
                    Asset a = byId.get(id);
                    start = Math.max(start, freeAt.get(id) + JsMath.dist(freePos.get(id), tk.waypoint) / p.speed(a.type));
                }
                for (String id : picked) {
                    freeAt.put(id, start + baseTime);
                    freePos.put(id, tk.waypoint.copy());
                    if (greedy) used.add(id);
                }
                result.put(tid, picked);
                return true;
            };
            if (!tryAssign.apply(TASK_PRIMARY[task.type], TASK_BASE_TIME[task.type])) {
                Comp sub = TASK_SUBSTITUTE[task.type];
                if (sub != null) tryAssign.apply(sub, TASK_SUB_BASE_TIME[task.type]);
            }
        }
        return result;
    }

    /**
     * Recovery Suggest: re-plan only the pending tasks the live plan leaves short, from the mission's drones that
     * are not executing a task, using their live positions.
     */
    public static Map<String, List<String>> computeRecoverySuggestion(Params p, Mission mission, List<String> dronePool,
                                                                      List<String> taskOrder, List<Asset> assets,
                                                                      Map<String, List<String>> current) {
        Map<String, Asset> byId = new HashMap<>();
        for (Asset a : assets) byId.put(a.id, a);
        List<String> shortTasks = new ArrayList<>();
        for (String tid : taskOrder) {
            Task t = mission.task(tid);
            if (t == null || !"pending".equals(t.status)) continue;
            List<Asset> held = new ArrayList<>();
            for (String id : current.getOrDefault(tid, List.of())) if (byId.containsKey(id)) held.add(byId.get(id));
            if (!taskCoverableBy(t, held)) shortTasks.add(tid);
        }
        if (shortTasks.isEmpty()) return new LinkedHashMap<>();
        List<String> pool = new ArrayList<>();
        for (String id : dronePool) {
            Asset a = byId.get(id);
            if (a == null) continue;
            if (a.currentTaskId == null) { pool.add(id); continue; }
            Task t = mission.task(a.currentTaskId);
            if (t == null || !"executing".equals(t.status)) pool.add(id);
        }
        return computeTacticalSuggestion(p, pool, shortTasks, mission.tasks, assets, false, true);
    }

    // ── epsilon-Tactical route failure ───────────────────────────────────────

    public record FailurePlan(Map<String, List<String>> taskAssignments, Map<String, List<String>> droneSequences) {}

    public static FailurePlan buildTacticalFailurePlan(List<Task> tasks, Map<String, List<String>> taskAssignments, Rng rng) {
        List<String> taskIds = new ArrayList<>();
        for (Task t : tasks) taskIds.add(t.id);
        if (taskIds.isEmpty()) return new FailurePlan(taskAssignments, new LinkedHashMap<>());
        Map<String, List<String>> realByDrone = new LinkedHashMap<>();
        for (String tid : taskIds)
            for (String d : taskAssignments.getOrDefault(tid, List.of()))
                realByDrone.computeIfAbsent(d, k -> new ArrayList<>()).add(tid);
        Map<String, List<String>> augmented = new LinkedHashMap<>();
        for (Map.Entry<String, List<String>> e : taskAssignments.entrySet()) augmented.put(e.getKey(), new ArrayList<>(e.getValue()));
        Map<String, List<String>> seqs = new LinkedHashMap<>();
        for (Map.Entry<String, List<String>> e : realByDrone.entrySet()) {
            String drone = e.getKey();
            List<String> real = e.getValue();
            int steps = rng.randInt(TACTICAL_FAILURE_MIN_HOPS, TACTICAL_FAILURE_MAX_HOPS + 1);
            Set<String> realSet = new LinkedHashSet<>(real);
            List<String> first = new ArrayList<>();
            for (String t : taskIds) if (!realSet.contains(t)) first.add(t);
            if (first.isEmpty()) { seqs.put(drone, new ArrayList<>(real)); continue; }
            String f = first.get(rng.randInt(0, first.size()));
            List<String> later = new ArrayList<>();
            for (String t : taskIds) if (!t.equals(f) && !realSet.contains(t)) later.add(t);
            List<String> detours = new ArrayList<>();
            detours.add(f);
            for (int i = 1; i < steps; i++) {
                if (later.isEmpty()) break;
                detours.add(later.get(rng.randInt(0, later.size())));
            }
            List<String> held = augmented.computeIfAbsent(f, k -> new ArrayList<>());
            if (!held.contains(drone)) held.add(drone);
            List<String> seq = new ArrayList<>(detours);
            seq.addAll(real);
            seqs.put(drone, seq);
        }
        return new FailurePlan(augmented, seqs);
    }

    // ── Scheduling cycles ────────────────────────────────────────────────────

    private static Map<String, Set<String>> dependencyGraph(Map<String, List<String>> ta, Map<String, List<String>> seqs) {
        Map<String, Set<String>> g = new LinkedHashMap<>();
        for (String tid : ta.keySet()) g.computeIfAbsent(tid, k -> new LinkedHashSet<>());
        for (List<String> seq : seqs.values()) {
            for (int i = 1; i < seq.size(); i++) {
                g.computeIfAbsent(seq.get(i - 1), k -> new LinkedHashSet<>());
                g.computeIfAbsent(seq.get(i), k -> new LinkedHashSet<>());
                g.get(seq.get(i - 1)).add(seq.get(i));
            }
        }
        return g;
    }

    /** Tasks lying on some dependency cycle (each can reach itself). */
    public static Set<String> tasksInCycles(Map<String, List<String>> ta, Map<String, List<String>> seqs) {
        Map<String, Set<String>> g = dependencyGraph(ta, seqs);
        Set<String> result = new LinkedHashSet<>();
        for (String start : g.keySet()) {
            Set<String> seen = new LinkedHashSet<>();
            Deque<String> stack = new ArrayDeque<>(g.get(start));
            while (!stack.isEmpty()) {
                String n = stack.pollLast();
                if (n.equals(start)) { result.add(start); break; }
                if (!seen.add(n)) continue;
                for (String m : g.getOrDefault(n, Set.of())) stack.addLast(m);
            }
        }
        return result;
    }

    /** The tasks of one dependency cycle in cycle order, or null if the plan is acyclic. */
    public static List<String> findSchedulingCycle(Map<String, List<String>> ta, Map<String, List<String>> seqs) {
        Map<String, Set<String>> g = dependencyGraph(ta, seqs);
        Map<String, Integer> colour = new HashMap<>();
        List<String> path = new ArrayList<>();
        List<String>[] cycle = new List[1];
        for (String node : g.keySet())
            if (colour.getOrDefault(node, 0) == 0 && dfs(node, g, colour, path, cycle)) return cycle[0];
        return null;
    }

    private static boolean dfs(String node, Map<String, Set<String>> g, Map<String, Integer> colour, List<String> path, List<String>[] cycle) {
        colour.put(node, 1);
        path.add(node);
        for (String next : g.getOrDefault(node, Set.of())) {
            int c = colour.getOrDefault(next, 0);
            if (c == 1) {
                cycle[0] = new ArrayList<>(path.subList(path.indexOf(next), path.size()));
                return true;
            }
            if (c == 0 && dfs(next, g, colour, path, cycle)) return true;
        }
        path.remove(path.size() - 1);
        colour.put(node, 2);
        return false;
    }

    // ── Balanced failure draws ───────────────────────────────────────────────

    /** Draws whether the next check fires, from a shuffled batch with exactly round(epsilon x batch) hits. */
    public static boolean drawBalancedRoll(BalancedRollState st, double epsilon, long seed, long salt) {
        if (epsilon <= 0) return false;
        if (st.index >= st.queue.length) {
            int size = FAILURE_BALANCE_BATCH_SIZE;
            long hits = JsMath.round(epsilon * size);
            boolean[] batch = new boolean[size];
            for (int i = 0; i < size; i++) batch[i] = i < hits;
            Rng rng = new Rng(Rng.u32(seed ^ salt ^ Rng.imul(st.batchNumber + 1, 0x9e3779b1L)));
            for (int i = batch.length - 1; i > 0; i--) {
                int j = rng.randInt(0, i + 1);
                boolean tmp = batch[i]; batch[i] = batch[j]; batch[j] = tmp;
            }
            st.queue = batch;
            st.index = 0;
            st.batchNumber++;
        }
        return st.queue[st.index++];
    }
}
