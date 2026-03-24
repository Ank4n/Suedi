const statusEl = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');
const videoTitleEl = document.getElementById('video-title');
const expandTopBtn = document.getElementById('expand-top');
const expandBottomBtn = document.getElementById('expand-bottom');
const debugPanel = document.getElementById('debug-panel');
const debugLogEl = document.getElementById('debug-log');

let allCues = [];
let activeCueIndex = -1;

// How many cues to show before/after the active cue
const CONTEXT_LINES = 3;
// How many extra lines each expand click reveals
const EXPAND_STEP = 5;
// Current expanded range beyond the context window
let expandedTop = 0;
let expandedBottom = 0;

function logDebug(msg) {
  const line = document.createElement('div');
  line.textContent = msg;
  debugLogEl.appendChild(line);
  debugLogEl.scrollTop = debugLogEl.scrollHeight;
}

// Connect to background
const port = chrome.runtime.connect({ name: 'sidepanel' });
port.postMessage({ type: 'PANEL_READY' });
logDebug('Panel opened, sent PANEL_READY');

port.onMessage.addListener(msg => {
  switch (msg.type) {
    case 'SUBTITLES_LOADED':
      allCues = msg.cues;
      videoTitleEl.textContent = msg.title || '';
      logDebug(`Loaded ${msg.cues.length} cues for "${msg.title}"`);
      statusEl.classList.add('hidden');
      expandedTop = 0;
      expandedBottom = 0;
      renderVisibleCues();
      break;

    case 'CUE_UPDATE':
      activeCueIndex = msg.cueIndex;
      expandedTop = 0;
      expandedBottom = 0;
      renderVisibleCues();
      break;

    case 'CUE_CLEAR':
      activeCueIndex = -1;
      renderVisibleCues();
      break;

    case 'NO_SUBTITLES':
      videoTitleEl.textContent = msg.title || '';
      showStatus('No subtitles available for this video.');
      transcriptEl.innerHTML = '';
      hideExpandButtons();
      logDebug('NO_SUBTITLES received');
      break;

    case 'NO_VIDEO':
      showStatus('Navigate to an SVT Play video to see subtitles.');
      transcriptEl.innerHTML = '';
      videoTitleEl.textContent = '';
      allCues = [];
      hideExpandButtons();
      logDebug('NO_VIDEO received');
      break;

    case 'ERROR':
      showStatus(`Error: ${msg.message}`);
      logDebug(`ERROR: ${msg.message}`);
      break;

    case 'DEBUG':
      logDebug(msg.message);
      break;
  }
});

function showStatus(text) {
  statusEl.querySelector('p').textContent = text;
  statusEl.classList.remove('hidden');
}

function hideExpandButtons() {
  expandTopBtn.classList.add('hidden');
  expandBottomBtn.classList.add('hidden');
}

function renderVisibleCues() {
  transcriptEl.innerHTML = '';

  if (allCues.length === 0) {
    hideExpandButtons();
    return;
  }

  // If no active cue yet, show the first few
  const center = activeCueIndex >= 0 ? activeCueIndex : 0;

  const windowStart = Math.max(0, center - CONTEXT_LINES - expandedTop);
  const windowEnd = Math.min(allCues.length - 1, center + CONTEXT_LINES + expandedBottom);

  // Show/hide expand buttons
  if (windowStart > 0) {
    expandTopBtn.classList.remove('hidden');
    expandTopBtn.textContent = `\u25B2 Show earlier (${windowStart} more)`;
  } else {
    expandTopBtn.classList.add('hidden');
  }
  if (windowEnd < allCues.length - 1) {
    expandBottomBtn.classList.remove('hidden');
    expandBottomBtn.textContent = `\u25BC Show later (${allCues.length - 1 - windowEnd} more)`;
  } else {
    expandBottomBtn.classList.add('hidden');
  }

  for (let i = windowStart; i <= windowEnd; i++) {
    const div = document.createElement('div');
    div.className = 'transcript-cue';
    div.dataset.index = i;

    if (i === activeCueIndex) {
      div.classList.add('active');
    } else if (activeCueIndex >= 0 && Math.abs(i - activeCueIndex) <= CONTEXT_LINES) {
      div.classList.add('near');
    }

    // Make words clickable
    buildClickableWords(div, allCues[i].text);
    transcriptEl.appendChild(div);
  }

  // Scroll active cue into view
  const activeEl = transcriptEl.querySelector('.active');
  if (activeEl) {
    activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function buildClickableWords(container, text) {
  const words = text.split(/(\s+)/);
  for (const token of words) {
    if (token.trim() === '') {
      if (token.includes('\n')) {
        container.appendChild(document.createTextNode(' '));
      } else {
        container.appendChild(document.createTextNode(' '));
      }
    } else {
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = token;
      span.dataset.word = token;
      container.appendChild(span);
    }
  }
}

// Click handler
document.addEventListener('click', async e => {
  if (e.target.id === 'refresh-btn') {
    logDebug('Refresh clicked');
    showStatus('Refreshing...');
    chrome.runtime.sendMessage({ type: 'REFRESH' });
    return;
  }

  if (e.target.id === 'debug-toggle-btn') {
    debugPanel.classList.toggle('hidden');
    return;
  }

  if (e.target.id === 'debug-info-btn') {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_DEBUG_INFO' }, resp => {
          if (chrome.runtime.lastError) {
            logDebug(`Content script error: ${chrome.runtime.lastError.message}`);
          } else {
            logDebug(`Content script info: ${JSON.stringify(resp, null, 1)}`);
          }
        });
      }
    });
    return;
  }

  if (e.target.id === 'expand-top') {
    expandedTop += EXPAND_STEP;
    renderVisibleCues();
    return;
  }

  if (e.target.id === 'expand-bottom') {
    expandedBottom += EXPAND_STEP;
    renderVisibleCues();
    return;
  }

  // Word click — inline translation above the word
  const wordEl = e.target.closest('.word');
  if (!wordEl) return;

  const word = wordEl.dataset.word;
  if (!word) return;

  // If this word already has a translation, toggle it off
  const wrapper = wordEl.closest('.word-wrapper');
  if (wrapper) {
    const annotation = wrapper.querySelector('.word-annotation');
    if (annotation) {
      // Unwrap: replace wrapper with just the word span
      wrapper.replaceWith(wordEl);
      wordEl.classList.remove('translated');
      return;
    }
  }

  // Wrap the word span in a container for positioning
  const wordWrapper = document.createElement('span');
  wordWrapper.className = 'word-wrapper';

  const annotation = document.createElement('span');
  annotation.className = 'word-annotation';
  annotation.textContent = '...';

  wordEl.classList.add('translated');
  wordEl.replaceWith(wordWrapper);
  wordWrapper.appendChild(annotation);
  wordWrapper.appendChild(wordEl);

  logDebug(`Translating: "${word}"`);

  try {
    const result = await chrome.runtime.sendMessage({ type: 'TRANSLATE', word });
    logDebug(`Translation: ${JSON.stringify(result)}`);

    if (result && result.translation) {
      annotation.textContent = result.translation;
    } else {
      annotation.textContent = result?.error || '?';
    }
  } catch (err) {
    logDebug(`Translation error: ${err.message}`);
    annotation.textContent = '?';
  }
});

// Expand buttons
expandTopBtn.addEventListener('click', () => {
  expandedTop += EXPAND_STEP;
  renderVisibleCues();
});

expandBottomBtn.addEventListener('click', () => {
  expandedBottom += EXPAND_STEP;
  renderVisibleCues();
});
