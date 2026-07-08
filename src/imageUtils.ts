const MAX_DIMENSION = 1600; // downscale huge images so storage and rendering stay smooth

export interface LoadedImage {
  dataURL: string;
  width: number;
  height: number;
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export async function fileToImageData(file: File): Promise<LoadedImage> {
  if (!isImageFile(file)) throw new Error('Only image files can be inserted.');
  const dataURL = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('That image could not be decoded.'));
    el.src = dataURL;
  });

  let { width, height } = img;
  if (Math.max(width, height) <= MAX_DIMENSION && !file.type.includes('heic')) {
    return { dataURL, width, height };
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  width = Math.round(width * scale);
  height = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
  return { dataURL: canvas.toDataURL('image/png'), width, height };
}
