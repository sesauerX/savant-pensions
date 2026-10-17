import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";

export default defineConfig({
  site: "https://sterlingpensiongroup.com",
  adapter: vercel(),
  // Inline the (small) stylesheet so first paint does not wait on a CSS request.
  build: { inlineStylesheets: "always" },
  // Old /insights URLs are redirected by src/pages/insights/[...path].ts.
});
