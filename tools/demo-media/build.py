#!/usr/bin/env python3
"""
Génère les médias de démonstration de Divertiflix, sans aucun fichier source :

  apps/api/src/Divertiflix.Api/media/stream/<slug>/index.m3u8 + segments   courts-métrages HLS (H.264 + AAC)
  apps/api/src/Divertiflix.Api/media/stream/<slug>/audio.m4a               extraits de livres audio
  apps/api/src/Divertiflix.Api/media/art/<slug>/poster.webp, backdrop.webp visuels
  apps/api/src/Divertiflix.Api/media/manifest.json                         durées réelles (lues par le seeder)

Prérequis : ffmpeg (avec libx264, libwebp, drawtext non requis), Python 3.10+. Livres audio : espeak-ng + voix MBROLA
(apt install espeak-ng mbrola mbrola-fr1 mbrola-fr4 mbrola-us1). Films Blender : lecture des flux HLS publics pour en
extraire un visuel (CC BY 3.0, Blender Foundation).

Usage : python3 tools/demo-media/build.py [--only slug,slug] [--art-only] [--force] [--jobs N]
Les fichiers existants sont conservés sans --force (les générations sont déterministes).
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from looks import LOOKS, PALETTES  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
MEDIA = ROOT / "apps/api/src/Divertiflix.Api/media"
VW, VH = 576, 324          # résolution des courts-métrages (motifs lisses : un agrandissement par le lecteur reste net)
BW, BH = 1920, 1080        # fonds
PW, PH = 480, 720          # affiches 2:3
FPS = 24


@dataclass(frozen=True)
class Film:
    slug: str
    look: str
    palette: str
    seed: int
    seconds: int
    root: float                      # fondamentale de la nappe sonore (Hz)
    mode: str = "minor"
    look_args: dict = field(default_factory=dict)
    poster_x: float = 0.5            # position horizontale du cadrage portrait, 0 à 1
    still_t: float = 0.45            # instant du fond, en fraction de la durée


FILMS = [
    Film("maree-basse", "horizon", "steel", 4, 70, 98.0, "minor", {"flat": 0.35, "lift": 0.1}, 0.4),
    Film("ligne-9", "ripples", "ink", 7, 60, 82.4, "minor", {"speed": 1.4}, 0.5),
    Film("orbite-silencieuse", "fractal", "steel", 1, 75, 65.4, "open", {"center": (-0.7453, 0.1127), "zoom": (0.06, 0.004)}, 0.5, 0.75),
    Film("les-hommes-pluie", "ripples", "abyss", 12, 70, 110.0, "minor", {"speed": 0.8}, 0.55),
    Film("atlas-de-poche", "horizon", "sand", 21, 90, 130.8, "major", {}, 0.35),
    Film("frequence-morte", "ripples", "blood", 3, 60, 73.4, "dim", {"speed": 2.0}, 0.5),
    Film("dernier-festin", "plasma", "blood", 5, 65, 69.3, "dim", {"speed": 1.3}, 0.45),
    Film("sucre-file", "plasma", "rose", 2, 60, 196.0, "major", {"speed": 1.6}, 0.5),
    Film("le-grand-depart", "horizon", "abyss", 17, 80, 146.8, "major", {"flat": 0.5, "speed": 2.0, "lift": 0.05}, 0.6),
    Film("poussiere-d-etoiles", "horizon", "night", 9, 90, 87.3, "open", {"moon": (0.72, 0.2), "stars": True}, 0.6),
    Film("bolero-des-machines", "fractal", "ember", 1, 60, 103.8, "open", {"center": (-0.1011, 0.9563), "zoom": (0.05, 0.008)}, 0.5, 0.7),
    Film("foret-memoire", "horizon", "moss", 33, 75, 116.5, "minor", {}, 0.45),
    Film("theatre-d-anouk", "plasma", "gold", 8, 60, 174.6, "major", {"speed": 1.2}, 0.5),
    Film("cartes-postales", "horizon", "rose", 44, 75, 155.6, "major", {"flat": 1.3}, 0.5),
    Film("neon-et-pluie", "ripples", "steel", 14, 60, 92.5, "dim", {"speed": 1.8}, 0.45),
    Film("le-dernier-cliche", "plasma", "ink", 6, 70, 77.8, "minor", {"speed": 0.7}, 0.5),
    Film("jardin-d-hiver", "horizon", "frost", 25, 90, 123.5, "minor", {"flat": 0.8}, 0.4),
]

# Livres audio : visuel (look/palette) + texte du domaine public + voix de synthèse
BOOKS = [
    dict(slug="candide", look="horizon", palette="sand", seed=11, voice="mb-fr1", speed=150, root=130.8, mode="major",
         text="Il y avait en Westphalie, dans le château de monsieur le baron de Thunder-ten-tronckh, un jeune garçon à qui la nature "
              "avait donné les moeurs les plus douces. Sa physionomie annonçait son âme. Il avait le jugement assez droit, avec l'esprit "
              "le plus simple ; c'est, je crois, pour cette raison qu'on le nommait Candide."),
    dict(slug="les-fleurs-du-mal", look="ripples", palette="gold", seed=19, voice="mb-fr4", speed=135, root=98.0, mode="minor",
         text="Quand le ciel bas et lourd pèse comme un couvercle sur l'esprit gémissant en proie aux longs ennuis, et que de l'horizon "
              "embrassant tout le cercle il nous verse un jour noir plus triste que les nuits ; quand la terre est changée en un cachot humide, "
              "où l'Espérance, comme une chauve-souris, s'en va battant les murs de son aile timide."),
    dict(slug="frankenstein", look="plasma", palette="abyss", seed=23, voice="mb-us1", speed=150, root=73.4, mode="dim",
         text="You will rejoice to hear that no disaster has accompanied the commencement of an enterprise which you have regarded with such "
              "evil forebodings. I arrived here yesterday, and my first task is to assure my dear sister of my welfare and increasing confidence "
              "in the success of my undertaking."),
    dict(slug="dracula", look="ripples", palette="blood", seed=29, voice="mb-us1", speed=145, root=69.3, mode="dim",
         text="Left Munich at eight thirty-five in the evening, arriving at Vienna early next morning. The impression I had was that we were "
              "leaving the West and entering the East. The country was full of beauty of all kinds, and the people are picturesque and quaint."),
]

REMOTE = {  # films Blender : visuel extrait du flux public
    "big-buck-bunny": ("https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", "00:04:20"),
}

CHORDS = {
    "minor": [1, 6 / 5, 3 / 2, 2, 9 / 4],
    "major": [1, 5 / 4, 3 / 2, 2, 5 / 2],
    "open": [1, 3 / 2, 2, 3, 4],
    "dim": [1, 6 / 5, 36 / 25, 2, 12 / 5],
}


def run(cmd: list[str], quiet=True) -> None:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg a échoué : {' '.join(cmd[:6])} ...\n{r.stderr[-1500:]}")


def graph(look: str, w: int, h: int, t0: float, seed: int, palette: str, grain: int, args: dict, seconds: int) -> str:
    fn = LOOKS[look]
    kw = dict(args)
    if look == "fractal":
        kw["seconds"] = seconds
    return fn(w, h, t0, seed, PALETTES[palette], grain, **kw)


def pad_expr(root: float, mode: str, seconds: int) -> str:
    """Nappe d'accompagnement : accord tenu, modulations lentes, deux canaux légèrement désaccordés."""
    ratios = CHORDS[mode]
    chans = []
    for c in range(2):
        parts = []
        for i, r in enumerate(ratios):
            f = root * r * (1 + 0.0015 * c * (i + 1))
            amp = 0.075 / (1 + 0.55 * i)
            lfo = 0.05 + 0.031 * i
            parts.append(f"{amp:.4f}*sin(2*PI*{f:.3f}*t+{i * 1.3:.2f})*(0.62+0.38*sin(2*PI*{lfo:.3f}*t+{i}))")
        chans.append("+".join(parts))
    return f"aevalsrc='{'|'.join(chans)}':s=44100:d={seconds}"


