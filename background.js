import { parseVTT } from './lib/vtt-parser.js';
import { getVideoData, getSubtitleUrl, fetchSubtitleText } from './lib/svt-api.js';
import { translate } from './lib/translation.js';

// Per-tab state: { svtId, cues, currentCueIndex, videoTitle, loading }
const tabState = new Map();
let panelPort = null;

// Debug log
const debugLog = [];
function debug(msg) {
  const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
  debugLog.push(entry);
  if (debugLog.length > 50) debugLog.shift();
  console.log('[Suedi BG]', msg);
  sendPanelMessage({ type: 'DEBUG', message: entry });
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// --- Message handling ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (msg.type) {
    case 'VIDEO_DETECTED':
      debug(`VIDEO_DETECTED tab=${tabId} svtId=${msg.svtId}`);
      handleVideoDetected(tabId, msg.svtId);
      sendResponse({ ok: true });
      return false;

    case 'TIME_UPDATE':
      handleTimeUpdate(tabId, msg.currentTime);
      return false;

    case 'TRANSLATE':
      debug(`Translate: "${msg.word}"`);
      translate(msg.word).then(result => {
        debug(`Translated "${msg.word}" -> "${result?.translation}"`);
        sendResponse(result);
      }).catch(err => {
        debug(`Translate error: ${err.message}`);
        sendResponse({ translation: null, error: err.message });
      });
      return true; // async

    case 'REFRESH':
      debug('REFRESH');
      handleRefresh();
      return false;

    case 'DEBUG':
      debug(`[content] ${msg.message}`);
      return false;

    case 'GET_DEBUG_LOG':
      sendResponse({ log: debugLog });
      return false;

    default:
      return false;
  }
});

// --- Side panel port ---

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'sidepanel') return;
  debug('Panel connected');
  panelPort = port;
  port.onDisconnect.addListener(() => { panelPort = null; });
  port.onMessage.addListener(msg => {
    if (msg.type === 'PANEL_READY') {
      debug('PANEL_READY');
      sendCurrentStateToPanel();
    }
  });
});

// --- Tab lifecycle ---

chrome.tabs.onRemoved.addListener(tabId => tabState.delete(tabId));

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && isSvtPlayUrl(changeInfo.url)) {
    chrome.tabs.sendMessage(tabId, { type: 'URL_CHANGED', url: changeInfo.url }).catch(() => {});
  }
});

// --- Core logic ---

function isSvtPlayUrl(url) {
  return /svtplay\.se\/video\//.test(url) || /svt\.se\/play\//.test(url);
}

function extractSvtId(url) {
  const m = url.match(/\/video\/([a-zA-Z0-9]+)/);
  if (m) return m[1];
  const m2 = url.match(/\/play\/[^/]+\/([a-zA-Z0-9]+)/);
  return m2 ? m2[1] : null;
}

async function handleVideoDetected(tabId, svtId) {
  // Dedup: skip if already loaded/loading for this svtId
  const existing = tabState.get(tabId);
  if (existing?.svtId === svtId && (existing.loading || existing.cues.length > 0)) {
    debug(`Dedup skip for svtId=${svtId}`);
    // Re-send to panel in case it missed it
    if (existing.cues.length > 0) {
      sendPanelMessage({ type: 'SUBTITLES_LOADED', cues: existing.cues, title: existing.videoTitle });
    }
    return;
  }

  let resolveLoading;
  const loadingPromise = new Promise(r => { resolveLoading = r; });
  tabState.set(tabId, { svtId, cues: [], currentCueIndex: -1, videoTitle: '', loading: loadingPromise });

  try {
    const videoData = await getVideoData(svtId);
    const subtitleUrl = getSubtitleUrl(videoData);
    const title = videoData.programTitle
      ? `${videoData.programTitle}${videoData.episodeTitle ? ' \u2014 ' + videoData.episodeTitle : ''}`
      : videoData.title || '';

    debug(`Title: ${title}, subs: ${subtitleUrl ? 'yes' : 'no'}`);

    if (!subtitleUrl) {
      tabState.set(tabId, { svtId, cues: [], currentCueIndex: -1, videoTitle: title, loading: null });
      resolveLoading();
      sendPanelMessage({ type: 'NO_SUBTITLES', title });
      return;
    }

    const vttText = await fetchSubtitleText(subtitleUrl);
    const cues = parseVTT(vttText);
    debug(`Parsed ${cues.length} cues`);

    tabState.set(tabId, { svtId, cues, currentCueIndex: -1, videoTitle: title, loading: null });
    resolveLoading();
    sendPanelMessage({ type: 'SUBTITLES_LOADED', cues, title });
  } catch (err) {
    debug(`Error: ${err.message}`);
    resolveLoading();
    tabState.set(tabId, { svtId, cues: [], currentCueIndex: -1, videoTitle: '', loading: null });
    sendPanelMessage({ type: 'ERROR', message: err.message });
  }
}

