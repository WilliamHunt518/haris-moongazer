/**
 * HARIS Moongazer launch page: showcase tiles (from showcase/showcase.json), sandbox, and a searchable list of all
 * scenario files.
 */
function menuInit() {
    var showError = function (msg) {
        var el = $("#loadScenarioErrorText");
        el.text(msg).fadeIn(200);
        setTimeout(function () { el.fadeOut(300); }, 3500);
    };

    var launchScenario = function (fileName, button) {
        if (button) button.prop("disabled", true).text("Loading…");
        // Reset first: loading a scenario on top of another one fails on the server
        $.post('/reset').always(function () {
            $.post('/mode/scenario', {'file-name': fileName}, function () {
                window.location = "/sandbox.html";
            }).fail(function () {
                if (button) button.prop("disabled", false).text("Launch");
                showError("Unable to load " + fileName + ".");
            });
        });
    };

    var esc = function (s) { return $("<div>").text(s == null ? "" : String(s)).html(); };

    // ------ Showcase tiles ------
    var renderTile = function (t) {
        var years = (t.papers || []).map(function (p) { return p.year; });
        var year = years.length ? Math.max.apply(null, years) : "";
        var papers = (t.papers || []).map(function (p) {
            return "<li>" + esc(p.cite) + " · <em>" + esc(p.venue) + "</em>, " + esc(p.year) + "</li>";
        }).join("");
        var variants = (t.variants || []).map(function (v, i) {
            return '<button class="mg-chip" type="button" data-file="' + esc(v.file) + '" aria-pressed="' + (v.file === t.file) + '">' + esc(v.label) + '</button>';
        }).join("");

        var tile = $(
            '<article class="mg-tile" id="tile_' + esc(t.id) + '">' +
            '  <div class="mg-tile-media" role="button" tabindex="-1" aria-hidden="true">' +
            '    <img src="' + esc(t.image) + '" alt="" loading="lazy">' +
            (year ? '<span class="mg-year">' + esc(year) + '</span>' : '') +
            '  </div>' +
            '  <div class="mg-tile-body">' +
            '    <p class="mg-eyebrow">Showcasing</p>' +
            '    <h2>' + esc(t.title) + '</h2>' +
            '    <p class="mg-showcasing">' + esc(t.showcasing) + '</p>' +
            '    <p class="mg-desc">' + esc(t.description) + '</p>' +
            (variants ? '<div class="mg-variants" role="group" aria-label="Variant">' + variants + '</div>' : '') +
            (papers ? '<ul class="mg-papers">' + papers + '</ul>' : '') +
            (t.note ? '<p class="mg-note">' + esc(t.note) + '</p>' : '') +
            '  </div>' +
            '  <div class="mg-tile-foot">' +
            '    <span class="mg-file" title="Scenario file">' + esc(t.file) + '</span>' +
            '    <button class="mg-btn mg-btn-primary" type="button">Launch</button>' +
            '  </div>' +
            '</article>');

        var selected = t.file;
        var button = tile.find(".mg-tile-foot .mg-btn");
        tile.find(".mg-chip").on("click", function () {
            selected = $(this).data("file");
            tile.find(".mg-chip").attr("aria-pressed", "false");
            $(this).attr("aria-pressed", "true");
            tile.find(".mg-file").text(selected);
        });
        button.on("click", function () { launchScenario(selected, button); });
        tile.find(".mg-tile-media").on("click", function () { launchScenario(selected, button); });
        return tile;
    };

    $.getJSON("showcase/showcase.json", function (data) {
        var sandbox = $("#sandboxTile");
        (data.tiles || []).forEach(function (t) { sandbox.before(renderTile(t)); });
    }).fail(function () {
        showError("Unable to load the showcase list.");
    });

    // ------ Sandbox ------
    $("#sandboxMedia").on('click', function () { $("#buttonSandboxMode").click(); });
    $("#buttonSandboxMode").on('click', function () {
        $.post('/mode/sandbox', function () {
            window.location = "/sandbox.html";
        }).fail(function () { showError("Unable to open the sandbox."); });
    });

    // ------ In-progress banner ------
    $("#buttonResumeOperation").on('click', function () {
        window.location = "/sandbox.html";
    });
    $("#buttonAbortOperation").on('click', function () {
        $.post('/reset', function () {
            $("#inProgressBanner").prop("hidden", true);
        });
    });

    // ------ All scenarios ------
    var modal = $("#loadScenarioDiv");
    var list = $("#scenarioList");
    var search = $("#scenarioSearch");
    var startButton = $("#buttonStartScenario");
    var selectedFile = null;

    $("#buttonLoadScenario").on('click', function () {
        modal.prop("hidden", false);
        search.val("").trigger("input").focus();
    });
    var closeModal = function () {
        modal.prop("hidden", true);
        list.children().removeClass("selected");
        selectedFile = null;
        startButton.prop("disabled", true);
    };
    $("#buttonCancelLoadScenario").on('click', closeModal);
    modal.on('click', function (e) { if (e.target === modal[0]) closeModal(); });
    $(document).on('keydown', function (e) { if (e.key === "Escape" && !modal.prop("hidden")) closeModal(); });

    search.on('input', function () {
        var q = search.val().toLowerCase();
        list.children().each(function () {
            $(this).toggle($(this).text().toLowerCase().indexOf(q) !== -1);
        });
    });
    startButton.on('click', function () {
        if (selectedFile) launchScenario(selectedFile, startButton);
    });

    $.get("/mode/scenario-list", {}, function (data) {
        var items = [];
        for (var i in data) items.push(data[i]);
        items.sort(function (a, b) { return String(a.gameId).localeCompare(String(b.gameId)); });
        items.forEach(function (s) {
            var li = $("<li>").append($("<span>").text(s.gameId)).append($("<small>").text(s.fileName));
            li.on('click', function () {
                list.children().removeClass("selected");
                li.addClass("selected");
                selectedFile = s.fileName;
                startButton.prop("disabled", false);
            });
            li.on('dblclick', function () { launchScenario(s.fileName, startButton); });
            list.append(li);
        });
    }).fail(function () {
        showError("Unable to get the scenario list.");
    });

    $.get("/mode/in-progress", {}, function (data) {
        if (String(data) === 'true') {
            $("#inProgressBanner").prop("hidden", false);
        } else {
            // Ensure any scenario is loaded with a clean slate
            $.post('/reset');
        }
    }).fail(function () {
        showError("Unable to connect to the server.");
    });
}
