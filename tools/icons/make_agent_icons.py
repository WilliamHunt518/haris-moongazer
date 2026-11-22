#!/usr/bin/env python3
"""Generate the modern-look agent marker SVGs (top-down quadrotor, fixed wing, UGV, hub).

They follow the classic icons' style: one colour per state, shaded from near-white at the
front to the full colour at the back, with a dark outline in the same hue.

Writes server/web/icons/modern/src/*.svg. Then run render_agent_icons.js to rasterise them to
60x60 PNGs in server/web/icons/modern/ (the same size and anchor as the classic icons/used/*.png).
All icons point north (heading 0); the map rotates the <img> by the agent's heading.
"""
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "server", "web", "icons", "modern", "src")

# (front tint, back colour, outline), sampled from the classic icons in icons/used/
UAV = ("#f1f6ff", "#1c4bfa", "#161a2e")
SELECTED = ("#ffe3f3", "#ff49f6", "#ff1d33")
MANUAL = ("#f8f1f3", "#f91b1b", "#2c1515")
TIMED_OUT = ("#515151", "#1a1a1a", "#090909")
MINI = ("#ffffff", "#e6e6e6", "#111111")
TEAM = {
    "blue": ("#f1f6ff", "#1c66fa", "#161e2e"), "cyan": ("#f1ffff", "#1cfafa", "#162e2e"),
    "green": ("#f1fff1", "#1cfa1c", "#162e16"), "orange": ("#fff8f1", "#fa8b1c", "#2e2216"),
    "pink": ("#fff1fc", "#fa1cc3", "#2e1628"), "purple": ("#f8f1ff", "#8b1cfa", "#22162e"),
    "red": ("#fff1f1", "#fa1c1c", "#2e1616"), "yellow": ("#fffef1", "#fae81c", "#2e2c16"),
}
PACK = "#f1cb95"

SHADOW = ('<filter id="s" x="-20%" y="-20%" width="140%" height="140%">'
          '<feDropShadow dx="1" dy="1.5" stdDeviation="1" flood-color="#000" flood-opacity=".4"/></filter>')


def svg(body, style, y0=6, y1=54):
    top, bottom, _ = style
    grad = (f'<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="{y0}" x2="0" y2="{y1}">'
            f'<stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">'
            f'<defs>{SHADOW}{grad}</defs><g filter="url(#s)">{body}</g></svg>\n')


def shape(parts, style, width=2.2):
    """Draw parts (svg element strings without fill/stroke) as one outlined silhouette."""
    line = style[2]
    casing = "".join(p.replace("/>", f' fill="{line}" stroke="{line}" stroke-width="{2 * width}" stroke-linejoin="round" stroke-linecap="round"/>') for p in parts)
    fill = "".join(p.replace("/>", ' fill="url(#g)" stroke="url(#g)" stroke-linecap="round"/>') for p in parts)
    return casing + fill


ROTORS = [(14, 14), (46, 14), (14, 46), (46, 46)]


def quad(style, pack=False, scale=1.0):
    line = style[2]
    arms = "".join(f'<line x1="30" y1="30" x2="{x}" y2="{y}"/>' for (x, y) in ROTORS)
    body = (f'<g stroke="{line}" stroke-width="7.4" stroke-linecap="round">{arms}</g>'
            + shape([f'<circle cx="{x}" cy="{y}" r="9"/>' for (x, y) in ROTORS]
                    + ['<path d="M30 17 L36.5 23 V37 Q36.5 41 33 41 H27 Q23.5 41 23.5 37 V23 Z"/>'], style)
            + f'<g stroke="url(#g)" stroke-width="3.2" stroke-linecap="round">{arms}</g>')
    # rotor hubs and blade hint, in the outline colour so they stay subtle
    for (x, y) in ROTORS:
        body += f'<circle cx="{x}" cy="{y}" r="5.8" fill="none" stroke="{line}" stroke-opacity=".25" stroke-width="1"/>'
        body += f'<circle cx="{x}" cy="{y}" r="2" fill="{line}" fill-opacity=".55"/>'
    body += f'<path d="M30 17 L36.5 23 V37 Q36.5 41 33 41 H27 Q23.5 41 23.5 37 V23 Z" fill="none" stroke="{line}" stroke-opacity=".55" stroke-width="1.2"/>'
    if pack:
        body += (f'<rect x="25" y="27.5" width="10" height="10" fill="{PACK}" stroke="{line}" stroke-width="1"/>'
                 f'<path d="M30 27.5 V37.5 M25 32.5 H35" stroke="{line}" stroke-opacity=".6" stroke-width="1"/>')
    if scale != 1.0:
        body = f'<g transform="translate(30 30) scale({scale}) translate(-30 -30)">{body}</g>'
    return svg(body, style)


def fixed_wing(style):
    plane = ("M30 5 Q33 5 33 11 V22 L54 32 V36.5 L33 31.5 V45 L40 50 V53.5 L30 51 L20 53.5 V50 "
             "L27 45 V31.5 L6 36.5 V32 L27 22 V11 Q27 5 30 5 Z")
    return svg(shape([f'<path d="{plane}"/>'], style), style)


def ugv(style):
    line = style[2]
    wheels = "".join(f'<rect x="{x}" y="{y}" width="6" height="12" rx="1.5" fill="#333" stroke="{line}" stroke-width="1.5"/>'
                     for x in (15, 39) for y in (13, 35))
    body = shape(['<rect x="19.5" y="9" width="21" height="42" rx="5"/>'], style)
    body += f'<path d="M23 18 Q30 13.5 37 18" fill="none" stroke="{line}" stroke-opacity=".6" stroke-width="1.4"/>'
    body += f'<rect x="23.5" y="25" width="13" height="19" rx="2" fill="none" stroke="{line}" stroke-opacity=".45" stroke-width="1.2"/>'
    return svg(wheels + body, style)


def hub(style):
    line = style[2]
    body = shape(['<circle cx="30" cy="30" r="20"/>'], style)
    # rotationally symmetric on purpose: the map rotates markers by heading, so letters would tumble
    body += f'<circle cx="30" cy="30" r="13" fill="none" stroke="#fff" stroke-width="2.4"/>'
    body += f'<circle cx="30" cy="30" r="5" fill="#fff" stroke="{line}" stroke-opacity=".6" stroke-width="1"/>'
    return svg(body, style, 10, 50)


ICONS = {
    "uav": quad(UAV),
    "uav_selected": quad(SELECTED),
    "uav_manual": quad(MANUAL),
    "uav_with_pack": quad(UAV, pack=True),
    "uav_timedout": quad(TIMED_OUT),
    "uav_mini": quad(MINI, scale=.5),
    "fixedwing": fixed_wing(UAV),
    "fixedwing_selected": fixed_wing(SELECTED),
    "ugv": ugv(UAV),
    "ugv_selected": ugv(SELECTED),
    "hub": hub(UAV),
}
for name, style in TEAM.items():
    ICONS[f"uav-{name}"] = quad(style)

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, text in ICONS.items():
        with open(os.path.join(OUT, name + ".svg"), "w") as f:
            f.write(text)
    print(f"wrote {len(ICONS)} SVGs to {os.path.normpath(OUT)}")
