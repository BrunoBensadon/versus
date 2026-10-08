// Generate the PWA icons (plain PNGs, no image library): a dark tile with two facing bars, the
// "head to head" of versus. Run once: `npm run icons`. The output is committed.

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x16, 0x18, 0x1d];
const LEFT = [0xfb, 0x92, 0x3c]; // orange
const RIGHT = [0xec, 0xee, 0xf2]; // off-white

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** `safe` = share of the size kept clear at each edge (maskable icons need ~20%). */
function icon(size: number, safe: number): Buffer {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const inset = size * safe;
  const barW = (size - 2 * inset) * 0.22;
  const top = inset + (size - 2 * inset) * 0.18;
  const bottom = size - inset - (size - 2 * inset) * 0.18;
  const leftX = inset + (size - 2 * inset) * 0.2;
  const rightX = size - inset - (size - 2 * inset) * 0.2 - barW;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      let color = BG;
      if (y >= top && y <= bottom) {
        if (x >= leftX && x <= leftX + barW && y <= bottom - (bottom - top) * 0.25) color = LEFT;
        if (x >= rightX && x <= rightX + barW && y >= top + (bottom - top) * 0.25) color = RIGHT;
      }
      raw.set(color, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = 'src/web/public/icons';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/icon-192.png`, icon(192, 0.08));
writeFileSync(`${dir}/icon-512.png`, icon(512, 0.08));
writeFileSync(`${dir}/icon-maskable-512.png`, icon(512, 0.2));
console.log(`wrote 3 icons to ${dir}`);
