/**
 * Lightweight WebVTT parser.
 * Parses a .vtt file string into an array of cue objects.
 * Handles STYLE blocks, NOTE blocks, and various tag formats used by SVT.
 */

function parseTimestamp(ts) {
  const parts = ts.trim().split(':');
  let hours = 0, minutes, seconds;
  if (parts.length === 3) {
    hours = parseFloat(parts[0]);
    minutes = parseFloat(parts[1]);
    seconds = parseFloat(parts[2]);
  } else {
    minutes = parseFloat(parts[0]);
    seconds = parseFloat(parts[1]);
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function stripTags(text) {
  // Remove all WebVTT tags: <c.class>, </c>, <b>, </b>, <i>, </i>, <u>, etc.
  return text.replace(/<[^>]+>/g, '').trim();
}

export function parseVTT(vttText) {
  const cues = [];
  // Normalize line endings and split into blocks
  const blocks = vttText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n\n');

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    // Skip WEBVTT header, STYLE blocks, NOTE blocks
    const firstLine = lines[0].trim();
    if (firstLine.startsWith('WEBVTT')) continue;
    if (firstLine === 'STYLE' || firstLine.startsWith('STYLE')) continue;
    if (firstLine === 'NOTE' || firstLine.startsWith('NOTE')) continue;

    // Find the timestamp line (contains ' --> ')
    let tsLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(' --> ')) {
        tsLineIndex = i;
        break;
      }
    }
    if (tsLineIndex === -1) continue;

    const tsParts = lines[tsLineIndex].split(' --> ');
    if (tsParts.length < 2) continue;

    const startTime = parseTimestamp(tsParts[0]);
    // Remove position/alignment settings after the end timestamp
    const endRaw = tsParts[1].split(/\s/)[0];
    const endTime = parseTimestamp(endRaw);

    // Everything after the timestamp line is the cue text
    const text = lines
      .slice(tsLineIndex + 1)
      .map(l => stripTags(l))
      .filter(l => l.length > 0)
      .join('\n');

    if (text) {
      cues.push({ startTime, endTime, text });
    }
  }

  return cues;
}
