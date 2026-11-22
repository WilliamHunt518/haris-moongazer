/*
 * Allocation lens (heatmapUI "lens"): the Moongazer heatmap allocation view.
 *
 * - Each agent team (fixed at scenario load) gets a colour and a letter. Its heatmap, badge and arrows, and the
 *   tasks it covers, all use that colour.
 * - Each mission (a spawn batch of tasks) is a zone with a badge that has one pip per task: filled in the
 *   covering team's colour, striped if queued for a team, dashed if nobody is on it.
 * - Arrow width is the number of drones a team has on that mission, so splits and partial cover show.
 * - Drag a team badge (or a board chip) onto a mission: the drop snaps to the nearest mission, previews the
 *   outcome, applies at once (POST /allocation/teamAllocate) and offers Undo (POST /allocation/restore).
 * - The allocation board lists the same thing per mission, and accepts the same drags.
 * - Hovering a team or mission shows the exact drone-to-task lines.
 *
 * render() is idempotent and cheap: call it whenever anything changes; it coalesces to one draw per frame.
 */
var MapLensController = {
    PALETTE: ["#0f8b8d", "#7b4fc9", "#d4508a", "#c98a00", "#2e7fd6", "#5c8a1f", "#c4512b", "#6b6f80"],
    view: null,
    teamLetters: {},     // team key -> letter, stable for the run
    heatmaps: {},        // team key -> HeatmapLayer
    zones: {},           // mission key -> Circle
    lines: {},           // id -> Polyline
    overlay: null,       // OverlayView holding badges and pips
    layer: null,         // its div
    nodes: {},           // id -> element in the overlay
    board: null,
    toast: null,
    preview: null,
    focus: null,         // {team} or {mission}
    drag: null,
    pending: false,
    model: null,
    undoTimer: null,

    bind: function (context) {
        MapLensController.view = context;
    },

    // ---------- model ----------

    teamKey: function (agent) {
        var team = agent.getAgentTeam && agent.getAgentTeam();
        if (team && team.length) return team.slice().sort().join(",");
        return agent.getId();
    },
    letterFor: function (key) {
        var L = MapLensController.teamLetters;
        if (!(key in L)) {
            var n = Object.keys(L).length;
            L[key] = n < 26 ? String.fromCharCode(65 + n) : "T" + (n + 1);
        }
        return L[key];
    },
    colourFor: function (letter) {
        var i = letter.length === 1 ? letter.charCodeAt(0) - 65 : parseInt(letter.substring(1), 10) - 1;
        return MapLensController.PALETTE[i % MapLensController.PALETTE.length];
    },

    /** Build teams, missions and coverage from the client state. */
    buildModel: function () {
        var state = MapLensController.view.state;
        var allocation = state.getAllocation() || {};
        var teams = {}, missions = {}, taskInfo = {};

        // Missions from spawn batches; tasks outside a batch are a mission of their own
        state.tasks.each(function (task) {
            var g = task.getTaskGroup();
            var key = (g !== null && g !== undefined && g >= 0) ? "g" + g : "t" + task.getId();
            if (!missions[key]) {
                missions[key] = {
                    key: key, group: (key[0] === "g") ? g : null,
                    name: (key[0] === "g") ? "M" + (g + 1) : task.getId().replace("Task-", "T"),
                    tasks: [], teams: {}
                };
            }
            missions[key].tasks.push(task);
            taskInfo[task.getId()] = {mission: key, agents: [], queued: []};
        });
        Object.keys(missions).forEach(function (k) {
            var m = missions[k];
            m.tasks.sort(function (a, b) { return a.getId().localeCompare(b.getId(), undefined, {numeric: true}); });
            var lat = 0, lng = 0;
            m.tasks.forEach(function (t) { lat += t.getPosition().lat(); lng += t.getPosition().lng(); });
            m.centre = new google.maps.LatLng(lat / m.tasks.length, lng / m.tasks.length);
            var r = 0;
            m.tasks.forEach(function (t) {
                r = Math.max(r, google.maps.geometry.spherical.computeDistanceBetween(m.centre, t.getPosition()));
            });
            m.radius = r + 70;
        });

        state.agents.each(function (agent) {
            if ((agent.isHub && agent.isHub()) || (agent.getType && agent.getType() === "hub")) return;
            var key = MapLensController.teamKey(agent);
            if (!teams[key]) {
                var letter = MapLensController.letterFor(key);
                teams[key] = {key: key, letter: letter, colour: MapLensController.colourFor(letter), agents: [], missions: {}};
            }
            teams[key].agents.push(agent);
        });
        Object.keys(teams).forEach(function (k) {
            var t = teams[k], lat = 0, lng = 0;
            t.agents.forEach(function (a) {
                lat += a.getPosition().lat(); lng += a.getPosition().lng();
                var taskId = allocation[a.getId()];
                if (taskId && taskInfo[taskId]) {
                    taskInfo[taskId].agents.push(t.key);
                    var mk = taskInfo[taskId].mission;
                    t.missions[mk] = (t.missions[mk] || 0) + 1;
                    missions[mk].teams[t.key] = (missions[mk].teams[t.key] || 0) + 1;
                }
                (a.get("taskQueue") || []).forEach(function (q) {
                    if (q && taskInfo[q.id]) taskInfo[q.id].queued.push(t.key);
                });
            });
            t.centre = new google.maps.LatLng(lat / t.agents.length, lng / t.agents.length);
        });
        return {teams: teams, missions: missions, taskInfo: taskInfo, allocation: allocation};
    },

    // ---------- drawing ----------

    render: function () {
        if (MapLensController.pending) return;
        MapLensController.pending = true;
        window.requestAnimationFrame(function () {
            MapLensController.pending = false;
            try {
                MapLensController.draw();
            } catch (e) {
                console.log("MapLensController.draw: " + e);
            }
        });
    },

    ensureOverlay: function () {
        var self = MapLensController;
        if (self.overlay) return;
        var map = self.view.map;
        self.overlay = new google.maps.OverlayView();
        self.overlay.onAdd = function () {
            self.layer = document.createElement("div");
            self.layer.className = "lens-layer";
            this.getPanes().overlayMouseTarget.appendChild(self.layer);
            if (google.maps.OverlayView.preventMapHitsAndGesturesFrom)
                google.maps.OverlayView.preventMapHitsAndGesturesFrom(self.layer);
        };
        self.overlay.draw = function () { self.placeNodes(); };
        self.overlay.onRemove = function () {
            if (self.layer && self.layer.parentNode) self.layer.parentNode.removeChild(self.layer);
            self.layer = null; self.nodes = {};
        };
        self.overlay.setMap(map);

        self.board = document.createElement("div");
        self.board.className = "lens-board";
        self.board.innerHTML = '<div class="lens-board-head"><span>Allocation</span><button type="button" class="lens-board-toggle" aria-expanded="true">Hide</button></div>' +
            '<div class="lens-board-body"><div class="lens-h">Teams without a mission</div><div class="lens-tray" data-drop="release"></div>' +
            '<div class="lens-h">Missions</div><div class="lens-cards"></div></div>';
        self.board.querySelector(".lens-board-toggle").addEventListener("click", function (e) {
            var body = self.board.querySelector(".lens-board-body");
            body.hidden = !body.hidden;
            e.target.textContent = body.hidden ? "Show" : "Hide";
            e.target.setAttribute("aria-expanded", String(!body.hidden));
        });
        self.board.addEventListener("pointerover", function (e) { self.hoverFrom(e.target); });
        self.board.addEventListener("pointerleave", function () { self.setFocus(null); });
        map.controls[google.maps.ControlPosition.RIGHT_TOP].push(self.board);

        self.toast = document.createElement("div");
        self.toast.className = "lens-toast";
        self.toast.hidden = true;
        self.toast.innerHTML = '<span class="lens-toast-text"></span><button type="button">Undo</button>';
        self.toast.querySelector("button").addEventListener("click", self.undo);
        map.controls[google.maps.ControlPosition.TOP_CENTER].push(self.toast);

        self.preview = document.createElement("div");
        self.preview.className = "lens-preview";
        self.preview.hidden = true;
        map.getDiv().appendChild(self.preview);
    },

    draw: function () {
        var self = MapLensController;
        if (!self.view || !self.view.map || !MapController.isHeatmapMode() || HeatmapUI.mode() !== "lens") return;
        self.ensureOverlay();
        var model = self.model = self.buildModel();
        var map = self.view.map;
        var f = self.drag ? {team: self.drag.team} : (self.focus || {});

        // Team heatmaps, tinted per team
        Object.keys(model.teams).forEach(function (k) {
            var t = model.teams[k];
            var data = t.agents.map(function (a) { return {location: a.getPosition(), weight: 3}; });
            var dim = f.team && f.team !== k;
            var hm = self.heatmaps[k];
            if (!hm) {
                hm = self.heatmaps[k] = new google.maps.visualization.HeatmapLayer({
                    data: data, radius: 45, gradient: self.gradient(t.colour), map: map
                });
            } else {
                hm.setData(data);
            }
            hm.set("opacity", dim ? 0.25 : 0.7);
        });
        Object.keys(self.heatmaps).forEach(function (k) {
            if (!model.teams[k]) { self.heatmaps[k].setMap(null); delete self.heatmaps[k]; }
        });

        // Mission zones
        Object.keys(model.missions).forEach(function (k) {
            var m = model.missions[k];
            var hot = self.drag && self.drag.target === k;
            var opts = {
                center: m.centre, radius: m.radius, map: map, clickable: false,
                strokeColor: hot ? "#26759e" : "#133d5b", strokeOpacity: hot ? 0.95 : 0.45, strokeWeight: hot ? 3 : 1.5,
                fillColor: "#133d5b", fillOpacity: hot ? 0.12 : 0.05, zIndex: 1
            };
            if (!self.zones[k]) self.zones[k] = new google.maps.Circle(opts);
            else self.zones[k].setOptions(opts);
        });
        Object.keys(self.zones).forEach(function (k) {
            if (!model.missions[k]) { self.zones[k].setMap(null); delete self.zones[k]; }
        });

        // Arrows: team centre -> mission badge, width by number of drones
        var wanted = {};
        Object.keys(model.teams).forEach(function (k) {
            var t = model.teams[k];
            Object.keys(t.missions).forEach(function (mk) {
                var id = "lens:" + k + ">" + mk;
                var dim = (f.team && f.team !== k) || (f.mission && f.mission !== mk);
                wanted[id] = true;
                self.arrow(id, t.centre, self.badgeAnchor(model.missions[mk]), t.colour, 2 + 2 * t.missions[mk], dim ? 0.2 : 0.9, false);
            });
        });
        // Drone -> task lines for the focused team or mission
        if (f.team || f.mission) {
            Object.keys(model.teams).forEach(function (k) {
                model.teams[k].agents.forEach(function (a) {
                    var taskId = model.allocation[a.getId()];
                    var info = taskId && model.taskInfo[taskId];
                    if (!info) return;
                    if ((f.team && f.team !== k) || (f.mission && f.mission !== info.mission)) return;
                    var task = self.view.state.tasks.get(taskId);
                    if (!task) return;
                    var id = "lens:thread:" + a.getId();
                    wanted[id] = true;
                    self.thread(id, a.getPosition(), task.getPosition(), model.teams[k].colour);
                });
            });
        }
        // Drag ghost
        if (self.drag && self.drag.latLng) {
            var dt = model.teams[self.drag.team];
            if (dt) {
                var end = self.drag.target && model.missions[self.drag.target] ? self.badgeAnchor(model.missions[self.drag.target]) : self.drag.latLng;
                wanted["lens:ghost"] = true;
                self.arrow("lens:ghost", dt.centre, end, dt.colour, 4, 0.9, true);
            }
        }
        Object.keys(self.lines).forEach(function (id) {
            if (!wanted[id]) { self.lines[id].setMap(null); delete self.lines[id]; }
        });

        self.drawNodes(model, f);
        self.drawBoard(model);
    },

    gradient: function (hex) {
        var r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
        var c = function (a) { return "rgba(" + r + "," + g + "," + b + "," + a + ")"; };
        return [c(0), c(0.35), c(0.55), c(0.7), c(0.85), c(1)];
    },

    /** The point just under a mission's badge (top of its zone), which arrows point at. */
    badgeAnchor: function (m) {
        return google.maps.geometry.spherical.computeOffset(m.centre, m.radius, 0);
    },

    arrow: function (id, from, to, colour, weight, opacity, dashed) {
        var self = MapLensController;
        // Gentle curve: quadratic Bezier with the control point off to one side
        var p0 = from, p2 = to;
        var mid = google.maps.geometry.spherical.interpolate(p0, p2, 0.5);
        var d = google.maps.geometry.spherical.computeDistanceBetween(p0, p2);
        var heading = google.maps.geometry.spherical.computeHeading(p0, p2);
        var p1 = google.maps.geometry.spherical.computeOffset(mid, d * 0.15, heading + 90);
        var path = [];
        for (var i = 0; i <= 16; i++) {
            var s = i / 16, u = 1 - s;
            path.push(new google.maps.LatLng(
                u * u * p0.lat() + 2 * u * s * p1.lat() + s * s * p2.lat(),
                u * u * p0.lng() + 2 * u * s * p1.lng() + s * s * p2.lng()));
        }
        var head = {icon: {path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeColor: colour, strokeOpacity: opacity, fillColor: colour, fillOpacity: opacity}, offset: "100%"};
        var opts = dashed ? {
            path: path, map: self.view.map, clickable: false, zIndex: 4, strokeOpacity: 0,
            icons: [{icon: {path: "M 0,-1 0,1", strokeColor: colour, strokeOpacity: opacity, strokeWeight: weight, scale: 3}, offset: "0", repeat: "14px"}, head]
        } : {
            path: path, map: self.view.map, clickable: false, zIndex: 3,
            strokeColor: colour, strokeOpacity: opacity, strokeWeight: weight, icons: [head]
        };
        if (self.lines[id]) self.lines[id].setOptions(opts);
        else self.lines[id] = new google.maps.Polyline(opts);
    },

    thread: function (id, from, to, colour) {
        var self = MapLensController;
        var opts = {
            path: [from, to], map: self.view.map, clickable: false, zIndex: 5, strokeOpacity: 0,
            icons: [{icon: {path: "M 0,-1 0,1", strokeColor: colour, strokeOpacity: 0.9, strokeWeight: 2, scale: 2}, offset: "0", repeat: "8px"}]
        };
        if (self.lines[id]) self.lines[id].setOptions(opts);
        else self.lines[id] = new google.maps.Polyline(opts);
    },

    /** Get or create an element in the overlay layer. */
    node: function (id, cls, create) {
        var self = MapLensController;
        var el = self.nodes[id];
        if (!el) {
            el = self.nodes[id] = document.createElement("div");
            el.className = cls;
            el.dataset.lensId = id;
            if (create) create(el);
            self.layer.appendChild(el);
        }
        el.dataset.seen = "1";
        return el;
    },

    drawNodes: function (model, f) {
        var self = MapLensController;
        if (!self.layer) return;
        Object.keys(self.nodes).forEach(function (id) { self.nodes[id].dataset.seen = ""; });

        // Task pips on the map
        Object.keys(model.missions).forEach(function (mk) {
            model.missions[mk].tasks.forEach(function (task) {
                var info = model.taskInfo[task.getId()];
                var el = self.node("task:" + task.getId(), "lens-task");
                self.paintPip(el, info, model);
                el.lensPos = task.getPosition();
            });
        });
        // Mission badges
        Object.keys(model.missions).forEach(function (mk) {
            var m = model.missions[mk];
            var el = self.node("mission:" + mk, "lens-mission", function (el) {
                el.dataset.mission = mk;
                el.innerHTML = '<span class="lens-mission-name"></span><span class="lens-pips"></span>';
            });
            el.querySelector(".lens-mission-name").textContent = m.name;
            self.paintPips(el.querySelector(".lens-pips"), m, model);
            el.classList.toggle("is-target", !!(self.drag && self.drag.target === mk));
            el.classList.toggle("is-dim", !!(f.mission && f.mission !== mk) || !!(f.team && !m.teams[f.team]));
            el.lensPos = self.badgeAnchor(m);
        });
        // Team badges
        Object.keys(model.teams).forEach(function (k) {
            var t = model.teams[k];
            var el = self.node("team:" + k, "lens-team", function (el) {
                el.dataset.team = k;
                el.innerHTML = '<span class="lens-team-dot"></span><span class="lens-team-label"></span>';
                el.addEventListener("pointerdown", function (e) { self.startDrag(e, k); });
                el.addEventListener("pointerenter", function () { self.setFocus({team: k}); });
                el.addEventListener("pointerleave", function () { self.setFocus(null); });
            });
            var idle = !Object.keys(t.missions).length;
            var dot = el.querySelector(".lens-team-dot");
            dot.textContent = t.letter;
            dot.style.background = t.colour;
            el.style.setProperty("--lens-team", t.colour);
            el.classList.toggle("is-idle", idle);
            el.classList.toggle("is-dim", !!(f.team && f.team !== k));
            el.querySelector(".lens-team-label").textContent = t.agents.length + (t.agents.length === 1 ? " drone" : " drones") + (idle ? " · idle" : "");
            el.lensPos = t.centre;
        });
        // Drone dots for the focused team or mission
        Object.keys(model.teams).forEach(function (k) {
            model.teams[k].agents.forEach(function (a) {
                var info = model.taskInfo[model.allocation[a.getId()]];
                var on = (f.team && f.team === k) || (f.mission && info && info.mission === f.mission);
                if (!on) return;
                var el = self.node("agent:" + a.getId(), "lens-agent");
                el.style.background = model.teams[k].colour;
                el.title = a.getId();
                el.lensPos = a.getPosition();
            });
        });
        Object.keys(self.nodes).forEach(function (id) {
            if (!self.nodes[id].dataset.seen) {
                self.nodes[id].remove();
                delete self.nodes[id];
            }
        });
        // Mission badges take hover too (bound once, through the layer)
        if (!self.layer.dataset.bound) {
            self.layer.dataset.bound = "1";
            self.layer.addEventListener("pointerover", function (e) {
                var m = e.target.closest && e.target.closest(".lens-mission");
                if (m) self.setFocus({mission: m.dataset.mission});
            });
            self.layer.addEventListener("pointerout", function (e) {
                var m = e.target.closest && e.target.closest(".lens-mission");
                if (m && !(e.relatedTarget && m.contains(e.relatedTarget))) self.setFocus(null);
            });
        }
        self.placeNodes();
    },

    paintPip: function (el, info, model) {
        var team = info && info.agents.length ? model.teams[info.agents[0]] : null;
        var queued = info && !team && info.queued.length ? model.teams[info.queued[0]] : null;
        el.classList.toggle("is-free", !team && !queued);
        el.classList.toggle("is-queued", !!queued);
        el.style.setProperty("--lens-team", team ? team.colour : queued ? queued.colour : "");
    },

    paintPips: function (box, m, model) {
        var self = MapLensController;
        while (box.children.length > m.tasks.length) box.removeChild(box.lastChild);
        while (box.children.length < m.tasks.length) {
            var s = document.createElement("span");
            s.className = "lens-pip";
            box.appendChild(s);
        }
        m.tasks.forEach(function (task, i) {
            var info = model.taskInfo[task.getId()];
            self.paintPip(box.children[i], info, model);
            var team = info.agents.length ? model.teams[info.agents[0]] : null;
            var queued = !team && info.queued.length ? model.teams[info.queued[0]] : null;
            box.children[i].title = task.getId() + (team ? ": Team " + team.letter : queued ? ": queued for Team " + queued.letter : ": nobody on it");
        });
    },

    placeNodes: function () {
        var self = MapLensController;
        if (!self.overlay || !self.layer) return;
        var proj = self.overlay.getProjection();
        if (!proj) return;
        Object.keys(self.nodes).forEach(function (id) {
            var el = self.nodes[id];
            if (!el.lensPos) return;
            var p = proj.fromLatLngToDivPixel(el.lensPos);
            el.style.transform = "translate(" + Math.round(p.x) + "px," + Math.round(p.y) + "px)";
        });
    },

    drawBoard: function (model) {
        var self = MapLensController;
        var sig = JSON.stringify([
            Object.keys(model.missions).map(function (k) {
                var m = model.missions[k];
                return [k, m.tasks.map(function (t) { var i = model.taskInfo[t.getId()]; return i.agents.join("|") + "/" + i.queued.join("|"); }), m.teams];
            }),
            Object.keys(model.teams).map(function (k) { return [k, model.teams[k].agents.length, Object.keys(model.teams[k].missions)]; }),
            self.drag && self.drag.target, self.focus
        ]);
        if (sig === self.boardSig) return;
        self.boardSig = sig;

        var tray = self.board.querySelector(".lens-tray");
        tray.textContent = "";
        tray.classList.toggle("is-target", !!(self.drag && self.drag.target === "release"));
        var idle = Object.keys(model.teams).filter(function (k) { return !Object.keys(model.teams[k].missions).length; });
        if (!idle.length) {
            tray.innerHTML = '<span class="lens-empty">All teams busy. Drop a team here to release it.</span>';
        }
        idle.forEach(function (k) { tray.appendChild(self.chip(model.teams[k])); });

        var cards = self.board.querySelector(".lens-cards");
        cards.textContent = "";
        Object.keys(model.missions).sort(function (a, b) {
            return model.missions[a].name.localeCompare(model.missions[b].name, undefined, {numeric: true});
        }).forEach(function (mk) {
            var m = model.missions[mk];
            var covered = m.tasks.filter(function (t) { return model.taskInfo[t.getId()].agents.length; }).length;
            var queued = m.tasks.filter(function (t) { var i = model.taskInfo[t.getId()]; return !i.agents.length && i.queued.length; }).length;
            var card = document.createElement("div");
            card.className = "lens-card" + (self.drag && self.drag.target === mk ? " is-target" : "") + (self.focus && self.focus.mission === mk ? " is-focus" : "");
            card.dataset.mission = mk;
            var status = covered === m.tasks.length ? ["ok", "All covered"]
                : covered ? ["part", covered + " of " + m.tasks.length + " covered" + (queued ? ", " + queued + " queued" : "")]
                : queued ? ["part", queued + " queued"] : ["none", "Nobody on it"];
            card.innerHTML = '<div class="lens-card-head"><span class="lens-card-name"></span><span class="lens-status lens-status-' + status[0] + '"></span></div><span class="lens-pips"></span><div class="lens-card-teams"></div>';
            card.querySelector(".lens-card-name").textContent = m.name + " · " + m.tasks.length + (m.tasks.length === 1 ? " task" : " tasks");
            card.querySelector(".lens-status").textContent = status[1];
            self.paintPips(card.querySelector(".lens-pips"), m, model);
            var row = card.querySelector(".lens-card-teams");
            Object.keys(m.teams).forEach(function (k) { row.appendChild(self.chip(model.teams[k])); });
            cards.appendChild(card);
        });
    },

    chip: function (t) {
        var self = MapLensController;
        var c = document.createElement("span");
        c.className = "lens-chip";
        c.dataset.team = t.key;
        c.innerHTML = '<span class="lens-team-dot"></span><span></span>';
        c.firstChild.textContent = t.letter;
        c.firstChild.style.background = t.colour;
        c.lastChild.textContent = "Team " + t.letter + " · " + t.agents.length;
        c.addEventListener("pointerdown", function (e) { self.startDrag(e, t.key); });
        return c;
    },

    hoverFrom: function (target) {
        var el = target && target.closest && target.closest("[data-team],[data-mission]");
        if (!el) return MapLensController.setFocus(null);
        MapLensController.setFocus(el.dataset.team ? {team: el.dataset.team} : {mission: el.dataset.mission});
    },

    setFocus: function (focus) {
        var self = MapLensController;
        if (self.drag) return;
        if (JSON.stringify(focus) === JSON.stringify(self.focus)) return;
        self.focus = focus;
        self.render();
    },

    // ---------- drag and drop ----------

    startDrag: function (e, teamKey) {
        var self = MapLensController;
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        self.focus = null;
        self.drag = {team: teamKey, target: null, latLng: null};
        self.view.map.setOptions({draggable: false});
        document.body.classList.add("lens-dragging");
        window.addEventListener("pointermove", self.onDragMove);
        window.addEventListener("pointerup", self.onDragEnd);
        window.addEventListener("pointercancel", self.onDragEnd);
        self.onDragMove(e);
    },

    onDragMove: function (e) {
        var self = MapLensController, d = self.drag;
        if (!d || !self.model) return;
        var mapDiv = self.view.map.getDiv(), r = mapDiv.getBoundingClientRect();
        var hit = document.elementFromPoint(e.clientX, e.clientY);
        var onBoard = hit && self.board.contains(hit);
        d.target = null;
        d.latLng = null;
        if (onBoard) {
            var card = hit.closest(".lens-card"), tray = hit.closest(".lens-tray");
            if (card) d.target = card.dataset.mission;
            else if (tray) d.target = "release";
        } else if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            var proj = self.overlay.getProjection();
            var pt = new google.maps.Point(e.clientX - r.left, e.clientY - r.top);
            d.latLng = proj.fromContainerPixelToLatLng(pt);
            // Snap to the nearest mission whose zone (or badge) is within reach of the pointer
            var best = null;
            Object.keys(self.model.missions).forEach(function (mk) {
                var m = self.model.missions[mk];
                var c = proj.fromLatLngToContainerPixel(m.centre);
                var edge = proj.fromLatLngToContainerPixel(self.badgeAnchor(m));
                var rPx = Math.abs(c.y - edge.y);
                var dz = Math.hypot(pt.x - c.x, pt.y - c.y) - rPx;
                var db = Math.hypot(pt.x - edge.x, pt.y - (edge.y - 16)) - 30;
                var dist = Math.min(dz, db);
                if (dist < 40 && (!best || dist < best.d)) best = {k: mk, d: dist};
            });
            if (best) d.target = best.k;
        }
        self.showPreview(e, r);
        self.render();
    },

    showPreview: function (e, r) {
        var self = MapLensController, d = self.drag;
        if (!d.target) { self.preview.hidden = true; return; }
        self.preview.innerHTML = d.target === "release" ? self.releaseText(d.team) : self.outcomeText(d.team, d.target);
        self.preview.hidden = false;
        var x = e.clientX - r.left + 18, y = e.clientY - r.top + 18;
        self.preview.style.left = Math.max(8, Math.min(x, r.width - 260)) + "px";
        self.preview.style.top = Math.max(8, Math.min(y, r.height - 100)) + "px";
    },

    esc: function (s) {
        return String(s).replace(/[&<>"]/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]; });
    },

    releaseText: function (teamKey) {
        var t = MapLensController.model.teams[teamKey];
        return "<b>Release Team " + t.letter + "</b><br>Its drones stop where they are.";
    },

    /** Predict what dropping a team on a mission does (mirrors Allocator.assignTeamToTasks). */
    outcomeText: function (teamKey, mk) {
        var self = MapLensController, model = self.model;
        var t = model.teams[teamKey], m = model.missions[mk];
        var n = t.agents.length;
        var freeSlots = m.tasks.filter(function (task) {
            var i = model.taskInfo[task.getId()];
            return !i.agents.some(function (k) { return k !== teamKey; });
        }).length;
        var total = m.tasks.length, covered = total - freeSlots + Math.min(n, freeSlots), waiting = total - covered;
        var s = "<b>Team " + self.esc(t.letter) + "</b> (" + n + (n === 1 ? " drone" : " drones") + ") → <b>" + self.esc(m.name) + "</b> (" + total + (total === 1 ? " task" : " tasks") + ")<br>";
        s += covered === total ? "All " + total + " covered" : "Covers " + covered + " of " + total + ", " + waiting + " queued for after";
        if (n > freeSlots) s += ", " + (n - freeSlots) + " spare " + (n - freeSlots === 1 ? "drone helps" : "drones help");
        var others = Object.keys(m.teams).filter(function (k) { return k !== teamKey; }).map(function (k) { return model.teams[k].letter; });
        if (others.length) s += "<br>Joins Team " + others.join(", ");
        var leaving = Object.keys(t.missions).filter(function (k) { return k !== mk; }).map(function (k) { return model.missions[k].name; });
        if (leaving.length) s += "<br>Leaves " + leaving.join(", ");
        return s;
    },

    onDragEnd: function () {
        var self = MapLensController, d = self.drag;
        window.removeEventListener("pointermove", self.onDragMove);
        window.removeEventListener("pointerup", self.onDragEnd);
        window.removeEventListener("pointercancel", self.onDragEnd);
        self.drag = null;
        self.preview.hidden = true;
        document.body.classList.remove("lens-dragging");
        self.view.map.setOptions({draggable: true});
        if (d && d.target && self.model && self.model.teams[d.team]) self.send(d.team, d.target);
        self.render();
    },

    send: function (teamKey, target) {
        var self = MapLensController, model = self.model;
        var t = model.teams[teamKey];
        var params = {agentIds: t.agents.map(function (a) { return a.getId(); }).join(",")};
        var text;
        if (target === "release") {
            if (!Object.keys(t.missions).length) return;
            text = "Team " + t.letter + " released";
        } else {
            var m = model.missions[target];
            if (!m) return;
            var current = Object.keys(t.missions);
            if (current.length === 1 && current[0] === target) return;
            if (m.group !== null) params.taskGroup = m.group;
            else params.taskIds = m.tasks.map(function (task) { return task.getId(); }).join(",");
            text = "Team " + t.letter + " sent to " + m.name;
        }
        $.post("/allocation/teamAllocate", params).done(function () {
            self.showToast(text);
        }).fail(function () {
            self.showToast("Couldn't reach the server. Allocation not changed.", true);
        });
    },

    showToast: function (text, noUndo) {
        var self = MapLensController;
        self.toast.querySelector(".lens-toast-text").textContent = text;
        self.toast.querySelector("button").hidden = !!noUndo;
        self.toast.hidden = false;
        clearTimeout(self.undoTimer);
        self.undoTimer = setTimeout(function () { self.toast.hidden = true; }, 6000);
    },

    undo: function () {
        var self = MapLensController;
        self.toast.hidden = true;
        $.post("/allocation/restore");
    },

    clear: function () {
        var self = MapLensController;
        Object.keys(self.heatmaps).forEach(function (k) { self.heatmaps[k].setMap(null); });
        Object.keys(self.zones).forEach(function (k) { self.zones[k].setMap(null); });
        Object.keys(self.lines).forEach(function (k) { self.lines[k].setMap(null); });
        self.heatmaps = {}; self.zones = {}; self.lines = {};
        if (self.overlay) self.overlay.setMap(null);
        self.overlay = null;
        if (self.board && self.view && self.view.map) {
            [self.board, self.toast].forEach(function (el) {
                ["RIGHT_TOP", "TOP_CENTER"].forEach(function (pos) {
                    var arr = self.view.map.controls[google.maps.ControlPosition[pos]];
                    for (var i = arr.getLength() - 1; i >= 0; i--) if (arr.getAt(i) === el) arr.removeAt(i);
                });
            });
        }
        if (self.preview && self.preview.parentNode) self.preview.parentNode.removeChild(self.preview);
        self.board = self.toast = self.preview = null;
        self.boardSig = null;
        self.nodes = {};
    }
};
