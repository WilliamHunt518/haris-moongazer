// Builds a view's DOM from its layout tree.
//
// A node is one of:
//   {"panel": "name", "options": {...}, "width": 440, "height": 120, "flex": 1}
//   {"row": [nodes...]}  or  {"column": [nodes...]}   (also take width/height/flex)
// Panels that are not registered show a placeholder, so a layout can name panels before they exist.
import { getPanel } from "./registry.js";

function size(el, node) {
    if (node.width != null) { el.style.flex = "none"; el.style.width = node.width + "px"; }
    if (node.height != null) { el.style.flex = "none"; el.style.height = node.height + "px"; }
    if (node.flex != null) el.style.flex = String(node.flex) + " 1 0";
}

export function buildLayout(parent, node, ctx, instances) {
    if (node.row || node.column) {
        const el = document.createElement("div");
        el.className = node.row ? "st-row" : "st-col";
        size(el, node);
        for (const child of node.row || node.column) buildLayout(el, child, ctx, instances);
        parent.appendChild(el);
        return el;
    }
    const cell = document.createElement("div");
    cell.className = "st-cell";
    cell.dataset.panel = node.panel;
    size(cell, node);
    parent.appendChild(cell);
    const def = getPanel(node.panel);
    if (!def) {
        cell.innerHTML = '<div class="st-placeholder">Panel <code></code> is not available yet.</div>';
        cell.querySelector("code").textContent = node.panel;
        return cell;
    }
    try {
        const inst = def.create(cell, ctx, node.options || {});
        if (inst) instances.push(inst);
    } catch (e) {
        console.error("Panel " + node.panel + " failed to start", e);
        cell.innerHTML = '<div class="st-placeholder">Panel <code></code> failed to start.</div>';
        cell.querySelector("code").textContent = node.panel;
    }
    return cell;
}
