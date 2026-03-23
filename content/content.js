/**
 * YouTube Purge — Content Script
 * Injected at document_start on youtube.com.
 *
 * Flow:
 *  1. CSS (hide.css) is already zeroing visibility at document_start.
 *  2. This script sets up a MutationObserver to watch for new video cards.
 *  3. Each card's metadata is extracted and run through checkRelevance().
 *  4. checkRelevance() first uses the local keyword engine, then
 *     delegates to the AI engine in the background (offscreen.js)
 *     via message passing — all scheduled via requestIdleCallback.
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const HIDDEN_CLASS = 'ytpurge-hidden';
const PROCESSED_ATTR = 'data-ytpurge-processed';
const VIDEO_SELECTOR = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-rich-grid-media, ytd-grid-video-renderer';

/** Default blocked keywords (always filtered regardless of intent) */
const ALWAYS_BLOCKED_KEYWORDS = [
  'music video', 'official video', 'official audio',
  'movie trailer', 'trailer', 'reaction', 'prank',
  'gaming', 'gameplay', 'let\'s play', 'vlog', 'daily vlog',
  'meme', 'tiktok', 'shorts compilation',
  'minecraft', 'gta', 'fortnite', 'roblox', 'clash of clans',
  'call of duty', 'league of legends', 'valorant',
  'asmr', 'mukbang', 'unreleased', 'dj set', 'mix', 'compilation'
];

/** Default intent-match keywords (fallback if storage is empty) */
const DEFAULT_INTENT_KEYWORDS = ['ai', 'machine learning', 'engineering', 'calculus', 'tutorial'];

// ─── State ────────────────────────────────────────────────────────────────────

let intentKeywords = [...DEFAULT_INTENT_KEYWORDS];
let isEnabled = true;
let aiThreshold = 0.7;
let strictMode = true;
let filterHome = true;

// ─── Init: Load user settings from chrome.storage ─────────────────────────────

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { 
        intent: DEFAULT_INTENT_KEYWORDS.join(', '), 
        enabled: true,
        aiThreshold: 0.7,
        strictMode: true,
        filterHome: true
      },
      (data) => {
        isEnabled = data.enabled;
        aiThreshold = data.aiThreshold;
        strictMode = data.strictMode;
        filterHome = data.filterHome;
        intentKeywords = data.intent
          .split(',')
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean);
        resolve();
      }
    );
  });
}

// ─── Metadata Extraction ──────────────────────────────────────────────────────

/**
 * Extracts raw text and thumbnail alt text from any element, avoiding brittle CSS selectors.
 * By using `textContent`, we grab the title, channel name, views, and timestamp implicitly.
 * @param {Element} el
 * @returns {{ combinedText: string }}
 */
function extractMetadata(el) {
  // Grab the title specifically if possible (YouTube usually uses #video-title)
  const titleEl = el.querySelector('#video-title, #video-title-link, .ytd-rich-grid-media #video-title');
  const titleText = titleEl ? (titleEl.textContent || '') : '';

  // Grab the channel name specifically
  const channelEl = el.querySelector('#channel-name, .ytd-channel-name, #text.ytd-channel-name');
  const channelText = channelEl ? (channelEl.textContent || '') : '';

  // Grab the thumbnail alt (often the best source)
  const imgEl = el.querySelector('img');
  const altText = imgEl ? (imgEl.getAttribute('alt') || '') : '';

  // Full text fallback
  const rawText = el.textContent || '';

  // Merged context for AI
  const combinedText = `Title: ${titleText} | Channel: ${channelText} | Info: ${altText} | Raw: ${rawText}`.replace(/\s+/g, ' ').trim();

  return { combinedText };
}

// ─── Keyword-Based Relevance Engine ──────────────────────────────────────────

/**
 * Synchronous keyword-based relevance check.
 * Returns: 'approve' | 'block' | 'uncertain'
 * @param {{ combinedText: string }} metadata
 */
