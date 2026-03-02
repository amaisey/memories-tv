export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const ALBUM_URL = 'https://photos.app.goo.gl/Bid9DHteAa1gXYYc7';

  try {
    // Follow the short URL redirect
    const redirectResp = await fetch(ALBUM_URL, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    const html = await redirectResp.text();

    // Extract photo data from Google Photos' embedded JSON
    // Google Photos embeds data in AF_initDataCallback blocks
    const photos = [];
    const seen = new Set();

    // Pattern 1: Extract lh3.googleusercontent.com URLs with photo dimensions
    // These appear in the page as arrays: [url, width, height]
    const photoPattern = /\["(https:\/\/lh3\.googleusercontent\.com\/[^"]+)",(\d+),(\d+)\]/g;
    let match;

    while ((match = photoPattern.exec(html)) !== null) {
      const url = match[1];
      const width = parseInt(match[2]);
      const height = parseInt(match[3]);

      // Filter: only keep large images (actual photos, not thumbnails or icons)
      if (width >= 200 && height >= 200 && !seen.has(url)) {
        seen.add(url);
        photos.push({ url, width, height });
      }
    }

    // Pattern 2: Fallback - look for photo keys in data arrays
    if (photos.length === 0) {
      const urlPattern = /https:\/\/lh3\.googleusercontent\.com\/[A-Za-z0-9_\-]+/g;
      const urls = html.match(urlPattern) || [];
      urls.forEach(url => {
        if (!seen.has(url)) {
          seen.add(url);
          photos.push({ url, width: 1000, height: 1000 });
        }
      });
    }

    // Try to extract creation dates from nearby data
    // Google Photos stores dates as timestamps in the data
    // Look for the data structure: [photoKey, ..., timestamp, ...]
    const photoDataWithDates = [];

    // Extract AF_initDataCallback blocks which contain photo metadata
    const dataBlockPattern = /AF_initDataCallback\((\{.*?\})\);/gs;
    let dataMatch;
    const allDataBlocks = [];

    while ((dataMatch = dataBlockPattern.exec(html)) !== null) {
      allDataBlocks.push(dataMatch[1]);
    }

    // Try to find timestamp data near photo URLs
    // Google Photos uses Unix timestamps in milliseconds
    const tsPattern = /1[67]\d{11}/g; // timestamps from ~2022-2024ish
    const allTimestamps = [];
    let tsMatch;
    while ((tsMatch = tsPattern.exec(html)) !== null) {
      const ts = parseInt(tsMatch[0]);
      // Sanity check: between 2000 and now
      if (ts > 946684800000 && ts < Date.now()) {
        allTimestamps.push(ts);
      }
    }

    // Deduplicate timestamps and sort
    const uniqueTimestamps = [...new Set(allTimestamps)].sort((a, b) => a - b);

    // Associate photos with timestamps if counts roughly match
    const finalPhotos = photos.map((photo, i) => {
      // Try to pair each photo with a timestamp
      // Google Photos lists them in order, so we try index-based matching
      const ts = uniqueTimestamps[i] || null;
      return {
        url: photo.url,
        width: photo.width,
        height: photo.height,
        timestamp: ts,
        date: ts ? new Date(ts).toISOString() : null,
      };
    });

    if (finalPhotos.length === 0) {
      return res.status(200).json({
        error: 'No photos found. The album may be empty or private.',
        photos: [],
        debug: { htmlLength: html.length, url: redirectResp.url }
      });
    }

    return res.status(200).json({
      photos: finalPhotos,
      total: finalPhotos.length,
      fetchedAt: new Date().toISOString()
    });

  } catch (err) {
    return res.status(500).json({ error: err.message, photos: [] });
  }
}
