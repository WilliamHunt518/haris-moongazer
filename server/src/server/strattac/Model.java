package server.strattac;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The study's state types (src/types/index.ts). Field names match the original so the state the browser reads and
 * the logs written for analysis have the same shape as before. Nullable numbers are boxed.
 */
public final class Model {
    private Model() {}

    public static final String[] TYPES = {"Blue", "Red", "Green"};

    public static class Pt {
        public double x, y;
        public Pt(double x, double y) { this.x = x; this.y = y; }
        public Pt copy() { return new Pt(x, y); }
    }

    /** A count per drone type (AssetRequirement / TaskComposition). */
    public static class Comp {
        public int Blue, Red, Green;
        public Comp() {}
        public Comp(int b, int r, int g) { Blue = b; Red = r; Green = g; }
        public int get(String t) {
            return switch (t) { case "Blue" -> Blue; case "Red" -> Red; default -> Green; };
        }
        public void set(String t, int v) {
            switch (t) { case "Blue" -> Blue = v; case "Red" -> Red = v; default -> Green = v; }
        }
        public void inc(String t) { set(t, get(t) + 1); }
        public Comp copy() { return new Comp(Blue, Red, Green); }
        public int total() { return Blue + Red + Green; }
        public boolean covers(Comp need) { return Blue >= need.Blue && Red >= need.Red && Green >= need.Green; }
        public boolean sameAs(Comp o) { return Blue == o.Blue && Red == o.Red && Green == o.Green; }
    }

    public static class Asset {
        public String id;
        public String type;
        public String status = "available";   // available, deployed, returning, failed
        public String currentMissionId;
        public String currentTaskId;
        public Pt position;
        public Pt travelFrom;
        public Pt targetPosition;
        public double travelStartElapsed;
        public double travelEndElapsed;
        public double availableAt;
        public Double failedAt;
        public Double replacementAt;
    }

    public static class Task {
        public String id;
        public String missionId;
        public int type;
        public String status = "pending";      // pending, traveling, executing, completed, failed
        public Pt waypoint;
        public List<String> assignedAssetIds = new ArrayList<>();
        public Double allocatedAt;
        public double travelTime;
        public double baseTime;
        public Double startTime;
        public Double completionTime;
        public boolean useSubstitute;
        public double recallDelay;
        public List<String> completedSectionTypes;

        public Task copy() {
            Task t = new Task();
            t.id = id; t.missionId = missionId; t.type = type; t.status = status; t.waypoint = waypoint;
            t.assignedAssetIds = new ArrayList<>(assignedAssetIds); t.allocatedAt = allocatedAt;
            t.travelTime = travelTime; t.baseTime = baseTime; t.startTime = startTime; t.completionTime = completionTime;
            t.useSubstitute = useSubstitute; t.recallDelay = recallDelay;
            t.completedSectionTypes = completedSectionTypes == null ? null : new ArrayList<>(completedSectionTypes);
            return t;
        }
        boolean terminal() { return "completed".equals(status) || "failed".equals(status); }
    }

    public static class PendingAllocation {
        public String strategyName;
        public Comp composition;
        public List<String> dronePool = new ArrayList<>();
        public Map<String, List<String>> taskAssignments = new LinkedHashMap<>();
        public List<String> taskOrder = new ArrayList<>();
        public double expectedCompletionTime;
        public boolean isAgentSuggested;
        public boolean isBadSuggestion;
        public String badSuggestionType;
        public boolean hasTacticalError;
        public String suppressedTaskId;
        public Map<String, List<String>> agentDroneSequences = new LinkedHashMap<>();
    }

    public static class RecoveryOption {
        public String type, label, description, taskId, newAssetId, redistributeToAssetId;
        public double expectedTimeImpact;
        public boolean feasible;
    }