def build_film(f: Film, force: bool) -> dict:
    out = MEDIA / "stream" / f.slug
    pl = out / "index.m3u8"
    if pl.exists() and not force:
        return {"slug": f.slug, "seconds": probe_duration(pl), "skipped": True}
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True, exist_ok=True)
    vg = graph(f.look, VW, VH, 0, f.seed, f.palette, 2, f.look_args, f.seconds)
    # Bandes de cinéma 2,39:1 (ici 10,5 % haut et bas) et fondus.
    vg += (f",drawbox=x=0:y=0:w=iw:h=ih*0.105:color=black:t=fill,drawbox=x=0:y=ih*0.895:w=iw:h=ih*0.105:color=black:t=fill,"
           f"fade=t=in:st=0:d=1.6,fade=t=out:st={f.seconds - 2.2}:d=2.2")
    ag = f"aecho=0.8:0.78:620|1050:0.32|0.22,lowpass=f=2200,afade=t=in:d=2,afade=t=out:st={f.seconds - 3}:d=3,volume=0.9"
    cmd = ["ffmpeg", "-v", "error", "-y",
           "-f", "lavfi", "-i", f"{vg}",
           "-f", "lavfi", "-i", pad_expr(f.root, f.mode, f.seconds),
           "-t", str(f.seconds), "-af", ag,
           "-c:v", "libx264", "-preset", "slow", "-crf", "34", "-profile:v", "main", "-pix_fmt", "yuv420p",
           "-r", str(FPS), "-g", str(FPS * 4), "-keyint_min", str(FPS * 4), "-sc_threshold", "0",
           "-c:a", "aac", "-b:a", "40k", "-ac", "1", "-ar", "44100",
           "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod", "-hls_segment_type", "mpegts",
           "-hls_segment_filename", str(out / "seg%03d.ts"), str(pl)]
    run(cmd)
    return {"slug": f.slug, "seconds": probe_duration(pl)}


