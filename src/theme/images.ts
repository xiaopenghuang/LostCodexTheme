export interface ImageMetadata { format: 'png' | 'jpg' | 'webp'; width: number; height: number }

function checked(format: ImageMetadata['format'], width: number, height: number): ImageMetadata {
  if (!width || !height || width > 16384 || height > 16384 || width * height > 50_000_000) {
    throw new Error('图片尺寸过大或不正确，请先缩小图片');
  }
  return { format, width, height };
}

// Inspect dimensions before asking the browser to allocate a decoded pixel buffer.
export function imageMetadata(bytes: Uint8Array): ImageMetadata {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => byte === bytes[i])) {
    if (view.getUint32(8) !== 13 || ascii(12, 4) !== 'IHDR') throw new Error('PNG 图片头已损坏');
    return checked('png', view.getUint32(16), view.getUint32(20));
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 1 < bytes.length) {
      if (bytes[offset++] !== 255) throw new Error('JPEG 图片头已损坏');
      while (offset < bytes.length && bytes[offset] === 255) offset++;
      if (offset >= bytes.length) break;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw new Error('JPEG 图片数据不完整');
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) throw new Error('JPEG 图片尺寸字段已损坏');
        return checked('jpg', view.getUint16(offset + 5), view.getUint16(offset + 3));
      }
      offset += length;
    }
    throw new Error('无法读取 JPEG 图片尺寸');
  }
  if (bytes.length >= 20 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const end = view.getUint32(4, true) + 8;
    if (end > bytes.length || end < 20) throw new Error('WebP 图片数据不完整');
    for (let offset = 12; offset + 8 <= end;) {
      const tag = ascii(offset, 4), length = view.getUint32(offset + 4, true), start = offset + 8;
      if (start + length > end) throw new Error('WebP 图片块越界');
      if (tag === 'VP8X' && length >= 10) {
        const integer24 = (index: number) => bytes[index] | bytes[index + 1] << 8 | bytes[index + 2] << 16;
        return checked('webp', integer24(start + 4) + 1, integer24(start + 7) + 1);
      }
      if (tag === 'VP8L' && length >= 5 && bytes[start] === 0x2f) {
        const bits = view.getUint32(start + 1, true);
        if (bits >>> 29) throw new Error('WebP 图片版本不受支持');
        return checked('webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      }
      if (tag === 'VP8 ' && length >= 10 && ascii(start + 3, 3) === '\u009d\u0001\u002a') {
        return checked('webp', view.getUint16(start + 6, true) & 0x3fff, view.getUint16(start + 8, true) & 0x3fff);
      }
      offset = start + length + (length & 1);
    }
    throw new Error('无法读取 WebP 图片尺寸');
  }
  throw new Error('仅支持 PNG、JPEG 和 WebP 图片');
}
