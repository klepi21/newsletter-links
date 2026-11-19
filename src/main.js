import { zipSync, strToU8 } from 'fflate';
import { Editor } from './editor.js';
import { computeGrid, renderSlices, buildHtml } from './slicer.js';
import { upload } from '@vercel/blob/client';

const $ = (id) => document.getElementById(id);
const editor = new Editor($('stage'));
let img = null, fileName = 'newsletter';

// ------------------------------------------------------------ load image
function loadFile(file) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) { toast('Χρειάζεται εικόνα JPEG, PNG ή WebP'); return; }
  fileName = file.name.replace(/\.[^.]+$/, '') || 'newsletter';
  const url = URL.createObjectURL(file);
  const im = new Image();
  im.onload = () => {
    img = im;
    $('drop').hidden = true;
    $('shell').hidden = false;
    editor.setImage(im, url);
    $('meta').textContent = `${im.naturalWidth} × ${im.naturalHeight} px`;
    if (im.naturalWidth < 1000) toast('Η εικόνα είναι μικρή. Για καθαρό αποτέλεσμα στα κινητά προτίμησε πλάτος 1200 px.', 4200);
    step(2);
  };
  im.src = url;
}
$('pick').onclick = () => $('file').click();
$('drop').onclick = (e) => { if (e.target === $('drop') || e.target.closest('.drop-inner') && !e.target.closest('button')) $('file').click(); };
$('file').onchange = (e) => loadFile(e.target.files[0]);
$('newImg').onclick = () => $('file').click();
['dragenter', 'dragover'].forEach((t) => window.addEventListener(t, (e) => { e.preventDefault(); $('drop').classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => window.addEventListener(t, (e) => { e.preventDefault(); if (t === 'drop' || !e.relatedTarget) $('drop').classList.remove('over'); }));
window.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
window.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) loadFile(f);
});

// ------------------------------------------------------------ links panel
function normUrl(u) {
  u = u.trim();
  if (!u) return '';
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) return 'mailto:' + u;
  return 'https://' + u;
}

