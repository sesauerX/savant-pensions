// Inter, embedded as base64 @font-face: serverless Chromium has no system fonts.
import l400 from "@fontsource/inter/files/inter-latin-400-normal.woff2?inline";
import l700 from "@fontsource/inter/files/inter-latin-700-normal.woff2?inline";
import l800 from "@fontsource/inter/files/inter-latin-800-normal.woff2?inline";
import x400 from "@fontsource/inter/files/inter-latin-ext-400-normal.woff2?inline";
import x700 from "@fontsource/inter/files/inter-latin-ext-700-normal.woff2?inline";
import x800 from "@fontsource/inter/files/inter-latin-ext-800-normal.woff2?inline";

const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

const FILES: Record<string, [string, string]> = { "400": [l400, x400], "700": [l700, x700], "800": [l800, x800] };

export function fontFaceCss(weights = ["400", "700", "800"]) {
  return weights
    .flatMap((w) => [
      `@font-face{font-family:Inter;font-style:normal;font-weight:${w};src:url(${FILES[w][1]}) format('woff2');unicode-range:${LATIN_EXT}}`,
      `@font-face{font-family:Inter;font-style:normal;font-weight:${w};src:url(${FILES[w][0]}) format('woff2');unicode-range:${LATIN}}`,
    ])
    .join("\n");
}
