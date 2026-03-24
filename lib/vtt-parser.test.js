import { describe, it, expect } from 'vitest';
import { parseVTT } from './vtt-parser.js';

describe('parseVTT', () => {
  it('parses basic cues with HH:MM:SS.mmm timestamps', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
Hello world

00:00:05.000 --> 00:00:08.000
Second line`;

    const cues = parseVTT(vtt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ startTime: 1, endTime: 4, text: 'Hello world' });
    expect(cues[1]).toEqual({ startTime: 5, endTime: 8, text: 'Second line' });
  });

  it('parses MM:SS.mmm timestamps (no hours)', () => {
    const vtt = `WEBVTT

01:30.000 --> 02:00.500
Short format`;

    const cues = parseVTT(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0].startTime).toBeCloseTo(90);
    expect(cues[0].endTime).toBeCloseTo(120.5);
  });

  it('skips STYLE blocks', () => {
    const vtt = `WEBVTT

STYLE
::cue {
    color: #DFDFDF;
}
::cue(.huvudpratare) {
    color: #00FFFF;
}

00:00:04.880 --> 00:00:08.680
First real cue`;

    const cues = parseVTT(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('First real cue');
  });

  it('skips NOTE blocks', () => {
    const vtt = `WEBVTT

NOTE This is a comment
that spans multiple lines

00:00:01.000 --> 00:00:02.000
After note`;

    const cues = parseVTT(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('After note');
  });

  it('strips HTML/WebVTT tags including <c.class> tags', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:05.000
<c.teletext>Liberalernas ödesmöte
är ännu inte avgjort.</c>`;

    const cues = parseVTT(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('Liberalernas ödesmöte\när ännu inte avgjort.');
  });

  it('strips <b>, <i>, <u> tags', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
<b>Bold</b> and <i>italic</i>`;

    const cues = parseVTT(vtt);
    expect(cues[0].text).toBe('Bold and italic');
  });

  it('handles cue identifiers (lines before timestamp)', () => {
    const vtt = `WEBVTT

abc123def
00:00:01.000 --> 00:00:04.000
With identifier`;

    const cues = parseVTT(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('With identifier');
  });

  it('strips position/alignment settings after end timestamp', () => {
    const vtt = `WEBVTT

00:00:04.880 --> 00:00:08.680 align:left position:22%
Positioned cue`;

    const cues = parseVTT(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0].endTime).toBeCloseTo(8.68);
    expect(cues[0].text).toBe('Positioned cue');
  });

  it('handles \\r\\n line endings', () => {
    const vtt = 'WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nWindows line endings';
    const cues = parseVTT(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('Windows line endings');
  });

  it('skips cues with empty text after tag stripping', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.000
<c></c>

00:00:03.000 --> 00:00:04.000
Real text`;

    const cues = parseVTT(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('Real text');
  });

  it('returns empty array for empty input', () => {
    expect(parseVTT('')).toEqual([]);
  });

  it('returns empty array for header-only input', () => {
    expect(parseVTT('WEBVTT')).toEqual([]);
  });

  it('handles multi-line cue text', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:05.000
Line one
Line two
Line three`;

    const cues = parseVTT(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('Line one\nLine two\nLine three');
  });

  it('parses a realistic SVT VTT sample', () => {
    const vtt = `WEBVTT

STYLE
::cue {
    color: #DFDFDF;
}
::cue(.huvudpratare) {
    color: #00FFFF;
}

793d7ce7fdaa4587a7bb86411be767ab
00:00:04.880 --> 00:00:08.680 align:left position:22%
<c.teletext>Liberalernas ödesmöte
är ännu inte avgjort.</c>

be8aed93eaf44cc5867052495598733d
00:00:08.880 --> 00:00:13.080 align:left position:22%
<c.teletext>Vad skulle det betyda
om partiet svänger om SD?</c>`;

    const cues = parseVTT(vtt);
    expect(cues).toHaveLength(2);
    expect(cues[0].startTime).toBeCloseTo(4.88);
    expect(cues[0].endTime).toBeCloseTo(8.68);
    expect(cues[0].text).toBe('Liberalernas ödesmöte\när ännu inte avgjort.');
    expect(cues[1].text).toBe('Vad skulle det betyda\nom partiet svänger om SD?');
  });
});
