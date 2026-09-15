import { imageMetadata } from './images';

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_DISPLAY_BYTES = 512 * 1024;

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('无法加载背景图片'));
    reader.readAsDataURL(blob);
  });
}

// Stored/exported assets remain unchanged. Bound only the renderer's copy so
// its CSS variable stays below Chromium's substitution limit.
export async function displayImageDataUrl(source: Blob): Promise<string> {
  if (source.size === 0 || source.size > MAX_SOURCE_BYTES) throw new Error('图片大小需在 10 MB 以内');
  const metadata = imageMetadata(new Uint8Array(await source.arrayBuffer()));
  const type = `image/${metadata.format === 'jpg' ? 'jpeg' : metadata.format}`;
  const image = new Blob([source], { type });
  if (image.size <= MAX_DISPLAY_BYTES) return dataUrl(image);
  const bitmap = await createImageBitmap(image).catch(() => { throw new Error('这张图片无法读取'); });
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法准备背景图片');
    const scale = Math.min(1, 3840 / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 10; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale * 0.75 ** attempt));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale * 0.75 ** attempt));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const encoded = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.9));
      if (encoded && encoded.size <= MAX_DISPLAY_BYTES) return await dataUrl(encoded);
    }
    throw new Error('背景图片无法缩减到显示大小，请换一张图片');
  } finally { bitmap.close(); }
}
