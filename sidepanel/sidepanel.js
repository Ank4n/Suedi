const statusEl = document.getElementById('status');
const currentCueEl = document.getElementById('current-cue');
const transcriptEl = document.getElementById('transcript');
const videoTitleEl = document.getElementById('video-title');
const popupEl = document.getElementById('translation-popup');
const debugPanel = document.getElementById('debug-panel');
const debugLogEl = document.getElementById('debug-log');

let allCues = [];
let activeCueIndex = -1;

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
      renderTranscript();
      statusEl.classList.add('hidden');
      currentCueEl.classList.remove('hidden');
      currentCueEl.innerHTML = '<span style="color:#888">Waiting for playback...</span>';
      break;

    case 'CUE_UPDATE':
      activeCueIndex = msg.cueIndex;
      renderCurrentCue(msg.cue);
      highlightTranscriptCue(msg.cueIndex);
      break;

    case 'CUE_CLEAR':
      activeCueIndex = -1;
      currentCueEl.innerHTML = '';
      clearTranscriptHighlight();
      break;

    case 'NO_SUBTITLES':
      videoTitleEl.textContent = msg.title || '';
      showStatus('No subtitles available for this video.');
      currentCueEl.classList.add('hidden');
      transcriptEl.innerHTML = '';
      logDebug('NO_SUBTITLES received');
      break;

    case 'NO_VIDEO':
      showStatus('Navigate to an SVT Play video to see subtitles.');
      currentCueEl.classList.add('hidden');
      transcriptEl.innerHTML = '';
      videoTitleEl.textContent = '';
      allCues = [];
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

function renderTranscript() {
  transcriptEl.innerHTML = '';
  for (let i = 0; i < allCues.length; i++) {
    const div = document.createElement('div');
    div.className = 'transcript-cue';
    div.dataset.index = i;
    // Make transcript words clickable too
    const words = allCues[i].text.split(/(\s+)/);
    for (const token of words) {
      if (token.trim() === '') {
        if (token.includes('\n')) {
          div.appendChild(document.createTextNode(' '));
        } else {
          div.appendChild(document.createTextNode(' '));
        }
      } else {
        const span = document.createElement('span');
        span.className = 'word';
        span.textContent = token;
        span.dataset.word = token;
        div.appendChild(span);
      }
    }
    transcriptEl.appendChild(div);
  }
}

function renderCurrentCue(cue) {
  currentCueEl.innerHTML = '';
  const words = cue.text.split(/(\s+)/);
  for (const token of words) {
    if (token.trim() === '') {
      if (token.includes('\n')) {
        currentCueEl.appendChild(document.createElement('br'));
      } else {
        currentCueEl.appendChild(document.createTextNode(' '));
      }
    } else {
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = token;
      span.dataset.word = token;
      currentCueEl.appendChild(span);
    }
  }
}

function highlightTranscriptCue(index) {
  clearTranscriptHighlight();
  const el = transcriptEl.querySelector(`[data-index="${index}"]`);
  if (el) {
    el.classList.add('active');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function clearTranscriptHighlight() {
  const prev = transcriptEl.querySelector('.active');
  if (prev) prev.classList.remove('active');
}

// Click handler — translate words, refresh button, debug button
document.addEventListener('click', async e => {
  // Refresh button
  if (e.target.id === 'refresh-btn') {
    logDebug('Refresh clicked');
    showStatus('Refreshing...');
    chrome.runtime.sendMessage({ type: 'REFRESH' });
    return;
  }

  // Debug toggle
  if (e.target.id === 'debug-toggle-btn') {
    debugPanel.classList.toggle('hidden');
    return;
  }

  // Debug info button
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

  // Word click — translate
  const wordEl = e.target.closest('.word');
  if (!wordEl) {
    hidePopup();
    return;
  }

  const word = wordEl.dataset.word;
  if (!word) return;

  const rect = wordEl.getBoundingClientRect();
  popupEl.style.left = `${Math.min(rect.left, window.innerWidth - 280)}px`;
  popupEl.style.top = `${rect.bottom + 8}px`;

  popupEl.querySelector('.popup-word').textContent = word;
  popupEl.querySelector('.popup-translation').innerHTML = '<span class="popup-loading">Translating...</span>';
  popupEl.querySelector('.popup-source').textContent = '';
  popupEl.classList.remove('hidden');

  logDebug(`Translating: "${word}"`);

  try {
    const result = await chrome.runtime.sendMessage({ type: 'TRANSLATE', word });
    logDebug(`Translation result: ${JSON.stringify(result)}`);

    if (result && result.translation) {
      popupEl.querySelector('.popup-translation').textContent = result.translation;
      popupEl.querySelector('.popup-source').textContent = `via ${result.source}`;
    } else {
      popupEl.querySelector('.popup-translation').textContent = result?.error || 'Translation unavailable';
      popupEl.querySelector('.popup-source').textContent = '';
    }
  } catch (err) {
    logDebug(`Translation error: ${err.message}`);
    popupEl.querySelector('.popup-translation').textContent = 'Translation failed';
    popupEl.querySelector('.popup-source').textContent = '';
  }
});

function hidePopup() {
  popupEl.classList.add('hidden');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') hidePopup();
});
