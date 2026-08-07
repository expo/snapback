export type UploadedImage = Readonly<{url: string; key: string}>;

/** Gateway composition adapter. Credentials remain HttpOnly and server-custodied. */
export async function uploadImage(file: File): Promise<UploadedImage> {
  const presign = await fetch('/api/upload/presigned-url', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({contentType: file.type || 'application/octet-stream', size: file.size}),
  });
  if (!presign.ok) throw new Error(`Image upload refused (${presign.status})`);
  const prepared = await presign.json() as {url: string; key: string; deliveryUrl: string};
  const upload = await fetch(prepared.url, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: {'content-type': file.type || 'application/octet-stream'},
    body: file,
  });
  if (!upload.ok) throw new Error(`Image delivery refused (${upload.status})`);
  return {url: prepared.deliveryUrl, key: prepared.key};
}
