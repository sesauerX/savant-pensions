import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";

export default defineConfig({
  site: "https://sterlingpensiongroup.com",
  adapter: vercel({
    // Case documents are rendered with serverless Chromium (src/lib/cases/pdf.ts).
    includeFiles: [
      "node_modules/@sparticuz/chromium/bin/al2023.tar.br",
      "node_modules/@sparticuz/chromium/bin/chromium.br",
      "node_modules/@sparticuz/chromium/bin/fonts.tar.br",
      "node_modules/@sparticuz/chromium/bin/swiftshader.tar.br",
    ],
    maxDuration: 60,
  }),
  vite: {
    ssr: { external: ["@sparticuz/chromium", "puppeteer-core"] },
  },
  // Inline the (small) stylesheet so first paint does not wait on a CSS request.
  build: { inlineStylesheets: "always" },
  // Old /insights URLs are redirected by src/pages/insights/[...path].ts.
});
