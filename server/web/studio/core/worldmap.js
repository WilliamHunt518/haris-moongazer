// A map in study world units.
//
// The study world is a flat W x H rectangle (1400 x 800 in StratTac). With a Google Maps key it is laid over the
// terrain map inside the scenario's bounding box; without one it is drawn on a plain grid. Either way panels draw
// into one SVG whose user units are world units, so the drawing code never deals with latitude and longitude.
const SVG_NS = "http://www.w3.org/2000/svg";
let mapsPromise = null;
const liveMaps = new Set();

export function svgEl(tag, attrs, parent) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
}

function loadGoogleMaps() {
    const key = window.HARIS_MAPS_KEY;
    if (!key || key.indexOf("%") === 0) return Promise.resolve(null);
    if (mapsPromise) return mapsPromise;
    mapsPromise = new Promise((resolve) => {
        window.__stMapsReady = () => resolve(window.google && window.google.maps ? window.google.maps : null);
        // Called by Google when the key is refused: every live map falls back to the grid
        window.gm_authFailure = () => { for (const m of liveMaps) m.toGrid("Map key refused"); };
        const s = document.createElement("script");
        s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key) + "&v=3.64&callback=__stMapsReady";
        s.async = true;
        s.onerror = () => resolve(null);
        document.head.appendChild(s);
    });
    return mapsPromise;
}

/**
 * createWorldMap(el, ctx, options)
 *   options.gestures: "greedy" (pan and zoom with the mouse, default) or "none" (fixed; for drag-heavy views)
 * Returns { svg, layer(name), fit(rect, paddingPx), clientToWorld(x, y), onRedraw(fn), destroy() }.
 */
export function createWorldMap(el, ctx, options = {}) {
    const st = ctx.config.strattac || {};
    const world = st.world || {};
    const W = world.width || 1400, H = world.height || 800;
    const bbox = (st.map && st.map.bbox) || null;
    const wrap = document.createElement("div");
    wrap.className = "st-map";
    el.appendChild(wrap);

    const svg = svgEl("svg", { class: "st-world", viewBox: `0 0 ${W} ${H}` });
    const layers = {};
    const redrawFns = [];
    let fitRect = { x: 0, y: 0, w: W, h: H }, fitPad = 0;
    let gmap = null, overlay = null, gridEl = null, mode = "pending", note = null;

    function layer(name) {
        if (!layers[name]) layers[name] = svgEl("g", { "data-layer": name }, svg);
        return layers[name];
    }

    function setNote(text) {
        if (!note) { note = document.createElement("div"); note.className = "st-map-note"; wrap.appendChild(note); }
        note.textContent = text || "";
    }

    function toGrid(reason) {
        if (mode === "grid") return;
        if (gmap) { overlay.setMap(null); gmap = null; overlay = null; wrap.innerHTML = ""; note = null; }
        mode = "grid";
        gridEl = document.createElement("div");
        gridEl.className = "st-map-grid";
        wrap.appendChild(gridEl);
        Object.assign(svg.style, { left: "0", top: "0", width: "100%", height: "100%" });
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        wrap.appendChild(svg);
        if (reason) setNote(reason + "; showing a plain grid");
        applyFit();
    }

    function applyFit() {
        if (mode === "grid") {
            // Padding is in screen pixels; convert roughly using the current scale
            const r = wrap.getBoundingClientRect();
            const scale = Math.min((r.width || 1) / fitRect.w, (r.height || 1) / fitRect.h) || 1;
            const p = fitPad / scale;
            svg.setAttribute("viewBox", `${fitRect.x - p} ${fitRect.y - p} ${fitRect.w + 2 * p} ${fitRect.h + 2 * p}`);
            redrawFns.forEach((f) => f());
        } else if (mode === "google" && gmap) {
            const g = window.google.maps;
            const nw = worldToLatLng(fitRect.x, fitRect.y), se = worldToLatLng(fitRect.x + fitRect.w, fitRect.y + fitRect.h);
            gmap.fitBounds(new g.LatLngBounds({ lat: se.lat, lng: nw.lng }, { lat: nw.lat, lng: se.lng }), fitPad);
        }
    }

    function worldToLatLng(x, y) {
        return {
            lat: bbox.north - (y / H) * (bbox.north - bbox.south),
            lng: bbox.west + (x / W) * (bbox.east - bbox.west),
        };
    }

    async function start() {
        const maps = bbox ? await loadGoogleMaps() : null;
        if (!maps || mode === "grid") { toGrid(bbox && !maps ? "No map key" : null); return; }
        mode = "google";
        const mapDiv = document.createElement("div");
        mapDiv.style.cssText = "position:absolute;inset:0";
        wrap.appendChild(mapDiv);
        const bounds = new maps.LatLngBounds({ lat: bbox.south, lng: bbox.west }, { lat: bbox.north, lng: bbox.east });
        gmap = new maps.Map(mapDiv, {
            mapTypeId: (st.map && st.map.type) || "terrain",
            disableDefaultUI: true,
            zoomControl: options.gestures !== "none",
            gestureHandling: options.gestures || "greedy",
            clickableIcons: false,
            keyboardShortcuts: false,
            isFractionalZoomEnabled: true,
            backgroundColor: "#0b1220",
            restriction: { latLngBounds: bounds, strictBounds: false },
            styles: [{ featureType: "poi", stylers: [{ visibility: "off" }] }],
        });
        Object.assign(svg.style, {});
        svg.setAttribute("preserveAspectRatio", "none");
        overlay = new maps.OverlayView();
        overlay.onAdd = function () { this.getPanes().overlayMouseTarget.appendChild(svg); };
        overlay.draw = function () {
            const proj = this.getProjection();
            if (!proj) return;
            const a = proj.fromLatLngToDivPixel(new maps.LatLng(bbox.north, bbox.west));
            const b = proj.fromLatLngToDivPixel(new maps.LatLng(bbox.south, bbox.east));
            Object.assign(svg.style, { left: a.x + "px", top: a.y + "px", width: (b.x - a.x) + "px", height: (b.y - a.y) + "px" });
            redrawFns.forEach((f) => f());
        };
        overlay.onRemove = function () { svg.remove(); };
        overlay.setMap(gmap);
        maps.event.addListenerOnce(gmap, "idle", () => {
            applyFit();
            // Do not let the operator zoom out past the whole study area
            maps.event.addListenerOnce(gmap, "idle", () => gmap.setOptions({ minZoom: Math.floor(gmap.getZoom()) }));
        });
        applyFit();
    }

    const ro = new ResizeObserver(() => applyFit());
    ro.observe(wrap);
    const api = {
        svg, layer, toGrid,
        get mode() { return mode; },
        world: { W, H },
        fit(rect, paddingPx = 0) { fitRect = rect || { x: 0, y: 0, w: W, h: H }; fitPad = paddingPx; applyFit(); },
        clientToWorld(cx, cy) {
            const m = svg.getScreenCTM();
            if (!m) return { x: 0, y: 0 };
            const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
            return { x: p.x, y: p.y };
        },
        onRedraw(fn) { redrawFns.push(fn); },
        setGestures(on) { if (gmap) gmap.setOptions({ gestureHandling: on ? (options.gestures || "greedy") : "none", draggable: on }); },
        destroy() { ro.disconnect(); liveMaps.delete(api); if (overlay) overlay.setMap(null); wrap.remove(); },
    };
    liveMaps.add(api);
    start();
    return api;
}
