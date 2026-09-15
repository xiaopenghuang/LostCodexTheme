import { crc32, deflateSync } from 'node:zlib';

function chunk(name, payload) {
  const type = Buffer.from(name);
  const length = Buffer.alloc(4); length.writeUInt32BE(payload.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([type, payload])));
  return Buffer.concat([length, type, payload, checksum]);
}

// A valid two-pixel PNG with a large ancillary text chunk, not a user's image.
export function largePng(bytes = 10 * 1024 * 1024) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  const prefix = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 20, 80, 40, 255, 30, 90, 50, 255])))]);
  const ending = chunk('IEND', Buffer.alloc(0));
  const text = Buffer.alloc(bytes - prefix.length - ending.length - 12, 'x');
  text.write('Comment\0', 0, 'latin1');
  return Buffer.concat([prefix, chunk('tEXt', text), ending]);
}
