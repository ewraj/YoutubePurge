// ─── Gemini Nano Session Manager ──────────────────────────────────────────────

let aiSession = null;
let aiStatus = 'initializing'; // 'ready' | 'unavailable' | 'initializing'

/**
 * System prompt designed to return a clean numeric score.
 * The model is instructed to output ONLY a number between 0.0 and 1.0.
 */
const SYSTEM_PROMPT = `You are a YouTube video relevance classifier.

A user has set a learning intent. Given that intent and a video's metadata,
output ONLY a single decimal number between 0.0 and 1.0 representing how
relevant the video is to the user's learning intent.

Rules:
- 1.0 = Perfectly matches the learning intent (e.g. a tutorial, lecture, deep-dive)
- 0.5 = Ambiguous (could be related but not clearly educational)
- 0.0 = Clearly irrelevant (entertainment, vlog, gaming, music, etc.)
- Output ONLY the number. No explanation. No units. No extra text.`;

async function initAI() {
  try {
    if (!('ai' in self) || !('languageModel' in self.ai)) {
      console.warn('[YouTube Purge AI] Chrome Prompt API not found. Using keyword-only mode.');
      aiStatus = 'unavailable';
      return;
    }

    const capabilities = await self.ai.languageModel.capabilities();

    if (capabilities.available === 'no') {
      console.warn('[YouTube Purge AI] Gemini Nano not available on this device.');
      aiStatus = 'unavailable';
      return;
    }

    if (capabilities.available === 'after-download') {
      console.info('[YouTube Purge AI] Gemini Nano is downloading. Will retry in 30s...');
      aiStatus = 'downloading';
      setTimeout(initAI, 30000);
      return;
    }

    // 'readily' — create session
    aiSession = await self.ai.languageModel.create({ systemPrompt: SYSTEM_PROMPT });
    aiStatus = 'ready';
    console.info('[YouTube Purge AI] Gemini Nano ready.');
  } catch (err) {
    console.error('[YouTube Purge AI] Init failed:', err);
    aiStatus = 'unavailable';
  }
}

// Boot the AI engine immediately when service worker starts
initAI();

// ─── Message Listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // ── Classification Request ──────────────────────────────────────────────────
  if (request.type === 'CLASSIFY') {
    handleClassification(request).then(sendResponse);
    return true; // async
  }

  // ── Status Query (from popup) ───────────────────────────────────────────────
  if (request.type === 'GET_AI_STATUS') {
    sendResponse({ status: aiStatus });
    return false;
  }
});

// ─── Classification Logic ─────────────────────────────────────────────────────

async function handleClassification(request) {
  if (!aiSession || aiStatus !== 'ready') {
    return null; // content.js handles null gracefully (benefit of the doubt)
  }

  const { text, intentKeywords } = request;
  if (!text || !intentKeywords || intentKeywords.length === 0) return null;

  const intentStr = intentKeywords.join(', ');
  const prompt = `Intent: "${intentStr}"\nVideo: ${text.substring(0, 500)}\nScore:`;

  try {
    const raw = await aiSession.prompt(prompt);
    const score = parseFloat(raw.trim());

    if (isNaN(score)) {
      console.warn('[YouTube Purge AI] Non-numeric response:', raw);
      return null;
    }

    // Clamp to [0, 1]
    const clamped = Math.min(1, Math.max(0, score));
    console.debug(`[YouTube Purge AI] "${text.substring(0, 40)}" -> ${clamped.toFixed(3)}`);
    return clamped;
  } catch (err) {
    // Session may have died — try to recreate it once
    console.warn('[YouTube Purge AI] Prompt failed, recreating session...', err.message);
    try {
      aiSession = await self.ai.languageModel.create({ systemPrompt: SYSTEM_PROMPT });
      const raw = await aiSession.prompt(prompt);
      const score = parseFloat(raw.trim());
      return isNaN(score) ? null : Math.min(1, Math.max(0, score));
    } catch (retryErr) {
      console.error('[YouTube Purge AI] Retry failed:', retryErr);
      aiStatus = 'unavailable';
      aiSession = null;
      return null;
    }
  }
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
    if (result.enabled === undefined)    chrome.storage.sync.set({ enabled: true });
    if (result.intent === undefined)     chrome.storage.sync.set({ intent: 'ai, machine learning, mathematics, algorithm' });
    if (result.aiThreshold === undefined) chrome.storage.sync.set({ aiThreshold: 0.6 });
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
