const ALBUM_URL = 'https://photos.google.com/u/1/share/AF1QipMB8CrO3eBXVo5W289OCOofviSb5lOR4Xf8b9LrfxnWdaTAmIeGpwRFWU2i8FD8Yw?key=YmFoV1RIbktLMVEtdGE2VWR5MXVnQ0pSMF9uYXln';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  try {
    const response = await fetch(ALBUM_URL, { redirect: 'follow', headers: HEADERS });
    const html = await response.text();
    const photos = extractPhotos(html);

    if (!photos.length) {
      return res.status(200).json({ error: 'No photos found.', photos: [] });
    }

    return res.status(200).json({ photos, total: photos.length, fetchedAt: new Date().toISOString() });

  } catch (err) {
    return res.status(500).json({ error: err.message, photos: [] });
  }
}

function extractPhotos(html) {
  // ── Step 1: extract photo URLs in order, deduplicated ──
  const photoPattern = /https:\/\/lh3\.googleusercontent\.com\/pw\/([A-Za-z0-9_\-]+)/g;
  const seen = new Set();
  const photos = [];
  let m;

  while ((m = photoPattern.exec(html)) !== null) {
    const baseUrl = 'https://lh3.googleusercontent.com/pw/' + m[1];
    if (!seen.has(baseUrl)) {
      seen.add(baseUrl);
      photos.push({ url: baseUrl, date: null });
    }
  }

  // ── Step 2: extract all 13-digit timestamps, deduplicated, in order ──
  // Filter to a narrow band of "recent but not today" timestamps
  // The repeated value (server timestamp) will be filtered as a duplicate
  const tsPattern = /\b(1[456789]\d{11})\b/g;
  const tsSeen = new Set();
  const timestamps = [];

  while ((m = tsPattern.exec(html)) !== null) {
    const ts = parseInt(m[1]);
    // Must be in past, and not a duplicate
    if (ts <= Date.now() && !tsSeen.has(ts)) {
      tsSeen.add(ts);
      timestamps.push(ts);
    }
  }

  // Sort timestamps oldest-first (photo taken dates, not upload dates)
  // The taken dates will be the earliest ones
  timestamps.sort((a, b) => a - b);

  // ── Step 3: pair photos with timestamps by index ──
  // Google embeds one timestamp per photo in order
  photos.forEach((photo, i) => {
    if (timestamps[i]) {
      photo.date = new Date(timestamps[i]).toISOString();
    }
  });

  return photos;
}
