// Shared measurement instrument for LLP 0139: a deterministic GPS-tagged
// JPEG fixture and a served-bytes checker. Byte-level on purpose — the
// question "did location metadata survive?" must not depend on any
// provider SDK's opinion of what it stored.

// A real 16x16 baseline JPEG produced by macOS sips (carries a benign
// non-GPS EXIF APP1 from sips — so the detector below proves GPS absence
// specifically, not mere EXIF absence).
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAAEAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAEAAQAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+Q6KKK/Cz/VQ/9k=';

const GPS_LAT = [37, 46, 30]; // 37°46'30" N — deterministic, obviously-a-location
const GPS_LON = [122, 25, 10];

function u16(n) { return [(n >> 8) & 0xff, n & 0xff]; }
function u32le(n) { return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]; }
function u16le(n) { return [n & 0xff, (n >> 8) & 0xff]; }

// A little-endian TIFF body holding one IFD0 entry (GPSInfo pointer) and a
// GPS IFD with latitude/longitude rationals.
function buildExifApp1() {
  const rat = (n) => [...u32le(n), ...u32le(1)];
  const gpsEntries = [
    { tag: 0x0001, type: 2, count: 2, value: [0x4e, 0x00, 0x00, 0x00] }, // GPSLatitudeRef "N"
    { tag: 0x0002, type: 5, count: 3, offset: true, data: GPS_LAT.flatMap(rat) },
    { tag: 0x0003, type: 2, count: 2, value: [0x57, 0x00, 0x00, 0x00] }, // GPSLongitudeRef "W"
    { tag: 0x0004, type: 5, count: 3, offset: true, data: GPS_LON.flatMap(rat) },
  ];
  const ifd0Offset = 8;
  const ifd0 = { entries: 1, gpsPointerPlaceholder: true };
  const ifd0Size = 2 + 12 * 1 + 4;
  const gpsIfdOffset = ifd0Offset + ifd0Size;
  const gpsIfdSize = 2 + 12 * gpsEntries.length + 4;
  let dataOffset = gpsIfdOffset + gpsIfdSize;
  const dataBlobs = [];
  const gpsIfd = [...u16le(gpsEntries.length)];
  for (const e of gpsEntries) {
    gpsIfd.push(...u16le(e.tag), ...u16le(e.type), ...u32le(e.count));
    if (e.offset) {
      gpsIfd.push(...u32le(dataOffset));
      dataBlobs.push(...e.data);
      dataOffset += e.data.length;
    } else {
      gpsIfd.push(...e.value);
    }
  }
  gpsIfd.push(...u32le(0));
  const tiff = [
    0x49, 0x49, 0x2a, 0x00, ...u32le(ifd0Offset),
    ...u16le(1),
    ...u16le(0x8825), ...u16le(4), ...u32le(1), ...u32le(gpsIfdOffset),
    ...u32le(0),
    ...gpsIfd,
    ...dataBlobs,
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0"
  return [0xff, 0xe1, ...u16(payload.length + 2), ...payload];
}

export function gpsJpegBytes() {
  const base = Buffer.from(TINY_JPEG_B64, 'base64');
  const app1 = Buffer.from(buildExifApp1());
  // Splice APP1 immediately after SOI (FF D8).
  return Buffer.concat([base.subarray(0, 2), app1, base.subarray(2)]);
}

// Detector: does the byte stream carry an EXIF APP1 whose TIFF references a
// GPS IFD (tag 0x8825)? Scans segments; robust to re-encoding (a stripped
// file simply has no such segment).
export function hasGpsExif(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (marker === 0xe1 && b.subarray(i + 4, i + 10).toString('latin1') === 'Exif\0\0') {
      const seg = b.subarray(i + 4, i + 2 + len);
      for (let j = 0; j + 2 <= seg.length; j++) {
        if ((seg[j] === 0x25 && seg[j + 1] === 0x88) || (seg[j] === 0x88 && seg[j + 1] === 0x25)) {
          return true; // GPSInfo tag in either endianness
        }
      }
    }
    if (marker === 0xda) break; // start of scan — metadata region over
    i += 2 + len;
  }
  return false;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fx = gpsJpegBytes();
  console.log('fixture bytes:', fx.length, 'hasGpsExif(fixture):', hasGpsExif(fx),
    'hasGpsExif(plain):', hasGpsExif(Buffer.from(TINY_JPEG_B64, 'base64')));
}
