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
 *   options.cover: on the grid, zoom out only as far as the area still fills the panel (the original strategic map)
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
        if (options.gestures !== "none") gridGestures();
        applyFit();
    }

    // Scroll to zoom and drag to pan on the grid (Google Maps does this itself on terrain)
    let zoomView = null, dragged = false, gesturesOn = true;
    function gridGestures() {
        svg.addEventListener("wheel", (e) => {
            if (!gesturesOn) return;
            e.preventDefault();
            const v = currentView(), p = api.clientToWorld(e.clientX, e.clientY);
            const f = e.deltaY < 0 ? 1 / 1.2 : 1.2;
            const w = Math.min(fullView().w, Math.max(fullView().w / 8, v.w * f)), k = w / v.w, h = v.h * k;
            setZoomView({ x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k, w, h });
        }, { passive: false });
        let down = null;
        svg.addEventListener("pointerdown", (e) => {
            if (!gesturesOn || e.button !== 0) return;
            down = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
            dragged = false;
        });
        svg.addEventListener("pointermove", (e) => {
            if (!down || e.pointerId !== down.id) return;
            const dx = e.clientX - down.x, dy = e.clientY - down.y;
            if (!down.moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
            if (!down.moved) { down.moved = true; dragged = true; svg.setPointerCapture(e.pointerId); svg.style.cursor = "grabbing"; }
            const r = svg.getBoundingClientRect(), v = currentView();
            const k = Math.max(v.w / r.width, v.h / r.height);
            setZoomView({ x: v.x - dx * k, y: v.y - dy * k, w: v.w, h: v.h });
            down.x = e.clientX; down.y = e.clientY;
        });
        const up = () => { down = null; svg.style.cursor = ""; };
        svg.addEventListener("pointerup", up);
        svg.addEventListener("pointercancel", up);
        // A click that ends a drag is not a click on whatever is under the pointer
        svg.addEventListener("click", (e) => { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; } }, true);
    }
    // The area panning may reach: the fitted rectangle plus padding
    function bounds() {
        const r = wrap.getBoundingClientRect();
        const scale = Math.min((r.width || 1) / fitRect.w, (r.height || 1) / fitRect.h) || 1;
        const p = fitPad / scale;
        return { x: fitRect.x - p, y: fitRect.y - p, w: fitRect.w + 2 * p, h: fitRect.h + 2 * p };
    }
    // The zoomed-out view: the whole fitted area, or with options.cover the largest part of it that fills the panel
    function fullView() {
        const b = bounds();
        if (!options.cover) return b;
        const r = wrap.getBoundingClientRect();
        const aspect = (r.width || 1) / (r.height || 1);
        const w = Math.min(b.w, b.h * aspect), h = Math.min(b.h, b.w / aspect);
        return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h };
    }
    function currentView() { return zoomView || fullView(); }
    function setZoomView(v) {
        const f = fullView(), b = bounds();
        if (v.w > f.w) { v.x += (v.w - f.w) / 2; v.y += (v.h - f.h) / 2; v.w = f.w; v.h = f.h; }
        v.x = Math.min(b.x + b.w - v.w, Math.max(b.x, v.x));
        v.y = Math.min(b.y + b.h - v.h, Math.max(b.y, v.y));
        zoomView = v;
        applyFit();
    }

    function applyFit() {
        if (mode === "grid") {
            const v = currentView();
            svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
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

    const ro = new ResizeObserver(() => { zoomView = null; applyFit(); });
    ro.observe(wrap);
    const api = {
        svg, layer, toGrid,
        get mode() { return mode; },
        world: { W, H },
        fit(rect, paddingPx = 0) { fitRect = rect || { x: 0, y: 0, w: W, h: H }; fitPad = paddingPx; zoomView = null; applyFit(); },
        clientToWorld(cx, cy) {
            const m = svg.getScreenCTM();
            if (!m) return { x: 0, y: 0 };
            const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
            return { x: p.x, y: p.y };
        },
        onRedraw(fn) { redrawFns.push(fn); },
        setGestures(on) { gesturesOn = on; if (gmap) gmap.setOptions({ gestureHandling: on ? (options.gestures || "greedy") : "none", draggable: on }); },
        destroy() { ro.disconnect(); liveMaps.delete(api); if (overlay) overlay.setMap(null); wrap.remove(); },
    };
    liveMaps.add(api);
    start();
    return api;
}
