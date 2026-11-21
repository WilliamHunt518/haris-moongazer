/**
 * Live simulation timing: speed (simulated seconds per real second) and engine tick rate.
 * Behaviour per simulated second is the same at any tick rate; higher rates only move agents in smaller steps.
 */
var SimTiming = {
    SPEEDS: [0.25, 0.5, 1, 2, 4, 8],
    dragging: false,
    pending: null,

    init: function () {
        var self = this;
        this.$speed = $("#sim_speed");
        this.$rate = $("#sim_tickrate");
        if (!this.$speed.length) return;
        var start = function () { self.dragging = true; };
        var stop = function () { self.dragging = false; };
        this.$speed.add(this.$rate).on("mousedown touchstart focus", start).on("mouseup touchend blur change", stop);
        this.$speed.on("input change", function () {
            var v = self.SPEEDS[+self.$speed.val()];
            self.label(v, null);
            self.send({speed: v});
        });
        this.$rate.on("input change", function () {
            var v = +self.$rate.val();
            self.label(null, v);
            self.send({tickRate: v});
        });
    },

    // Send at most one request per 120 ms while a slider is dragged
    send: function (params) {
        var self = this;
        this.pending = $.extend(this.pending || {}, params);
        if (this.timer) return;
        this.timer = setTimeout(function () {
            var p = self.pending;
            self.pending = null;
            self.timer = null;
            // Ignore server values for a moment so a state fetched before this lands can't snap the slider back
            self.holdUntil = Date.now() + 800;
            $.post("/mode/timing", p);
        }, 120);
    },

    label: function (speed, rate) {
        if (speed != null) $("#sim_speed_val").text("×" + speed);
        if (rate != null) $("#sim_tickrate_val").text(rate + " Hz");
    },

    /** Called after each state fetch: show the server's values unless the user is dragging. */
    sync: function (state) {
        if (!this.$speed || !this.$speed.length || this.dragging || this.pending || Date.now() < (this.holdUntil || 0)) return;
        var speed = state.get("simSpeed"), rate = state.get("tickRate");
        if (speed == null || rate == null) return;
        var idx = 0, best = Infinity;
        for (var i = 0; i < this.SPEEDS.length; i++) {
            var d = Math.abs(this.SPEEDS[i] - speed);
            if (d < best) { best = d; idx = i; }
        }
        if (+this.$speed.val() !== idx) this.$speed.val(idx);
        if (+this.$rate.val() !== rate) this.$rate.val(rate);
        this.label(speed, rate);
    },

    /** How long the client waits between state fetches. */
    pollInterval: function (state) {
        var speed = state.get("simSpeed") || 1, rate = state.get("tickRate") || 10;
        // Classic look at its original timing polls exactly as before
        if (window.MG_LOOK === "classic" && rate <= 5 && speed === 1) return 400;
        // Otherwise fetch about once per tick, between 20 and 10 times a second
        return Math.max(50, Math.min(100, 1000 / (rate * speed)));
    }
};
