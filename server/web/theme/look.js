/*
 * HARIS Moongazer look switch: "modern" (default) or "classic" (the interface exactly as it was).
 * Set with ?look=classic or ?look=modern, or the switch on the launch page; remembered in localStorage.
 * Load this synchronously in <head>, after any <link data-mg-theme> stylesheets it should turn off.
 */
(function () {
    var look = "modern";
    try {
        var q = new URLSearchParams(window.location.search).get("look");
        if (q === "classic" || q === "modern") window.localStorage.setItem("mg-look", q);
        if (window.localStorage.getItem("mg-look") === "classic") look = "classic";
    } catch (e) { /* storage blocked: use modern */ }
    window.MG_LOOK = look;
    document.documentElement.setAttribute("data-look", look);
    if (look === "classic") {
        var links = document.querySelectorAll("link[data-mg-theme]");
        for (var i = 0; i < links.length; i++) links[i].disabled = true;
        // Markup that only exists in the modern look
        var s = document.createElement("style");
        s.textContent = ".mg-modern-only { display: none !important; }";
        document.head.appendChild(s);
    }
    /** Engine tick rate that goes with each look: the original 5 Hz, or 10 Hz for smoother movement. */
    window.MG_LOOK_TICK_RATE = look === "classic" ? 5 : 10;
})();
