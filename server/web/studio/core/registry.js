// Panel registry for the interface configurator.
//
// A panel is a named building block of a view (a header, a map, a mission list...). Each registers a factory:
//   registerPanel("name", { title, create(el, ctx, options) -> { update(state), destroy() } })
// The scenario's interface block then places panels by name, so a new interface is a JSON change, not new code.
const panels = new Map();

export function registerPanel(name, def) {
    if (panels.has(name)) throw new Error("Panel already registered: " + name);
    panels.set(name, def);
}

export function getPanel(name) {
    return panels.get(name);
}

export function panelNames() {
    return [...panels.keys()];
}
