import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(scriptDir, '../public/icons');

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let value = n;
  for (let k = 0; k < 8; k += 1) {
    value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[n] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function roundedRectContains(x, y, left, top, right, bottom, radius) {
  const nearestX = Math.max(left + radius, Math.min(x, right - radius));
  const nearestY = Math.max(top + radius, Math.min(y, bottom - radius));
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function drawIcon(size, { maskable = false } = {}) {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  const inset = maskable ? size * 0.12 : size * 0.035;
  const radius = maskable ? size * 0.16 : size * 0.22;
  const left = inset;
  const top = inset;
  const right = size - inset;
  const bottom = size - inset;

  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    rows[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = row + 1 + x * 4;
      const px = x + 0.5;
      const py = y + 0.5;
      const inCanvas = maskable || roundedRectContains(px, py, left, top, right, bottom, radius);
      if (!inCanvas) continue;

      const normalizedY = y / Math.max(1, size - 1);
      rows[offset] = Math.round(2 + normalizedY * 6);
      rows[offset + 1] = Math.round(6 + normalizedY * 13);
      rows[offset + 2] = Math.round(23 + normalizedY * 19);
      rows[offset + 3] = 255;

      const borderWidth = Math.max(2, size * 0.018);
      const inInner = roundedRectContains(
        px,
        py,
        left + borderWidth,
        top + borderWidth,
        right - borderWidth,
        bottom - borderWidth,
        Math.max(0, radius - borderWidth)
      );
      if (!inInner) {
        rows[offset] = 30;
        rows[offset + 1] = 64;
        rows[offset + 2] = 90;
      }

      const glyphScale = maskable ? 0.72 : 0.82;
      const gx = (x - size / 2) / glyphScale + size / 2;
      const gy = (y - size / 2) / glyphScale + size / 2;
      const stroke = size * 0.045;
      const chevron = Math.min(
        distanceToSegment(gx, gy, size * 0.31, size * 0.31, size * 0.51, size * 0.5),
        distanceToSegment(gx, gy, size * 0.51, size * 0.5, size * 0.31, size * 0.69)
      );
      const underscore = gy >= size * 0.63 && gy <= size * 0.63 + stroke * 1.4 && gx >= size * 0.55 && gx <= size * 0.75;
      if (chevron <= stroke / 2 || underscore) {
        rows[offset] = 34;
        rows[offset + 1] = 211;
        rows[offset + 2] = 238;
      }
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(outputDir, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDir, 'icon-192.png'), drawIcon(192)),
  writeFile(resolve(outputDir, 'icon-512.png'), drawIcon(512)),
  writeFile(resolve(outputDir, 'icon-maskable-192.png'), drawIcon(192, { maskable: true })),
  writeFile(resolve(outputDir, 'icon-maskable-512.png'), drawIcon(512, { maskable: true })),
  writeFile(resolve(outputDir, 'apple-touch-icon.png'), drawIcon(180, { maskable: true })),
]);
