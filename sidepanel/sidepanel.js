const statusEl = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');
const videoTitleEl = document.getElementById('video-title');
const expandTopBtn = document.getElementById('expand-top');
const expandBottomBtn = document.getElementById('expand-bottom');
const debugPanel = document.getElementById('debug-panel');
const debugLogEl = document.getElementById('debug-log');
const sbState = document.getElementById('sb-state');
const sbTime = document.getElementById('sb-time');
const sbCue = document.getElementById('sb-cue');
const freezeBanner = document.getElementById('freeze-banner');
const freezeDismissBtn = document.getElementById('freeze-dismiss');

let allCues = [];
let activeCueIndex = -1;
let refreshTimeout = null;
let lastTimeTick = 0; // track if time updates are flowing
let staleCheckInterval = null;

const CONTEXT_LINES = 3;
const EXPAND_STEP = 5;
let expandedTop = 0;
let expandedBottom = 0;
let renderedStart = -1;
let renderedEnd = -1;

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function setBarState(state, label) {
  sbState.textContent = label;
  sbState.className = state;
}

let lastTimeValue = -1;

function updateBar(currentTime) {
  lastTimeTick = Date.now();
  freezeBanner.classList.add('hidden'); // connection recovered
  sbTime.textContent = formatTime(currentTime);
  sbCue.textContent = activeCueIndex >= 0
    ? `${activeCueIndex + 1}/${allCues.length}`
    : `--/${allCues.length || '--'}`;

  // Detect paused: time hasn't changed between ticks
  if (Math.abs(currentTime - lastTimeValue) < 0.1 && lastTimeValue >= 0) {
    setBarState('paused', 'paused');
  } else {
    setBarState('connected', 'playing');
  }
  lastTimeValue = currentTime;
}

// Check every 3s if time updates stopped flowing entirely
staleCheckInterval = setInterval(() => {
  if (allCues.length > 0 && lastTimeTick > 0 && Date.now() - lastTimeTick > 5000) {
    setBarState('disconnected', 'stale');
    freezeBanner.classList.remove('hidden');
  }
}, 3000);

freezeDismissBtn.addEventListener('click', () => {
  freezeBanner.classList.add('hidden');
});

function logDebug(msg) {
  const line = document.createElement('div');
  line.textContent = msg;
  debugLogEl.appendChild(line);
  debugLogEl.scrollTop = debugLogEl.scrollHeight;
}

// --- Port connection ---

const port = chrome.runtime.connect({ name: 'sidepanel' });
port.postMessage({ type: 'PANEL_READY' });
logDebug('Panel opened, sent PANEL_READY');

port.onMessage.addListener(msg => {
  switch (msg.type) {
    case 'SUBTITLES_LOADED':
      clearRefreshTimeout();
      allCues = msg.cues;
      videoTitleEl.textContent = msg.title || '';
      logDebug(`Loaded ${msg.cues.length} cues`);
      statusEl.classList.add('hidden');
      expandedTop = 0;
      expandedBottom = 0;
      setBarState('loading', 'loaded');
      sbCue.textContent = `--/${allCues.length}`;
      fullRebuild();
      break;

    case 'CUE_UPDATE':
      activeCueIndex = msg.cueIndex;
      expandedTop = 0;
      expandedBottom = 0;
      if (msg.currentTime != null) updateBar(msg.currentTime);
      syncView();
      break;

    case 'CUE_CLEAR':
      activeCueIndex = -1;
      if (msg.currentTime != null) updateBar(msg.currentTime);
      updateAllClasses();
      break;

    case 'TIME_TICK':
      if (msg.currentTime != null) updateBar(msg.currentTime);
      break;

    case 'NO_SUBTITLES':
      clearRefreshTimeout();
      videoTitleEl.textContent = msg.title || '';
      showStatus('No subtitles available for this video.');
      setBarState('disconnected', 'no subs');
      clearTranscript();
      break;

    case 'NO_VIDEO':
      clearRefreshTimeout();
      showStatus('Navigate to an SVT Play video to see subtitles.');
      setBarState('no-video', 'no video');
      sbTime.textContent = '--:--';
      sbCue.textContent = '--/--';
      clearTranscript();
      videoTitleEl.textContent = '';
      allCues = [];
      break;

    case 'STATUS':
      showStatus(msg.message);
      setBarState('loading', msg.message.toLowerCase());
      break;

    case 'ERROR':
      clearRefreshTimeout();
      showStatus(`Error: ${msg.message}`);
      setBarState('disconnected', 'error');
      break;

    case 'DEBUG':
      logDebug(msg.message);
      break;
  }
});

// --- UI helpers ---

function showStatus(text) {
  statusEl.querySelector('p').textContent = text;
  statusEl.classList.remove('hidden');
}

function clearTranscript() {
  transcriptEl.innerHTML = '';
  renderedStart = renderedEnd = -1;
  expandTopBtn.classList.add('hidden');
  expandBottomBtn.classList.add('hidden');
}

function clearRefreshTimeout() {
  if (refreshTimeout) { clearTimeout(refreshTimeout); refreshTimeout = null; }
}

function getWindowRange() {
  if (allCues.length === 0) return { start: 0, end: -1 };
  const center = activeCueIndex >= 0 ? activeCueIndex : 0;
  return {
    start: Math.max(0, center - CONTEXT_LINES - expandedTop),
    end: Math.min(allCues.length - 1, center + CONTEXT_LINES + expandedBottom),
  };
}

