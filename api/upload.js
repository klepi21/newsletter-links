// Issues short-lived upload tokens so the browser can send the email slices
// straight to Vercel Blob. Only small JPEG/PNG files under the nl/<id>/ path
// are accepted, so the endpoint can't be used to host anything else.
import { handleUpload } from '@vercel/blob/client';

const PATH = /^nl\/[a-z0-9]{12,32}\/slice-\d{2}-\d{1,2}\.(jpg|png)$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!PATH.test(pathname)) throw new Error('Invalid file name');
        return {
          allowedContentTypes: ['image/jpeg', 'image/png'],
          maximumSizeInBytes: 4 * 1024 * 1024,
          addRandomSuffix: false,
          cacheControlMaxAge: 60 * 60 * 24 * 365,
        };
      },
      onUploadCompleted: async () => {},
    });
    res.status(200).json(json);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Upload failed' });
  }
}
