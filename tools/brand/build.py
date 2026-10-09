#!/usr/bin/env python3
"""
Génère les logos Divertiflix en SVG vectoriel (fond transparent) dans packages/brand/.

Le dessin reprend le logo officiel fourni par le client : un D chromé dégradé bleu-violet vers magenta avec un
triangle de lecture dans le contre-poinçon, une pellicule en orbite qui passe devant puis derrière le D, le mot
DIVERTIFLIX en métal chromé et la signature « STREAM WITHOUT LIMITS ». Le texte est converti en tracés (Orbitron,
licence OFL) : aucun fichier de police n'est nécessaire à l'affichage.

Usage : python3 tools/brand/build.py        (nécessite fonttools)
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

HERE = Path(__file__).parent
OUT = HERE.parent.parent / 'packages' / 'brand' / 'assets'
OUT.mkdir(parents=True, exist_ok=True)

# ------------------------------------------------------------------ Palette (voir packages/brand/tokens.css)
BLUE, VIOLET, MAGENTA, ORANGE, CYAN = '#4f6bff', '#8a4dff', '#e440a4', '#ff8f3a', '#38c8ff'


def text_path(font_file: str, text: str, size: float, tracking: float = 0.0):
    """Texte vers un tracé SVG unique. Renvoie (d, largeur, hauteur de capitale) ; l'origine est le coin haut gauche."""
    font = TTFont(HERE / font_file)
    gs, cmap, upem = font.getGlyphSet(), font.getBestCmap(), font['head'].unitsPerEm
    cap = getattr(font['OS/2'], 'sCapHeight', 0) or upem * 0.72
    k = size / cap  # on dimensionne par la hauteur de capitale : `size` = hauteur des majuscules
    pen = SVGPathPen(gs)
    x = 0.0
    for ch in text:
        name = cmap[ord(ch)]
        tp = TransformPen(pen, (k, 0, 0, -k, x, cap * k))
        gs[name].draw(tp)
        x += gs[name].width * k + tracking
    return pen.getCommands(), x - tracking, cap * k


def ellipse_path(cx, cy, rx, ry):
    return f'M{cx - rx:.1f} {cy:.1f}A{rx} {ry} 0 1 0 {cx + rx:.1f} {cy:.1f}A{rx} {ry} 0 1 0 {cx - rx:.1f} {cy:.1f}Z'


# ------------------------------------------------------------------ La marque : D + lecture + pellicule
# Repère 1080 x 740. Le D occupe x 160..880, la pellicule déborde de part et d'autre.
D_OUTER = 'M175 5H560C770 5 880 150 880 360C880 570 770 715 560 715H175Q160 715 160 700V20Q160 5 175 5Z'
D_COUNTER = 'M370 125H520C660 125 725 230 725 320C725 410 660 515 520 515H370Z'
PLAY = 'M440 215L440 465L640 340Z'
RING = dict(cx=535, cy=412, rot=-12)


def mark_defs(uid: str, holes: bool = True) -> str:
    u = uid
    return f'''
  <linearGradient id="{u}body" x1="170" y1="20" x2="880" y2="720" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#4a3cf2"/><stop offset=".38" stop-color="#8a3fee"/><stop offset=".72" stop-color="#e440a4"/><stop offset="1" stop-color="#ff6a7a"/>
  </linearGradient>
  <linearGradient id="{u}lower" x1="0" y1="430" x2="0" y2="715" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#2f9bff" stop-opacity="0"/><stop offset="1" stop-color="#2aa6ff" stop-opacity=".95"/>
  </linearGradient>
  <linearGradient id="{u}gloss" x1="0" y1="5" x2="0" y2="360" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="{u}rim" x1="880" y1="5" x2="160" y2="715" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#ffb04a"/><stop offset=".3" stop-color="#ff5fa0"/><stop offset=".62" stop-color="#8a5cff"/><stop offset="1" stop-color="#38c8ff"/>
  </linearGradient>
  <linearGradient id="{u}counter" x1="370" y1="125" x2="725" y2="515" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#2a1a8f"/><stop offset="1" stop-color="#7b2fcf"/>
  </linearGradient>
  <linearGradient id="{u}play" x1="440" y1="215" x2="640" y2="465" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#ff4f6d"/><stop offset=".55" stop-color="#e440a4"/><stop offset="1" stop-color="#7d3cf0"/>
  </linearGradient>
  <linearGradient id="{u}strip" x1="-570" y1="0" x2="570" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#ff8f3a"/><stop offset=".16" stop-color="#e440a4"/><stop offset=".42" stop-color="#6f4dff"/><stop offset=".62" stop-color="#38b6ff"/><stop offset=".84" stop-color="#8a5cff"/><stop offset="1" stop-color="#ff8f3a"/>
  </linearGradient>
  <linearGradient id="{u}stripedge" x1="-570" y1="0" x2="570" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#ffd08a"/><stop offset=".3" stop-color="#ff86c8"/><stop offset=".6" stop-color="#9fe6ff"/><stop offset="1" stop-color="#ffd08a"/>
  </linearGradient>
  <mask id="{u}holes" maskUnits="userSpaceOnUse" x="-700" y="-400" width="1400" height="800">
    <rect x="-700" y="-400" width="1400" height="800" fill="#fff"/>
    {'' if not holes else f'<path d="{ellipse_path(0, -8, 541, 194)}" fill="none" stroke="#000" stroke-width="21" stroke-dasharray="30 24"/><path d="{ellipse_path(0, -26, 521, 166)}" fill="none" stroke="#000" stroke-width="17" stroke-dasharray="26 28" stroke-dashoffset="14"/>'}
  </mask>
  <clipPath id="{u}front"><rect x="-700" y="-2" width="1400" height="500"/></clipPath>'''