def probe_duration(path: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
                       capture_output=True, text=True)
    return round(float(r.stdout.strip() or 0), 1)


def webp(src_png: Path, dst: Path, q: int) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    run(["ffmpeg", "-v", "error", "-y", "-i", str(src_png), "-c:v", "libwebp", "-quality", str(q), "-compression_level", "6", str(dst)])


def build_art(slug: str, look: str, palette: str, seed: int, args: dict, seconds: int, t_frac: float, poster_x: float,
              square: bool, force: bool) -> None:
    d = MEDIA / "art" / slug
    if (d / "poster.webp").exists() and (d / "backdrop.webp").exists() and not force:
        return
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        t = max(1.0, seconds * t_frac)
        # Fond 16:9 : même graphe qu'à l'image mais en grand format, avec un grain plus fin.
        g = graph(look, BW, BH, t if look != "fractal" else 0, seed, palette, 7, args, seconds)
        cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", g]
        if look == "fractal":
            cmd += ["-ss", f"{t:.2f}"]
        run(cmd + ["-frames:v", "1", str(tmp / "b.png")])
        webp(tmp / "b.png", d / "backdrop.webp", 74)
        # Affiche : cadrage vertical dans le fond, ou carré pour les livres audio.
        if square:
            cw = BH
            x = int((BW - cw) * poster_x)
            run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp / "b.png"), "-vf", f"crop={cw}:{BH}:{x}:0,scale=640:640:flags=lanczos", str(tmp / "p.png")])
        else:
            cw = int(BH * 2 / 3)
            x = int((BW - cw) * poster_x)
            run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp / "b.png"), "-vf", f"crop={cw}:{BH}:{x}:0,scale={PW}:{PH}:flags=lanczos", str(tmp / "p.png")])
        webp(tmp / "p.png", d / "poster.webp", 78)


