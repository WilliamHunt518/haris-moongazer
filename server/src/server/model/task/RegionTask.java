package server.model.task;

import com.google.gson.JsonObject;
import com.google.gson.JsonSerializationContext;
import server.Simulator;
import server.model.Coordinate;
import server.model.agents.Agent;

import java.util.*;

/**
 * Define a rectangular region to search the interior of
 */
public class RegionTask extends PatrolTask {

    private static final double baseStep = 40;
    private Coordinate nw, ne, se, sw;

    /** Route points already swept, by index, in region coverage mode. */
    private final HashSet<Integer> coveredPoints = new HashSet<>();

    public RegionTask(String id, List<Coordinate> route, Coordinate centrePoint, Coordinate nw, Coordinate ne, Coordinate se, Coordinate sw) {
        super(id, Task.TASK_REGION, route, centrePoint);
        this.nw = nw;
        this.ne = ne;
        this.se = se;
        this.sw = sw;
    }

    public static RegionTask createTask(String id, Coordinate nw, Coordinate ne, Coordinate se, Coordinate sw) {
        List<Coordinate> route = createRoute(nw, ne, se, sw);
        return new RegionTask(id, route, getCentre(Arrays.asList(nw, ne, se, sw)), nw, ne, se, sw);
    }

    private static boolean coverageMode() {
        return Simulator.instance != null && Simulator.instance.getState().isRegionCoverage();
    }

    /**
     * In region coverage mode, a newly added agent drops the points already swept, so the team carries on from where
     * it left off instead of starting the sweep again.
     */
    @Override
    public void addAgent(Agent agent) {
        super.addAgent(agent);
        if (!coverageMode()) return;
        synchronized (this) {
            List<Coordinate> toRemove = coveredPoints.stream().filter(i -> i >= 0 && i < points.size()).map(points::get).toList();
            points.removeAll(toRemove);
            coveredPoints.clear();
            lastPointMap.clear();
            workingAgents.clear();
        }
    }

    /**
     * Region coverage mode ("regionCoverage": true in the scenario; Will Hunt, Jan 2025, from the dev_RM branch).
     * Several agents split one region's sweep between them, starting at evenly spaced points along the route, and the
     * region completes once every point has been swept. Without the flag, a region behaves like a patrol that never ends.
     */
    @Override
    boolean perform() {
        if (!coverageMode()) {
            return super.perform();
        }
        synchronized (getAgents()) {
            if (points.isEmpty()) {
                return true;
            }
            boolean justSplit = false;
            // When the first agent starts work, spread the others evenly along the route
            if (getAgents().stream().anyMatch(a -> a.isWorking() && !workingAgents.contains(a))) {
                justSplit = true;
                Agent first = getAgents().get(0);
                lastPointMap.put(first.getId(), Math.max(0, points.indexOf(getPreviousPoint(first))));
                if (!workingAgents.contains(first)) workingAgents.add(first);
                for (int a = 1; a < getAgents().size(); a++) {
                    Agent other = getAgents().get(a);
                    int relPos = (lastPointMap.get(first.getId()) + (a * (points.size() / getAgents().size()))) % points.size();
                    if (!workingAgents.contains(other)) workingAgents.add(other);
                    lastPointMap.put(other.getId(), relPos);
                    other.setWorking(true);
                    other.resume();
                }
            }

            for (Agent agent : getAgents()) {
                if (agent.isWorking() && !workingAgents.contains(agent)) {
                    lastPointMap.put(agent.getId(), Math.max(0, points.indexOf(getPreviousPoint(agent))));
                    workingAgents.add(agent);
                }
                if (agent.isWorking()) {
                    updateAgentRoute(agent);
                    if (agent.isCurrentDestinationReached()) {
                        if (!justSplit) {
                            coveredPoints.add(lastPointMap.get(agent.getId()));
                        }
                        lastPointMap.put(agent.getId(), lastPointMap.get(agent.getId()) < points.size() - 1 ? lastPointMap.get(agent.getId()) + 1 : 0);
                        // Don't send the agent round points that have already been swept
                        while (agent.getRoute().size() > Math.max(1, points.size() - coveredPoints.size())) {
                            agent.getRoute().remove(agent.getRoute().size() - 1);
                        }
                    }
                } else {
                    workingAgents.remove(agent);
                }
            }
            workingAgents.removeIf(w -> !w.getAllocatedTaskId().equals(getId()));

            return coveredPoints.size() >= points.size();
        }
    }

    private static Coordinate getCentre(List<Coordinate> corners) {
        return Coordinate.findCentre(corners);
    }

    @Override
    public void updatePoints(List<Coordinate> points) {
        super.updatePoints(points);
        this.setCoordinate(getCentre(points));
    }

    private static List<Coordinate> createRoute(Coordinate nw, Coordinate ne, Coordinate se, Coordinate sw) {
        double width = nw.getDistance(ne);
        double height = nw.getDistance(sw);

        List<Coordinate> points = new ArrayList<>();
        int r = (int) Math.floor((width - baseStep)/(2*baseStep));
        if(width <= baseStep || height <= baseStep || r == 0) {
            points.add(nw);
            points.add(ne);
            points.add(se);
            points.add(sw);
            points.add(nw);
        }
        else {
            double dx = (width - baseStep)/(2*r);
            double dy = height - baseStep;

            double NORTH = Math.PI/180.0D * 90.0F;
            double EAST = 0;
            double SOUTH = Math.PI/180.0D * 270.0F;

            points.add(nw);
            Coordinate currentPoint = nw;
            for(int i = 0; i < r; i++) {
                currentPoint = currentPoint.getCoordinate(dx, EAST);
                points.add(currentPoint);
                currentPoint = currentPoint.getCoordinate(dy, SOUTH);
                points.add(currentPoint);
                currentPoint = currentPoint.getCoordinate(dx, EAST);
                points.add(currentPoint);
                currentPoint = currentPoint.getCoordinate(dy, NORTH);
                points.add(currentPoint);
            }
            currentPoint = currentPoint.getCoordinate(baseStep, EAST);
            points.add(currentPoint);
            points.add(se);
            points.add(sw);
            points.add(nw);
        }
        return points;
    }

    public synchronized void updateCorners(Coordinate nw, Coordinate ne, Coordinate se, Coordinate sw) {
        this.nw = nw;
        this.ne = ne;
        this.se = se;
        this.sw = sw;
        this.updatePoints(createRoute(nw, ne, se, sw));
    }

    @Override
    public JsonObject serialize(JsonSerializationContext context) {
        List<Coordinate> corners = Arrays.asList(nw, ne, se, sw);
        JsonObject jsonObj = super.serialize(context);
        jsonObj.add("corners", context.serialize(corners));
        return jsonObj;
    }

}
