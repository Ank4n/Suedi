/**
 * Content script (ISOLATED world).
 * Single source of truth for video detection and time tracking on SVT Play.
 */

// Re-entrance guard — prevent double injection
if (window.__suediLoaded) {
  // Already running, skip
} else {
  window.__suediLoaded = true;

  let currentSvtId = null;
  let videoEl = null;
  let throttleTimer = null;
  let videoSearchInterval = null;

  function extractSvtId(url) {
    // Same regex exists in background.js — duplicated because content scripts can't share ES modules
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
    chrome.runtime.sendMessage({ type: 'DEBUG', message: 'Attached to <video> element' });
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
    // Check same-origin iframes
    for (const iframe of document.querySelectorAll('iframe')) {
      try {
        video = iframe.contentDocument?.querySelector('video');
        if (video) {
          attachToVideo(video);
          return true;
        }
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

    // Poll every 1s as fallback for React async rendering
    videoSearchInterval = setInterval(() => {
      if (findAndAttachVideo()) observer.disconnect();
    }, 1000);

    // Stop after 60s
    setTimeout(() => {
      observer.disconnect();
      stopVideoSearch();
    }, 60000);
  }

  function init() {
    const svtId = extractSvtId(window.location.href);
    if (!svtId) return;
    if (svtId === currentSvtId) return;

    currentSvtId = svtId;
    chrome.runtime.sendMessage({ type: 'VIDEO_DETECTED', svtId });
    startVideoSearch();
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'URL_CHANGED' || msg.type === 'FORCE_REINIT') {
      currentSvtId = null;
      detachVideo();
      stopVideoSearch();
      init();
    }
    if (msg.type === 'REQUEST_STATE') {
      // Background asks us to re-announce ourselves (e.g. after service worker restart)
      if (currentSvtId) {
        chrome.runtime.sendMessage({ type: 'VIDEO_DETECTED', svtId: currentSvtId });
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
      });
    }
  });

  init();
}
