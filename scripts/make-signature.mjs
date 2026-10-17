// Draws the decorative "Polo Delicana" sign-off for /welcome as outlined SVG paths.
//
//   node scripts/make-signature.mjs [font] [out.svg]
//
// font: allison (default, chosen for the site) | mrs-saint-delafield | monsieur-la-doulaise | herr-von-muellerhoff
// The font is downloaded from the Google Fonts repository (OFL) for this script
// only; the site never loads it. The output has no <text> and no font dependency.
// This is a web sign-off, not a legal signature; swap in a real scan at
// public/images/team/polo-signature.svg whenever one is available.
import opentype from "opentype.js";
import { writeFileSync } from "node:fs";

const FONTS = {
  "mrs-saint-delafield": { file: "mrssaintdelafield/MrsSaintDelafield-Regular.ttf", size: 92, track: -0.06, skew: -5 },
  "allison": { file: "allison/Allison-Regular.ttf", size: 104, track: -0.05, skew: -4 },
  "monsieur-la-doulaise": { file: "monsieurladoulaise/MonsieurLaDoulaise-Regular.ttf", size: 84, track: -0.07, skew: -5 },
  "herr-von-muellerhoff": { file: "herrvonmuellerhoff/HerrVonMuellerhoff-Regular.ttf", size: 92, track: -0.06, skew: -6 },
};
const NAVY = "#0B2545";
const name = process.argv[2] ?? "allison";
const out = process.argv[3] ?? "public/images/team/polo-signature.svg";
const cfg = FONTS[name];
if (!cfg) throw new Error(`Unknown font ${name}; use one of ${Object.keys(FONTS).join(", ")}`);

const res = await fetch(`https://github.com/google/fonts/raw/main/ofl/${cfg.file}`);
if (!res.ok) throw new Error(`Font download failed: ${res.status}`);
const font = opentype.parse(await res.arrayBuffer());

// Lay the glyphs out by hand so the letters can be pulled together (negative
// tracking), with kerning, the way a quick signature runs letters into each other.
const text = "Polo Delicana";
const scale = cfg.size / font.unitsPerEm;
const glyphs = font.stringToGlyphs(text);
const paths = [];
let x = 0;
glyphs.forEach((g, i) => {
  const p = g.getPath(x, 0, cfg.size);
  paths.push(p);
  const kern = i < glyphs.length - 1 ? font.getKerningValue(g, glyphs[i + 1]) : 0;
  const isSpace = text[i] === " ";
  // Letters run together; the gap between the two names stays open.
  x += (g.advanceWidth + kern) * scale + cfg.size * (isSpace ? 0.1 : cfg.track);
});
const all = new opentype.Path();
paths.forEach((p) => p.commands.forEach((c) => all.commands.push(c)));

// Underline flourish leaving the final "a": a thin tapered stroke drawn as a filled shape.
const bb = all.getBoundingBox();
const startX = bb.x2 - cfg.size * 0.08;
const y0 = cfg.size * 0.05;
const flourish = `M${startX.toFixed(1)} ${(y0 - 2).toFixed(1)}`
  + ` C${(startX + 14).toFixed(1)} ${(y0 + 6).toFixed(1)} ${(bb.x1 + 140).toFixed(1)} ${(y0 + 26).toFixed(1)} ${(bb.x1 + 40).toFixed(1)} ${(y0 + 22).toFixed(1)}`
  + ` C${(bb.x1 + 138).toFixed(1)} ${(y0 + 23.6).toFixed(1)} ${(startX + 12).toFixed(1)} ${(y0 + 4.6).toFixed(1)} ${startX.toFixed(1)} ${(y0 - 2).toFixed(1)} Z`;

// Slant to the right and crop the viewBox tight to the ink.
const t = Math.tan((-cfg.skew * Math.PI) / 180);
const pad = 3;
const minY = bb.y1 - pad, maxY = Math.max(bb.y2, y0 + 26) + pad;
// x' = x - t*y: points below the baseline move left, ascenders move right.
const minX = bb.x1 - t * maxY - pad, maxX = bb.x2 + 18 - t * minY + pad;
const w = maxX - minX, h = maxY - minY;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX.toFixed(1)} ${minY.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" width="${Math.round(w)}" height="${Math.round(h)}" aria-hidden="true">
<g transform="matrix(1 0 ${(-t).toFixed(4)} 1 0 0)" fill="${NAVY}">
<path d="${all.toPathData(2)}"/>
<path d="${flourish}"/>
</g>
</svg>
`;
writeFileSync(out, svg);
console.log(`${name}: ${out} (${Math.round(w)}x${Math.round(h)})`);
