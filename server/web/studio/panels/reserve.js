// Reserve strip: drones of each type available at the hub, out of the fleet, plus the mission-category forecast.
import { registerPanel } from "../core/registry.js";
import { TYPES, esc, patch, div, typeOf } from "../core/study.js";

registerPanel("reserve", {
    create(el, ctx) {
        el.style.flex = "none";
        const strip = div("st-reserve", el);
        strip.dataset.tutorial = "reserve-strip";
        return {
            update(s) {
                let html = '<span class="st-reserve-label">Reserve</span>';
                for (const type of TYPES) {
                    const t = typeOf(ctx, type);
                    const avail = s.reserve[type] || 0;
                    const total = s.assets.filter((a) => a.type === type).length;
                    const returning = s.assets.filter((a) => a.type === type && a.status === "returning").length;
                    html += `<span class="st-reserve-type" style="color:${esc(t.text || t.colour)}" title="${esc(t.label)}">`
                        + `<img src="${esc(t.icon)}" alt="" style="width:24px;height:24px">`
                        + `<b>${avail}</b><small>/${total} (${total - avail} out${returning ? ", " + returning + " rtg" : ""})</small></span>`;
                }
                if (s.categoryForecast) {
                    const f = ["A", "B", "C", "D", "E"].filter((c) => s.categoryForecast[c] > 0.1)
                        .map((c) => c + Math.round(s.categoryForecast[c] * 100) + "%").join(" ");
                    html += `<span class="st-forecast" title="Expected mix of incoming mission categories">${f}</span>`;
                }
                patch(strip, html);
            },
        };
    },
});
