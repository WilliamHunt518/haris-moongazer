package server.model.task;

import server.Simulator;
import server.model.agents.Agent;
import server.model.target.AdjustableTarget;

/**
 * Progressive-resolution scouting (the AAMAS 2023 demo, ported from the exp_ai_demo branch).
 * One task per target: an agent flies to the target, the target's image sharpens as it gets closer, and on arrival
 * the agent classifies the target itself (with the scenario's agent accuracy). The operator can classify earlier from
 * the blurrier image, which completes the task and frees the agent.
 */
public class ScoutTask extends Task {
    private final transient AdjustableTarget associatedTarget;
    private transient boolean reachedByAgent = false;

    public ScoutTask(String id, AdjustableTarget target) {
        super(id, Task.TASK_SCOUT, target.getCoordinate());
        this.associatedTarget = target;
    }

    @Override
    boolean perform() {
        for (Agent agent : getAgents()) {
            if (agent.isFinalDestinationReached()) {
                reachedByAgent = true;
                return true;
            }
        }
        return false;
    }

    @Override
    public void complete() {
        if (reachedByAgent && Simulator.instance.getScoutingController().isEnabled()) {
            Simulator.instance.getScoutingController().agentClassify(this, associatedTarget);
        }
        super.complete();
    }

    public AdjustableTarget getAssociatedTarget() {
        return associatedTarget;
    }
}
