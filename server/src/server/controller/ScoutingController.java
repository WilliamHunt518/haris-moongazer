package server.controller;

import server.Simulator;
import server.model.agents.Agent;
import server.model.target.AdjustableTarget;
import server.model.target.Target;
import server.model.task.ScoutTask;
import server.model.task.Task;

import java.text.DecimalFormat;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Progressive-resolution scouting, the AAMAS 2023 "Demonstrating Performance Benefits of Human-Swarm Teaming" demo
 * (Will Hunt, ported from the exp_ai_demo branch). Turned on by a "scouting" block in the scenario.
 *
 * Every target gets a {@link ScoutTask}. Free agents are continuously re-allocated and, when there are more agents than
 * tasks, doubled up on tasks (saturating). As an agent closes in, the target's image sharpens from level
 * {@code maxLevel} to 0 ({@code metresPerLevel} per level). The operator can classify a target early from the review
 * panel; otherwise the agent classifies it on arrival, correctly with probability {@code agentAccuracy}.
 * Score: correct finds per minute x accuracy x 100, as in the demo.
 */
public class ScoutingController extends AbstractController {

    private boolean enabled = false;
    private double agentAccuracy = 0.8;
    private double metresPerLevel = 50;
    private int maxLevel = 9;

    private int totalTargets = 0;
    private int correct = 0;
    private int classified = 0;
    private int byAgent = 0;
    private int byOperator = 0;
    private final Map<String, Map<String, Object>> results = new LinkedHashMap<>();
    private boolean finished = false;

    public ScoutingController(Simulator simulator) {
        super(simulator, ScoutingController.class.getName());
    }

    /** Clears the current run. The last finished result stays in the state until another scenario is loaded. */
    public void reset() {
        enabled = false;
        agentAccuracy = 0.8;
        metresPerLevel = 50;
        maxLevel = 9;
        totalTargets = 0;
        correct = 0;
        classified = 0;
        byAgent = 0;
        byOperator = 0;
        results.clear();
        finished = false;
    }

    public void configure(Map<String, Object> config) {
        enabled = true;
        if (config != null) {
            if (config.get("agentAccuracy") instanceof Double d) agentAccuracy = d;
            if (config.get("metresPerLevel") instanceof Double d) metresPerLevel = d;
            if (config.get("maxLevel") instanceof Double d) maxLevel = d.intValue();
            if (config.get("agentSpeed") instanceof Double d) {
                // Metres per second for every agent, so the demo's pace doesn't depend on the engine default
                simulator.getState().getAgents().forEach(a -> a.setSpeed(d));
            }
        }
        LOGGER.info(String.format("%s; SCCFG; Scouting configured (agentAccuracy, metresPerLevel, maxLevel); %s; %s; %s",
                simulator.getState().getTime(), agentAccuracy, metresPerLevel, maxLevel));
        publish();
    }

    public boolean isEnabled() {
        return enabled;
    }

    /** Called for each target while the scenario loads: makes it visible, queues its image and creates its task. */
    public void addTarget(AdjustableTarget target) {
        totalTargets++;
        target.setResolutionLevel(maxLevel);
        simulator.getState().addToStoredImages(target.getId(), "images/" + target.getHighResFileName(), false);
        Task task = new ScoutTask(simulator.getTaskController().generateTaskId(), target);
        simulator.getState().add(task);
        publish();
    }

    /** Every tick: sharpen each target's image according to the distance of its nearest assigned agent. */
    public void step() {
        if (!enabled) return;
        synchronized (simulator.getState().getTasks()) {
            for (Task t : simulator.getState().getTasks()) {
                if (t instanceof ScoutTask st && !st.getAgents().isEmpty()) {
                    double nearest = Double.MAX_VALUE;
                    for (Agent a : st.getAgents()) {
                        nearest = Math.min(nearest, st.getCoordinate().getDistance(a.getCoordinate()));
                    }
                    int level = Math.min((int) Math.floor(nearest / metresPerLevel), maxLevel);
                    // Images only ever get sharper
                    if (level < st.getAssociatedTarget().getResolutionLevel()) {
                        st.getAssociatedTarget().setResolutionLevel(level);
                    }
                }
            }
        }
    }

    /** An agent reached its target and classifies it itself. */
    public void agentClassify(ScoutTask task, AdjustableTarget target) {
        if (!simulator.getState().getTargets().contains(target)) return;
        boolean answer = simulator.getRandom().nextDouble() < agentAccuracy ? target.isReal() : !target.isReal();
        LOGGER.info(String.format("%s; AGCLA; Agent classified target on arrival (taskId, targetId, classifiedStatus, actualStatus); %s; %s; %s; %s",
                simulator.getState().getTime(), task.getId(), target.getId(), answer, target.isReal()));
        record(target, answer, "agent");
        simulator.getState().getStoredImages().remove(target.getId());
        simulator.getTargetController().deleteTarget(target.getId());
    }

    /** The operator classified a target from the review panel (ImageController.classify does the rest). */
    public void operatorClassify(Target target, boolean answer) {
        if (target instanceof AdjustableTarget at) {
            record(at, answer, "operator");
        }
    }

    private void record(AdjustableTarget target, boolean answer, String by) {
        boolean isCorrect = answer == target.isReal();
        classified++;
        if (isCorrect) correct++;
        if (by.equals("agent")) byAgent++; else byOperator++;
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("status", answer);
        r.put("by", by);
        r.put("level", target.getResolutionLevel());
        results.put(target.getId(), r);
        publish();
    }

    private Map<String, Object> summary() {
        double minutes = Math.max(simulator.getState().getTime(), 1e-6) / 60.0;
        if (simulator.getState().getTimeLimit() > 0) {
            minutes = Math.min(minutes, simulator.getState().getTimeLimit() / 60.0);
        }
        double perMinute = correct / minutes;
        double accuracy = classified == 0 ? 0 : (double) correct / classified;
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("total", totalTargets);
        s.put("classified", classified);
        s.put("correct", correct);
        s.put("byAgent", byAgent);
        s.put("byOperator", byOperator);
        s.put("perMinute", round(perMinute, 2));
        s.put("accuracy", round(accuracy, 2));
        s.put("points", Math.round(100 * perMinute * accuracy));
        s.put("results", new LinkedHashMap<>(results));
        return s;
    }

    private void publish() {
        simulator.getState().setScouting(enabled ? summary() : null);
    }

    /** End of the run (time limit or all targets done): log the demo score and keep it for the end panel. */
    public void finish() {
        if (!enabled || finished) return;
        finished = true;
        Map<String, Object> s = summary();
        DecimalFormat df = new DecimalFormat("#.##");
        LOGGER.info(String.format("%s; DEMOSCORE; Recording (name, correct/total, tgt/min, accuracy, pts); %s; %s/%s; %s; %s; %s",
                simulator.getState().getTime(), simulator.getState().getUserName(), correct, totalTargets,
                df.format(s.get("perMinute")), df.format(s.get("accuracy")), s.get("points")));
        simulator.getState().setLastScoutResult(s);
    }

    private static double round(double v, int dp) {
        double f = Math.pow(10, dp);
        return Math.round(v * f) / f;
    }
}
