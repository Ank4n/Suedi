/**
 * SVT Play API client.
 * Fetches video metadata and subtitle URLs from SVT's public API.
 */

const SVT_API_BASE = 'https://api.svt.se/video';

export async function getVideoData(svtId) {
  const resp = await fetch(`${SVT_API_BASE}/${svtId}`);
  if (!resp.ok) {
    throw new Error(`SVT API error: ${resp.status} for svtId=${svtId}`);
  }
  return resp.json();
}

export function getSubtitleUrl(videoData) {
  const refs = videoData.subtitleReferences;
  if (!refs || refs.length === 0) return null;

  // Prefer caption-sdh (full closed captions) over subtitle (often just burned-in open subs)
  // caption-sdh has all dialogue; "subtitle" type often only has a few hardcoded lines
  const sdh = refs.find(r => r.format === 'webvtt' && r.type === 'caption-sdh');
  const subtitle = refs.find(r => r.format === 'webvtt' && r.type === 'subtitle');
  const any = refs.find(r => r.format === 'webvtt') || refs[0];

  const ref = sdh || subtitle || any;
  return ref?.url || null;
}

export async function fetchSubtitleText(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Subtitle fetch error: ${resp.status} for ${url}`);
  }
  return resp.text();
}
