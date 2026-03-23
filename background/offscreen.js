import { pipeline, env } from '@xenova/transformers';

// ─── Environment Configuration ────────────────────────────────────────────────
env.allowLocalModels = false;
env.useWorker = false;          // Run on main thread, no blob workers (avoids CSP errors)
env.backends.onnx.wasm.numThreads = 1; // Single-threaded WASM, prevents worker spawning
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('background/');

// ─── Pipeline Singleton ───────────────────────────────────────────────────────

class PipelineSingleton {
  static task = 'zero-shot-classification';
  static model = 'Xenova/nli-deberta-v3-small';
  static instance = null;
  static loading = false;
  static ready = false;

  static async getInstance() {
    if (this.ready) return this.instance;

    if (!this.loading) {
      this.loading = true;
      console.info('[YouTube Purge AI] Loading model...');
      this.instance = await pipeline(this.task, this.model);
      this.ready = true;
      this.loading = false;
      console.info('[YouTube Purge AI] [Ready] Model ready.');
    } else {
      // Wait for loading to complete
      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (this.ready) { clearInterval(check); resolve(); }
        }, 200);
      });
    }
    return this.instance;
  }
}

// ─── Pre-warm the model immediately when offscreen doc loads ──────────────────
// This ensures the classifier is ready by the time the first video card arrives.
PipelineSingleton.getInstance().catch((e) => {
  console.error('[YouTube Purge AI] Pre-warm failed:', e);
});

// ─── Message Listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'CLASSIFY_OFFSCREEN') {
    handleClassification(request).then(sendResponse);
    return true;
  }
});

async function handleClassification(request) {
  try {
    const classifier = await PipelineSingleton.getInstance();

    const targetLabels = request.intentKeywords;
    if (!targetLabels || targetLabels.length === 0) return null;

    const negativeLabels = [
      'entertainment', 'gaming', 'music', 'food vlog', 'distraction',
      'vlog', 'prank', 'reaction', 'comedy', 'sports', 'lifestyle',
      'unboxing', 'movie trailer', 'official music video', 'recipe'
    ];
    const labels = [...targetLabels, ...negativeLabels];

    const output = await classifier(request.text, labels, { multi_label: false });

    let intentScore = 0;
    for (let i = 0; i < output.labels.length; i++) {
      if (targetLabels.includes(output.labels[i])) {
        intentScore += output.scores[i];
      }
    }

    console.debug(`[YouTube Purge AI] "${request.text.substring(0, 40)}" -> ${intentScore.toFixed(3)}`);
    return intentScore;
  } catch (err) {
    console.error('[YouTube Purge AI] Classification failed:', err);
    return null; // null = engine failed, let content.js decide based on strict mode
  }
}
