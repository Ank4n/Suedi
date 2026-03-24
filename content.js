/**
 * Content script (ISOLATED world).
 * Single source of truth for video detection and time tracking on SVT Play.
 */

if (window.__suediLoaded) {
  // Already running, skip
} else {
  window.__suediLoaded = true;

  let currentSvtId = null;
  let videoEl = null;
  let throttleTimer = null;
  let videoSearchInterval = null;
  let backgroundAlive = false; // track if background has our state

  function extractSvtId(url) {
    const match = url.match(/\/video\/([a-zA-Z0-9]+)/);
    if (match) return match[1];
    const match2 = url.match(/\/play\/[^/]+\/([a-zA-Z0-9]+)/);
    return match2 ? match2[1] : null;
  }

  // Send message with auto-recovery: if background died, re-announce video
  function safeSend(msg) {
    chrome.runtime.sendMessage(msg).catch(() => {
      // Service worker was killed (e.g. during pause). Re-bootstrap it.
      backgroundAlive = false;
      if (currentSvtId) {
        chrome.runtime.sendMessage({ type: 'VIDEO_DETECTED', svtId: currentSvtId }).then(() => {
          backgroundAlive = true;
        }).catch(() => {});
      }
    });
  }

  function onTimeUpdate() {
    if (throttleTimer) return;
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      if (videoEl) {
        safeSend({ type: 'TIME_UPDATE', currentTime: videoEl.currentTime });
      }
    }, 250);
  }

  // Also send time updates while paused (every 2s) to keep the connection alive
  // and to recover from service worker restarts
  setInterval(() => {
    if (videoEl && currentSvtId) {
      safeSend({ type: 'TIME_UPDATE', currentTime: videoEl.currentTime });
    }
  }, 2000);

  function attachToVideo(video) {
    if (videoEl === video) return;
    detachVideo();
    videoEl = video;
    videoEl.addEventListener('timeupdate', onTimeUpdate);
    stopVideoSearch();
    safeSend({ type: 'DEBUG', message: 'Attached to <video> element' });
  }

  function detachVideo() {
    if (videoEl) {
      videoEl.removeEventListener('timeupdate', onTimeUpdate);
      videoEl = null;
    }
  }

  function findAndAttachVideo() {
    let video = document.querySelector('video');
    if (video) { attachToVideo(video); return true; }
    for (const iframe of document.querySelectorAll('iframe')) {
      try {
        video = iframe.contentDocument?.querySelector('video');
        if (video) { attachToVideo(video); return true; }
      } catch (e) { /* cross-origin */ }
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

    const observer = new MutationObserver(() => {
      if (findAndAttachVideo()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    videoSearchInterval = setInterval(() => {
      if (findAndAttachVideo()) observer.disconnect();
    }, 1000);

    setTimeout(() => {
      observer.disconnect();
      stopVideoSearch();
    }, 60000);
  }

  function init() {
    const svtId = extractSvtId(window.location.href);
    if (!svtId) return;
    if (svtId === currentSvtId && backgroundAlive) return;

    currentSvtId = svtId;
    backgroundAlive = false;
    chrome.runtime.sendMessage({ type: 'VIDEO_DETECTED', svtId }).then(() => {
      backgroundAlive = true;
    }).catch(() => {});
    startVideoSearch();
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'URL_CHANGED' || msg.type === 'FORCE_REINIT') {
      currentSvtId = null;
      backgroundAlive = false;
      detachVideo();
      stopVideoSearch();
      init();
    }
    if (msg.type === 'REQUEST_STATE') {
      if (currentSvtId) {
        chrome.runtime.sendMessage({ type: 'VIDEO_DETECTED', svtId: currentSvtId }).catch(() => {});
      }
      sendResponse({ svtId: currentSvtId, attached: !!videoEl });
    }
    if (msg.type === 'GET_DEBUG_INFO') {
      sendResponse({
        url: window.location.href,
        svtId: currentSvtId,
        videoElements: document.querySelectorAll('video').length,
        attached: !!videoEl,
        currentTime: videoEl?.currentTime ?? null,
        paused: videoEl?.paused ?? null,
        backgroundAlive,
      });
    }
  });

  init();
}
