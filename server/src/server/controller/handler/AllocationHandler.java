package server.controller.handler;

import server.Simulator;
import server.model.agents.Agent;
import server.model.task.Task;
import tool.HttpServer.Request;
import tool.HttpServer.Response;

import java.io.IOException;
import java.util.*;
import java.util.logging.FileHandler;

/**
 * Rest handler for the allocation
 */
public class AllocationHandler extends RestHandler {

    public AllocationHandler(String handlerName, Simulator simulator) {
        super(handlerName, simulator);
    }

    @Override
    public void handlePost(Request req, Response resp) throws IOException, UnregisteredPathException {
        switch(parseId(req.getPath())) {
            case "auto-allocate":
                handleAutoAllocate(resp);
                break;
            case "confirm":
                handleConfirm(resp);
                break;
            case "allocate":
                handleAllocate(req, resp);
                break;
            case "groupAllocate":
                handleGroupAllocate(req, resp);
                break;
            case "teamAllocate":
                handleTeamAllocate(req, resp);
                break;
            case "restore":
                handleRestore(req, resp);
                break;
            case "undo":
                handleUndo(resp);
                break;
            case "redo":
                handleRedo(resp);
                break;
            case "reset":
                handleReset(resp);
                break;
            default:
                throw new UnregisteredPathException("No method for handling POST request on " + req.getPath());
        }
    }

    @Override
    public void handleDelete(Request req, Response resp) throws IOException {
        String id = parseId(req.getPath());
        if (!agentExists(id, resp))
            return;
        simulator.getAllocator().removeFromTempAllocation(id);
        resp.sendOkay();
    }

    private void handleAutoAllocate(Response resp) throws IOException {
        LOGGER.info(String.format("%s; ALRUN; Running auto allocation;", Simulator.instance.getState().getTime()));
        simulator.getAllocator().runAutoAllocation();
        LOGGER.info(String.format("%s; FNRUN; Finished auto allocation;", Simulator.instance.getState().getTime()));
        resp.sendOkay();
    }

    private void handleConfirm(Response resp) throws IOException {
        simulator.getAllocator().confirmAllocation(simulator.getState().getTempAllocation());
        resp.sendOkay();
    }

    private void handleAllocate(Request req, Response resp) throws IOException {
        Map<String, String> params = req.getParams();
        List<String> expectedKeys = Arrays.asList("agentId", "taskId");
        if (!checkParams(params, expectedKeys, resp))
            return;
        String agentId = params.get("agentId");
        if(!agentExists(agentId, resp))
            return;
        String taskId = params.get("taskId");
        if(!taskExists(taskId, resp))
            return;
        simulator.getAllocator().putInTempAllocation(agentId, taskId);
        // TODO Temp workaround for demo is to lock in groups as unchangeable
        //simulator.getState().getAgent(agentId).setAgentTeam(new ArrayList<>(Collections.singleton(agentId)));
        simulator.getAllocator().confirmAllocation(simulator.getState().getTempAllocation());
        resp.sendOkay();
    }

    /**
     * Assign a group of agents to a group of tasks (the heatmap drag). Takes agentIds plus either taskIds
     * (original heatmap) or taskGroupIndex (exp_fastpi team heatmap: every task in that spawn batch).
     */
    private void handleGroupAllocate(Request req, Response resp) throws IOException {
        Map<String, String> params = req.getParams();
        boolean byGroup = params.containsKey("taskGroupIndex");
        List<String> expectedKeys = byGroup ? Arrays.asList("agentIds", "taskGroupIndex") : Arrays.asList("agentIds", "taskIds");

        if (!checkParams(params, expectedKeys, resp))
            return;

        List<Agent> agentIdsAsArray = new ArrayList<>();
        Arrays.stream(params.get("agentIds").split(",")).forEach(a -> agentIdsAsArray.add(Simulator.instance.getState().getAgent(a)));

        List<Task> taskIdsAsArray = new ArrayList<>();
        if (byGroup) {
            int taskGroup = Integer.parseInt(params.get("taskGroupIndex"));
            simulator.getState().getTasks().stream().filter(t -> t.getTaskGroup() == taskGroup).forEach(taskIdsAsArray::add);
        } else {
            Arrays.stream(params.get("taskIds").split(",")).forEach(t -> taskIdsAsArray.add(Simulator.instance.getState().getTask(t)));
        }

        simulator.getAllocator().dynamicRandomAssignSubgroup(agentIdsAsArray, taskIdsAsArray);
        simulator.getAllocator().confirmAllocation(simulator.getState().getTempAllocation());

        resp.sendOkay();
    }

    /**
     * Allocation lens: send a team to a mission, given as taskGroup (spawn batch) or taskIds; neither releases it. The team fills the mission's uncovered tasks,
     * queues any it can't cover yet, and spare drones help on the nearest task. Applied immediately.
     */
    private void handleTeamAllocate(Request req, Response resp) throws IOException {
        Map<String, String> params = req.getParams();
        if (!checkParams(params, Collections.singletonList("agentIds"), resp))
            return;
        List<Agent> team = new ArrayList<>();
        for (String id : params.get("agentIds").split(",")) {
            Agent a = simulator.getState().getAgent(id);
            if (a != null) team.add(a);
        }
        List<Task> tasks = new ArrayList<>();
        String label;
        if (params.containsKey("taskGroup")) {
            int taskGroup = Integer.parseInt(params.get("taskGroup"));
            simulator.getState().getTasks().stream().filter(t -> t.getTaskGroup() == taskGroup).forEach(tasks::add);
            label = "group " + taskGroup;
        } else if (params.containsKey("taskIds")) {
            for (String id : params.get("taskIds").split(",")) {
                Task t = simulator.getState().getTask(id);
                if (t != null) tasks.add(t);
            }
            label = "tasks " + params.get("taskIds");
        } else {
            label = "none (released)";
        }
        simulator.getAllocator().assignTeamToTasks(team, tasks, label);
        resp.sendOkay();
    }

    /** Allocation lens undo: puts the drones moved by the latest teamAllocate back where they were. */
    private void handleRestore(Request req, Response resp) throws IOException {
        simulator.getAllocator().undoTeamAllocation();
        resp.sendOkay();
    }

    private void handleUndo(Response resp) throws IOException {
        simulator.getAllocator().undoAllocationChange();
        resp.sendOkay();
    }

    private void handleRedo(Response resp) throws IOException {
        simulator.getAllocator().redoAllocationChange();
        resp.sendOkay();
    }

    private void handleReset(Response resp) throws IOException {
        simulator.getAllocator().resetAllocation();
        resp.sendOkay();
    }

}
