var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// background/background.js
var require_background = __commonJS({
  "background/background.js"() {
    var creating;
    async function setupOffscreenDocument(path) {
      const offscreenUrl = chrome.runtime.getURL(path);
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [offscreenUrl]
      });
      if (existingContexts.length > 0) {
        return;
      }
      if (creating) {
        await creating;
      } else {
        creating = chrome.offscreen.createDocument({
          url: path,
          reasons: ["LOCAL_STORAGE"],
          // More reliable background reason
          justification: "Run local machine learning models for YouTube Purge semantic filtering"
        });
        await creating;
        creating = null;
        await new Promise((r) => setTimeout(r, 3e3));
      }
    }
    var classificationQueue = [];
    var isProcessingQueue = false;
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.type === "CLASSIFY") {
        classificationQueue.push({ request, sendResponse });
        processQueue();
        return true;
      }
    });
    async function processQueue() {
      if (isProcessingQueue) return;
      if (classificationQueue.length === 0) return;
      isProcessingQueue = true;
      try {
        await setupOffscreenDocument("background/offscreen.html");
      } catch (err) {
        console.error("[YouTube Purge] Failed to setup offscreen doc:", err);
        while (classificationQueue.length > 0) {
          classificationQueue.shift().sendResponse(0.5);
        }
        isProcessingQueue = false;
        return;
      }
      while (classificationQueue.length > 0) {
        const { request, sendResponse } = classificationQueue.shift();
        try {
          let score = 0.5;
          let attempts = 0;
          while (attempts < 3) {
            score = await new Promise((resolve) => {
              chrome.runtime.sendMessage(
                {
                  type: "CLASSIFY_OFFSCREEN",
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
            await new Promise((r) => setTimeout(r, 1e3));
          }
          sendResponse(score !== null ? score : null);
        } catch (err) {
          console.error("[YouTube Purge] Proxy failed:", err);
          sendResponse(null);
        }
      }
      isProcessingQueue = false;
    }
    chrome.runtime.onInstalled.addListener((details) => {
      if (details.reason === "install") {
        console.info("YouTube Purge Installed");
      } else if (details.reason === "update") {
        console.info("YouTube Purge Updated");
      }
      chrome.storage.sync.get(["enabled", "intent", "aiThreshold", "strictMode", "filterHome"], (result) => {
        if (result.enabled === void 0) chrome.storage.sync.set({ enabled: true });
        if (result.intent === void 0) chrome.storage.sync.set({ intent: "ai, machine learning, mathematics, algorithm" });
        if (result.aiThreshold === void 0) chrome.storage.sync.set({ aiThreshold: 0.7 });
        if (result.strictMode === void 0) chrome.storage.sync.set({ strictMode: true });
        if (result.filterHome === void 0) chrome.storage.sync.set({ filterHome: true });
      });
      chrome.action.setBadgeText({ text: "ON" });
      chrome.action.setBadgeBackgroundColor({ color: "#8a0303" });
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.enabled) {
        const isEnabled = changes.enabled.newValue;
        const text = isEnabled ? "ON" : "OFF";
        const color = isEnabled ? "#8a0303" : "#333333";
        chrome.action.setBadgeText({ text });
        chrome.action.setBadgeBackgroundColor({ color });
      }
    });
    chrome.tabs.onRemoved.addListener(async () => {
      try {
        const ytTabs = await chrome.tabs.query({ url: "https://www.youtube.com/*" });
        if (ytTabs.length === 0) {
          const offscreenUrl = chrome.runtime.getURL("background/offscreen.html");
          const existing = await chrome.runtime.getContexts({
            contextTypes: ["OFFSCREEN_DOCUMENT"],
            documentUrls: [offscreenUrl]
          });
          if (existing.length > 0) {
            await chrome.offscreen.closeDocument();
            console.info("[YouTube Purge] No YouTube tabs remain \u2014 Offscreen AI engine shut down.");
          }
        }
      } catch (e) {
      }
    });
  }
});
export default require_background();