function keywordCheck(metadata) {
  const text = metadata.combinedText.toLowerCase();

  // Too short means it hasn't rendered yet
  if (text.length < 5) return 'uncertain';

  // Hard block — regardless of intent
  for (const kw of ALWAYS_BLOCKED_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) {
      console.info('[YouTube Purge] ❌ Blocked (Hard Keyword: "' + kw + '"): ' + metadata.combinedText.substring(0, 40) + '...');
      return 'block';
    }
  }

  // Intent match — approve
  if (intentKeywords.length === 0) {
    console.info('[YouTube Purge] ⚠️ No intent keywords set. Please set your intent in the popup.');
    return 'uncertain';
  }

  for (const kw of intentKeywords) {
    const isShortKW = kw.length <= 3;
    
    if (isShortKW) {
      // Use regex with word boundaries for short keywords like "ai", "cs" to avoid false positives
      const rxStr = '\\\\b' + kw.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '\\\\b';
      const regex = new RegExp(rxStr, 'i');
      if (regex.test(text)) {
        console.info('[YouTube Purge] ✅ Approved (Regex Match: "' + kw + '"): ' + metadata.combinedText.substring(0, 40) + '...');
        return 'approve';
      }
    } else {
      if (text.includes(kw.toLowerCase())) {
        console.info('[YouTube Purge] ✅ Approved (Keyword Match: "' + kw + '"): ' + metadata.combinedText.substring(0, 40) + '...');
        return 'approve';
      }
    }
  }

  return 'uncertain';
}

// ─── AI Pipeline Invocation ──────────────────────────────────────────────────

/**
 * Calls the local AI model inside the Background Service Worker.
 * Returns a real score [0,1], or null if the AI is unavailable.
 * Returning null (not 0.5) lets the caller decide what to do based on strict mode.
 * @param {{ combinedText: string }} metadata
 * @returns {Promise<number|null>}
 */
async function getAIScore(metadata) {
  return new Promise((resolve) => {
    // No hard timeout here — the background queue handles retries.
    // The model may take 15-20s to load on first run; a premature timeout
    // would cause everything to resolve as null before any real scoring happens.
    chrome.runtime.sendMessage(
      {
        type: 'CLASSIFY',
        text: metadata.combinedText,
        intentKeywords,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[YouTube Purge] AI unavailable:', chrome.runtime.lastError.message);
          resolve(null);
        } else if (response === undefined || response === null) {
          resolve(null);
        } else {
          resolve(response);
        }
      }
    );
  });
}

/**
 * Returns true if the element looks like a live stream.
 * Live streams with keyword matches are often irrelevant (e.g. a 24/7 AI chatbot stream).
 */
function isLiveStream(el) {
  // YouTube adds a <yt-badge> or a badge div with text "LIVE" for live streams
  const badge = el.querySelector('yt-badge, .badge-style-type-live-now, .badge-style-type-live-now-alternate, ytd-badge-supported-renderer');
  if (badge && badge.textContent && badge.textContent.toUpperCase().includes('LIVE')) return true;
  // Also check thumbnail overlay
  const overlay = el.querySelector('.ytp-live-badge, .ytd-thumbnail-overlay-time-status-renderer');
  if (overlay && overlay.textContent && overlay.textContent.toUpperCase().includes('LIVE')) return true;
  return false;
}

// ─── Main Relevance Decision ──────────────────────────────────────────────────

/**
 * Full async relevance pipeline.
 * Stage 1 (sync): keyword check → fast block/approve.
 * Stage 2 (async, idle): AI confidence score for uncertain cases.
 * @param {Element} el
 */
