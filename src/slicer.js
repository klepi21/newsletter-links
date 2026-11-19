// Turns an image + link rectangles into an email-safe grid of slices.
//
// Email clients don't reliably support image maps, so instead the image is cut
// into horizontal bands at every rectangle edge, and each band into cells at
// the rectangle edges inside it. Cells under a rectangle become links. Neighbour
// cells that share the same link (or no link) are merged so there are as few
// pieces as possible. Reassembled in a table, it looks like one image.

const uniqSorted = (a) => [...new Set(a)].sort((x, y) => x - y);

export function computeGrid(W, H, rects) {
  const R = rects.map((r) => ({
    ...r,
    x0: Math.max(0, Math.round(r.x)), y0: Math.max(0, Math.round(r.y)),
    x1: Math.min(W, Math.round(r.x + r.w)), y1: Math.min(H, Math.round(r.y + r.h)),
  })).filter((r) => r.x1 - r.x0 >= 2 && r.y1 - r.y0 >= 2);

  const ys = uniqSorted([0, H, ...R.flatMap((r) => [r.y0, r.y1])]);
  let bands = [];
  for (let k = 0; k < ys.length - 1; k++) {
    const y0 = ys[k], y1 = ys[k + 1];
    if (y1 - y0 < 1) continue;
    const active = R.filter((r) => r.y0 < y1 && r.y1 > y0);
    const xs = uniqSorted([0, W, ...active.flatMap((r) => [r.x0, r.x1])]);
    let cells = [];
    for (let j = 0; j < xs.length - 1; j++) {
      const x0 = xs[j], x1 = xs[j + 1];
      if (x1 - x0 < 1) continue;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      // the rectangle drawn last wins where two overlap
      const hit = [...active].reverse().find((r) => cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1);
      cells.push({ x0, x1, link: hit ? hit.id : null });
    }
    // merge horizontal neighbours with the same link
    cells = cells.reduce((acc, c) => {
      const last = acc[acc.length - 1];
      if (last && last.link === c.link) last.x1 = c.x1; else acc.push({ ...c });
      return acc;
    }, []);
    bands.push({ y0, y1, cells });
  }
  // merge vertical neighbours that are a single full-width cell with the same link
  bands = bands.reduce((acc, b) => {
    const last = acc[acc.length - 1];
    if (last && last.cells.length === 1 && b.cells.length === 1 && last.cells[0].link === b.cells[0].link) last.y1 = b.y1;
    else acc.push({ ...b, cells: b.cells.map((c) => ({ ...c })) });
    return acc;
  }, []);
  return bands;
}

/** cut the image into slices; returns [{band, cell, blob, name, w, h}] */
export async function renderSlices(img, bands, { emailWidth, quality, format }) {
  const W = img.naturalWidth;
  // export at up to 2x the email width so it stays sharp on retina phones
  const k = Math.min(1, (emailWidth * 2) / W);
  const ext = format === 'png' ? 'png' : 'jpg';
  const type = format === 'png' ? 'image/png' : 'image/jpeg';
  const out = [];
  for (let b = 0; b < bands.length; b++) {
    const band = bands[b];
    for (let c = 0; c < band.cells.length; c++) {
      const cell = band.cells[c];
      const sw = cell.x1 - cell.x0, sh = band.y1 - band.y0;
      const cw = Math.max(1, Math.round(sw * k)), ch = Math.max(1, Math.round(sh * k));
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch); }
      ctx.drawImage(img, cell.x0, band.y0, sw, sh, 0, 0, cw, ch);
      const blob = await new Promise((res) => canvas.toBlob(res, type, quality));
      out.push({ band: b, cell: c, blob, name: `images/slice-${String(b + 1).padStart(2, '0')}-${c + 1}.${ext}` });
    }
  }
  return out;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Build the email HTML.
 * @param srcFor(name) returns the src to use for a slice (relative path, absolute URL or blob URL)
 */
export function buildHtml(W, H, bands, rectsById, slices, opts) {
  const E = opts.emailWidth;
  const dx = (x) => Math.round((x * E) / W);
  const dy = (y) => Math.round((y * E) / W);
  const bg = opts.background || '#f4f4f4';
  const byKey = new Map(slices.map((s) => [s.band + ':' + s.cell, s]));
  const imgTag = (s, w, h, alt) =>
    `<img src="${esc(opts.srcFor(s.name))}" width="${w}" height="${h}" alt="${esc(alt)}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;outline:none;text-decoration:none;">`;
  const wrap = (html, link) => {
    const r = link && rectsById.get(link);
    if (!r || !r.url) return html;
    return `<a href="${esc(r.url)}" target="_blank" style="display:block;text-decoration:none;">${html}</a>`;
  };

  const rows = bands.map((band, b) => {
    const h = dy(band.y1) - dy(band.y0);
    if (band.cells.length === 1) {
      const c = band.cells[0], s = byKey.get(b + ':0');
      const r = c.link && rectsById.get(c.link);
      return `<tr><td style="font-size:0;line-height:0;">${wrap(imgTag(s, E, h, r ? r.alt : ''), c.link)}</td></tr>`;
    }
    const tds = band.cells.map((c, j) => {
      const w = dx(c.x1) - dx(c.x0), s = byKey.get(b + ':' + j);
      const r = c.link && rectsById.get(c.link);
      const pct = ((w / E) * 100).toFixed(4);
      return `<td width="${w}" valign="top" style="width:${pct}%;font-size:0;line-height:0;">${wrap(imgTag(s, w, h, r ? r.alt : ''), c.link)}</td>`;
    }).join('');
    return `<tr><td style="font-size:0;line-height:0;"><table role="presentation" width="${E}" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr>${tds}</tr></table></td></tr>`;
  }).join('\n');

  const pre = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${esc(opts.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>`
    : '';
  const top = opts.viewOnline
    ? `<tr><td align="center" style="padding:0 0 12px;font:12px Arial,Helvetica,sans-serif;color:#7a7a7a;"><a href="${esc(opts.viewOnline)}" target="_blank" style="color:#7a7a7a;text-decoration:underline;">${esc(opts.viewOnlineText || 'View in your browser')}</a></td></tr>`
    : '';
  const foot = opts.footer
    ? `<tr><td align="center" style="padding:18px 16px 0;font:13px/1.5 Arial,Helvetica,sans-serif;color:#555;">${esc(opts.footer).replace(/\n/g, '<br>')}</td></tr>`
    : '';

  // pasted straight into Gmail / Outlook: just the email body, no page wrapper
  if (opts.fragment) {
    return `<table role="presentation" width="${E}" cellpadding="0" cellspacing="0" border="0" style="width:${E}px;max-width:100%;border-collapse:collapse;">
${top}
<tr><td>
<table role="presentation" width="${E}" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
${rows}
</table>
</td></tr>
${foot}
</table>`;
  }

  return `<!DOCTYPE html>
<html lang="${opts.lang || 'el'}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(opts.title || 'Newsletter')}</title>
<style>
  body { margin:0; padding:0; }
  img { -ms-interpolation-mode:bicubic; }
  a img { border:0; }
  @media only screen and (max-width:${E + 20}px) {
    .wrap { width:100% !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${esc(bg)};">
${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${esc(bg)};">
<tr><td align="center" style="padding:20px 0;">
<table role="presentation" class="wrap" width="${E}" cellpadding="0" cellspacing="0" border="0" style="width:${E}px;max-width:100%;">
${top}
<tr><td>
<table role="presentation" width="${E}" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
${rows}
</table>
</td></tr>
${foot}
</table>
</td></tr>
</table>
</body>
</html>
`;
}