def build_remote_art(slug: str, url: str, ts: str, force: bool) -> None:
    d = MEDIA / "art" / slug
    if (d / "poster.webp").exists() and not force:
        return
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        run(["ffmpeg", "-v", "error", "-y", "-ss", ts, "-i", url, "-frames:v", "1", "-vf", f"scale={BW}:-2:flags=lanczos,eq=contrast=1.04", str(tmp / "b.png")])
        webp(tmp / "b.png", d / "backdrop.webp", 80)
        # Cadrage portrait : la moitié centrale, légèrement à gauche.
        run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp / "b.png"), "-vf", f"crop=ih*2/3:ih:iw*0.33:0,scale={PW}:{PH}:flags=lanczos", str(tmp / "p.png")])
        webp(tmp / "p.png", d / "poster.webp", 80)


def build_book(b: dict, force: bool) -> dict:
    out = MEDIA / "stream" / b["slug"] / "audio.m4a"
    if out.exists() and not force:
        return {"slug": b["slug"], "seconds": probe_duration(out), "skipped": True}
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "voice.wav"
        r = subprocess.run(["espeak-ng", "-v", b["voice"], "-s", str(b["speed"]), "-w", str(wav), b["text"]], capture_output=True, text=True)
        if r.returncode != 0 or not wav.exists():
            raise RuntimeError("espeak-ng a échoué : " + r.stderr[-400:])
        seconds = math.ceil(probe_duration(wav) + 4)
        run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-f", "lavfi", "-i", pad_expr(b["root"], b["mode"], seconds),
             "-filter_complex",
             "[0:a]aresample=44100,adelay=1500|1500,highpass=f=90,acompressor=threshold=-20dB:ratio=3,volume=1.5[v];"
             "[1:a]volume=0.55,lowpass=f=1500[b];[v][b]amix=inputs=2:duration=longest:normalize=0,aecho=0.7:0.5:160:0.18,"
             "alimiter=limit=0.9,afade=t=in:d=1,afade=t=out:st=" + str(seconds - 2) + ":d=2[a]",
             "-map", "[a]", "-ac", "1", "-c:a", "aac", "-b:a", "56k", "-t", str(seconds), str(out)])
    return {"slug": b["slug"], "seconds": probe_duration(out)}


def work(task: tuple) -> dict:
    kind, payload, force, art_only = task
    if kind == "film":
        f: Film = payload
        build_art(f.slug, f.look, f.palette, f.seed, f.look_args, f.seconds, f.still_t, f.poster_x, False, force)
        return {"slug": f.slug} if art_only else build_film(f, force)
    if kind == "book":
        b = payload
        build_art(b["slug"], b["look"], b["palette"], b["seed"], {}, 60, 0.5, 0.5, True, force)
        return {"slug": b["slug"]} if art_only else build_book(b, force)
    slug, (url, ts) = payload
    try:
        build_remote_art(slug, url, ts, force)
    except RuntimeError as e:   # hors ligne : le front retombe sur son visuel génératif
        print(f"  (visuel distant ignoré pour {slug} : {str(e)[:120]})", file=sys.stderr)
    return {"slug": slug}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="slugs séparés par des virgules")
    ap.add_argument("--art-only", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--jobs", type=int, default=3)
    a = ap.parse_args()
    only = set(a.only.split(",")) if a.only else None

    tasks = [("film", f, a.force, a.art_only) for f in FILMS if not only or f.slug in only]
    tasks += [("book", b, a.force, a.art_only) for b in BOOKS if not only or b["slug"] in only]
    tasks += [("remote", (s, v), a.force, a.art_only) for s, v in REMOTE.items() if not only or s in only]

    manifest_path = MEDIA / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    with ProcessPoolExecutor(max_workers=a.jobs) as pool:
        for res in pool.map(work, tasks):
            tag = " (déjà là)" if res.get("skipped") else ""
            if "seconds" in res:
                manifest[res["slug"]] = {"seconds": res["seconds"]}
            print(f"ok  {res['slug']}{tag}" + (f"  {res['seconds']} s" if "seconds" in res else ""))
    manifest_path.write_text(json.dumps(dict(sorted(manifest.items())), indent=2) + "\n")
    total = sum(p.stat().st_size for p in MEDIA.rglob("*") if p.is_file()) / 1e6
    print(f"manifest.json écrit ; médias : {total:.1f} Mo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
