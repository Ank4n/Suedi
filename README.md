# Suedi - SVT Play Subtitle Reader

A Chrome extension that extracts subtitles from [SVT Play](https://www.svtplay.se) and displays them in a side panel with click-to-translate for learning Swedish.

## Features

- Extracts subtitles from SVT Play videos via SVT's public API
- Displays synchronized subtitles in a Chrome side panel
- Click any Swedish word to see its English translation inline (above the word)
- Scrolling transcript with 3 lines of context before and after the active subtitle
- Expand buttons to reveal more transcript
- Translation powered by MyMemory (primary) with Lingva Translate (fallback)
- Translations are cached locally to minimize API calls
- Live status bar showing playback state, video time, and active cue
- Auto-recovers when Chrome's service worker restarts (e.g. after pausing)

## Install

1. Clone the repository:
   ```
   git clone https://github.com/ankan/suedi.git
   cd suedi
   ```

2. Open Chrome and navigate to `chrome://extensions`

3. Enable **Developer mode** (toggle in the top-right corner)

4. Click **Load unpacked** and select the `suedi` folder

5. Navigate to any video on [svtplay.se](https://www.svtplay.se) (e.g. `https://www.svtplay.se/video/...`)

6. Click the Suedi extension icon in the toolbar to open the side panel

## Usage

- **Play a video** on SVT Play — subtitles appear in the side panel, synchronized with playback
- **Click any word** to see its English translation appear above the word
- **Click the word again** to dismiss the translation
- **Expand buttons** at the top/bottom of the transcript reveal more lines
- **Refresh button** (top-right) reloads subtitles if something goes wrong
- **Status bar** shows: `playing` (green), `paused` (cyan), `stale` (red, lost connection)

## How It Works

1. Content script detects the video on SVT Play and extracts the video ID from the URL
2. Background service worker fetches subtitle data from `api.svt.se/video/{id}`
3. The WebVTT subtitle file is downloaded and parsed
4. The side panel displays subtitles, synchronized via `timeupdate` events from the video element
5. Word translations are fetched from MyMemory or Lingva Translate and cached in `chrome.storage.local`

## Development

```
npm install
npm test
```

Tests cover the WebVTT parser and translation module.

## Project Structure

```
suedi/
  manifest.json          # Chrome extension manifest (Manifest V3)
  background.js          # Service worker: API calls, subtitle parsing, cue routing
  content.js             # Content script: video detection, time tracking
  sidepanel/
    sidepanel.html       # Side panel markup
    sidepanel.js         # Side panel logic: rendering, word click, translation
    sidepanel.css        # Styling
  lib/
    vtt-parser.js        # WebVTT parser
    vtt-parser.test.js   # Parser tests
    svt-api.js           # SVT API client
    translation.js       # Translation client (MyMemory + Lingva) with caching
    translation.test.js  # Translation tests
  icons/                 # Extension icons
```

## Permissions

- `sidePanel` — to display the subtitle panel
- `activeTab` — to access the current tab's video element
- `storage` — to cache translations
- `scripting` — to inject content script on extension reload
- Host permissions for `svt.se`, `svtplay.se`, `akamaized.net` (subtitle CDN), `mymemory.translated.net`, `lingva.ml`

## License

MIT
