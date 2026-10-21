// Number to American English words, for amounts printed in the documents.
// 2500 -> "two thousand five hundred"; 2500.5 -> "two thousand five hundred and 50/100".

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", "thousand", "million", "billion", "trillion"];

function underThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(`${ONES[hundreds]} hundred`);
  if (rest) {
    if (rest < 20) parts.push(ONES[rest]);
    else parts.push(TENS[Math.floor(rest / 10)] + (rest % 10 ? `-${ONES[rest % 10]}` : ""));
  }
  return parts.join(" ");
}

/** Whole number to words: no "and", hyphenated tens, lower case. */
export function integerToWords(value: bigint | number): string {
  let n = BigInt(value);
  if (n < 0n) throw new Error("negative amounts are not supported");
  if (n === 0n) return "zero";
  const groups: string[] = [];
  let scale = 0;
  while (n > 0n) {
    const chunk = Number(n % 1000n);
    if (chunk) {
      if (scale >= SCALES.length) throw new Error("amount too large");
      groups.unshift(underThousand(chunk) + (SCALES[scale] ? ` ${SCALES[scale]}` : ""));
    }
    n /= 1000n;
    scale++;
  }
  return groups.join(" ");
}

/**
 * Amount string ("2500", "2500.50", "1,000,000.5") to words.
 * Cents are written as "and 50/100" (open question for counsel: "and fifty cents").
 */
export function amountToWords(amount: string): string {
  const { whole, cents } = splitAmount(amount);
  const words = integerToWords(BigInt(whole));
  return cents === "00" ? words : `${words} and ${cents}/100`;
}

export function splitAmount(amount: string) {
  const cleaned = String(amount).replace(/[,\s]/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) throw new Error(`not an amount: ${amount}`);
  return { whole: m[1].replace(/^0+(?=\d)/, ""), cents: (m[2] ?? "").padEnd(2, "0") };
}

/** German amount: "2500" -> "2.500 USD"; "2500.5" -> "2.500,50 USD". */
export function formatUsdDe(amount: string): string {
  const { whole, cents } = splitAmount(amount);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${cents === "00" ? grouped : `${grouped},${cents}`} USD`;
}

/** "2500" -> "2,500"; "2500.5" -> "2,500.50". */
export function formatAmount(amount: string): string {
  const { whole, cents } = splitAmount(amount);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return cents === "00" ? grouped : `${grouped}.${cents}`;
}
