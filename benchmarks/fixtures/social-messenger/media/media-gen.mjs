#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const OUTPUT_DIR = dirname(fileURLToPath(import.meta.url));

const GLYPHS = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"]
};

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function setPixel(pixels, width, height, x, y, rgb) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const offset = (y * width + x) * 3;
  pixels[offset] = rgb[0];
  pixels[offset + 1] = rgb[1];
  pixels[offset + 2] = rgb[2];
}

function drawLabel(pixels, width, height, label, scale, rgb) {
  const glyphWidth = 5 * scale;
  const spacing = scale;
  const totalWidth = label.length * glyphWidth + (label.length - 1) * spacing;
  const totalHeight = 7 * scale;
  const startX = Math.floor((width - totalWidth) / 2);
  const startY = Math.floor((height - totalHeight) / 2);

  for (let charIndex = 0; charIndex < label.length; charIndex += 1) {
    const glyph = GLYPHS[label[charIndex]];
    if (!glyph) throw new Error(`No bitmap glyph for ${label[charIndex]}`);
    for (let row = 0; row < 7; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        if (glyph[row][column] !== "1") continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            setPixel(
              pixels,
              width,
              height,
              startX + charIndex * (glyphWidth + spacing) + column * scale + dx,
              startY + row * scale + dy,
              rgb
            );
          }
        }
      }
    }
  }
}

function makePng(filename, width, height, background, label, scale) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let offset = 0; offset < pixels.length; offset += 3) {
    pixels[offset] = background[0];
    pixels[offset + 1] = background[1];
    pixels[offset + 2] = background[2];
  }
  drawLabel(pixels, width, height, label, scale, [255, 255, 255]);

  const scanlines = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const outputOffset = y * (1 + width * 3);
    scanlines[outputOffset] = 0;
    pixels.copy(scanlines, outputOffset + 1, y * width * 3, (y + 1) * width * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const png = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
  writeFileSync(join(OUTPUT_DIR, filename), png);
}

const images = [
  ["img-01.png", [190, 55, 63], "IMG 01"],
  ["img-02.png", [30, 120, 180], "IMG 02"],
  ["img-03.png", [42, 145, 92], "IMG 03"],
  ["img-04.png", [128, 78, 175], "IMG 04"],
  ["img-05.png", [215, 128, 35], "IMG 05"],
  ["img-06.png", [45, 58, 72], "IMG 06"]
];

for (const [filename, color, label] of images) {
  makePng(filename, 640, 480, color, label, 10);
}
makePng("avatar-alice.png", 256, 256, [185, 55, 100], "ALICE", 7);
makePng("avatar-bob.png", 256, 256, [35, 100, 175], "BOB", 10);

const videoPath = join(OUTPUT_DIR, "vid-01.mp4");
const ffmpeg = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x334155:s=320x240:r=30:d=5",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=5",
    "-map_metadata",
    "-1",
    "-t",
    "5",
    "-c:v",
    "libx264",
    "-preset",
    "veryslow",
    "-crf",
    "30",
    "-pix_fmt",
    "yuv420p",
    "-x264-params",
    "threads=1:lookahead_threads=1:sliced_threads=0",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    "-fflags",
    "+bitexact",
    "-flags:v",
    "+bitexact",
    "-flags:a",
    "+bitexact",
    "-movflags",
    "+faststart",
    "-threads",
    "1",
    videoPath
  ],
  { encoding: "utf8" }
);

if (ffmpeg.error) throw ffmpeg.error;
if (ffmpeg.status !== 0) {
  process.stderr.write(ffmpeg.stderr);
  process.exit(ffmpeg.status ?? 1);
}

const artifactNames = [...images.map(([filename]) => filename), "avatar-alice.png", "avatar-bob.png", "vid-01.mp4"];
const manifest = {
  schemaVersion: "0.1.0-p1",
  generator: "media-gen.mjs",
  generatorSourceSha256: createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex"),
  artifacts: Object.fromEntries(
    artifactNames.map((filename) => {
      const path = join(OUTPUT_DIR, filename);
      const bytes = readFileSync(path);
      return [
        filename,
        {
          sha256: createHash("sha256").update(bytes).digest("hex"),
          byteCount: statSync(path).size
        }
      ];
    })
  )
};
writeFileSync(join(OUTPUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

process.stdout.write("generated 8 PNG fixtures, media/vid-01.mp4, and media/manifest.json\n");
