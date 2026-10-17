import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";

export default defineConfig({
  site: "https://sterlingpensiongroup.com",
  adapter: vercel(),
  // The blog moved from /insights to /the-brief; every old URL 301s to its new home.
  redirects: {
    "/insights": { status: 301, destination: "/the-brief" },
    "/insights/archive": { status: 301, destination: "/the-brief" },
    "/insights/[slug]": { status: 301, destination: "/the-brief/[slug]" },
  },
});
