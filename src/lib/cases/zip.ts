// Minimal streaming ZIP writer (deflate, UTF-8 names, no ZIP64), built on node:zlib.
// Entries are produced one at a time so large archives stream instead of being held in memory.
import { crc32, deflateRawSync } from "node:zlib";

export type ZipEntry = { name: string; bytes: Uint8Array; date?: Date };

function dosDateTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** A ZIP as a ReadableStream, pulling entries lazily from an async iterator. */
export function zipStream(entries: AsyncIterable<ZipEntry>): ReadableStream<Uint8Array> {
  const iterator = entries[Symbol.asyncIterator]();
  const central: Uint8Array[] = [];
  let offset = 0;
  let count = 0;
  let finished = false;
  const usedNames = new Set<string>();

  const uniqueName = (raw: string) => {
    // Plain-ASCII punctuation: some unzip tools ignore the UTF-8 flag and mangle dashes and quotes.
    const ascii = raw
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, "")
      .replace(/[\u00B7]/g, "-")
      .replace(/[:*?"<>|]/g, " ");
    const clean = ascii.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.\.+\//g, "");
    if (!usedNames.has(clean)) {
      usedNames.add(clean);
      return clean;
    }
    const dot = clean.lastIndexOf(".");
    for (let i = 2; ; i++) {
      const candidate = dot > clean.lastIndexOf("/") ? `${clean.slice(0, dot)} (${i})${clean.slice(dot)}` : `${clean} (${i})`;
      if (!usedNames.has(candidate)) {
        usedNames.add(candidate);
        return candidate;
      }
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      const next = await iterator.next();
      if (next.done) {
        const cd = Buffer.concat(central);
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(count, 8);
        end.writeUInt16LE(count, 10);
        end.writeUInt32LE(cd.length, 12);
        end.writeUInt32LE(offset, 16);
        controller.enqueue(new Uint8Array(cd));
        controller.enqueue(new Uint8Array(end));
        finished = true;
        controller.close();
        return;
      }
      const entry = next.value;
      const name = Buffer.from(uniqueName(entry.name), "utf8");
      const raw = Buffer.from(entry.bytes);
      const deflated = deflateRawSync(raw, { level: 6 });
      const stored = deflated.length >= raw.length; // already-compressed files (PDF, JPEG) may not shrink
      const data = stored ? raw : deflated;
      const crc = crc32(raw) >>> 0;
      const { time, date } = dosDateTime(entry.date ?? new Date());

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6); // UTF-8 file names
      local.writeUInt16LE(stored ? 0 : 8, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(name.length, 26);

      const cen = Buffer.alloc(46);
      cen.writeUInt32LE(0x02014b50, 0);
      cen.writeUInt16LE(20, 4);
      cen.writeUInt16LE(20, 6);
      cen.writeUInt16LE(0x0800, 8);
      cen.writeUInt16LE(stored ? 0 : 8, 10);
      cen.writeUInt16LE(time, 12);
      cen.writeUInt16LE(date, 14);
      cen.writeUInt32LE(crc, 16);
      cen.writeUInt32LE(data.length, 20);
      cen.writeUInt32LE(raw.length, 24);
      cen.writeUInt16LE(name.length, 28);
      cen.writeUInt32LE(offset, 42);
      central.push(new Uint8Array(Buffer.concat([cen, name])));

      const chunk = Buffer.concat([local, name, data]);
      offset += chunk.length;
      count++;
      controller.enqueue(new Uint8Array(chunk));
    },
  });
}