async function checkRelevance(el, retryCount = 0) {
  if (!isEnabled) {
    // Extension disabled — show everything
    el.style.removeProperty('display');
    el.style.removeProperty('filter');
    el.style.removeProperty('opacity');
    return;
  }

  // BYPASS: If on Home page and "Filter Home" is OFF
  const path = window.location.pathname;
  const isHomePage = path === '/' || path === '/index.html';
  if (isHomePage && !filterHome) {
    el.style.removeProperty('display');
    el.style.removeProperty('filter');
    el.style.removeProperty('opacity');
    return;
  }

  const metadata = extractMetadata(el);

  // If text is too short (element not yet rendered with text), retry up to 20 times (10 seconds)
  if (metadata.combinedText.length < 5) {
    if (retryCount < 20) {
      setTimeout(() => checkRelevance(el, retryCount + 1), 500);
    } else {
      console.debug('[YouTube Purge] Giving up on empty element (no textContent found)', el);
      // Fallback: If strict mode is ON, and we couldn't even extract text, hide it to be safe.
      if (strictMode) {
        el.style.setProperty('display', 'none', 'important');
      } else {
        el.style.removeProperty('display');
      }
    }
    return;
  }

  const kwResult = keywordCheck(metadata);

  if (kwResult === 'approve') {
    // Exact match — stay visible
    el.style.removeProperty('display');
    return;
  }

  if (kwResult === 'block') {
    // Hard block — hide immediately
    el.style.setProperty('display', 'none', 'important');
    return;
  }

  // ── Uncertain: delegate to AI ─────────────────────────────────────────────
  requestIdleCallback(
    async () => {
      try {
        // Check for live streams — require keyword match, never just AI score
        const live = isLiveStream(el);
        if (live) {
          // Live streams must have an EXACT keyword match to pass — AI alone is not enough
          console.info('[YouTube Purge] 📡 Live stream detected, requiring exact keyword match.');
          el.style.setProperty('display', 'none', 'important');
          el.style.setProperty('opacity', '0', 'important');
          return;
        }

        const score = await getAIScore(metadata);

        if (score === null) {
          // AI unavailable — always show. Hard-block keywords already caught the obvious trash.
          // Don't punish videos just because the AI engine is busy/loading.
          console.info('[YouTube Purge] ⚠️ Shown (AI unavailable, benefit of the doubt): ' + metadata.combinedText.substring(0, 40));
          el.style.removeProperty('display');
          el.style.setProperty('transition', 'filter 0.5s ease-out, opacity 0.5s ease-out', 'important');
          el.style.setProperty('filter', 'blur(0px) grayscale(0%)', 'important');
          el.style.setProperty('opacity', '1', 'important');
        } else if (score >= aiThreshold) {
          console.info('[YouTube Purge] ✅ Approved (AI Score: ' + score.toFixed(3) + '): ' + metadata.combinedText.substring(0, 40));
          el.style.removeProperty('display');
          el.style.setProperty('transition', 'filter 0.5s ease-out, opacity 0.5s ease-out', 'important');
          el.style.setProperty('filter', 'blur(0px) grayscale(0%)', 'important');
          el.style.setProperty('opacity', '1', 'important');
        } else {
          console.info('[YouTube Purge] 🙈 Hidden (AI Score: ' + score.toFixed(3) + ' < Threshold: ' + aiThreshold + '): ' + metadata.combinedText.substring(0, 40));
          el.style.setProperty('display', 'none', 'important');
          el.style.setProperty('opacity', '0', 'important');
        }
      } catch (err) {
        console.warn('[YouTube Purge] checkRelevance error:', err);
        if (strictMode) {
          el.style.setProperty('display', 'none', 'important');
        } else {
          el.style.removeProperty('display');
        }
      }
    },
    { timeout: 3000 }
  );
}

// ─── MutationObserver ─────────────────────────────────────────────────────────

function processElement(el) {
  if (el.hasAttribute(PROCESSED_ATTR)) return;
  el.setAttribute(PROCESSED_ATTR, '1');
  
  // IMMEDIATELY BLUR TO SHOW ANALYZING STATE
  el.style.setProperty('filter', 'blur(10px) grayscale(100%)', 'important');
  el.style.setProperty('opacity', '0.6', 'important');
  el.style.setProperty('transition', 'none', 'important');

  checkRelevance(el);
}

function processAllCurrent() {
  document
    .querySelectorAll(VIDEO_SELECTOR)
    .forEach((el) => {
      if (!el.hasAttribute(PROCESSED_ATTR)) {
        processElement(el);
      }
    });
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;

      if (node.matches && node.matches(VIDEO_SELECTOR)) {
        processElement(node);
      } else {
        node
          .querySelectorAll?.(VIDEO_SELECTOR)
          ?.forEach((el) => {
            if (!el.hasAttribute(PROCESSED_ATTR)) {
              processElement(el);
            }
          });
      }
    }
  }
});

// ─── Settings Change Listener ─────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;

  if (changes.enabled !== undefined) {
    isEnabled = changes.enabled.newValue;
  }
  if (changes.aiThreshold !== undefined) {
    aiThreshold = changes.aiThreshold.newValue;
  }
  if (changes.strictMode !== undefined) {
    strictMode = changes.strictMode.newValue;
  }
  if (changes.filterHome !== undefined) {
    filterHome = changes.filterHome.newValue;
  }

  if (changes.intent !== undefined) {
    intentKeywords = changes.intent.newValue
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
  }

  // Re-process all visible cards with new settings
  document
    .querySelectorAll(VIDEO_SELECTOR)
    .forEach((el) => {
      if (el.hasAttribute(PROCESSED_ATTR)) {
        el.removeAttribute(PROCESSED_ATTR);
        el.style.removeProperty('display');
        processElement(el);
      }
    });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

(async () => {
  await loadSettings();

  // Start observing on `document` instead of `document.documentElement` to avoid null errors at document_start
  observer.observe(document, {
    childList: true,
    subtree: true,
  });

  // Process any elements already in the DOM (e.g. cached page)
  processAllCurrent();
})();
