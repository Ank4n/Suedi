/**
 * Content script (ISOLATED world).
 * Detects video on SVT Play, extracts svtId, and tracks playback time.
 */

let currentSvtId = null;
let videoEl = null;
let throttleTimer = null;
let videoSearchInterval = null;

function extractSvtId(url) {
  const match = url.match(/\/video\/([a-zA-Z0-9]+)/);
  if (match) return match[1];
  const match2 = url.match(/\/play\/[^/]+\/([a-zA-Z0-9]+)/);
  return match2 ? match2[1] : null;
}

function onTimeUpdate() {
  if (throttleTimer) return;
  throttleTimer = setTimeout(() => {
    throttleTimer = null;
    if (videoEl) {
      chrome.runtime.sendMessage({
        type: 'TIME_UPDATE',
        currentTime: videoEl.currentTime,
      });
    }
  }, 250);
}

function attachToVideo(video) {
  if (videoEl === video) return;
  detachVideo();
  videoEl = video;
  videoEl.addEventListener('timeupdate', onTimeUpdate);
  stopVideoSearch();
  chrome.runtime.sendMessage({
    type: 'DEBUG',
    message: 'Attached to <video> element',
  });
}

function detachVideo() {
  if (videoEl) {
    videoEl.removeEventListener('timeupdate', onTimeUpdate);
    videoEl = null;
  }
}

function findAndAttachVideo() {
  let video = document.querySelector('video');
  if (video) {
    attachToVideo(video);
    return true;
  }

  // Check inside iframes (same-origin only)
  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      video = iframe.contentDocument?.querySelector('video');
      if (video) {
        attachToVideo(video);
        return true;
      }
    } catch (e) {
      // Cross-origin iframe
    }
  }

  return false;
}

function stopVideoSearch() {
  if (videoSearchInterval) {
    clearInterval(videoSearchInterval);
    videoSearchInterval = null;
  }
}

function startVideoSearch() {
  if (findAndAttachVideo()) return;

  let attempts = 0;

  const observer = new MutationObserver(() => {
    if (findAndAttachVideo()) {
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Poll every 1s as fallback — report status to debug panel
  videoSearchInterval = setInterval(() => {
    attempts++;
    if (findAndAttachVideo()) {
      observer.disconnect();
      return;
    }
    // Report search status every 5 attempts
    if (attempts % 5 === 0) {
      const allVideos = document.querySelectorAll('video');
      const allIframes = document.querySelectorAll('iframe');
      chrome.runtime.sendMessage({
        type: 'DEBUG',
        message: `Searching for <video>... attempt ${attempts}. Found: ${allVideos.length} video(s), ${allIframes.length} iframe(s)`,
      });
    }
  }, 1000);

  // Stop after 60s
  setTimeout(() => {
    observer.disconnect();
    stopVideoSearch();
    if (!videoEl) {
      chrome.runtime.sendMessage({
        type: 'DEBUG',
        message: 'Gave up searching for <video> after 60s. Try clicking Refresh after starting playback.',
      });
    }
  }, 60000);
}

function getDebugInfo() {
  const allVideos = document.querySelectorAll('video');
  const allIframes = document.querySelectorAll('iframe');
  const info = {
    url: window.location.href,
    svtId: extractSvtId(window.location.href),
    videoElements: allVideos.length,
    iframes: allIframes.length,
    attached: !!videoEl,
    videoCurrentTime: videoEl?.currentTime ?? null,
    videoPaused: videoEl?.paused ?? null,
    videoDuration: videoEl?.duration ?? null,
  };
  // Check for video in shadow DOM
  let shadowVideos = 0;
  document.querySelectorAll('*').forEach(el => {
    if (el.shadowRoot) {
      shadowVideos += el.shadowRoot.querySelectorAll('video').length;
    }
  });
  info.shadowDomVideos = shadowVideos;
  return info;
}

function init() {
  const svtId = extractSvtId(window.location.href);
  if (!svtId) return;

  if (svtId === currentSvtId) return;
  currentSvtId = svtId;

  chrome.runtime.sendMessage({ type: 'VIDEO_DETECTED', svtId });
  startVideoSearch();
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'URL_CHANGED' || msg.type === 'FORCE_REINIT') {
    currentSvtId = null;
    detachVideo();
    stopVideoSearch();
    init();
  }
  if (msg.type === 'GET_DEBUG_INFO') {
    sendResponse(getDebugInfo());
  }
});

init();
