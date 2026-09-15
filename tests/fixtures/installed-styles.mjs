import { openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Read only stylesheet entries from the detected official package. Never patch
// or unpack application files; test pages block all network requests.
export function installedStyles(executable) {
  const fd = openSync(join(dirname(executable), 'resources', 'app.asar'), 'r');
  try {
    const size = fstatSync(fd).size;
    const prefix = Buffer.alloc(16); readSync(fd, prefix, 0, 16, 0);
    const headerSize = prefix.readUInt32LE(12);
    const base = 8 + prefix.readUInt32LE(4);
    if (headerSize > 32 * 1024 * 1024 || base > size || headerSize + 16 > base) throw new Error('Invalid ASAR header');
    const header = Buffer.alloc(headerSize); readSync(fd, header, 0, header.length, 16);
    const assets = JSON.parse(header.toString()).files.webview.files.assets.files;
    const styles = [];
    let total = 0;
    for (const [name, entry] of Object.entries(assets)) {
      if (!/^app(?:-[\w-]+)?\.css$/.test(name) || entry.unpacked) continue;
      const offset = Number(entry.offset);
      total += entry.size;
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(entry.size)
        || entry.size < 0 || total > 8 * 1024 * 1024 || base + offset + entry.size > size) throw new Error('Invalid stylesheet entry');
      const bytes = Buffer.alloc(entry.size); readSync(fd, bytes, 0, bytes.length, base + offset);
      styles.push({ name, css: bytes.toString() });
    }
    return styles;
  } finally { closeSync(fd); }
}
