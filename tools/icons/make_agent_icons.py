#!/usr/bin/env python3
"""Generate the modern-look agent marker SVGs (top-down quadrotor, fixed wing, UGV, hub).

Writes server/web/icons/modern/src/*.svg. Then run render_agent_icons.js to rasterise them to
60x60 PNGs in server/web/icons/modern/ (the same size and anchor as the classic icons/used/*.png).
All icons point north (heading 0); the map rotates the <img> by the agent's heading.
"""
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "server", "web", "icons", "modern", "src")

NAVY, NAVY_900, BLUE, BLUE_300 = "#133d5b", "#0d2a40", "#26759e", "#3093c7"
ORANGE, RED, GREY = "#e78404", "#a32020", "#6b7780"

# Degradation-study team colours (marker "UAV-<colour>")
TEAM = {
    "blue": "#2f6fdf", "cyan": "#13a6c6", "green": "#2f9e33", "orange": "#f08a00",
    "pink": "#e0529c", "purple": "#8a4fd0", "red": "#d63a3a", "yellow": "#e3bb12",
}

SHADOW = ('<filter id="s" x="-20%" y="-20%" width="140%" height="140%">'
          '<feDropShadow dx="0" dy="1" stdDeviation="1.1" flood-color="#0d2a40" flood-opacity=".45"/></filter>')


def svg(body, extra_defs=""):
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">'
            f'<defs>{SHADOW}{extra_defs}</defs><g filter="url(#s)">{body}</g></svg>\n')


def quad(body=NAVY, rotor=BLUE_300, ring=BLUE, front=ORANGE, opacity=1.0, dashed=False,
         pack=False, halo=None, scale=1.0, outline="#fff"):
    rotors = [(15, 15), (45, 15), (15, 45), (45, 45)]
    p = []
    if halo:
        p.append(f'<circle cx="30" cy="30" r="27" fill="{halo}" fill-opacity=".18" stroke="{halo}" stroke-width="2.5"/>')
    # rotor discs first; the front pair is ringed in the heading colour
    dash = ' stroke-dasharray="3 2.4"' if dashed else ""
    for (x, y) in rotors:
        p.append(f'<circle cx="{x}" cy="{y}" r="10.5" fill="{rotor}" fill-opacity=".3" stroke="{outline}" stroke-width="3.6"/>')
        p.append(f'<circle cx="{x}" cy="{y}" r="10.5" fill="none" stroke="{front if y < 30 else ring}" stroke-width="2"{dash}/>')
    # arms on top, with a casing so they read on any map
    for (x, y) in rotors:
        p.append(f'<line x1="30" y1="30" x2="{x}" y2="{y}" stroke="{outline}" stroke-width="6.4" stroke-linecap="round"/>')
    for (x, y) in rotors:
        p.append(f'<line x1="30" y1="30" x2="{x}" y2="{y}" stroke="{body}" stroke-width="3.4" stroke-linecap="round"/>')
    for (x, y) in rotors:
        p.append(f'<circle cx="{x}" cy="{y}" r="3" fill="{body}" stroke="{outline}" stroke-width="1.2"/>')
    # body with a nose pointing north
    p.append(f'<path d="M30 16 L38.5 23 V37 Q38.5 41.5 34 41.5 H26 Q21.5 41.5 21.5 37 V23 Z" fill="{body}" stroke="{outline}" stroke-width="2" stroke-linejoin="round"/>')
    p.append(f'<path d="M30 19.2 L35 23.6 H25 Z" fill="{front}"/>')
    if pack:
        p.append('<rect x="24.5" y="28" width="11" height="11" rx="1.5" fill="#d9a54c" stroke="#fff" stroke-width="1.4"/>'
                 '<path d="M30 28 V39 M24.5 33.5 H35.5" stroke="#8a5f1e" stroke-width="1.3"/>')
    g = "".join(p)
    t = []
    if scale != 1.0:
        t.append(f'translate(30 30) scale({scale}) translate(-30 -30)')
    attrs = (f' transform="{t[0]}"' if t else "") + (f' opacity="{opacity}"' if opacity != 1.0 else "")
    return svg(f'<g{attrs}>{g}</g>')