    public static class Mission {
        public String id;
        public String category;
        public String status = "queued";      // queued, active, completed, failed, abandoned
        public Pt zoneCenter;
        public double zoneRadius;
        public List<Task> tasks = new ArrayList<>();
        public double arrivalTime;
        public Double allocationTime;
        public Double completionTime;
        public String agentInteraction = "none";
        public String chosenStrategyName;
        public List<String> manualPriorityIds = new ArrayList<>();
        public boolean tacticalPending;
        public PendingAllocation pendingAllocation;
        public Long tacticalOpenedAtMs;
        public Integer tacticalSuggestCount;
        public Map<String, List<String>> droneSequences = new LinkedHashMap<>();
        public int droneFailuresFired;
        public String failedDroneId;
        public boolean failureRecoveryPending;
        public String recoveryReason;
        public Long recoveryOpenedAtMs;
        public List<RecoveryOption> pendingRecoveryOptions;
        public Double failureExemptUntil;
        public String tacticallySuppressedTaskId;
        public Double abandonedAt;
        public String abandonedReason;
        public boolean isResidual;
        public boolean needsGreedyReplan;
        public Boolean strategicFailureFired;
        public String strategicFailureColour;
        public Boolean tacticalFailureFired;

        public Task task(String id) {
            for (Task t : tasks) if (t.id.equals(id)) return t;
            return null;
        }

        /** A copy whose tasks are copied too (other fields are shared until replaced). */
        public Mission copy() {
            Mission m = new Mission();
            m.id = id; m.category = category; m.status = status; m.zoneCenter = zoneCenter; m.zoneRadius = zoneRadius;
            for (Task t : tasks) m.tasks.add(t.copy());
            m.arrivalTime = arrivalTime; m.allocationTime = allocationTime; m.completionTime = completionTime;
            m.agentInteraction = agentInteraction; m.chosenStrategyName = chosenStrategyName;
            m.manualPriorityIds = new ArrayList<>(manualPriorityIds); m.tacticalPending = tacticalPending;
            m.pendingAllocation = pendingAllocation; m.tacticalOpenedAtMs = tacticalOpenedAtMs;
            m.tacticalSuggestCount = tacticalSuggestCount; m.droneSequences = new LinkedHashMap<>(droneSequences);
            m.droneFailuresFired = droneFailuresFired; m.failedDroneId = failedDroneId;
            m.failureRecoveryPending = failureRecoveryPending; m.recoveryReason = recoveryReason;
            m.recoveryOpenedAtMs = recoveryOpenedAtMs; m.pendingRecoveryOptions = pendingRecoveryOptions;
            m.failureExemptUntil = failureExemptUntil; m.tacticallySuppressedTaskId = tacticallySuppressedTaskId;
            m.abandonedAt = abandonedAt; m.abandonedReason = abandonedReason; m.isResidual = isResidual;
            m.needsGreedyReplan = needsGreedyReplan; m.strategicFailureFired = strategicFailureFired;
            m.strategicFailureColour = strategicFailureColour; m.tacticalFailureFired = tacticalFailureFired;
            return m;
        }
    }

    public static class TaskComp {
        public int Blue, Red, Green;
        public double baseTime;
        public boolean useSubstitute;
    }

    public static class Strategy {
        public String name, description;
        public Comp assets;
        public double expectedCompletionTime;
        public Comp reserveAfter;
        public double speedScore, reserveScore, redundancyScore;
        public Comp minimumAssets;
        public Map<String, TaskComp> taskComps;
        public boolean isBadSuggestion;
        public String badSuggestionType;
        public String badSuggestionColour;
        public Comp trueAssets;
        public Map<String, TaskComp> trueTaskComps;
    }

    public static class StrategicModal {
        public String missionId;
        public List<Strategy> strategies = new ArrayList<>();
        public Integer selectedStrategyIndex;
        public Comp manualAllocation;
        public long openedAtMs;
        public List<Long> cardRevealDelaysMs = new ArrayList<>();
    }

    public static class Blueprint {
        public String id;
        public double arrivalTime;
        public String category;
        public int[] taskTypes;
        public Pt zoneCenter;
        public List<Pt> waypoints = new ArrayList<>();
    }

    public static class BalancedRollState {
        public boolean[] queue = new boolean[0];
        public int index;
        public int batchNumber;
    }
}
