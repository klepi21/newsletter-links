# Newsletter Links

Put links on specific spots of a newsletter image, so it works in every email client.

Email clients don't reliably support image maps, so the tool cuts the image into
slices at the edges of the link boxes you draw, and rebuilds it as a table: it
looks like one image, but each part can have its own link.

## Use

1. Drop the newsletter image (JPEG, PNG or WebP, ideally 1200 px wide).
2. Draw a box over each spot that should be a link and type the URL (an email
   address becomes a `mailto:` link automatically).
3. **Upload and ready email**: the slices are uploaded to Vercel Blob with
   permanent public URLs. Then:
   - **Copy for Gmail / Outlook**: open a new message and paste.
   - **Copy HTML code**: paste into Mailchimp, Brevo or any HTML editor.
4. Without uploading: download a ZIP (email + images) for Mailchimp's
   *Import zip*, or copy HTML that points to your own image hosting.

The image is processed in the browser; only the slices are uploaded, and only
when you press the upload button.

## Develop

```bash
npm install
npm run dev        # editor, preview and ZIP work locally
vercel dev         # also runs /api/upload (needs BLOB_READ_WRITE_TOKEN)
npm run build
```

`api/upload.js` hands out short-lived upload tokens and accepts only JPEG/PNG
slices up to 4 MB under `nl/<random id>/`.