def fixed_wing(body=NAVY, front=ORANGE, halo=None):
    p = []
    if halo:
        p.append(f'<circle cx="30" cy="30" r="27" fill="{halo}" fill-opacity=".18" stroke="{halo}" stroke-width="2.5"/>')
    plane = ("M30 5 Q33 5 33 11 V22 L54 32 V36.5 L33 31.5 V45 L40 50 V53.5 L30 51 L20 53.5 V50 "
             "L27 45 V31.5 L6 36.5 V32 L27 22 V11 Q27 5 30 5 Z")
    p.append(f'<path d="{plane}" fill="{body}" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>')
    p.append(f'<path d="M30 7.2 Q31.6 7.2 31.6 11 V13 H28.4 V11 Q28.4 7.2 30 7.2 Z" fill="{front}"/>')
    p.append(f'<path d="M33 24 L50 32.3 M27 24 L10 32.3" stroke="{BLUE_300}" stroke-width="1.4" stroke-linecap="round"/>')
    return svg("".join(p))


def ugv(body=NAVY, front=ORANGE, halo=None):
    p = []
    if halo:
        p.append(f'<circle cx="30" cy="30" r="27" fill="{halo}" fill-opacity=".18" stroke="{halo}" stroke-width="2.5"/>')
    for x in (15.5, 39.5):
        for y in (14, 36):
            p.append(f'<rect x="{x}" y="{y}" width="5" height="11" rx="1.6" fill="#2a2f33" stroke="#fff" stroke-width="1.6"/>')
    p.append(f'<rect x="19" y="10" width="22" height="40" rx="5" fill="{body}" stroke="#fff" stroke-width="2.2"/>')
    p.append(f'<path d="M22 17 Q30 12.5 38 17 V21 H22 Z" fill="{front}"/>')
    p.append(f'<rect x="23.5" y="26" width="13" height="17" rx="2" fill="none" stroke="{BLUE_300}" stroke-width="1.5"/>')
    p.append(f'<circle cx="30" cy="34.5" r="2.6" fill="{BLUE_300}"/>')
    return svg("".join(p))


def hub():
    p = ['<circle cx="30" cy="30" r="21" fill="#fff" stroke="#fff" stroke-width="3"/>',
         f'<circle cx="30" cy="30" r="19" fill="{NAVY}" fill-opacity=".1" stroke="{NAVY}" stroke-width="3"/>',
         f'<circle cx="30" cy="30" r="13.5" fill="none" stroke="{ORANGE}" stroke-width="1.8" stroke-dasharray="4 3"/>',
         # rotationally symmetric on purpose: the map rotates markers by heading, so letters would tumble
         f'<circle cx="30" cy="30" r="6.5" fill="{NAVY}" stroke="#fff" stroke-width="1.5"/>',
         f'<circle cx="30" cy="30" r="2.4" fill="{ORANGE}"/>']
    return svg("".join(p))


ICONS = {
    "uav": quad(),
    "uav_selected": quad(halo=ORANGE),
    "uav_manual": quad(body=RED, rotor="#e06b6b", ring=RED, front=ORANGE),
    "uav_with_pack": quad(pack=True),
    "uav_timedout": quad(body=GREY, rotor="#a7b0b6", ring=GREY, front="#a7b0b6", opacity=.7, dashed=True),
    "uav_mini": quad(body="#fff", rotor="#fff", ring=NAVY, front=ORANGE, outline=NAVY, scale=.5),
    "fixedwing": fixed_wing(),
    "fixedwing_selected": fixed_wing(halo=ORANGE),
    "ugv": ugv(),
    "ugv_selected": ugv(halo=ORANGE),
    "hub": hub(),
}
for name, col in TEAM.items():
    ICONS[f"uav-{name}"] = quad(body=col, rotor=col, ring=col, front=NAVY_900)

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, text in ICONS.items():
        with open(os.path.join(OUT, name + ".svg"), "w") as f:
            f.write(text)
    print(f"wrote {len(ICONS)} SVGs to {os.path.normpath(OUT)}")
