// ─── Offscreen Document Manager ───────────────────────────────────────────────

let creating; // A promise to track document creation

async function setupOffscreenDocument(path) {
  // Check if an offscreen document exists
  const offscreenUrl = chrome.runtime.getURL(path);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) {
    return;
  }

  // create only one offscreen document
  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: path,
      reasons: ['LOCAL_STORAGE'], // More reliable background reason
      justification: 'Run local machine learning models for YouTube Purge semantic filtering',
    });
    await creating;
    creating = null;
    // Grace period for model to start loading — 3s ensures even slow connections
    // have time to begin fetching the model before the first classification request.
    await new Promise(r => setTimeout(r, 3000));
  }
}

// ─── Message Listener Proxy Queue ─────────────────────────────────────────────

const classificationQueue = [];
let isProcessingQueue = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'CLASSIFY') {
    classificationQueue.push({ request, sendResponse });
    processQueue();
    return true; // Indicates async response
  }
});

async function processQueue() {
  if (isProcessingQueue) return;
  if (classificationQueue.length === 0) return;
  
  isProcessingQueue = true;

  try {
    await setupOffscreenDocument('background/offscreen.html');
  } catch (err) {
    console.error('[YouTube Purge] Failed to setup offscreen doc:', err);
    // Flush queue with 0.5 neutral scores
    while (classificationQueue.length > 0) {
      classificationQueue.shift().sendResponse(0.5);
    }
    isProcessingQueue = false;
    return;
  }

  while (classificationQueue.length > 0) {
    const { request, sendResponse } = classificationQueue.shift();
    
    try {
      // Forward the classification request to the offscreen document with a retry
      let score = 0.5;
      let attempts = 0;
      
      while (attempts < 3) {
        score = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: 'CLASSIFY_OFFSCREEN',
              text: request.text,
              intentKeywords: request.intentKeywords
            },
            (response) => {
              if (chrome.runtime.lastError) {
                console.warn(`[YouTube Purge] Offscreen attempt ${attempts + 1} failed:`, chrome.runtime.lastError.message);
                resolve(null);
              } else {
                resolve(response);
              }
            }
          );
        });

        if (score !== null) break;
        attempts++;
        await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
      }

      sendResponse(score !== null ? score : null);
    } catch (err) {
      console.error('[YouTube Purge] Proxy failed:', err);
      sendResponse(null); // null lets content.js decide based on strict mode
    }
  }

  isProcessingQueue = false;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.info('YouTube Purge Installed');
  } else if (details.reason === 'update') {
    console.info('YouTube Purge Updated');
  }

  // Set default initial settings
  chrome.storage.sync.get(['enabled', 'intent', 'aiThreshold', 'strictMode', 'filterHome'], (result) => {
    if (result.enabled === undefined) chrome.storage.sync.set({ enabled: true });
    if (result.intent === undefined) chrome.storage.sync.set({ intent: 'ai, machine learning, mathematics, algorithm' });
    if (result.aiThreshold === undefined) chrome.storage.sync.set({ aiThreshold: 0.7 });
    if (result.strictMode === undefined) chrome.storage.sync.set({ strictMode: true });
    if (result.filterHome === undefined) chrome.storage.sync.set({ filterHome: true });
  });

  chrome.action.setBadgeText({ text: 'ON' });
  chrome.action.setBadgeBackgroundColor({ color: '#8a0303' });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.enabled) {
    const isEnabled = changes.enabled.newValue;
    const text = isEnabled ? 'ON' : 'OFF';
    const color = isEnabled ? '#8a0303' : '#333333';
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
  }
});

// ─── Tab Cleanup ──────────────────────────────────────────────────────────────

/**
 * When any tab closes, check if there are any remaining YouTube tabs.
 * If not, close the Offscreen Document to free memory and CPU.
 */
chrome.tabs.onRemoved.addListener(async () => {
  try {
    const ytTabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
    if (ytTabs.length === 0) {
      const offscreenUrl = chrome.runtime.getURL('background/offscreen.html');
      const existing = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
      });
      if (existing.length > 0) {
        await chrome.offscreen.closeDocument();
        console.info('[YouTube Purge] No YouTube tabs remain — Offscreen AI engine shut down.');
      }
    }
  } catch (e) {
    // Silently ignore — this is a best-effort cleanup
  }
});
