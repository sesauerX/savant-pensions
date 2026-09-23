export type Post = {
  slug: string;
  title: string;
  date: string;
  kicker: string;
  description: string;
  image: string;
  html: string;
};

const rawModules = import.meta.glob("../content/posts/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">");
}

function inline(value: string) {
  const safe = escapeHtml(value);
  const linked = safe.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="font-semibold text-navy underline decoration-gold/70 underline-offset-4 hover:text-gold">$1</a>',
  );
  return linked.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

export function markdownToHtml(markdown: string) {
  const blocks = markdown.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  const html: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (lines.every((line) => line.startsWith("## "))) {
      html.push(`<h2>${inline(lines[0].slice(3))}</h2>`);
      continue;
    }
    if (lines.every((line) => line.startsWith("- "))) {
      html.push(`<ul>${lines.map((line) => `<li>${inline(line.slice(2))}</li>`).join("")}</ul>`);
      continue;
    }
    html.push(`<p>${inline(lines.join(" "))}</p>`);
  }
  return html.join("\n");
}

function parse(raw: string): Post {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error("Post is missing frontmatter");
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    meta[key] = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
  }
  return {
    slug: meta.slug,
    title: meta.title,
    date: meta.date,
    kicker: meta.kicker || "Owner briefing",
    description: meta.description,
    image: meta.image,
    html: markdownToHtml(match[2]),
  };
}

export const posts: Post[] = Object.values(rawModules)
  .map(parse)
  .sort((a, b) => (a.date < b.date ? 1 : -1));

export function getPost(slug: string) {
  return posts.find((post) => post.slug === slug);
}

export function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
