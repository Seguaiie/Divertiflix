"""Looks génératifs pour les courts-métrages de démonstration : un graphe de filtres ffmpeg par esthétique.

Chaque look produit un motif animé en niveaux de gris (ou en couleurs pour `aurora`), puis une palette à trois
tons (ombre, milieu, lumière) le colore. Aucun fichier source : tout est calculé par ffmpeg, donc reproductible
et libre de droits.
"""
from dataclasses import dataclass


def hexrgb(h: str):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


@dataclass(frozen=True)
class Palette:
    shadow: str
    mid: str
    light: str

    def curves(self) -> str:
        (r0, g0, b0), (r1, g1, b1), (r2, g2, b2) = hexrgb(self.shadow), hexrgb(self.mid), hexrgb(self.light)
        return (f"curves=r='0/{r0:.3f} 0.5/{r1:.3f} 1/{r2:.3f}':g='0/{g0:.3f} 0.5/{g1:.3f} 1/{g2:.3f}':"
                f"b='0/{b0:.3f} 0.5/{b1:.3f} 1/{b2:.3f}'")


PALETTES = {
    "ember": Palette("#0a0605", "#8a3a16", "#f3c07a"),
    "steel": Palette("#04080c", "#1d4b5c", "#c3dedb"),
    "bone": Palette("#070707", "#5a554d", "#efe7d8"),
    "moss": Palette("#040906", "#25513a", "#d3dcae"),
    "rose": Palette("#0c0608", "#6e3040", "#efc2ac"),
    "sand": Palette("#0b0804", "#8c6b3a", "#f4e4be"),
    "abyss": Palette("#02070b", "#0f3d49", "#86cfc6"),
    "ink": Palette("#050506", "#2a2f3a", "#aab4c4"),
    "blood": Palette("#070304", "#5e1114", "#e8b09a"),
    "gold": Palette("#080604", "#7d5a1c", "#f6dc9a"),
    "frost": Palette("#06070a", "#4a525c", "#eef1f3"),
    "night": Palette("#03040a", "#1b2540", "#b9c6e6"),
}


def _finish(pal: Palette, grain: int, vig: float = 0.5) -> str:
    return f"{pal.curves()},vignette=angle={vig}*PI/4,noise=alls={grain}:allf=t,format=yuv420p"


def ripples(w, h, t0, seed, pal, grain=5, speed=1.0):
    """Ondes concentriques : pluie sur l'eau, ondes radio. Se calcule en basse résolution puis s'agrandit."""
    sw, sh = w // 2, h // 2
    cx, cy = 0.35 + 0.3 * ((seed * 37) % 100) / 100, 0.4 + 0.2 * ((seed * 53) % 100) / 100
    d1 = f"hypot(X-W*{cx:.2f},Y-H*{cy:.2f})"
    d2 = f"hypot(X-W*{1 - cx:.2f},Y-H*{1 - cy + .1:.2f})"
    expr = (f"clip(128+64*sin({d1}/{9 + seed % 5}-(T+{t0})*{2.2 * speed:.2f})+"
            f"48*sin({d2}/{13 + seed % 7}-(T+{t0})*{1.6 * speed:.2f})*exp(-{d2}/{sw * 0.9:.0f}),0,255)")
    return (f"color=c=black:s={sw}x{sh}:r=24,format=gray,geq=lum='{expr}',gblur=sigma=1.2,"
            f"scale={w}:{h}:flags=bicubic,eq=contrast=1.25:gamma=1.15,{_finish(pal, grain)}")


def plasma(w, h, t0, seed, pal, grain=5, speed=1.0):
    """Nappes de lumière liquides, lentes."""
    sw, sh = w // 2, h // 2
    s = seed % 9
    expr = (f"clip(128+50*sin(X/{38 + s * 3}+(T+{t0})*{0.9 * speed:.2f})+"
            f"44*sin(Y/{27 + s * 2}-(T+{t0})*{0.7 * speed:.2f}+X/{90 + s * 5})+"
            f"32*sin(hypot(X-W/2,Y-H/2)/{30 + s}-(T+{t0})*{0.5 * speed:.2f}),0,255)")
    return (f"color=c=black:s={sw}x{sh}:r=24,format=gray,geq=lum='{expr}',gblur=sigma=2,"
            f"scale={w}:{h}:flags=bicubic,eq=contrast=1.3:gamma=1.05,{_finish(pal, grain, 0.7)}")


def horizon(w, h, t0, seed, pal, grain=5, speed=1.0, flat=1.0, moon=None, stars=False, lift=0.0):
    """
    Reliefs superposés dans la brume (dunes, collines, vagues) : parallaxe lente, ciel clair à l'horizon.
    flat < 1 aplatit les reliefs (mer), moon = (x, y) ajoute une lune, stars = ciel étoilé.
    """
    sw, sh = w // 2, h // 2
    layers = []
    for k in range(6):
        base = 0.38 + 0.095 * k + lift
        amp = (0.05 + 0.012 * k) * flat
        f1, f2 = 70 - 7 * k + seed % 11, 29 - 2 * k + seed % 5
        sp = 0.05 + 0.035 * k
        ph = (seed * (k + 3) * 0.7) % 6.28
        layers.append(f"H*({base:.3f}-{amp:.3f}*(sin(X/{f1}+{ph:.2f}+(T+{t0})*{sp * speed:.3f})+0.5*sin(X/{f2}+{ph * 1.7:.2f}-(T+{t0})*{sp * 0.6 * speed:.3f})))")
    tones = [168, 138, 108, 78, 48, 22]
    sky = "205-110*Y/H"
    if moon:
        sky += f"+95*exp(-hypot(X-W*{moon[0]},Y-H*{moon[1]})/(W*0.045))+26*exp(-hypot(X-W*{moon[0]},Y-H*{moon[1]})/(W*0.22))"
    if stars:
        sky = f"({sky})*0.55+170*gt(mod(X*7919+Y*104729,991),986)*lt(Y,H*0.6)"
    body = "{sky}"
    for k in reversed(range(6)):
        body = body.replace("{sky}", f"if(gt(Y,{layers[k]}),{tones[k]}+10*(Y-{layers[k]})/H*8,{{sky}})")
    body = body.replace("{sky}", sky)
    return (f"color=c=black:s={sw}x{sh}:r=24,format=gray,geq=lum='{body}',scale={w}:{h}:flags=bicubic,gblur=sigma=2.0,"
            f"eq=contrast=1.12:gamma=1.0,{_finish(pal, grain, 0.8)}")


def fractal(w, h, t0, seed, pal, grain=5, speed=1.0, seconds=60, center=(-0.7453, 0.1127), zoom=(0.06, 0.004)):
    """Zoom lent dans l'ensemble de Mandelbrot, intérieur ombré : filaments et spirales, très « science-fiction »."""
    rw, rh = ((w * 3 // 4) // 2 * 2, (h * 3 // 4) // 2 * 2) if w <= 800 else (w, h)
    return (f"mandelbrot=s={rw}x{rh}:rate=24:maxiter=300:start_x={center[0]}:start_y={center[1]}:start_scale={zoom[0]}:end_scale={zoom[1]}:"
            f"end_pts={int(seconds * 24)}:inner=convergence:outer=normalized_iteration_count,"
            f"format=gray,eq=contrast=1.3:gamma=0.8,scale={w}:{h}:flags=bicubic,gblur=sigma=0.8,{_finish(pal, grain, 0.7)}")


LOOKS = {f.__name__: f for f in (ripples, plasma, horizon, fractal)}
