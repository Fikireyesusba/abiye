/**
 * Make a large JPG / PNG photo smaller in the customer's browser before it is uploaded, so it stays under the
 * virus scanner's file-size limit (and uploads faster on mobile data). PDFs / DOCX are left as they are.
 * Small files are not touched. If the browser cannot decode the image, the original file is returned
 * (the size check then decides).
 */
export async function shrinkImage(
  file: File,
  opts: { maxBytes: number; maxSide?: number; minQuality?: number; target?: number },
): Promise<File> {
  if (!/^image\/(jpeg|png)$/.test(file.type)) return file;
  // Already small: keep the original (no quality loss).
  const target = Math.min(opts.maxBytes, opts.target ?? 1.5 * 1024 * 1024);
  if (file.size <= target) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const maxSide = opts.maxSide ?? 2000;
    let scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    let best: Blob | null = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.fillStyle = "#ffffff"; // transparent PNG areas → white (JPEG has no transparency)
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      for (const quality of [0.85, 0.75, opts.minQuality ?? 0.6]) {
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
        if (blob && (!best || blob.size < best.size)) best = blob;
        if (blob && blob.size <= target) {
          return new File([blob], file.name.replace(/\.(png|jpe?g)$/i, "") + ".jpg", { type: "image/jpeg", lastModified: Date.now() });
        }
      }
      scale *= 0.8; // still too big: a bit smaller and try again
    }
    return best && best.size < file.size
      ? new File([best], file.name.replace(/\.(png|jpe?g)$/i, "") + ".jpg", { type: "image/jpeg", lastModified: Date.now() })
      : file;
  } finally {
    bitmap.close();
  }
}
