// Minimal template renderer for the document templates.
//
//   {{field}}                 HTML-escaped value; a missing or empty value fails the render
//   {{field|br}}              same, with line breaks kept as <br>
//   {{#if flag}}…{{else}}…{{/if}}, {{#unless flag}}…{{/unless}}   (nestable)
//   {{n}}                     auto-numbering counter (1, 2, 3…) for numbered paragraphs
//   {{> partial}}             raw partial (logo, etc.)
//   {{@tag}}                  left untouched: BoldSign text tags

type Node =
  | { t: "text"; v: string }
  | { t: "var"; name: string; filter?: string }
  | { t: "num" }
  | { t: "partial"; name: string }
  | { t: "if"; name: string; negate: boolean; yes: Node[]; no: Node[] };

export class MissingFieldsError extends Error {
  missing: string[];
  template: string;
  constructor(missing: string[], template: string) {
    super(`Template "${template}" is missing: ${missing.join(", ")}`);
    this.missing = missing;
    this.template = template;
  }
}

export function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parse(src: string): Node[] {
  const root: Node[] = [];
  const stack: { node: Extract<Node, { t: "if" }>; inElse: boolean }[] = [];
  const push = (n: Node) => {
    const top = stack[stack.length - 1];
    (top ? (top.inElse ? top.node.no : top.node.yes) : root).push(n);
  };
  const re = /\{\{(?!@)\s*([^}]*?)\s*\}\}/g;
  let last = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(src)); ) {
    if (m.index > last) push({ t: "text", v: src.slice(last, m.index) });
    last = re.lastIndex;
    const tag = m[1];
    let mm: RegExpExecArray | null;
    if ((mm = /^#(if|unless)\s+(\w+)$/.exec(tag))) {
      const node = { t: "if" as const, name: mm[2], negate: mm[1] === "unless", yes: [], no: [] };
      push(node);
      stack.push({ node, inElse: false });
    } else if (tag === "else") {
      if (!stack.length) throw new Error("{{else}} without {{#if}}");
      stack[stack.length - 1].inElse = true;
    } else if (tag === "/if" || tag === "/unless") {
      if (!stack.length) throw new Error(`{{${tag}}} without opening block`);
      stack.pop();
    } else if (tag === "n") {
      push({ t: "num" });
    } else if ((mm = /^>\s*(\w+)$/.exec(tag))) {
      push({ t: "partial", name: mm[1] });
    } else if ((mm = /^(\w+)(?:\|(\w+))?$/.exec(tag))) {
      push({ t: "var", name: mm[1], filter: mm[2] });
    } else {
      throw new Error(`Bad template tag: {{${tag}}}`);
    }
  }
  if (stack.length) throw new Error(`Unclosed {{#${stack[0].node.negate ? "unless" : "if"} ${stack[0].node.name}}}`);
  if (last < src.length) push({ t: "text", v: src.slice(last) });
  return root;
}

const truthy = (v: unknown) => v === true || (typeof v === "string" && v.trim() !== "");

export function renderTemplate(
  src: string,
  values: Record<string, unknown>,
  partials: Record<string, string> = {},
  name = "template",
): string {
  const missing = new Set<string>();
  let counter = 0;
  const walk = (nodes: Node[]): string =>
    nodes
      .map((n) => {
        switch (n.t) {
          case "text":
            return n.v;
          case "num":
            return String(++counter);
          case "partial":
            if (!(n.name in partials)) throw new Error(`Unknown partial: ${n.name}`);
            return partials[n.name];
          case "if":
            return walk(truthy(values[n.name]) !== n.negate ? n.yes : n.no);
          case "var": {
            const v = values[n.name];
            if (!truthy(v) || typeof v !== "string") {
              missing.add(n.name);
              return "";
            }
            const esc = escapeHtml(v);
            return n.filter === "br" ? esc.replace(/\n/g, "<br>") : esc;
          }
        }
      })
      .join("");
  const out = walk(parse(src));
  if (missing.size) throw new MissingFieldsError([...missing], name);
  return out;
}

/** The template_version from the header comment `<!-- template_version: … -->`. */
export function templateVersion(src: string) {
  return /template_version:\s*([^\s>-][^\s>]*)/.exec(src)?.[1] ?? "unknown";
}
