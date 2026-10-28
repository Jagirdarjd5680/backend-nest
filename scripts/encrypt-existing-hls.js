/**
 * One-time migration: encrypts already-transcoded (plain) HLS videos in uploads/hls/ with
 * AES-128, the same way new uploads are encrypted by media.service.ts — without re-transcoding.
 *
 *   node scripts/encrypt-existing-hls.js --dry-run          # just list what would change
 *   node scripts/encrypt-existing-hls.js                    # encrypt every plain video
 *   node scripts/encrypt-existing-hls.js video_123          # only these videos
 *   node scripts/encrypt-existing-hls.js --delete-plain     # also remove the old plain .ts files
 *
 * Run from the backend_nestjs folder. Safe to re-run: videos that already have a key are skipped.
 * Plain segments are kept by default; once a video has a key the server never serves them anyway.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const deletePlain = args.includes('--delete-plain');
const only = args.filter((a) => !a.startsWith('--'));

const hlsBase = path.join(process.cwd(), 'uploads', 'hls');
const keysDir = path.join(process.cwd(), 'storage', 'hls_keys');

function ivFor(sequence) {
  // No IV attribute in EXT-X-KEY → players use the media sequence number as a 128-bit big-endian IV.
  const iv = Buffer.alloc(16);
  iv.writeBigUInt64BE(BigInt(sequence), 8);
  return iv;
}

function encryptVideo(videoId) {
  const dir = path.join(hlsBase, videoId);
  const keyPath = path.join(keysDir, `${videoId}.key`);
  if (fs.existsSync(keyPath)) return { videoId, status: 'skip (already encrypted)' };

  const playlistName = ['master.m3u8', 'index.m3u8'].find((n) => fs.existsSync(path.join(dir, n)));
  if (!playlistName) return { videoId, status: 'skip (no playlist)' };

  const playlistPath = path.join(dir, playlistName);
  const lines = fs.readFileSync(playlistPath, 'utf8').split(/\r?\n/);
  if (!lines.some((l) => l.startsWith('#EXTINF'))) {
    return { videoId, status: 'skip (multi-quality master playlist — re-upload to encrypt)' };
  }
  if (lines.some((l) => l.startsWith('#EXT-X-KEY'))) return { videoId, status: 'skip (playlist already has a key)' };

  const seqLine = lines.find((l) => l.startsWith('#EXT-X-MEDIA-SEQUENCE:'));
  const firstSeq = seqLine ? parseInt(seqLine.split(':')[1], 10) || 0 : 0;

  const segments = lines.filter((l) => l.trim() && !l.startsWith('#'));
  const missing = segments.filter((s) => !fs.existsSync(path.join(dir, s.trim().split('?')[0])));
  if (missing.length) return { videoId, status: `skip (missing ${missing.length} segment files)` };

  if (dryRun) return { videoId, status: `would encrypt ${segments.length} segments` };

  const key = crypto.randomBytes(16);
  let index = 0;
  const out = [];
  let keyWritten = false;
  for (const line of lines) {
    if (!keyWritten && line.startsWith('#EXTINF')) {
      out.push(`#EXT-X-KEY:METHOD=AES-128,URI="key://${videoId}"`);
      keyWritten = true;
    }
    if (!line.trim() || line.startsWith('#')) {
      out.push(line);
      continue;
    }
    const plainName = line.trim().split('?')[0];
    const encName = `enc_${String(index).padStart(5, '0')}.ts`;
    const cipher = crypto.createCipheriv('aes-128-cbc', key, ivFor(firstSeq + index));
    const data = Buffer.concat([cipher.update(fs.readFileSync(path.join(dir, plainName))), cipher.final()]);
    fs.writeFileSync(path.join(dir, encName), data);
    out.push(encName);
    index++;
  }

  // Order matters: new playlist is fully written before the key appears, and the key appears
  // before the playlist is swapped — the server treats "key exists" as "serve encrypted".
  const tmpPlaylist = `${playlistPath}.enc.tmp`;
  fs.writeFileSync(tmpPlaylist, out.join('\n'));
  fs.copyFileSync(playlistPath, `${playlistPath}.plain.bak`);
  fs.mkdirSync(keysDir, { recursive: true });
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  fs.renameSync(tmpPlaylist, playlistPath);

  if (deletePlain) {
    for (const s of segments) {
      const name = s.trim().split('?')[0];
      if (!name.startsWith('enc_')) fs.rmSync(path.join(dir, name), { force: true });
    }
  }
  return { videoId, status: `encrypted ${index} segments${deletePlain ? ' (plain deleted)' : ''}` };
}

if (!fs.existsSync(hlsBase)) {
  console.log(`No HLS folder at ${hlsBase}`);
  process.exit(0);
}

const videoIds = (only.length ? only : fs.readdirSync(hlsBase)).filter((d) =>
  fs.statSync(path.join(hlsBase, d)).isDirectory(),
);

let failed = 0;
for (const id of videoIds) {
  try {
    const r = encryptVideo(id);
    console.log(`${r.videoId}: ${r.status}`);
  } catch (e) {
    failed++;
    console.error(`${id}: FAILED — ${e.message}`);
  }
}
console.log(dryRun ? '\nDry run only — nothing changed.' : `\nDone. ${failed} failed.`);
process.exit(failed ? 1 : 0);
