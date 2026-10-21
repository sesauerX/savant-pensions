// Run with: npm test  (Node's built-in runner; Node 24 strips the types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { amountToWords, formatAmount, integerToWords } from "../src/lib/cases/words.ts";
import { MissingFieldsError, renderTemplate } from "../src/lib/cases/templates/render.ts";

test("number to words: boundary values", () => {
  const cases: [string, string][] = [
    ["0", "zero"],
    ["1", "one"],
    ["15", "fifteen"],
    ["21", "twenty-one"],
    ["100", "one hundred"],
    ["101", "one hundred one"],
    ["1000", "one thousand"],
    ["1001", "one thousand one"],
    ["999999", "nine hundred ninety-nine thousand nine hundred ninety-nine"],
    ["1000000.50", "one million and 50/100"],
    ["2500", "two thousand five hundred"],
    ["125000", "one hundred twenty-five thousand"],
    ["2500.5", "two thousand five hundred and 50/100"],
    ["2500.05", "two thousand five hundred and 05/100"],
  ];
  for (const [input, words] of cases) assert.equal(amountToWords(input), words, input);
  assert.equal(integerToWords(1_000_000_000), "one billion");
});

test("amount formatting", () => {
  assert.equal(formatAmount("2500"), "2,500");
  assert.equal(formatAmount("2500.5"), "2,500.50");
  assert.equal(formatAmount("1000000.50"), "1,000,000.50");
  assert.equal(formatAmount("999"), "999");
  assert.throws(() => formatAmount("12a"));
});

test("template: escaping, conditionals, numbering, BoldSign tags", () => {
  const src = "{{name}}|{{#if a}}A{{else}}notA{{/if}}|{{#unless a}}U{{/unless}}|{{n}}{{#if b}}{{n}}{{/if}}{{n}}|{{@sig_tag}}|{{addr|br}}";
  const out = renderTemplate(src, { name: "<X & Y>", a: false, b: false, addr: "1 St\nTown" });
  assert.equal(out, "&lt;X &amp; Y&gt;|notA|U|12|{{@sig_tag}}|1 St<br>Town");
  const out2 = renderTemplate("{{#if b}}x{{n}}{{/if}}{{n}}", { b: true });
  assert.equal(out2, "x12");
});

test("template: missing fields fail with the full list", () => {
  try {
    renderTemplate("{{a}} {{b}} {{#if c}}{{d}}{{/if}} {{e}}", { a: "ok", b: "", e: "  " }, {}, "t");
    assert.fail("should throw");
  } catch (err) {
    assert.ok(err instanceof MissingFieldsError);
    assert.deepEqual(err.missing.sort(), ["b", "e"]);
  }
});

test("template: unbalanced blocks are rejected", () => {
  assert.throws(() => renderTemplate("{{#if a}}x", { a: true }));
  assert.throws(() => renderTemplate("x{{/if}}", {}));
});
