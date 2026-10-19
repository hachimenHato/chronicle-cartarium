import type { MapObject } from '../../shared/cartography';
import { makeId } from '../../shared/model';
import { request } from './api';

export const MAP_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export function fitMapImage(
  url: string,
  name: string,
  width: number,
  height: number,
  imageWidth: number,
  imageHeight: number,
  overlay = false,
): MapObject {
  if (![width, height, imageWidth, imageHeight].every((n) => Number.isFinite(n) && n > 0))
    throw new Error('图片尺寸无效。');
  const factor = Math.min(width / imageWidth, height / imageHeight) * (overlay ? 0.8 : 1);
  const w = Math.min(width, imageWidth * factor),
    h = Math.min(height, imageHeight * factor);
  return {
    id: makeId('image'),
    name: name.trim().slice(0, 100) || '导入地图图片',
    kind: 'image',
    imageUrl: url,
    layer: overlay ? 'detail' : 'base',
    points: [
      { x: (width - w) / 2, y: (height - h) / 2 },
      { x: (width + w) / 2, y: (height + h) / 2 },
    ],
    text: '',
    color: 'none',
    stroke: 'none',
    strokeWidth: 0,
    size: 16,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: true,
  };
}
export async function uploadMapImage(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('请选择 PNG、JPG 或 WebP 图片。');
  if (!file.size || file.size > MAP_IMAGE_MAX_BYTES)
    throw new Error('图片应大于 0 且不超过 8 MB。');
  const url = URL.createObjectURL(file);
  let width: number, height: number;
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    width = image.naturalWidth;
    height = image.naturalHeight;
    if (!width || !height || width * height > 64_000_000)
      throw new Error('图片尺寸过大或无法读取，请缩小至 6400 万像素以内。');
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.startsWith('图片')
        ? error.message
        : '这张图片无法解码，请检查文件是否完整。',
    );
  } finally {
    URL.revokeObjectURL(url);
  }
  const body = new FormData();
  body.append('file', file);
  const uploaded = await request<{ url: string }>('/api/uploads', { method: 'POST', body });
  return { url: uploaded.url, width, height };
}
/** Export a self-contained SVG. Only the local validated upload directory is fetched. */
export async function embedMapImages(snapshot: SVGSVGElement) {
  const images = [...snapshot.querySelectorAll('image')];
  const urls = [...new Set(images.map((image) => image.getAttribute('href')!))];
  const embedded = new Map<string, string>();
  for (const url of urls) {
    if (!/^\/uploads\/[A-Za-z0-9_-]+\.(png|jpg|webp)$/.test(url))
      throw new Error('地图图片地址无效，无法导出。');
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('地图图片无法读取，请检查 uploads 目录后重试。');
    const blob = await response.blob();
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) ||
      blob.size > MAP_IMAGE_MAX_BYTES
    )
      throw new Error('地图图片内容无效，无法导出。');
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('读取地图图片失败。'));
      reader.readAsDataURL(blob);
    });
    embedded.set(url, dataUrl);
  }
  images.forEach((image) => image.setAttribute('href', embedded.get(image.getAttribute('href')!)!));
}
