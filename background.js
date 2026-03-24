import { parseVTT } from './lib/vtt-parser.js';
import { getVideoData, getSubtitleUrl, fetchSubtitleText } from './lib/svt-api.js';
import { translate } from './lib/translation.js';

// Per-tab state: { cues, currentCueIndex, videoTitle, loading, lastTimeUpdate }
const tabState = new Map();

// Side panel port
let panelPort = null;

// Debug log buffer
const debugLog = [];
function debug(msg) {
  const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
  debugLog.push(entry);
  if (debugLog.length > 50) debugLog.shift();
  console.log('[Suedi BG]', msg);
  sendPanelMessage({ type: 'DEBUG', message: entry });
}

// Open side panel on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Handle messages from content scripts and side panel
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (msg.type === 'VIDEO_DETECTED') {
    debug(`VIDEO_DETECTED from tab ${tabId}, svtId: ${msg.svtId}`);
    handleVideoDetected(tabId, msg.svtId);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'TIME_UPDATE') {
    handleTimeUpdate(tabId, msg.currentTime);
    return false;
  }

  if (msg.type === 'TRANSLATE') {
    debug(`Translate request: "${msg.word}"`);
    translate(msg.word).then(result => {
      debug(`Translate result for "${msg.word}": ${JSON.stringify(result)}`);
      sendResponse(result);
    }).catch(err => {
      debug(`Translate error: ${err.message}`);
      sendResponse({ translation: null, error: err.message });
    });
    return true; // async response
  }

  if (msg.type === 'VIDEO_GONE') {
    tabState.delete(tabId);
    sendPanelMessage({ type: 'NO_VIDEO' });
    return false;
  }

  if (msg.type === 'REFRESH') {
    debug('REFRESH from panel');
    handleRefresh().catch(err => debug(`Refresh error: ${err.message}`));
    return false;
  }

  if (msg.type === 'DEBUG') {
    debug(`[content] ${msg.message}`);
    return false;
  }

  if (msg.type === 'GET_DEBUG_LOG') {
    sendResponse({ log: debugLog });
    return false;
  }

  return false;
});

// Handle side panel connection
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'sidepanel') {
    debug('Side panel connected');
    panelPort = port;
    port.onDisconnect.addListener(() => {
      debug('Side panel disconnected');
      panelPort = null;
    });

    port.onMessage.addListener(msg => {
      if (msg.type === 'PANEL_READY') {
        debug('PANEL_READY received');
        sendCurrentStateToPanel();
      }
    });
  }
});

async function sendCurrentStateToPanel() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) {
    debug('No active tab found');
    sendPanelMessage({ type: 'NO_VIDEO' });
    return;
  }

  const tabId = tabs[0].id;
  const state = tabState.get(tabId);

  if (!state) {
    debug(`No state for tab ${tabId}, URL: ${tabs[0].url}`);
    // If the URL looks like a video page, try to bootstrap
    if (isSvtPlayVideoUrl(tabs[0].url)) {
      const svtId = extractSvtIdFromUrl(tabs[0].url);
      if (svtId) {
        debug(`Auto-detecting video from URL, svtId: ${svtId}`);
        handleVideoDetected(tabId, svtId);
        // Also inject content script for time tracking
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        }).catch(e => debug(`Auto-inject failed: ${e.message}`));
        return;
      }
    }
    sendPanelMessage({ type: 'NO_VIDEO' });
    return;
  }

  // If still loading, wait for it
  if (state.loading) {
    debug('State is loading, waiting...');
    await state.loading;
    const freshState = tabState.get(tabId);
    if (freshState && freshState.cues.length > 0) {
      debug(`Sending ${freshState.cues.length} cues after load wait`);
      sendPanelMessage({
        type: 'SUBTITLES_LOADED',
        cues: freshState.cues,
        title: freshState.videoTitle,
      });
    } else {
      sendPanelMessage({ type: 'NO_SUBTITLES', title: freshState?.videoTitle || '' });
    }
    return;
  }

  if (state.cues.length > 0) {
    debug(`Sending ${state.cues.length} cues to panel`);
    sendPanelMessage({
      type: 'SUBTITLES_LOADED',
      cues: state.cues,
      title: state.videoTitle,
    });
  } else {
    sendPanelMessage({ type: 'NO_SUBTITLES', title: state.videoTitle || '' });
  }
}

// Clean up on tab close
chrome.tabs.onRemoved.addListener(tabId => {
  tabState.delete(tabId);
});

