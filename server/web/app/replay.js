/**
 * Replay mode: plays a recorded run (tools/record_replay.py) in the real interface, with no server.
 *
 * Turned on by sandbox.html?replay=<id>, which loads replays/<id>.json.gz. A jQuery transport answers the
 * interface's requests: state.json gets the recorded state at the current playback time (agent positions are
 * interpolated between frames so movement stays smooth), and everything else is accepted and ignored, because a
 * recording can't be steered. This is what the GitHub Pages demo runs; it also works against a live server.
 */
var MGReplay = {
    id: null,
    data: null,          // {hz, duration, frames: [{t, d}]}
    full: [],            // full state for each frame (shallow copies sharing unchanged values)
    started: false,
    paused: false,
    speed: 1,
    playT: 0,            // playback position in simulated seconds
    lastWall: null,
    notified: false,

    requested: function () {
        try {
            return new URLSearchParams(window.location.search).get("replay");
        } catch (e) {
            return null;
        }
    },

    /** Called from simulator.init, before the first state fetch. */
    install: function () {
        this.id = this.requested();
        if (!this.id) return false;
        var self = this;
        document.documentElement.setAttribute("data-replay", "true");
        this.ready = this.load("replays/" + encodeURIComponent(this.id) + ".json.gz");

        $.ajaxTransport("+*", function (options) {
            var path = self.apiPath(options.url);
            if (path === null) return;  // static file: let the browser fetch it
            return {
                send: function (headers, complete) {
                    self.ready.then(function () {
                        var res = self.answer(path, options);
                        complete(res.status, res.status === 200 ? "OK" : "Error", {text: res.body},
                            "Content-Type: " + (res.json ? "application/json" : "text/plain"));
                    }, function (err) {
                        complete(500, "Error", {text: String(err)}, "");
                    });
                },
                abort: function () {}
            };
        });
        this.initControls();
        return true;
    },

    load: function (url) {
        var self = this;
        return fetch(url).then(function (r) {
            if (!r.ok) throw new Error("No recording called " + self.id);
            if (typeof DecompressionStream === "undefined") throw new Error("This browser can't open the recording");
            return new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).json();
        }).then(function (data) {
            self.data = data;
            var prev = {};
            self.full = data.frames.map(function (f) {
                prev = $.extend({}, prev, f.d);
                return prev;
            });
        }).catch(function (e) {
            $("body").css("visibility", "visible");
            alert("Unable to load the recording: " + e.message);
            throw e;
        });
    },

    /** Server API paths are answered here; null means a static file. */
    apiPath: function (url) {
        var a = document.createElement("a");
        a.href = url;
        var p = a.pathname;
        if (/(^|\/)state\.json$/.test(p)) return "state.json";
        var m = p.match(/\/(mode|allocation|tasks|agents|targets|ghosts|review|visualizer|preset|provdoc|reset|jsonp|hazards)(\/.*)?$/);
        return m ? "/" + m[1] + (m[2] || "") : null;
    },

    answer: function (path, options) {
        if (path === "state.json") return {status: 200, json: true, body: JSON.stringify(this.stateAt())};
        if (path === "/mode/scenario/start") {
            this.start();
        } else if (path === "/mode/timing") {
            var q = new URLSearchParams(options.data || "");
            if (q.get("speed")) this.speed = Math.max(0.25, Math.min(8, +q.get("speed")));
            return {status: 200, json: true, body: JSON.stringify({speed: this.speed, tickRate: this.data.hz})};
        } else if (path === "/mode/in-progress") {
            return {status: 200, json: true, body: "true"};
        } else if (path === "/reset" || path === "/provdoc") {
            // Nothing to undo in a recording
        } else if ((options.type || "GET").toUpperCase() !== "GET") {
            this.readOnlyNotice();
        }
        return {status: 200, json: false, body: ""};
    },

    /** Frame 0 is the briefing before the run starts; playback begins at frame 1. */
    start: function () {
        if (this.started) return;
        this.started = true;
        this.playT = Math.max(this.playT, this.data.frames.length > 1 ? this.data.frames[1].t : 0);
        this.lastWall = performance.now();
    },

    readOnlyNotice: function () {
        if (this.notified) return;
        this.notified = true;
        var msg = "This is a recorded run, so it can't be steered. Run HARIS Moongazer yourself to take control.";
        if (window.spop) spop({template: msg, autoclose: 6000, style: "info"});
    },

    /** Advance the clock and return the (interpolated) state for the current playback time. */
    stateAt: function () {
        var now = performance.now();
        if (this.started && !this.paused && this.lastWall !== null)
            this.playT = Math.min(this.data.duration, this.playT + (now - this.lastWall) / 1000 * this.speed);
        this.lastWall = now;

        var frames = this.data.frames, i = Math.max(1, this.indexAt(this.playT));
        if (frames.length < 2) i = 0;
        if (!this.started) return $.extend({}, this.full[0], {inProgress: false, simSpeed: this.speed, tickRate: this.data.hz});
        var a = this.full[i], b = this.full[Math.min(i + 1, frames.length - 1)];
        var ta = frames[i].t, tb = frames[Math.min(i + 1, frames.length - 1)].t;
        var k = tb > ta ? Math.max(0, Math.min(1, (this.playT - ta) / (tb - ta))) : 0;
        var s = $.extend({}, a, {simSpeed: this.speed, tickRate: this.data.hz});
        if (b.inProgress !== false) {
            s.time = ta + (tb - ta) * k;
            s.agents = this.lerpAgents(a.agents, b.agents, k);
        }
        this.showProgress();
        return s;
    },

    indexAt: function (t) {
        var f = this.data.frames, lo = 0, hi = f.length - 1;
        while (lo < hi) {
            var mid = (lo + hi + 1) >> 1;
            if (f[mid].t <= t) lo = mid; else hi = mid - 1;
        }
        return lo;
    },

    lerpAgents: function (A, B, k) {
        if (!A || !B || k === 0) return A;
        var byId = {};
        B.forEach(function (x) { byId[x.id] = x; });
        return A.map(function (x) {
            var y = byId[x.id];
            if (!y || !x.coordinate || !y.coordinate) return x;
            var dh = ((y.heading - x.heading + 540) % 360) - 180;  // shortest turn
            return $.extend({}, x, {
                coordinate: {
                    latitude: x.coordinate.latitude + (y.coordinate.latitude - x.coordinate.latitude) * k,
                    longitude: x.coordinate.longitude + (y.coordinate.longitude - x.coordinate.longitude) * k
                },
                heading: x.heading + dh * k
            });
        });
    },

    // ---- Controls: the timing card gets play/pause and a scrub bar; the tick-rate row is hidden ----
    initControls: function () {
        var self = this;
        $("#sim_tickrate").closest("label").hide();
        var row = $('<div class="mg-replay-row">' +
            '<button type="button" class="mg-replay-play" aria-label="Pause">❚❚</button>' +
            '<input type="range" class="mg-replay-scrub" min="0" max="1000" value="0" aria-label="Playback position">' +
            '<output class="mg-replay-time">0:00</output></div>');
        $("#sim_timing").prepend('<div class="mg-replay-label">Recorded run</div>').append(row);
        row.find(".mg-replay-play").on("click", function () {
            self.paused = !self.paused;
            $(this).text(self.paused ? "▶" : "❚❚").attr("aria-label", self.paused ? "Play" : "Pause");
        });
        var scrub = row.find(".mg-replay-scrub");
        scrub.on("mousedown touchstart", function () { self.scrubbing = true; });
        scrub.on("mouseup touchend change", function () { self.scrubbing = false; });
        scrub.on("input change", function () {
            if (!self.data) return;
            // Jumping replays every "task completed" notice in between: clear them once they have appeared
            [300, 900].forEach(function (ms) { setTimeout(function () { $(".spop").remove(); }, ms); });
            self.start();
            self.playT = Math.max(self.data.frames[1] ? self.data.frames[1].t : 0, +scrub.val() / 1000 * self.data.duration);
        });
    },

    /** At the end, add "Watch again" and "Back to scenarios" to the interface's end-of-scenario panel. */
    showEndActions: function () {
        if ($(".mg-replay-end").length) return;
        var self = this;
        var tries = 0, timer = setInterval(function () {
            var panel = $(".blockMsg");
            if (panel.length || ++tries > 20) {
                clearInterval(timer);
                var box = $('<div class="mg-replay-end" style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">' +
                    '<button type="button" class="mg-replay-again">Watch again</button>' +
                    '<a class="mg-replay-back" href="./">Back to scenarios</a></div>');
                box.find(".mg-replay-again").on("click", function () { window.location.reload(); });
                (panel.length ? panel.first() : $("body")).append(box);
            }
        }, 150);
    },

    showProgress: function () {
        if (!this.data) return;
        if (this.playT >= this.data.duration) this.showEndActions();
        var fmt = function (s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + ("0" + s % 60).slice(-2); };
        $(".mg-replay-time").text(fmt(this.playT) + " / " + fmt(this.data.duration));
        if (!this.scrubbing) $(".mg-replay-scrub").val(Math.round(this.playT / this.data.duration * 1000));
    }
};