function renderLinks() {
  const list = $('links');
  const rects = editor.rects;
  $('count').textContent = rects.length;
  $('empty').hidden = rects.length > 0;
  const seen = new Set();
  rects.forEach((r, i) => {
    let el = list.querySelector(`[data-id="${r.id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'link';
      el.dataset.id = r.id;
      el.innerHTML = `
        <span class="badge"></span>
        <div class="fields">
          <input type="url" class="u" placeholder="https://... ή email" spellcheck="false" />
          <input type="text" class="a" placeholder="Περιγραφή (αν δεν φορτώσει η εικόνα)" />
        </div>
        <button class="rm" title="Διαγραφή" aria-label="Διαγραφή">
          <svg viewBox="0 0 24 24"><path d="M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9 7V4h6v3"/></svg>
        </button>`;
      const u = el.querySelector('.u'), a = el.querySelector('.a');
      u.addEventListener('input', () => editor.update(r.id, { url: normUrl(u.value) }));
      u.addEventListener('blur', () => { const v = normUrl(u.value); u.value = v; editor.update(r.id, { url: v }); });
      a.addEventListener('input', () => editor.update(r.id, { alt: a.value }));
      el.querySelector('.rm').onclick = () => editor.remove(r.id);
      el.addEventListener('focusin', () => { if (editor.sel !== r.id) editor.select(r.id); });
      list.append(el);
    }
    seen.add(String(r.id));
    el.querySelector('.badge').textContent = i + 1;
    el.classList.toggle('sel', r.id === editor.sel);
    el.classList.toggle('missing', !r.url);
    // keep the list in drawing order, but never move a field you're typing in
    const items = [...list.querySelectorAll('.link')];
    if (items[i] !== el) list.insertBefore(el, items[i] || null);
  });
  list.querySelectorAll('.link').forEach((el) => { if (!seen.has(el.dataset.id)) el.remove(); });
}

editor.addEventListener('change', (e) => {
  renderLinks();
  const ready = !!img;
  ['btnPreview', 'btnZip', 'btnCopy', 'btnHost'].forEach((id) => ($(id).disabled = !ready));
  if (!e.detail?.soft) { updateStats(); invalidateHosting(); } // new link text needs no re-upload
  if (editor.rects.length) step(editor.rects.every((r) => r.url) ? 3 : 2);
});
editor.addEventListener('select', () => renderLinks());
editor.addEventListener('created', (e) => {
  requestAnimationFrame(() => $('links').querySelector(`[data-id="${e.detail}"] .u`)?.focus({ preventScroll: true }));
});

function step(n) {
  [1, 2, 3].forEach((k) => {
    $('st' + k).classList.toggle('on', k === n);
    $('st' + k).classList.toggle('done', k < n);
  });
}

// ------------------------------------------------------------ settings
$('quality').oninput = () => { $('qOut').textContent = $('quality').value; };
$('bg').oninput = () => { $('bgText').value = $('bg').value; };
$('bgText').onchange = () => { if (/^#[0-9a-f]{6}$/i.test($('bgText').value)) $('bg').value = $('bgText').value; };
$('width').onchange = () => { updateStats(); invalidateHosting(); };
$('quality').addEventListener('change', invalidateHosting);
$('format').addEventListener('change', invalidateHosting);

function opts() {
  return {
    emailWidth: Math.min(800, Math.max(320, +$('width').value || 600)),
    quality: +$('quality').value / 100,
    format: $('format').value,
    background: $('bgText').value,
    preheader: $('preheader').value.trim(),
    title: $('title').value.trim() || fileName,
    viewOnline: normUrl($('viewOnline').value),
    viewOnlineText: 'Δείτε το email στον browser',
    footer: $('footer').value.trim(),
    base: $('base').value.trim(),
  };
}

function updateStats() {
  if (!img) return;
  const bands = computeGrid(img.naturalWidth, img.naturalHeight, editor.rects);
  const pieces = bands.reduce((n, b) => n + b.cells.length, 0);
  $('stats').textContent = `${pieces} ${pieces === 1 ? 'κομμάτι' : 'κομμάτια'} εικόνας, ${editor.rects.length} links`;
}

// ------------------------------------------------------------ build
async function build(mode) {
  const o = opts();
  const missing = editor.rects.filter((r) => !r.url);
  if (missing.length && mode !== 'preview') toast(`${missing.length === 1 ? 'Ένα πλαίσιο δεν έχει' : missing.length + ' πλαίσια δεν έχουν'} link και θα μείνουν απλή εικόνα`, 3600);
  const bands = computeGrid(img.naturalWidth, img.naturalHeight, editor.rects);
  const slices = mode === 'hosted' || mode === 'paste' ? hosted.slices : await renderSlices(img, bands, o);
  const rectsById = new Map(editor.rects.map((r) => [r.id, r]));
  let srcFor;
  if (mode === 'hosted' || mode === 'paste') {
    srcFor = (n) => hosted.urls.get(n);
  } else if (mode === 'preview') {
    const urls = new Map(slices.map((s) => [s.name, URL.createObjectURL(s.blob)]));
    srcFor = (n) => urls.get(n);
  } else if (o.base) {
    const base = o.base.endsWith('/') ? o.base : o.base + '/';
    srcFor = (n) => base + n.replace(/^images\//, '');
  } else {
    srcFor = (n) => n;
  }
  const html = buildHtml(img.naturalWidth, img.naturalHeight, bands, rectsById, slices, { ...o, srcFor, fragment: mode === 'paste' });
  return { html, slices, o };
}

// preview
$('btnPreview').onclick = async () => {
  const { html } = await build('preview');
  const frame = $('frame');
  frame.srcdoc = html;
  frame.onload = () => applyCuts();
  $('modal').classList.add('open');
  $('modal').setAttribute('aria-hidden', 'false');
};
function applyCuts() {
  const doc = $('frame').contentDocument;
  if (!doc) return;
  let st = doc.getElementById('__cuts');
  if (!st) { st = doc.createElement('style'); st.id = '__cuts'; doc.head.append(st); }
  st.textContent = $('showCuts').checked ? 'img{outline:1px dashed rgba(255,0,90,.85);outline-offset:-1px} a img{outline:2px solid rgba(20,120,255,.9)}' : '';
}
$('showCuts').onchange = applyCuts;
document.querySelectorAll('.seg button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
  $('frame').classList.toggle('mobile', b.dataset.w === 'mobile');
});
const closeModal = () => { $('modal').classList.remove('open'); $('modal').setAttribute('aria-hidden', 'true'); };
$('closeModal').onclick = closeModal;
$('modal').onclick = (e) => { if (e.target === $('modal')) closeModal(); };
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// zip
$('btnZip').onclick = async () => {
  const btn = $('btnZip');
  btn.disabled = true; btn.textContent = 'Ετοιμάζεται…';
  try {
    const { html, slices, o } = await build('zip');
    const files = { 'index.html': strToU8(html) };
    for (const s of slices) files[s.name] = new Uint8Array(await s.blob.arrayBuffer());
    const zip = zipSync(files, { level: 6 });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
    a.download = `${fileName}-email.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(o.base ? 'Έτοιμο. Ανέβασε τον φάκελο images στη διεύθυνση που όρισες.' : 'Έτοιμο. Ανέβασε το ZIP στο Mailchimp (Import zip).', 3800);
    step(3);
  } finally {
    btn.disabled = false; btn.textContent = 'Λήψη ZIP';
  }
};

// copy html
$('btnCopy').onclick = async () => {
  const { html, o } = await build('copy');
  try { await navigator.clipboard.writeText(html); } catch { toast('Ο browser δεν επέτρεψε την αντιγραφή'); return; }
  toast(o.base ? 'Το HTML αντιγράφηκε, με τις εικόνες από τη διεύθυνσή σου' : 'Το HTML αντιγράφηκε. Οι εικόνες είναι στο ZIP: όρισε διεύθυνση φιλοξενίας για να δουλεύει απευθείας.', 4200);
};

function toast(msg, ms = 2400) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), ms);
}

