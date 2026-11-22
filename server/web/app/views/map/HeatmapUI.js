/*
 * Chooses which heatmap allocation interface draws the map when the "heatmap" UI feature is on.
 * A scenario picks one with "heatmapUI":
 *   "dynamic" (default) - the original heatmap: agents and tasks grouped by distance (MapAgentHeatmapController,
 *                         MapTaskHeatmapController). Scenarios without the key keep using it, unchanged.
 *   "teams"             - exp_fastpi's version: fixed teams of 3 and one task group per spawn batch
 *                         (MapTeamHeatmapController, MapTeamTaskHeatmapController).
 *   "lens"              - the Moongazer allocation lens (MapLensController). Under the Classic look a "lens"
 *                         scenario falls back to "teams", which shares its server-side setup.
 * The original call sites in MapAgentController / MapTaskController / map.js keep their code for "dynamic" and ask
 * this object first.
 */
var HeatmapUI = {
    view: null,
    bind: function (context) {
        HeatmapUI.view = context;
    },
    /** @returns {"dynamic"|"teams"|"lens"} */
    mode: function () {
        var state = HeatmapUI.view && HeatmapUI.view.state;
        var mode = (state && state.getHeatmapUI && state.getHeatmapUI()) || "dynamic";
        if (mode === "lens" && window.MG_LOOK === "classic") return "teams";
        return mode;
    },
    isDynamic: function () {
        return HeatmapUI.mode() === "dynamic";
    },

    /** Agents were added, removed or regrouped. */
    agentsChanged: function () {
        if (HeatmapUI.mode() === "teams") MapTeamHeatmapController.drawAgentMaps();
        else MapLensController.render();
    },
    /** Tasks were added, changed, completed or removed. */
    tasksChanged: function (task) {
        if (HeatmapUI.mode() === "teams") {
            MapTeamTaskHeatmapController.removeTaskMarkerForTask(task);
            MapTeamTaskHeatmapController.drawTaskMaps();
        } else {
            MapLensController.render();
        }
    },
    /** A single task moved or changed (exp_fastpi updated its group heatmap in place). */
    taskChanged: function (task) {
        if (HeatmapUI.mode() === "teams") MapTeamTaskHeatmapController.updateTaskMaps();
        else MapLensController.render();
    },
    taskRemoved: function (task) {
        if (HeatmapUI.mode() === "teams") {
            MapTeamTaskHeatmapController.updateFor(task);
            MapTeamHeatmapController.removeAgentMarkerForAgentWithTask(task);
            MapTeamHeatmapController.drawAgentMaps();
            MapTeamTaskHeatmapController.removeTaskMarkerForTask(task);
            MapTeamTaskHeatmapController.drawTaskMaps();
        } else {
            MapLensController.render();
        }
    },
    /** Each tick, after the markers are drawn. */
    tick: function () {
        if (HeatmapUI.mode() === "teams") MapTeamHeatmapController.moveAllMaps();
        else MapLensController.render();
    },
    allocationChanged: function () {
        if (HeatmapUI.mode() === "teams") MapTeamHeatmapController.updateHeatmapAllocationRendering();
        else MapLensController.render();
    },
    /**
     * Remove what the non-dynamic views drew, e.g. when the workload level turns the heatmap off.
     * @param part - "agents", "tasks" or undefined for both
     */
    clearAll: function (part) {
        // Nothing to clear for the original heatmap (and its markers share ids with the team view)
        if (HeatmapUI.isDynamic()) return;
        try {
            if (part !== "tasks") {
                MapTeamHeatmapController.clearAllHeatmaps();
                MapTeamHeatmapController.removeAllTeamMarkers();
                MapTeamHeatmapController.hidePolyline("AgentGroup-");
                MapTeamHeatmapController.hidePolyline("manual_allocation");
            }
            if (part !== "agents") MapTeamTaskHeatmapController.removeAll();
        } catch (e) { console.log("HeatmapUI.clearAll (teams): " + e); }
        MapLensController.clear();
    }
};