def ring(uid: str, front_only: bool = False) -> str:
    band = ellipse_path(0, 0, 562, 216) + ellipse_path(0, -42, 500, 134)
    g = (f'<g transform="translate({RING["cx"]} {RING["cy"]}) rotate({RING["rot"]})"'
         + (f' clip-path="url(#{uid}front)"' if front_only else '') + '>')
    return (g + f'<g mask="url(#{uid}holes)"><path d="{band}" fill-rule="evenodd" fill="url(#{uid}strip)"/></g>'
            f'<path d="{ellipse_path(0, 0, 562, 216)}" fill="none" stroke="url(#{uid}stripedge)" stroke-width="3.5" opacity=".9"/>'
            f'<path d="{ellipse_path(0, -42, 500, 134)}" fill="none" stroke="url(#{uid}stripedge)" stroke-width="3" opacity=".75"/></g>')


def mark_body(uid: str) -> str:
    u = uid
    return f'''
  <g>{ring(u)}</g>
  <g>
    <path d="{D_OUTER}{D_COUNTER}" fill-rule="evenodd" fill="url(#{u}body)"/>
    <path d="{D_OUTER}{D_COUNTER}" fill-rule="evenodd" fill="url(#{u}lower)"/>
    <path d="{D_OUTER}{D_COUNTER}" fill-rule="evenodd" fill="url(#{u}gloss)"/>
    <path d="{D_COUNTER}" fill="url(#{u}counter)"/>
    <path d="{D_COUNTER}" fill="none" stroke="#c9b6ff" stroke-opacity=".7" stroke-width="7" stroke-linejoin="round"/>
    <path d="{D_OUTER}" fill="none" stroke="url(#{u}rim)" stroke-width="12" stroke-linejoin="round"/>
    <path d="{D_OUTER}" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="2.5" stroke-linejoin="round" transform="translate(535 360) scale(.955) translate(-535 -360)"/>
    <path d="{PLAY}" fill="url(#{u}play)" stroke="url(#{u}play)" stroke-width="30" stroke-linejoin="round"/>
    <path d="M458 240L458 330L600 330Z" fill="#fff" fill-opacity=".22"/>
    <path d="{PLAY}" fill="none" stroke="#ffd0e8" stroke-opacity=".55" stroke-width="3" stroke-linejoin="round" transform="translate(540 340) scale(1.12) translate(-540 -340)"/>
  </g>
  <g>{ring(u, front_only=True)}</g>'''


def mark_svg(uid='m', holes=True, view='0 0 1080 740') -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" role="img" aria-label="Divertiflix"><defs>{mark_defs(uid, holes)}</defs>{mark_body(uid)}</svg>\n'


# ------------------------------------------------------------------ Mot-symbole chromé
def wordmark_group(uid: str, size=190, tracking=14, flat_fill=None):
    d, w, h = text_path('orbitron-latin-900-normal.woff', 'DIVERTIFLIX', size, tracking)
    if flat_fill:
        return f'<path d="{d}" fill="{flat_fill}"/>', w, h, ''
    defs = f'''
  <linearGradient id="{uid}chrome" x1="0" y1="0" x2="0" y2="{h:.1f}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#ffffff"/><stop offset=".34" stop-color="#d6d4f2"/><stop offset=".49" stop-color="#8a84d2"/><stop offset=".52" stop-color="#3f3598"/><stop offset=".6" stop-color="#9d97e2"/><stop offset=".85" stop-color="#e9e7fb"/><stop offset="1" stop-color="#9fe0ff"/>
  </linearGradient>
  <linearGradient id="{uid}bevel" x1="0" y1="0" x2="{w:.1f}" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#4a3cf2"/><stop offset=".5" stop-color="#8a3fee"/><stop offset="1" stop-color="#e440a4"/>
  </linearGradient>
  <linearGradient id="{uid}depth" x1="0" y1="0" x2="0" y2="{h + 12:.1f}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#5b35d8"/><stop offset="1" stop-color="#1a0d52"/>
  </linearGradient>'''
    # Le tracé des lettres est défini une seule fois ; l'extrusion et la face le référencent (fichier 5 fois plus léger).
    defs += f'\n  <path id="{uid}glyphs" d="{d}"/>'
    extrude = ''.join(f'<use href="#{uid}glyphs" transform="translate({i * 0.8:.1f} {i * 1.15:.1f})" fill="url(#{uid}depth)"/>' for i in range(8, 0, -1))
    face = (f'<use href="#{uid}glyphs" fill="url(#{uid}chrome)" stroke="url(#{uid}bevel)" stroke-width="3.2" paint-order="stroke" stroke-linejoin="round"/>'
            f'<use href="#{uid}glyphs" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.2" stroke-linejoin="round"/>')
    return extrude + face, w, h + 10, defs