// --- Rendering ---

// Build a single cue div with clickable words
function createCueEl(index) {
  const div = document.createElement('div');
  div.className = 'transcript-cue';
  div.dataset.index = index;
  for (const token of allCues[index].text.split(/(\s+)/)) {
    if (token.trim() === '') {
      div.appendChild(document.createTextNode(' '));
    } else {
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = token;
      span.dataset.word = token;
      div.appendChild(span);
    }
  }
  return div;
}

// Full rebuild — only on initial load or when allCues changes
function fullRebuild() {
  transcriptEl.innerHTML = '';
  renderedStart = renderedEnd = -1;
  syncView();
}

// Main sync: incrementally adjust the visible window, preserve existing cue elements
function syncView() {
  if (allCues.length === 0) { clearTranscript(); return; }

  const { start: newStart, end: newEnd } = getWindowRange();

  if (renderedStart === -1) {
    // Nothing rendered yet — build from scratch
    for (let i = newStart; i <= newEnd; i++) {
      transcriptEl.appendChild(createCueEl(i));
    }
  } else {
    // Remove cues that scrolled out at the top
    while (renderedStart < newStart) {
      const el = transcriptEl.querySelector(`[data-index="${renderedStart}"]`);
      if (el) el.remove();
      renderedStart++;
    }
    // Remove cues that scrolled out at the bottom
    while (renderedEnd > newEnd) {
      const el = transcriptEl.querySelector(`[data-index="${renderedEnd}"]`);
      if (el) el.remove();
      renderedEnd--;
    }
    // Add new cues at the top
    for (let i = renderedStart - 1; i >= newStart; i--) {
      transcriptEl.insertBefore(createCueEl(i), transcriptEl.firstChild);
    }
    // Add new cues at the bottom
    for (let i = renderedEnd + 1; i <= newEnd; i++) {
      transcriptEl.appendChild(createCueEl(i));
    }
  }

  renderedStart = newStart;
  renderedEnd = newEnd;

  updateExpandButtons(newStart, newEnd);
  updateAllClasses();
  scrollToActive();
}

function updateExpandButtons(start, end) {
  if (start > 0) {
    expandTopBtn.classList.remove('hidden');
    expandTopBtn.textContent = `\u25B2 Show earlier (${start} more)`;
  } else {
    expandTopBtn.classList.add('hidden');
  }
  if (end < allCues.length - 1) {
    expandBottomBtn.classList.remove('hidden');
    expandBottomBtn.textContent = `\u25BC Show later (${allCues.length - 1 - end} more)`;
  } else {
    expandBottomBtn.classList.add('hidden');
  }
}

function updateAllClasses() {
  for (const el of transcriptEl.querySelectorAll('.transcript-cue')) {
    const i = parseInt(el.dataset.index);
    el.classList.toggle('active', i === activeCueIndex);
    el.classList.toggle('near', activeCueIndex >= 0 && i !== activeCueIndex && Math.abs(i - activeCueIndex) <= CONTEXT_LINES);
  }
}

function scrollToActive() {
  const el = transcriptEl.querySelector('.active');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// --- Click handling ---

document.addEventListener('click', async e => {
  if (e.target.id === 'refresh-btn') {
    logDebug('Refresh clicked');
    showStatus('Refreshing...');
    chrome.runtime.sendMessage({ type: 'REFRESH' });
    refreshTimeout = setTimeout(() => {
      showStatus('Refresh timed out — try again or reload the page.');
    }, 15000);
    return;
  }
  if (e.target.id === 'debug-toggle-btn') { debugPanel.classList.toggle('hidden'); return; }
  if (e.target.id === 'debug-info-btn') {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_DEBUG_INFO' }, resp => {
          logDebug(chrome.runtime.lastError
            ? `Error: ${chrome.runtime.lastError.message}`
            : `Info: ${JSON.stringify(resp)}`);
        });
      }
    });
    return;
  }
  if (e.target.id === 'expand-top') { expandedTop += EXPAND_STEP; syncView(); return; }
  if (e.target.id === 'expand-bottom') { expandedBottom += EXPAND_STEP; syncView(); return; }

  // Word click — inline translation above the word
  const wordEl = e.target.closest('.word');
  if (!wordEl) return;

  const word = wordEl.dataset.word;
  if (!word) return;

  // Toggle off if already translated
  const wrapper = wordEl.closest('.word-wrapper');
  if (wrapper) {
    wrapper.replaceWith(wordEl);
    wordEl.classList.remove('translated');
    return;
  }

  // Wrap word and show annotation above it
  wordEl.classList.add('translated');
  const wordWrapper = document.createElement('span');
  wordWrapper.className = 'word-wrapper';
  const annotation = document.createElement('span');
  annotation.className = 'word-annotation';
  annotation.textContent = '...';
  wordEl.replaceWith(wordWrapper);
  wordWrapper.appendChild(annotation);
  wordWrapper.appendChild(wordEl);

  try {
    const result = await chrome.runtime.sendMessage({ type: 'TRANSLATE', word });
    annotation.textContent = result?.translation || result?.error || '?';
  } catch (err) {
    annotation.textContent = '?';
  }
});
