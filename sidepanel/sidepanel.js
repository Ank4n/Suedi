const statusEl = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');
const videoTitleEl = document.getElementById('video-title');
const expandTopBtn = document.getElementById('expand-top');
const expandBottomBtn = document.getElementById('expand-bottom');
const debugPanel = document.getElementById('debug-panel');
const debugLogEl = document.getElementById('debug-log');

let allCues = [];
let activeCueIndex = -1;
let refreshTimeout = null;

const CONTEXT_LINES = 3;
const EXPAND_STEP = 5;
let expandedTop = 0;
let expandedBottom = 0;
// Track current window to enable differential updates
let renderedStart = -1;
let renderedEnd = -1;

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
      renderedStart = renderedEnd = -1;
      renderVisibleCues();
      break;

    case 'CUE_UPDATE': {
      const prevActive = activeCueIndex;
      activeCueIndex = msg.cueIndex;
      const { start, end } = getWindowRange();
      if (start === renderedStart && end === renderedEnd) {
        // Window unchanged — just update highlighting
        updateHighlighting(prevActive, activeCueIndex);
      } else {
        expandedTop = 0;
        expandedBottom = 0;
        renderVisibleCues();
      }
      break;
    }

    case 'CUE_CLEAR':
      activeCueIndex = -1;
      updateHighlighting(-1, -1);
      break;

    case 'NO_SUBTITLES':
      clearRefreshTimeout();
      videoTitleEl.textContent = msg.title || '';
      showStatus('No subtitles available for this video.');
      transcriptEl.innerHTML = '';
      hideExpandButtons();
      break;

    case 'NO_VIDEO':
      clearRefreshTimeout();
      showStatus('Navigate to an SVT Play video to see subtitles.');
      transcriptEl.innerHTML = '';
      videoTitleEl.textContent = '';
      allCues = [];
      hideExpandButtons();
      break;

    case 'STATUS':
      showStatus(msg.message);
      break;

    case 'ERROR':
      clearRefreshTimeout();
      showStatus(`Error: ${msg.message}`);
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

function hideExpandButtons() {
  expandTopBtn.classList.add('hidden');
  expandBottomBtn.classList.add('hidden');
}

function clearRefreshTimeout() {
  if (refreshTimeout) { clearTimeout(refreshTimeout); refreshTimeout = null; }
}

function getWindowRange() {
  if (allCues.length === 0) return { start: 0, end: -1 };
  const center = activeCueIndex >= 0 ? activeCueIndex : 0;
  const start = Math.max(0, center - CONTEXT_LINES - expandedTop);
  const end = Math.min(allCues.length - 1, center + CONTEXT_LINES + expandedBottom);
  return { start, end };
}

// --- Rendering ---

function renderVisibleCues() {
  transcriptEl.innerHTML = '';
  if (allCues.length === 0) { hideExpandButtons(); return; }

  const { start, end } = getWindowRange();
  renderedStart = start;
  renderedEnd = end;

  // Expand buttons
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

  for (let i = start; i <= end; i++) {
    const div = document.createElement('div');
    div.className = 'transcript-cue';
    div.dataset.index = i;
    applyCueClasses(div, i);
    buildClickableWords(div, allCues[i].text);
    transcriptEl.appendChild(div);
  }

  scrollToActive();
}

function updateHighlighting(prevIndex, newIndex) {
  // Remove old highlight
  if (prevIndex >= 0) {
    const old = transcriptEl.querySelector(`[data-index="${prevIndex}"]`);
    if (old) applyCueClasses(old, prevIndex);
  }
  // Apply new
  if (newIndex >= 0) {
    const el = transcriptEl.querySelector(`[data-index="${newIndex}"]`);
    if (el) applyCueClasses(el, newIndex);
  }
  // Update near classes for neighbors
  for (let i = renderedStart; i <= renderedEnd; i++) {
    const el = transcriptEl.querySelector(`[data-index="${i}"]`);
    if (el) applyCueClasses(el, i);
  }
  scrollToActive();
}

function applyCueClasses(el, index) {
  el.classList.remove('active', 'near');
  if (index === activeCueIndex) {
    el.classList.add('active');
  } else if (activeCueIndex >= 0 && Math.abs(index - activeCueIndex) <= CONTEXT_LINES) {
    el.classList.add('near');
  }
}

function scrollToActive() {
  const el = transcriptEl.querySelector('.active');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function buildClickableWords(container, text) {
  for (const token of text.split(/(\s+)/)) {
    if (token.trim() === '') {
      container.appendChild(document.createTextNode(' '));
    } else {
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = token;
      span.dataset.word = token;
      container.appendChild(span);
    }
  }
}

// --- Click handling ---

document.addEventListener('click', async e => {
  if (e.target.id === 'refresh-btn') {
    logDebug('Refresh clicked');
    showStatus('Refreshing...');
    chrome.runtime.sendMessage({ type: 'REFRESH' });
    // Timeout safety net
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
  if (e.target.id === 'expand-top') { expandedTop += EXPAND_STEP; renderVisibleCues(); return; }
  if (e.target.id === 'expand-bottom') { expandedBottom += EXPAND_STEP; renderVisibleCues(); return; }

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

  // Wrap word and show annotation
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