def wordmark_svg() -> str:
    body, w, h, defs = wordmark_group('w')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 {w + 22:.0f} {h + 14:.0f}" role="img" aria-label="Divertiflix"><defs>{defs}</defs>{body}</svg>\n'


# ------------------------------------------------------------------ Logo complet : marque + mot-symbole + signature
def full_svg() -> str:
    uid = 'f'
    W = 1500
    size = 150
    for _ in range(3):  # la largeur du texte est proportionnelle à sa taille : on ajuste jusqu'à occuper 92 % du logo
        _, ww0, _ = text_path('orbitron-latin-900-normal.woff', 'DIVERTIFLIX', size, size * 0.08)
        size *= (W * 0.92) / ww0
    wbody, ww, wh, wdefs = wordmark_group(uid + 'w', size=size, tracking=size * 0.08)
    ox = (W - ww) / 2
    sign, sw, sh = text_path('orbitron-latin-700-normal.woff', 'STREAM WITHOUT LIMITS', 30, 14)
    sx = (W - sw) / 2
    y_word = 770
    y_sign = y_word + wh + 52
    line_y = y_sign + sh / 2
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {y_sign + sh + 30:.0f}" role="img" aria-label="Divertiflix, stream without limits">
<defs>{mark_defs(uid + 'm')}{wdefs}
  <linearGradient id="{uid}l1" x1="0" x2="1"><stop offset="0" stop-color="#e440a4"/><stop offset="1" stop-color="#6f4dff"/></linearGradient>
  <linearGradient id="{uid}l2" x1="0" x2="1"><stop offset="0" stop-color="#38c8ff"/><stop offset="1" stop-color="#4f6bff"/></linearGradient>
</defs>
<g transform="translate({(W - 1080) / 2:.0f} 0)">{mark_body(uid + 'm')}</g>
<g transform="translate({ox:.1f} {y_word})">{wbody}</g>
<path d="{sign}" transform="translate({sx:.1f} {y_sign})" fill="#d4cef2"/>
<rect x="{ox:.0f}" y="{line_y - 3:.0f}" width="{sx - ox - 36:.0f}" height="6" rx="3" fill="url(#{uid}l1)"/>
<rect x="{sx + sw + 36:.0f}" y="{line_y - 3:.0f}" width="{ox + ww - (sx + sw + 36):.0f}" height="6" rx="3" fill="url(#{uid}l2)"/>
</svg>
'''


# ------------------------------------------------------------------ Version horizontale à plat (barre de navigation)
def lockup_svg(wordmark_fill='#f2eefc') -> str:
    d, w, h = text_path('orbitron-latin-900-normal.woff', 'DIVERTIFLIX', 100, 9)
    markw, markh = 1080 * 0.2, 740 * 0.2
    gap = 26
    H = 150
    scale = 0.2
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {markw + gap + w:.0f} {H}" role="img" aria-label="Divertiflix">
<defs>{mark_defs('n', holes=False)}</defs>
<g transform="translate(0 {(H - markh) / 2:.1f}) scale({scale})">{mark_body('n')}</g>
<path d="{d}" transform="translate({markw + gap:.1f} {(H - h) / 2:.1f})" fill="{wordmark_fill}"/>
</svg>
'''


# ------------------------------------------------------------------ Favicon : le D et son triangle, lisible à 16 px
def favicon_svg() -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="120 -20 820 780" role="img" aria-label="Divertiflix">
<defs>{mark_defs('i')}</defs>
<path d="{D_OUTER}{D_COUNTER}" fill-rule="evenodd" fill="url(#ibody)"/>
<path d="{D_OUTER}{D_COUNTER}" fill-rule="evenodd" fill="url(#ilower)"/>
<path d="{D_COUNTER}" fill="url(#icounter)"/>
<path d="{D_OUTER}" fill="none" stroke="url(#irim)" stroke-width="22" stroke-linejoin="round"/>
<path d="{PLAY}" fill="url(#iplay)" stroke="url(#iplay)" stroke-width="34" stroke-linejoin="round"/>
</svg>
'''


files = {
    'mark.svg': mark_svg('m'),
    'mark-flat.svg': mark_svg('mf', holes=False),
    'wordmark.svg': wordmark_svg(),
    'logo.svg': full_svg(),
    'lockup.svg': lockup_svg(),
    'favicon.svg': favicon_svg(),
}
for name, svg in files.items():
    (OUT / name).write_text(svg, encoding='utf-8')
    print(f'{name:14s} {len(svg) / 1024:6.1f} Ko')
