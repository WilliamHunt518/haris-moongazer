_.provide("App.Views.Review");


App.Views.Review = Backbone.View.extend({
    initialize: function(options) {
        this.state = options.state;
        this.views = options.views;
        this.canvas = options.canvas;
        this.ctx = options.ctx;

        this.currentImageName = "";
        this.currentImageRef = "";

        this.originalWidth = 0;
        this.originalHeight = 0;

        this.scale = 1;

        this.render();

        this.bind("update", this.update);

        // Progressive-resolution scouting: redraw the open image as its target sharpens
        var self = this;
        this.state.targets.on("change:resolutionLevel", function (target) {
            if (target.getId() === self.currentImageName && self.currentImageRef) {
                self.displayImage(self.currentImageName, self.currentImageRef, false);
            }
        });

    },
    update: function() {

    },
    reset: function () {
        this.currentImageName = "";
        this.currentImageRef = "";

        this.originalWidth = 0;
        this.originalHeight = 0;

        this.scale = 1;
        this.clearImage();
        this.render();
    },
    displayImage: function (id, iRef, update) {
        console.log("updating image id=" + id + ", iref=" + iRef)
        if (update) {
            this.currentImageName = id;
            this.currentImageRef = iRef;
        }
        var self = this;
        self.scale = 1;
        if (self.originalHeight !== 0) {
            // Not the first run, so reset canvas
            $("#image_review_canvas").width(self.originalWidth);
            $("#image_review_canvas").height(self.originalHeight);
        }
        try {
            var img = new Image();
            img.onload = function() {

                self.originalWidth = $("#image_review_canvas").width();
                self.originalHeight = $("#image_review_canvas").height();

                while ($("#image_review_canvas").width() < $("#image_review").width() || $("#image_review_canvas").height() < $("#image_review").height()) {
                    self.scale += 0.25;
                    $("#image_review_canvas").width(self.originalWidth * self.scale);
                    $("#image_review_canvas").height(self.originalHeight * self.scale);

                }

                self.canvas.width = img.width;
                self.canvas.height = img.height;
                $("#image_review_canvas").css({top: 0, left: 0, position:'relative'});
                var level = self.resolutionLevelFor(id);
                if (level > 0) {
                    // The demo's level images were the full image with a Gaussian blur of about 2/3 px per level
                    // at 1920 px wide; draw the same blur here instead of shipping ten copies of every image.
                    self.ctx.filter = "blur(" + (level * 0.67 * img.width / 1920).toFixed(2) + "px)";
                }
                self.ctx.drawImage(img, 0, 0, img.width, img.height);
                self.ctx.filter = "none";
                if (level >= 0) {
                    var label = level === 0 ? "Full resolution" : "Resolution level " + level + " (sharpens as a drone gets closer)";
                    var fontPx = Math.round(img.width / 64);
                    self.ctx.font = "600 " + fontPx + "px sans-serif";
                    var w = self.ctx.measureText(label).width;
                    self.ctx.fillStyle = "rgba(10, 22, 40, 0.75)";
                    self.ctx.fillRect(0, 0, w + fontPx, fontPx * 1.8);
                    self.ctx.fillStyle = "#ffffff";
                    self.ctx.fillText(label, fontPx / 2, fontPx * 1.25);
                }
            };
            img.src = iRef;  // Use the argument, so it works regardless of update flag

        } catch (e) {
            alert("update error: " + e)
        }

    },
    /** The scouting resolution level of a target's image, or -1 when scouting is off. */
    resolutionLevelFor: function (id) {
        if (!this.state.get("scouting")) return -1;
        var target = this.state.targets.find(function (t) { return t.getId() === id; });
        if (!target || target.get("resolutionLevel") === undefined) return -1;
        return target.get("resolutionLevel");
    },
    clearImage : function () {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.render();
    },
});
