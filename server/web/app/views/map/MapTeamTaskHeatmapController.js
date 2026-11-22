/*
 * Task heatmaps for heatmapUI "teams", ported from the exp_fastpi branch (see MapTeamHeatmapController.js).
 */
var MapTeamTaskHeatmapController = {
    taskGroups: {},


    taskHeatmaps: {},
    addedGroups: [],
    taskMarkers: [],
    running: false,

    /**
     * Binds all the methods to use the given context.
     *  This means the methods can be called just using MapAgentController.method() without
     *  having to worry about calling from the correct context.
     * @param context - Context to bind to.
     */
    bind: function (context) {
        this.bindEvents = _.bind(this.bindEvents, context);
        this.drawTaskMaps = _.bind(this.drawTaskMaps, context);
        this.removeTaskMarkerFor = _.bind(this.removeTaskMarkerFor, context);
        this.addTaskMarkerFor = _.bind(this.addTaskMarkerFor, context);
        this.updateAllTaskMarkers = _.bind(this.updateAllTaskMarkers, context);
        this.updateFor = _.bind(this.updateFor, context);
        this.updateTaskRendering = _.bind(this.updateTaskRendering, context);
        this.clearAll = _.bind(this.clearAll, context);
        this.removeStaleGroupMarkers = _.bind(this.removeStaleGroupMarkers, context);
        this.removeAll = _.bind(this.removeAll, context);
        this.onTaskMarkerDrag = _.bind(this.onTaskMarkerDrag, context);
        this.onTaskMarkerDragEnd = _.bind(this.onTaskMarkerDragEnd, context);
        this.getTaskGradient = _.bind(this.getTaskGradient, context);
        this.calculateGroupCenter = _.bind(this.calculateGroupCenter, context);
        this.groupTasks = _.bind(this.groupTasks, context);
        this.updateTaskMaps = _.bind(this.updateTaskMaps, context);
    },
    /**
     * Bind listeners for agent state add, change and remove events
     */
    bindEvents: function () {
        
    },

    drawTaskMaps: function () {
        if (!this.state.tasks.isEmpty()) {
            const groups = MapTeamTaskHeatmapController.groupTasks();

            // Clear old heatmaps and markers
            MapTeamTaskHeatmapController.clearAll();
            MapTeamTaskHeatmapController.removeStaleGroupMarkers(groups);

            Object.entries(groups).forEach(([index, group]) => {
                if (group.length > 0) {
                    // Add task marker
                    MapTeamTaskHeatmapController.addTaskMarkerFor(group, index);

                    // Create and add heatmap for the group
                    const heatmapData = group.map(task => ({
                        location: new google.maps.LatLng(task.getPosition().lat(), task.getPosition().lng()),
                        weight: 0.15, // Adjust weight if necessary
                    }));

                    const heatmap = new google.maps.visualization.HeatmapLayer({
                        data: heatmapData,
                        gradient: MapTeamTaskHeatmapController.getTaskGradient(group),
                        radius: 50, // Adjust radius for visualization
                    });

                    heatmap.setMap(this.map);
                    MapTeamTaskHeatmapController.taskHeatmaps[index] = heatmap;
                    console.log(`Heatmap created for TaskGroup-${index}`);
                } else {
                    console.warn(`Skipped empty group at index: ${index}`);
                }
            });
        }
    },

    updateTaskMaps: function () {
        if (!this.state.tasks.isEmpty()) {
            const groupedTasks = MapTeamTaskHeatmapController.groupTasks();

            // Moongazer: remove markers and heatmaps of finished groups
            Object.keys(MapTeamTaskHeatmapController.taskHeatmaps).forEach((index) => {
                if (!groupedTasks[index]) {
                    MapTeamTaskHeatmapController.removeTaskMarkerFor(index);
                    MapTeamTaskHeatmapController.taskHeatmaps[index].setMap(null);
                    delete MapTeamTaskHeatmapController.taskHeatmaps[index];
                }
            });
            Object.entries(groupedTasks).forEach(([index, group]) => {
                if (group.length > 0) {
                    // Update or create task marker for this group
                    MapTeamTaskHeatmapController.addTaskMarkerFor(group, index);

                    // Update heatmap for this group
                    const heatmapData = group.map(task => ({
                        location: new google.maps.LatLng(task.getPosition().lat(), task.getPosition().lng()),
                        weight: 0.15, // Adjust weight if necessary
                    }));

                    if (MapTeamTaskHeatmapController.taskHeatmaps[index]) {
                        // Update existing heatmap
                        MapTeamTaskHeatmapController.taskHeatmaps[index].setData(heatmapData);
                    } else {
                        // Create new heatmap
                        const heatmap = new google.maps.visualization.HeatmapLayer({
                            data: heatmapData,
                            gradient: MapTeamTaskHeatmapController.getTaskGradient(group),
                            radius: 50, // Adjust radius for visualization
                        });

                        heatmap.setMap(this.map);
                        MapTeamTaskHeatmapController.taskHeatmaps[index] = heatmap;
                        console.log(`Heatmap updated for TaskGroup-${index}`);
                    }
                } else {
                    // Remove empty groups
                    MapTeamTaskHeatmapController.removeTaskMarkerFor(index);
                    if (MapTeamTaskHeatmapController.taskHeatmaps[index]) {
                        MapTeamTaskHeatmapController.taskHeatmaps[index].setMap(null);
                        delete MapTeamTaskHeatmapController.taskHeatmaps[index];
                    }
                    console.log(`Removed empty TaskGroup-${index}`);
                }
            });

            console.log("Task maps updated incrementally.");
        }
    },


    groupTasks: function () {
        const groups = {};

        // Iterate over tasks and organize them by taskGroup
        this.state.tasks.forEach(task => {
            console.log("Processing task:", task);
            if (task && task.getTaskGroup() != null && task.getTaskGroup() >= 0) {
                const groupId = task.getTaskGroup();
                console.log(`Task belongs to group ${groupId}`);
                if (!groups[groupId]) {
                    groups[groupId] = [];
                }
                groups[groupId].push(task);
            } else {
                console.warn("Task has no valid group:", task);
            }
        });

        // Moongazer: keep the real task group ids as keys (exp_fastpi used Object.values(), so the marker index
        // drifted from the group id once a batch was finished, and drops went to the wrong batch)
        return groups;
    },

    addTaskMarkerFor: function (group, index) {
        const markerId = `TaskGroup-${index}`; // Use the raw index as marker ID
        const newPos = MapTeamTaskHeatmapController.calculateGroupCenter(group);

        const existingMarker = this.$el.gmap("get", "markers")[markerId];
        const labelContent = `TaskGroup-${index}`; // Display TaskGroup-X format in label

        if (existingMarker) {
            existingMarker.setPosition(new google.maps.LatLng(newPos.lat, newPos.lng));
            existingMarker.setOptions({ labelContent }); // Update the label content
        } else {
            this.$el.gmap("addMarker", {
                bounds: false,
                draggable: false,
                id: markerId, // Raw index as ID
                position: new google.maps.LatLng(newPos.lat, newPos.lng),
                marker: MarkerWithLabel,
                labelContent, // Use improved label content
                labelAnchor: new google.maps.Point(25, 65),
                labelClass: "labels",
                labelStyle: { opacity: 1.0 },
                zIndex: 3,
            });

            const marker = this.$el.gmap("get", "markers")[markerId];
            if (marker) {
                $(marker).mouseover(() => {
                    MapTeamHeatmapController.groupIdToAllocateManually = `TaskGroup-${index}`; // Keep TaskGroup-X format for logic
                });
                $(marker).mouseout(() => {
                    MapTeamHeatmapController.groupIdToAllocateManually = null;
                });
            } else {
                console.error(`Failed to create marker for TaskGroup-${index}`);
            }
        }
    },


    getTaskGradient: function (taskGroup) {
        const defaultGradient = [
            "rgba(0, 255, 0, 0)",   // Transparent green
            "rgba(0, 255, 0, 1)",   // Bright green
            "rgba(127, 255, 0, 1)", // Lime green
            "rgba(255, 255, 0, 1)", // Yellow
            "rgba(255, 127, 0, 1)", // Orange
            "rgba(255, 0, 0, 1)"    // Red
        ];

        // You can customize the gradient per taskGroup here if needed
        return defaultGradient;
    },

    updateAllTaskMarkers: function () {
        for (let i = 0; i < MapTeamTaskHeatmapController.addedGroups.length; i++){
            if (MapTeamTaskHeatmapController.addedGroups[i].length === 0) {
                //console.log("Removing " + i + " groupsize = " + MapTeamTaskHeatmapController.addedGroups[i].length)
                MapTeamTaskHeatmapController.removeTaskMarkerFor(i);
            } else {
                //console.log("Adding " + i + " groupsize = " + MapTeamTaskHeatmapController.addedGroups[i].length)
                MapTeamTaskHeatmapController.addTaskMarkerFor(MapTeamTaskHeatmapController.addedGroups[i], i);
            }
        }
    },

    updateFor: function (task) {
        // TODO remove this marker's group. The whole map is then refreshed above
        for (let i = 0; i < MapTeamTaskHeatmapController.addedGroups.length; i++){
            const g = MapTeamTaskHeatmapController.addedGroups[i];
            if (g.includes(task)) {
                MapTeamTaskHeatmapController.addedGroups[i] = []
                MapTeamTaskHeatmapController.removeTaskMarkerFor(i);
                try {
                    MapTeamTaskHeatmapController.taskHeatmaps[i].setMap(null);
                    delete MapTeamTaskHeatmapController.taskHeatmaps[i];
                } catch (e) {}
            }

        }
    },

    calculateGroupCenter: function (group) {
        let latSum = 0, lngSum = 0;
        group.forEach(task => {
            latSum += task.getPosition().lat();
            lngSum += task.getPosition().lng();
        });
        return {
            lat: latSum / group.length,
            lng: lngSum / group.length
        };
    },

    onTaskMarkerDrag: function (marker, group) {
        const cursorPosition = marker.getPosition();
        const groupTasks = MapTeamTaskHeatmapController.taskGroups[group];

        // Update the allocation rendering with a polyline
        const path = groupTasks.map(task => ({
            lat: task.getPosition().lat(),
            lng: task.getPosition().lng(),
        }));
        path.push(cursorPosition);

        this.drawAllocation(`TaskAllocation-${group}`, "blue", path);
    },

    onTaskMarkerDragEnd: function (marker, group) {
        const groupTasks = MapTeamTaskHeatmapController.taskGroups[group];
        const taskIds = groupTasks.map(task => task.getId());

        $.post("/allocation/groupAllocate", {
            taskIds: taskIds.toString(),
        });

        this.hidePolyline(`TaskAllocation-${group}`);
    },

    removeTaskMarkerFor: function (index) {
        var marker = this.$el.gmap("get", "markers")["TaskGroup-"+index];
        if (marker) {
            //alert("Removing marker " + index)
            marker.setMap(null);
            // Moongazer: forget it too, otherwise a later addTaskMarkerFor() moves the hidden marker instead of showing one
            delete this.$el.gmap("get", "markers")["TaskGroup-"+index];
        }
    },

    /** Moongazer: remove the markers of task groups that no longer exist (exp_fastpi left them on the map). */
    removeStaleGroupMarkers: function (groups) {
        Object.keys(this.$el.gmap("get", "markers")).forEach(k => {
            if (k.startsWith("TaskGroup-") && !groups[k.substring("TaskGroup-".length)]) {
                MapTeamTaskHeatmapController.removeTaskMarkerFor(k.substring("TaskGroup-".length));
            }
        });
    },

    /** Moongazer: remove everything this view drew (used when the heatmap is switched off). */
    removeAll: function () {
        MapTeamTaskHeatmapController.clearAll();
        MapTeamTaskHeatmapController.removeStaleGroupMarkers({});
    },

    removeTaskMarkerForTask: function (task) {
        for (let i = 0; i < MapTeamTaskHeatmapController.addedGroups.length; i++){
            if (MapTeamTaskHeatmapController.addedGroups[i].includes(task)) {
                MapTeamTaskHeatmapController.removeTaskMarkerFor(i)
            }
        }
    },

    updateTaskRendering: function (taskId, colourOptions) {
        var marker = this.$el.gmap("get", "markers")[taskId];
        var icon = this.icons.MarkerMonitor;
        marker.setIcon(icon.Image);
        if (marker.icon) {
            //Add task id to end of marker url, this makes them unique.
            marker.icon.url = marker.icon.url + "#" + taskId;
            var h = colourOptions['h'];
            var s = colourOptions['s'];
            var l = colourOptions['l'];


            //Grab actual marker element by the (now unique) image src and set its colour
            $('img[src=\"' + marker.icon.url + '\"]').css({
                '-webkit-filter': 'hue-rotate(' + h + 'deg) saturate(' + s + ') brightness(' + l + ')',
                'filter': 'hue-rotate(' + h + 'deg) saturate(' + s + ') brightness(' + l + ')'
            });
        }
    },

    clearAll: function () {
        Object.values(MapTeamTaskHeatmapController.taskHeatmaps).forEach((h) => {
            try {
                h.setMap(null);
                delete h;
            } catch (e) {}
        })

        for (let i = 0; i < MapTeamTaskHeatmapController.addedGroups.length; i++){
            try {
                MapTeamTaskHeatmapController.removeTaskMarkerFor(i)
            } catch (e) {}
        }

        MapTeamTaskHeatmapController.taskHeatmaps = {};
        MapTeamTaskHeatmapController.addedGroups = [];
        MapTeamTaskHeatmapController.taskMarkers = [];
        MapTeamTaskHeatmapController.running = false;
    }
};
