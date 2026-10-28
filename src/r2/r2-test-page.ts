// HTML for the local R2 test page (r2-dev.controller.ts).
// Talks only to its own backend (same origin), which uploads to the bucket server-side.
export const R2_TEST_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>R2 Upload Test</title>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js"></script>
<style>
  :root { --bg:#f6f7fb; --card:#fff; --ink:#111827; --mute:#6b7280; --line:#e5e7eb; --ok:#059669; --bad:#dc2626; --brand:#2563eb; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:var(--bg); color:var(--ink); }
  main { max-width: 1000px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: var(--mute); margin: 0 0 20px; font-size: 14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; margin-bottom:16px; }
  .card h2 { font-size: 15px; margin: 0 0 12px; }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:10px; }
  label { display:block; font-size:12px; color:var(--mute); margin-bottom:4px; }
  input[type=text] { width:100%; padding:8px 10px; border:1px solid var(--line); border-radius:8px; font: 13px ui-monospace, Consolas, monospace; background:#f9fafb; }
  button, select { border:0; border-radius:8px; padding:9px 16px; font-weight:600; cursor:pointer; background:var(--brand); color:#fff; font-size:14px; }
  select { background:#eef2ff; color:var(--brand); padding:7px 10px; }
  button.ghost { background:#eef2ff; color:var(--brand); }
  button.danger { background:#fee2e2; color:var(--bad); padding:5px 10px; font-size:12px; }
  button:disabled { opacity:.5; cursor:default; }
  .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .drop { border:2px dashed #c7d2fe; border-radius:12px; padding:28px; text-align:center; color:var(--mute); cursor:pointer; background:#fafbff; }
  .drop.over { background:#eef2ff; border-color:var(--brand); }
  .bar { height:8px; background:var(--line); border-radius:4px; overflow:hidden; margin-top:6px; }
  .bar > div { height:100%; width:0; background:var(--brand); transition: width .2s; }
  .msg { font-size:14px; margin-top:10px; padding:10px 12px; border-radius:8px; display:none; }
  .msg.ok { display:block; background:#ecfdf5; color:var(--ok); }
  .msg.bad { display:block; background:#fef2f2; color:var(--bad); }
  .msg.info { display:block; background:#eff6ff; color:var(--brand); }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:8px 6px; border-bottom:1px solid var(--line); vertical-align:middle; }
  th { color:var(--mute); font-weight:600; font-size:12px; }
  td.key { word-break: break-all; cursor:pointer; color:var(--brand); }
  td.key code { font-family: ui-monospace, Consolas, monospace; }
  td.key small { display:block; color:var(--mute); margin-top:2px; }
  td.num { white-space:nowrap; }
  .thumb { width:44px; height:44px; object-fit:cover; border-radius:6px; background:#f3f4f6; display:flex; align-items:center; justify-content:center; font-size:20px; }
  .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700; }
  .pill.on { background:#ecfdf5; color:var(--ok); } .pill.off { background:#f3f4f6; color:var(--mute); }
  .modal { position:fixed; inset:0; background:rgba(15,23,42,.7); display:none; align-items:center; justify-content:center; padding:16px; z-index:10; }
  .modal.open { display:flex; }
  .sheet { background:#fff; border-radius:14px; width:min(960px, 100%); max-height:92vh; overflow:auto; }
  .sheet header { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-bottom:1px solid var(--line); gap:10px; }
  .sheet header b { word-break: break-all; }
  .viewer { background:#000; display:flex; align-items:center; justify-content:center; min-height:200px; }
  .viewer img, .viewer video { max-width:100%; max-height:70vh; display:block; }
  .viewer iframe { width:100%; height:70vh; border:0; background:#fff; }
  .info { padding:12px 16px; font-size:13px; color:var(--mute); line-height:1.7; }
  .info code { background:#f3f4f6; padding:1px 6px; border-radius:4px; color:var(--ink); }
</style>
</head>
<body>
<main>
  <h1>R2 Upload Test</h1>
  <p class="sub">Local-only test page. Files are uploaded by this backend straight to your bucket using the keys saved in Settings → Storage.</p>

  <div class="card">
    <h2>Saved settings <span id="enabled" class="pill off">…</span></h2>
    <div class="grid">
      <div><label>Endpoint</label><input type="text" id="endpoint" readonly></div>
      <div><label>Bucket</label><input type="text" id="bucket" readonly></div>
      <div><label>Access Key</label><input type="text" id="accessKey" readonly></div>
      <div><label>Secret Key</label><input type="text" id="secret" readonly></div>
    </div>
    <div class="row" style="margin-top:12px">
      <button class="ghost" id="checkBtn">Test Connection</button>
    </div>
    <div class="msg" id="checkMsg"></div>
  </div>

  <div class="card">
    <h2>Upload a test file <span style="color:var(--mute);font-weight:400">— same path as Admin → Media Library: videos become encrypted HLS (360p/720p/1080p) with only the chunks in the bucket; other files go to the bucket. Everything also appears in the Media Library.</span></h2>
    <div class="drop" id="drop">Click or drop any file here — any size (sent in 20 MB parts)<input type="file" id="file" hidden multiple></div>
    <div id="progressWrap" style="display:none">
      <div class="row" style="justify-content:space-between;font-size:13px;margin-top:12px"><span id="progressLabel"></span><span id="progressPct"></span></div>
      <div class="bar"><div id="progressBar"></div></div>
    </div>
    <div class="msg" id="uploadMsg"></div>
  </div>

  <div class="card">
    <div class="row" style="justify-content:space-between;margin-bottom:8px">
      <h2 style="margin:0">Bucket contents <span id="total" style="color:var(--mute);font-weight:400"></span></h2>
      <button class="ghost" id="refreshBtn">Refresh</button>
    </div>
    <div style="overflow-x:auto"><table>
      <thead><tr><th></th><th>File (click to preview / play)</th><th>Size</th><th>Uploaded</th><th></th></tr></thead>
      <tbody id="rows"><tr><td colspan="5">Loading…</td></tr></tbody>
    </table></div>
  </div>
</main>

<div class="modal" id="modal">
  <div class="sheet">
    <header>
      <b id="mTitle"></b>
      <div class="row">
        <span id="qWrap" style="display:none"><select id="quality"></select></span>
        <button class="ghost" id="mClose">Close</button>
      </div>
    </header>
    <div class="viewer" id="viewer"></div>
    <div class="info" id="mInfo"></div>
  </div>
</div>

<script>
const base = '/api/r2/dev';
const $ = (id) => document.getElementById(id);
const fmt = (b) => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : b >= 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fileUrl = (key) => '/api/r2/file/' + key.split('/').map(encodeURIComponent).join('/');
const show = (el, cls, text) => { el.className = 'msg ' + cls; el.innerHTML = text; };
const kind = (name) => /\\.(png|jpe?g|webp|gif|svg)$/i.test(name) ? 'image' : /\\.pdf$/i.test(name) ? 'pdf' : /\\.(mp4|webm|mov|m4v)$/i.test(name) ? 'video' : /\\.(mp3|wav|m4a|aac)$/i.test(name) ? 'audio' : 'other';
const ICON = { image: '🖼️', pdf: '📄', video: '🎞️', audio: '🎵', other: '📦' };

// ─── Settings ───
async function loadInfo() {
  const c = await (await fetch(base + '/info')).json();
  $('endpoint').value = c.endpoint || '';
  $('bucket').value = c.bucket || '';
  $('accessKey').value = c.accessKeyId || '';
  $('secret').value = c.hasSecret ? '•••••••• (saved on server)' : '(not saved)';
  $('enabled').textContent = c.enabled ? 'Upload toggle ON' : 'Upload toggle OFF';
  $('enabled').className = 'pill ' + (c.enabled ? 'on' : 'off');
}
$('checkBtn').onclick = async () => {
  $('checkBtn').disabled = true;
  show($('checkMsg'), 'info', 'Checking…');
  try {
    const r = await (await fetch(base + '/check', { method: 'POST' })).json();
    show($('checkMsg'), r.success ? 'ok' : 'bad', esc(r.message));
  } catch (e) { show($('checkMsg'), 'bad', esc(e.message)); }
  $('checkBtn').disabled = false;
};

// ─── Preview modal ───
let hls = null;
function closeModal() {
  if (hls) { hls.destroy(); hls = null; }
  $('viewer').innerHTML = '';
  $('qWrap').style.display = 'none';
  $('modal').classList.remove('open');
}
$('mClose').onclick = closeModal;
$('modal').onclick = (e) => { if (e.target === $('modal')) closeModal(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

function openModal(title, info) {
  closeModal();
  $('mTitle').textContent = title;
  $('mInfo').innerHTML = info || '';
  $('modal').classList.add('open');
}

function previewFile(key) {
  const url = fileUrl(key);
  openModal(key.split('/').pop(), 'Streamed from <b>R2</b> · <code>' + esc(key) + '</code>');
  const k = kind(key);
  if (k === 'image') $('viewer').innerHTML = '<img src="' + url + '">';
  else if (k === 'pdf') $('viewer').innerHTML = '<iframe src="' + url + '"></iframe>';
  else if (k === 'video') $('viewer').innerHTML = '<video src="' + url + '" controls autoplay></video>';
  else if (k === 'audio') $('viewer').innerHTML = '<audio src="' + url + '" controls autoplay style="margin:40px"></audio>';
  else $('viewer').innerHTML = '<div style="color:#fff;padding:40px">No preview for this type · <a style="color:#93c5fd" href="' + url + '" target="_blank">download / open</a></div>';
}

/** Plays an encrypted HLS video whose chunks are in the bucket, with a quality picker. */
async function playVideo(v) {
  const chunks = Object.entries(v.qualities).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([q, n]) => q + ' ×' + n).join(', ');
  const head = 'Encrypted HLS · chunks in bucket: <code>' + esc(chunks) + '</code>';
  openModal(v.videoId, head + '<br>Starting secure playback…');
  const r = await (await fetch(base + '/play/' + encodeURIComponent(v.videoId))).json();
  if (r.name) $('mTitle').textContent = r.name + '  (' + v.videoId + ')';
  if (!r.streamUrl) {
    const why = r.keyPresent === false ? 'its decryption key is missing on the server (storage/hls_keys)'
      : r.playlistPresent === false ? 'its playlist is missing on the server (uploads/hls)'
      : (r.message || 'playback could not start');
    $('viewer').innerHTML = '<div style="color:#fca5a5;padding:40px;text-align:center">Cannot play: ' + esc(why) + '.<br>These chunks are useless without it — delete them and upload the video again.</div>';
    $('mInfo').innerHTML = head;
    return;
  }

  const video = document.createElement('video');
  video.controls = true; video.autoplay = true; video.playsInline = true;
  $('viewer').appendChild(video);
  if (!window.Hls || !Hls.isSupported()) { video.src = r.streamUrl; return; }

  hls = new Hls();
  hls.loadSource(r.streamUrl);
  hls.attachMedia(video);
  const label = (l) => (l && l.height ? l.height + 'p' : '');
  let loaded = 0;
  const status = () => {
    const l = hls.levels[hls.currentLevel >= 0 ? hls.currentLevel : hls.loadLevel];
    $('mInfo').innerHTML = head + '<br>Now playing: <b>' + label(l) + '</b>' + ($('quality').value === '-1' ? ' (auto)' : '') + ' · chunks loaded: <b>' + loaded + '</b>';
  };
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    const sel = $('quality');
    sel.innerHTML = '<option value="-1">Auto</option>' + hls.levels.map((l, i) => '<option value="' + i + '">' + (label(l) || 'Level ' + (i + 1)) + '</option>').join('');
    sel.value = '-1';
    sel.onchange = () => { hls.currentLevel = Number(sel.value); status(); };
    $('qWrap').style.display = hls.levels.length ? 'inline-block' : 'none';
  });
  hls.on(Hls.Events.LEVEL_SWITCHED, status);
  hls.on(Hls.Events.FRAG_LOADED, () => { loaded++; status(); });
  hls.on(Hls.Events.ERROR, (_e, d) => {
    if (d.fatal) $('mInfo').innerHTML = head + '<br><span style="color:var(--bad)">Playback error: ' + esc(d.details) + '</span>';
  });
}

// ─── Upload ───
// Same chunked path as the Media Library: no overall size limit, 20 MB per request,
// sent one after another (the server's chunk counter isn't safe for parallel chunks).
const CHUNK = 20 * 1024 * 1024;
function sendChunk(fd, onProgress) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', base + '/chunk');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
    xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({ success: false, message: xhr.responseText || ('HTTP ' + xhr.status) }); } };
    xhr.onerror = () => resolve({ success: false, message: 'Network error' });
    xhr.send(fd);
  });
}
async function uploadOne(file) {
  const uploadId = 'dev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const total = Math.max(1, Math.ceil(file.size / CHUNK));
  let r = null;
  for (let i = 0; i < total; i++) {
    const fd = new FormData();
    fd.append('chunk', file.slice(i * CHUNK, Math.min(file.size, (i + 1) * CHUNK)), file.name);
    fd.append('fileName', file.name);
    fd.append('chunkIndex', String(i));
    fd.append('totalChunks', String(total));
    fd.append('chunkSize', String(CHUNK));
    fd.append('fileSize', String(file.size));
    fd.append('uploadId', uploadId);
    for (let attempt = 1; attempt <= 3; attempt++) {
      r = await sendChunk(fd, (loaded) => {
        const pct = Math.min(100, Math.round(((i * CHUNK + loaded) / file.size) * 100));
        setBar('Sending ' + file.name + ' to the server — part ' + (i + 1) + ' of ' + total, pct);
      });
      if (r.success) break;
      await sleep(1000 * attempt);
    }
    if (!r.success) return r;
  }
  return r;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setBar = (label, pct) => {
  $('progressWrap').style.display = 'block';
  $('progressLabel').textContent = label;
  $('progressBar').style.width = (pct == null ? 100 : pct) + '%';
  $('progressPct').textContent = pct == null ? '' : pct + '%';
};

/** Follows a video through the real pipeline: HLS conversion → chunks moving to bucket → done. */
async function trackVideo(name, mediaId) {
  show($('uploadMsg'), 'info', '<b>' + esc(name) + '</b> received by the server — processing…');
  let movingTotal = 0;
  for (;;) {
    await sleep(2000);
    let s;
    try { s = await (await fetch(base + '/media-status/' + encodeURIComponent(mediaId))).json(); } catch { continue; }
    if (s.phase === 'storing') {
      setBar('Server is uploading ' + name + ' to R2…', null);
    } else if (s.phase === 'done' && !s.videoId) {
      show($('uploadMsg'), s.inBucket ? 'ok' : 'info', s.inBucket
        ? '✅ <b>' + esc(name) + '</b> is stored in R2 and listed in the Media Library.'
        : '<b>' + esc(name) + '</b> was saved on this server (R2 upload toggle is OFF, or the bucket upload failed — check the backend log).');
      break;
    } else if (s.phase === 'converting') {
      setBar('Step 1/2 · Converting ' + name + ' to encrypted HLS on the server…', s.percent || 1);
    } else if (s.phase === 'moving') {
      movingTotal = Math.max(movingTotal, s.inBucket + s.local);
      setBar('Step 2/2 · Moving encrypted chunks to R2 — ' + s.inBucket + ' of ' + movingTotal + ' uploaded', Math.round((s.inBucket / Math.max(movingTotal, 1)) * 100));
      loadList();
    } else if (s.phase === 'done') {
      show($('uploadMsg'), 'ok', '✅ <b>' + esc(name) + '</b> converted to encrypted HLS and all ' + (s.inBucket ?? '') + ' chunks are in R2 (' + esc(s.videoId || '') + '). The original MP4 was deleted. Click the 🎬 row below to play it.');
      break;
    } else if (s.phase === 'local') {
      show($('uploadMsg'), 'info', '🎬 <b>' + esc(name) + '</b> converted to encrypted HLS, but "Store encrypted video chunks in the bucket" is OFF in Settings → Storage, so its chunks stay on this server.');
      break;
    } else if (s.phase === 'failed') {
      show($('uploadMsg'), 'bad', '❌ Conversion failed: ' + esc(s.message));
      break;
    } else if (s.phase === 'gone') {
      show($('uploadMsg'), 'bad', '❌ The video was deleted from the Media Library while processing.');
      break;
    }
  }
}

async function handleFiles(files) {
  for (const file of files) {
    $('progressBar').style.width = '0';
    $('progressPct').textContent = '';
    show($('uploadMsg'), 'info', 'Uploading ' + esc(file.name) + ' (' + fmt(file.size) + ')…');
    const r = await uploadOne(file);
    if (r.success && r.mediaId) {
      await trackVideo(file.name, r.mediaId);
    } else if (r.success) {
      show($('uploadMsg'), 'bad', '⚠️ Upload finished but the Media Library entry was not found (was it deleted meanwhile?)');
    } else {
      show($('uploadMsg'), 'bad', '❌ ' + esc(r.message || 'Upload failed'));
    }
  }
  $('progressWrap').style.display = 'none';
  loadList();
}
const drop = $('drop');
drop.onclick = () => $('file').click();
$('file').onchange = (e) => { if (e.target.files.length) handleFiles([...e.target.files]); e.target.value = ''; };
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files.length) handleFiles([...e.dataTransfer.files]); };

// ─── Bucket contents ───
// Encrypted chunks hls/<videoId>/<quality>/enc_*.ts are grouped into one playable video row.
let videos = {};
async function loadList() {
  $('rows').innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
  const r = await (await fetch(base + '/list')).json();
  if (!r.success) { $('rows').innerHTML = '<tr><td colspan="5" style="color:var(--bad)">' + esc(r.message) + '</td></tr>'; return; }
  $('total').textContent = '— ' + r.items.length + ' objects · ' + fmt(r.totalBytes);
  if (!r.items.length) { $('rows').innerHTML = '<tr><td colspan="5" style="color:var(--mute)">Bucket is empty</td></tr>'; return; }

  videos = {};
  const files = [];
  for (const i of r.items) {
    const m = /^hls\\/([\\w-]+)\\/(?:(\\d{3,4}p)\\/)?enc_\\d+\\.ts$/.exec(i.key);
    if (!m) { files.push(i); continue; }
    const v = (videos[m[1]] = videos[m[1]] || { videoId: m[1], size: 0, count: 0, lastModified: '', qualities: {} });
    v.size += i.size; v.count++;
    v.qualities[m[2] || 'single'] = (v.qualities[m[2] || 'single'] || 0) + 1;
    if ((i.lastModified || '') > v.lastModified) v.lastModified = i.lastModified;
  }

  const rows = [
    ...Object.values(videos).map((v) => ({ t: v.lastModified, html:
      '<tr><td><div class="thumb">🎬</div></td>' +
      '<td class="key" data-video="' + esc(v.videoId) + '"><b>▶ ' + esc(v.videoId) + '</b><small>Encrypted HLS video · ' +
        esc(Object.keys(v.qualities).sort((a, b) => parseInt(a) - parseInt(b)).join(' · ')) + ' · ' + v.count + ' chunks</small></td>' +
      '<td class="num">' + fmt(v.size) + '</td>' +
      '<td class="num">' + (v.lastModified ? new Date(v.lastModified).toLocaleString() : '') + '</td>' +
      '<td><button class="danger" data-delvideo="' + esc(v.videoId) + '">Delete</button></td></tr>' })),
    ...files.map((i) => ({ t: i.lastModified, html:
      '<tr><td>' + (kind(i.key) === 'image' ? '<img class="thumb" loading="lazy" src="' + fileUrl(i.key) + '">' : '<div class="thumb">' + ICON[kind(i.key)] + '</div>') + '</td>' +
      '<td class="key" data-preview="' + esc(i.key) + '"><code>' + esc(i.key) + '</code></td>' +
      '<td class="num">' + fmt(i.size) + '</td>' +
      '<td class="num">' + (i.lastModified ? new Date(i.lastModified).toLocaleString() : '') + '</td>' +
      '<td><button class="danger" data-key="' + esc(i.key) + '">Delete</button></td></tr>' })),
  ];
  rows.sort((a, b) => (b.t || '').localeCompare(a.t || ''));
  $('rows').innerHTML = rows.map((x) => x.html).join('');
}

$('rows').onclick = async (e) => {
  const cell = e.target.closest('td');
  if (cell?.dataset.video) return playVideo(videos[cell.dataset.video]);
  if (cell?.dataset.preview) return previewFile(cell.dataset.preview);

  const btn = e.target.closest('button');
  if (!btn) return;
  const vid = btn.dataset.delvideo;
  const keys = vid ? null : btn.dataset.key;
  if (!confirm('Delete ' + (vid ? 'all chunks of video ' + vid : keys) + ' from the bucket?')) return;
  btn.disabled = true;
  const r = await (await fetch(base + (vid ? '/video?videoId=' + encodeURIComponent(vid) : '/object?key=' + encodeURIComponent(keys)), { method: 'DELETE' })).json();
  if (!r.success) alert(r.message || 'Delete failed');
  loadList();
};
$('refreshBtn').onclick = loadList;

loadInfo();
loadList();
</script>
</body>
</html>
`;
