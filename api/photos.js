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

  const debug = req.query.debug === '1';

  try {
    const response = await fetch(ALBUM_URL, { redirect: 'follow', headers: HEADERS });
    const finalUrl = response.url;
    const html = await response.text();
    const htmlLength = html.length;

    if (debug) {
      // Return raw debug info so we can see what Google is sending back
      return res.status(200).json({
        finalUrl,
        htmlLength,
        statusCode: response.status,
        // First 3000 chars of HTML to see structure
        htmlPreview: html.substring(0, 3000),
        // Last 1000 chars
        htmlTail: html.substring(html.length - 1000),
        // Check for key markers
        hasLh3: html.includes('lh3.googleusercontent.com'),
        hasAFInit: html.includes('AF_initDataCallback'),
        hasRemix: html.includes('remixContext'),
        hasBuildApp: html.includes('buildApp'),
        hasPhotoKey: html.includes('AF_dataServiceRequests'),
        // Sample of any lh3 URLs found
        lh3Sample: (html.match(/lh3\.googleusercontent\.com\/[^"'\s]{10,}/g) || []).slice(0, 5),
      });
    }

    const photos = extractPhotos(html);

    if (!photos.length) {
      return res.status(200).json({
        error: 'No photos found. Visit /api/photos?debug=1 to diagnose.',
        photos: [],
        debug: { finalUrl, htmlLength, hasLh3: html.includes('lh3.googleusercontent.com') }
      });
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ photos, total: photos.length, fetchedAt: new Date().toISOString() });

  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack, photos: [] });
  }
}

function extractPhotos(html) {
  const photos = [];
  const seen = new Set();

  // ── Pattern A ──────────────────────────────────────────────────────────────
  // Google Photos embeds data as nested arrays. Photo entries look like:
  // ["AF1Qip...", null, null, [null, null, null, null, null, null, null, null, null, 
  //   ["https://lh3.googleusercontent.com/...", 4032, 3024]], ...]
  // We look for lh3 URLs paired with two adjacent integers (width, height)
  const patternA = /"(https:\/\/lh3\.googleusercontent\.com\/[^"]{20,})",(\d{3,5}),(\d{3,5})/g;
  let m;
  while ((m = patternA.exec(html)) !== null) {
    const url = m[1];
    const w = parseInt(m[2]);
    const h = parseInt(m[3]);
    if (w >= 400 && h >= 400 && !seen.has(url)) {
      seen.add(url);
      photos.push({ url, width: w, height: h, date: findDateNear(html, m.index) });
    }
  }

  // ── Pattern B: looser match if A found nothing ──────────────────────────
  if (!photos.length) {
    const patternB = /https:\/\/lh3\.googleusercontent\.com\/([A-Za-z0-9_\-]{20,})/g;
    while ((m = patternB.exec(html)) !== null) {
      const url = 'https://lh3.googleusercontent.com/' + m[1];
      if (!seen.has(url)) {
        seen.add(url);
        photos.push({ url, width: 1000, height: 1000, date: null });
      }
    }
  }

  return photos;
}

function findDateNear(html, position) {
  // Look within ±2000 chars of a photo URL for a Unix timestamp in ms
  const slice = html.substring(Math.max(0, position - 500), position + 2000);
  // Timestamps: 13-digit numbers starting with 1 (year ~2001–2033)
  const tsPattern = /\b(1[3-9]\d{11})\b/g;
  let m;
  const candidates = [];
  while ((m = tsPattern.exec(slice)) !== null) {
    const ts = parseInt(m[1]);
    if (ts > 978307200000 && ts <= Date.now()) { // after 2001 and not future
      candidates.push(ts);
    }
  }
  if (!candidates.length) return null;
  // Pick the smallest (oldest) to avoid using "last modified" type dates
  const ts = Math.min(...candidates);
  return new Date(ts).toISOString();
}