async function sendCurrentStateToPanel() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) { sendPanelMessage({ type: 'NO_VIDEO' }); return; }

  const tabId = tabs[0].id;
  const state = tabState.get(tabId);

  if (!state) {
    // No state — ask the content script to re-announce, or try direct detection
    if (isSvtPlayUrl(tabs[0].url)) {
      debug('No state but SVT URL — requesting content script state');
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'REQUEST_STATE' });
        // Content script will send VIDEO_DETECTED which will call handleVideoDetected
        // Panel will get SUBTITLES_LOADED from there
        sendPanelMessage({ type: 'STATUS', message: 'Loading...' });
      } catch (e) {
        // Content script not loaded — fetch subtitles directly
        const svtId = extractSvtId(tabs[0].url);
        if (svtId) {
          debug(`Direct fetch for svtId=${svtId}`);
          handleVideoDetected(tabId, svtId);
        } else {
          sendPanelMessage({ type: 'NO_VIDEO' });
        }
      }
    } else {
      sendPanelMessage({ type: 'NO_VIDEO' });
    }
    return;
  }

  if (state.loading) {
    debug('Waiting for loading...');
    await state.loading;
    const s = tabState.get(tabId);
    if (s?.cues.length > 0) {
      sendPanelMessage({ type: 'SUBTITLES_LOADED', cues: s.cues, title: s.videoTitle });
    } else {
      sendPanelMessage({ type: 'NO_SUBTITLES', title: s?.videoTitle || '' });
    }
    return;
  }

  if (state.cues.length > 0) {
    sendPanelMessage({ type: 'SUBTITLES_LOADED', cues: state.cues, title: state.videoTitle });
  } else {
    sendPanelMessage({ type: 'NO_SUBTITLES', title: state.videoTitle || '' });
  }
}

async function handleRefresh() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) { sendPanelMessage({ type: 'NO_VIDEO' }); return; }

  const tabId = tabs[0].id;
  const svtId = extractSvtId(tabs[0].url);

  if (!svtId) {
    sendPanelMessage({ type: 'NO_VIDEO' });
    return;
  }

  // Clear existing state so dedup doesn't block us
  tabState.delete(tabId);

  // Fetch subtitles directly
  await handleVideoDetected(tabId, svtId);

  // Tell content script to re-attach to video (fire and forget)
  chrome.tabs.sendMessage(tabId, { type: 'FORCE_REINIT' }).catch(() => {});
}

function handleTimeUpdate(tabId, currentTime) {
  const state = tabState.get(tabId);
  if (!state || state.cues.length === 0) return;

  const idx = findActiveCue(state.cues, currentTime);
  if (idx !== state.currentCueIndex) {
    state.currentCueIndex = idx;
    if (idx >= 0) {
      sendPanelMessage({ type: 'CUE_UPDATE', cue: state.cues[idx], cueIndex: idx });
    } else {
      sendPanelMessage({ type: 'CUE_CLEAR' });
    }
  }
}

function findActiveCue(cues, time) {
  let lo = 0, hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (time < cues[mid].startTime) hi = mid - 1;
    else if (time >= cues[mid].endTime) lo = mid + 1;
    else return mid;
  }
  return -1;
}

function sendPanelMessage(msg) {
  if (!panelPort) return;
  try { panelPort.postMessage(msg); }
  catch (e) { panelPort = null; }
}