// Detect SPA navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && isSvtPlayVideoUrl(changeInfo.url)) {
    debug(`URL changed: ${changeInfo.url}`);
    chrome.tabs.sendMessage(tabId, { type: 'URL_CHANGED', url: changeInfo.url }).catch(() => {});
  }
});

function isSvtPlayVideoUrl(url) {
  return /svtplay\.se\/video\//.test(url) || /svt\.se\/play\//.test(url);
}

function extractSvtIdFromUrl(url) {
  const match = url.match(/\/video\/([a-zA-Z0-9]+)/);
  if (match) return match[1];
  const match2 = url.match(/\/play\/[^/]+\/([a-zA-Z0-9]+)/);
  return match2 ? match2[1] : null;
}

async function handleRefresh() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) {
    debug('No active tab for refresh');
    return;
  }
  const tab = tabs[0];

  // Try to message the content script first
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'FORCE_REINIT' });
    debug('FORCE_REINIT sent successfully');
    return;
  } catch (e) {
    debug(`Content script not present, injecting... (${e.message})`);
  }

  // Content script not loaded — inject it
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
    debug('Content script injected');
  } catch (e) {
    debug(`Script injection failed: ${e.message}`);
    // Last resort: extract svtId from URL and fetch subtitles directly
    const svtId = extractSvtIdFromUrl(tab.url);
    if (svtId) {
      debug(`Falling back to direct fetch for svtId: ${svtId}`);
      await handleVideoDetected(tab.id, svtId);
    } else {
      debug('Cannot extract svtId from URL');
      sendPanelMessage({ type: 'NO_VIDEO' });
    }
  }
}

async function handleVideoDetected(tabId, svtId) {
  let resolveLoading;
  const loadingPromise = new Promise(r => { resolveLoading = r; });

  tabState.set(tabId, {
    cues: [],
    currentCueIndex: -1,
    videoTitle: '',
    loading: loadingPromise,
  });

  try {
    debug(`Fetching SVT API for svtId: ${svtId}`);
    const videoData = await getVideoData(svtId);
    const subtitleUrl = getSubtitleUrl(videoData);

    const title = videoData.programTitle
      ? `${videoData.programTitle}${videoData.episodeTitle ? ' \u2014 ' + videoData.episodeTitle : ''}`
      : videoData.title || '';

    debug(`Title: ${title}, subtitleUrl: ${subtitleUrl ? 'found' : 'NOT FOUND'}`);

    if (!subtitleUrl) {
      tabState.set(tabId, { cues: [], currentCueIndex: -1, videoTitle: title, loading: null });
      resolveLoading();
      sendPanelMessage({ type: 'NO_SUBTITLES', title });
      return;
    }

    debug(`Fetching VTT from: ${subtitleUrl.substring(0, 80)}...`);
    const vttText = await fetchSubtitleText(subtitleUrl);
    const cues = parseVTT(vttText);
    debug(`Parsed ${cues.length} cues`);

    tabState.set(tabId, { cues, currentCueIndex: -1, videoTitle: title, loading: null });
    resolveLoading();

    sendPanelMessage({
      type: 'SUBTITLES_LOADED',
      cues,
      title,
    });
  } catch (err) {
    debug(`Error: ${err.message}`);
    resolveLoading();
    tabState.set(tabId, { cues: [], currentCueIndex: -1, videoTitle: '', loading: null });
    sendPanelMessage({ type: 'ERROR', message: err.message });
  }
}

function handleTimeUpdate(tabId, currentTime) {
  const state = tabState.get(tabId);
  if (!state || state.cues.length === 0) return;

  const idx = findActiveCue(state.cues, currentTime);

  if (idx !== state.currentCueIndex) {
    state.currentCueIndex = idx;
    if (idx >= 0) {
      sendPanelMessage({
        type: 'CUE_UPDATE',
        cue: state.cues[idx],
        cueIndex: idx,
        currentTime,
      });
    } else {
      sendPanelMessage({ type: 'CUE_CLEAR', currentTime });
    }
  }
}

function findActiveCue(cues, time) {
  let lo = 0, hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (time < cues[mid].startTime) {
      hi = mid - 1;
    } else if (time >= cues[mid].endTime) {
      lo = mid + 1;
    } else {
      return mid;
    }
  }
  return -1;
}

function sendPanelMessage(msg) {
  if (panelPort) {
    try {
      panelPort.postMessage(msg);
    } catch (e) {
      panelPort = null;
    }
  }
}
