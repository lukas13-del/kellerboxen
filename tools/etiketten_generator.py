# -*- coding: utf-8 -*-
"""Kellerboxen: QR-Etiketten zum Vorausdrucken als A4-PDF (Vektor, Century Gothic).

Jedes Etikett trägt einen QR-Code auf  <App-URL>#box-<Nr>  und die Boxnummer (kein Inhalt).
Die App öffnet beim Scannen die Box mit dieser Nummer oder bietet an, sie einzurichten.

Aufruf:
  python etiketten_generator.py 1 40
  python etiketten_generator.py 41 61 --start 20 --format klein
"""
import argparse
import os

from reportlab.graphics.barcode import qrencoder as qr
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

APP_URL = "https://lukas13-del.github.io/kellerboxen/"
FMT = {
    # Masse in mm. «klein» = HERMA 63,5 x 38,1 (Vorlage HERMA, mit Word nachgemessen 12.10.2026)
    "klein": dict(titel="HERMA 63,5 x 38,1 mm, 21 pro A4", w=63.5, h=38.1, cols=3, rows=7, left=6.94, top=15.16, px=66.33, py=38.1),
    "gross": dict(titel="99,1 x 57 mm, 10 pro A4", w=99.1, h=57.0, cols=2, rows=5, left=4.65, top=6.0, px=101.6, py=57.0),
}
FONT_DIR = r"C:\Windows\Fonts"
pdfmetrics.registerFont(TTFont("CG", os.path.join(FONT_DIR, "GOTHIC.TTF")))
pdfmetrics.registerFont(TTFont("CGB", os.path.join(FONT_DIR, "GOTHICB.TTF")))
CAP = 0.72  # Versalhöhe Century Gothic / Schriftgrösse (gemessen 718/1000)
PAGE_W, PAGE_H = A4


def nr_text(n):
    return f"{n:02d}" if n < 100 else str(n)


def qr_matrix(text):
    c = qr.QRCode(None, qr.QRErrorCorrectLevel.M)
    c.addData(text)
    c.make()
    n = c.getModuleCount()
    return [[c.isDark(r, k) for k in range(n)] for r in range(n)]


def width_mm(text, font, size_mm, char_space_mm=0.0):
    return pdfmetrics.stringWidth(text, font, size_mm) + char_space_mm * max(len(text) - 1, 0)


def fit(text, font, size_mm, min_mm, max_w_mm):
    s = size_mm
    while s > min_mm and width_mm(text, font, s) > max_w_mm:
        s -= 0.05
    return s


def Y(y_mm):
    return PAGE_H - y_mm * mm


def draw_label(c, x, y, w, h, nr, name=None):
    """x, y = linke obere Ecke des Etiketts in mm.
    Links QR-Code, rechts oben die Nummer, darunter ein Strich zum Beschriften (oder der Boxname)."""
    u = h / 38.1
    pad = 3.6 * u
    q = 27.0 * u                      # QR inkl. 2 Module Ruhezone
    mat = qr_matrix(f"{APP_URL}#box-{nr}")
    n, quiet = len(mat), 2
    cell = q / (n + 2 * quiet)
    qx, qy = x + pad * 0.75, y + (h - q) / 2
    dark_top, dark_bot = qy + quiet * cell, qy + q - quiet * cell
    # QR als ein Pfad (keine Haarlinien zwischen Modulen)
    path = c.beginPath()
    for r in range(n):
        k = 0
        while k < n:
            if mat[r][k]:
                k0 = k
                while k < n and mat[r][k]:
                    k += 1
                rx, ry = qx + (k0 + quiet) * cell, qy + (r + quiet) * cell
                path.rect(rx * mm, Y(ry + cell), (k - k0) * cell * mm, cell * mm)
            else:
                k += 1
    c.setFillColorRGB(0, 0, 0)
    c.drawPath(path, stroke=0, fill=1)
    tx = qx + q + 1.2 * u
    tw = x + w - pad - tx
    # Nummer oben, Oberkante bündig mit dem QR-Code, mind. 9 mm Schreibraum bis zum Strich
    max_cap = (dark_bot - dark_top) - 9.0 * u
    fs_n = fit(nr, "CGB", min(21.0 * u, max_cap / CAP), 8.0 * u, tw)
    c.setFillColorRGB(0.07, 0.07, 0.07)
    c.setFont("CGB", fs_n * mm)
    c.drawString(tx * mm, Y(dark_top + CAP * fs_n), nr)
    # Schreibstrich, bündig mit der Unterkante des QR-Codes
    c.setStrokeColorRGB(0.35, 0.35, 0.35)
    c.setLineWidth(0.3 * u * mm)
    c.line(tx * mm, Y(dark_bot), (tx + tw) * mm, Y(dark_bot))
    if name:
        fs_t = fit(name, "CGB", 3.6 * u, 2.4 * u, tw)
        c.setFillColorRGB(0.07, 0.07, 0.07)
        c.setFont("CGB", fs_t * mm)
        c.drawString(tx * mm, Y(dark_bot - 1.3 * u), name)


def build(von, bis, start=1, fmt="klein", out=None):
    f = FMT[fmt]
    per = f["cols"] * f["rows"]
    nummern = [nr_text(n) for n in range(von, bis + 1)]
    slots = [None] * (start - 1) + nummern
    out = out or f"Kellerboxen Etiketten {nummern[0]}-{nummern[-1]} ({'HERMA 63x38' if fmt == 'klein' else '99x57'}).pdf"
    c = canvas.Canvas(out, pagesize=A4)
    c.setTitle(f"Kellerboxen Etiketten {nummern[0]} bis {nummern[-1]}")
    c.setAuthor("Kellerboxen")
    for p in range(0, len(slots), per):
        for i, nr in enumerate(slots[p:p + per]):
            if nr is None:
                continue
            col, row = i % f["cols"], i // f["cols"]
            draw_label(c, f["left"] + col * f["px"], f["top"] + row * f["py"], f["w"], f["h"], nr)
        c.showPage()
    c.save()
    frei_ab = (len(slots) % per) + 1 if len(slots) % per else None
    return out, len(slots) // per + (1 if len(slots) % per else 0), frei_ab


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("von", type=int)
    ap.add_argument("bis", type=int)
    ap.add_argument("--start", type=int, default=1, help="erstes freies Etikett auf dem ersten Bogen (1 = oben links)")
    ap.add_argument("--format", choices=FMT, default="klein")
    ap.add_argument("--out")
    a = ap.parse_args()
    datei, bogen, frei = build(a.von, a.bis, a.start, a.format, a.out)
    print(f"{datei}: {bogen} Bogen" + (f", auf dem letzten frei ab Position {frei}" if frei else ""))