// ------------------------------------------------------------ hosting
// Upload the slices to Vercel Blob once; after that the email can be pasted
// straight into Gmail / Outlook or any newsletter tool, no files to handle.
let hosted = null;

function invalidateHosting() {
  if (!hosted) return;
  hosted = null;
  $('hostDone').hidden = true;
  $('hostBox').hidden = false;
}

const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');

$('btnHost').onclick = async () => {
  const btn = $('btnHost'), label = btn.querySelector('span');
  btn.disabled = true; btn.classList.add('progress');
  const o = opts();
  try {
    const missing = editor.rects.filter((r) => !r.url).length;
    if (missing) toast(`${missing === 1 ? 'Ένα πλαίσιο δεν έχει' : missing + ' πλαίσια δεν έχουν'} link και θα μείνουν απλή εικόνα`, 3200);
    label.textContent = 'Ετοιμάζονται οι εικόνες…';
    const bands = computeGrid(img.naturalWidth, img.naturalHeight, editor.rects);
    const slices = await renderSlices(img, bands, o);
    const id = rid();
    const urls = new Map();
    let done = 0;
    const queue = [...slices];
    const worker = async () => {
      while (queue.length) {
        const s = queue.shift();
        const res = await upload(`nl/${id}/${s.name.replace(/^images\//, '')}`, s.blob, {
          access: 'public', handleUploadUrl: '/api/upload', contentType: s.blob.type,
        });
        urls.set(s.name, res.url);
        done++;
        label.textContent = `Ανέβασμα ${done} από ${slices.length}…`;
        btn.style.setProperty('--p', `${(done / slices.length) * 100}%`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    hosted = { urls, slices: slices.map(({ band, cell, name }) => ({ band, cell, name })) };
    $('hostBox').hidden = true;
    $('hostDone').hidden = false;
    step(3);
    toast('Έτοιμο. Πάτα «Αντιγραφή για Gmail / Outlook» και επικόλλησε στο νέο μήνυμα.', 3800);
  } catch (err) {
    console.error(err);
    toast(location.hostname === 'localhost' ? 'Το ανέβασμα δουλεύει στην online έκδοση του εργαλείου' : 'Το ανέβασμα απέτυχε. Δοκίμασε ξανά.', 3600);
  } finally {
    btn.disabled = false; btn.classList.remove('progress'); btn.style.removeProperty('--p');
    label.textContent = 'Ανέβασμα και έτοιμο email';
  }
};

// rich copy: pasting into Gmail / Outlook gives the real email, not code
$('btnRich').onclick = async () => {
  if (!hosted) return;
  const { html } = await build('paste');
  const plain = editor.rects.filter((r) => r.url).map((r) => `${r.alt || 'Link'}: ${r.url}`).join('\n');
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([plain || ' '], { type: 'text/plain' }),
    })]);
  } catch {
    // older browsers: copy a rendered selection instead
    const box = document.createElement('div');
    box.contentEditable = 'true';
    box.style.cssText = 'position:fixed;left:-9999px;top:0;';
    box.innerHTML = html;
    document.body.append(box);
    const range = document.createRange(); range.selectNodeContents(box);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    document.execCommand('copy');
    sel.removeAllRanges(); box.remove();
  }
  toast('Αντιγράφηκε. Άνοιξε νέο μήνυμα στο Gmail ή Outlook και κάνε επικόλληση.', 3600);
};

$('btnCode').onclick = async () => {
  if (!hosted) return;
  const { html } = await build('hosted');
  try { await navigator.clipboard.writeText(html); } catch { toast('Ο browser δεν επέτρεψε την αντιγραφή'); return; }
  toast('Ο κώδικας HTML αντιγράφηκε, με τις εικόνες ήδη online', 3000);
};
