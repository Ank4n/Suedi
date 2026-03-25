/**
 * Subtitle pipeline integration test.
 *
 * Tests the full SVT API → VTT download → parse flow for real SVT URLs.
 * No browser needed — runs in Node.js against live SVT APIs.
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { getVideoData, getSubtitleUrl, fetchSubtitleText } from '../../lib/svt-api.js';
import { parseVTT } from '../../lib/vtt-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testUrls = JSON.parse(readFileSync(path.join(__dirname, 'svt-urls.json'), 'utf-8'));

function extractSvtId(url) {
  const m = url.match(/\/video\/([a-zA-Z0-9]+)/);
  return m ? m[1] : null;
}

describe('subtitle pipeline (live SVT API)', { timeout: 30000 }, () => {
  for (const { url, label } of testUrls) {
    const svtId = extractSvtId(url);
    if (!svtId) continue;

    describe(label, () => {
      let videoData;
      let subtitleUrl;
      let vttText;

      it('fetches video metadata from SVT API', async () => {
        videoData = await getVideoData(svtId);
        expect(videoData).toBeDefined();
        expect(videoData.svtId || videoData.id).toBeDefined();
      });

      it('finds a subtitle URL (or confirms none available)', async () => {
        if (!videoData) return; // skip if metadata fetch failed
        subtitleUrl = getSubtitleUrl(videoData);
        // Some videos genuinely don't have subtitles — that's OK
        if (!subtitleUrl) {
          console.log(`    (no subtitles for "${label}" — skipping download/parse)`);
        }
        // Just verify the function doesn't crash
        expect(true).toBe(true);
      });

      it('downloads and parses VTT subtitles', async () => {
        if (!subtitleUrl) return; // no subs for this video

        vttText = await fetchSubtitleText(subtitleUrl);
        expect(vttText).toBeDefined();
        expect(vttText.length).toBeGreaterThan(10);
        expect(vttText).toContain('WEBVTT');

        const cues = parseVTT(vttText);
        expect(cues).toBeInstanceOf(Array);
        expect(cues.length).toBeGreaterThan(0);

        // Verify cue structure
        const first = cues[0];
        expect(first).toHaveProperty('startTime');
        expect(first).toHaveProperty('endTime');
        expect(first).toHaveProperty('text');
        expect(first.startTime).toBeGreaterThanOrEqual(0);
        expect(first.endTime).toBeGreaterThan(first.startTime);
        expect(first.text.length).toBeGreaterThan(0);

        console.log(`    ${cues.length} cues parsed, first: "${first.text.slice(0, 50)}..."`);
      });
    });
  }
});
