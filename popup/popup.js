/**
 * YouTube Purge — Popup Script
 * Handles loading/saving settings and UI interactions.
 */

'use strict';

// ─── Element refs ─────────────────────────────────────────────────────────────

const enableToggle = document.getElementById('enableToggle');
const intentInput = document.getElementById('intentInput');
const thresholdRange = document.getElementById('thresholdRange');
const thresholdValue = document.getElementById('thresholdValue');
const strictToggle = document.getElementById('strictToggle');
const homeToggle = document.getElementById('homeToggle');
const saveBtn = document.getElementById('saveBtn');
const saveBtnText = document.getElementById('saveBtnText');
const saveFeedback = document.getElementById('saveFeedback');
const statusBanner = document.getElementById('statusBanner');
const statusText = document.getElementById('statusText');
const chipContainer = document.getElementById('chipContainer');
const aiStatusBadge = document.getElementById('aiStatusBadge');

// ─── AI Status ────────────────────────────────────────────────────────────────

function updateAIStatus() {
  chrome.runtime.sendMessage({ type: 'GET_AI_STATUS' }, (response) => {
    if (chrome.runtime.lastError || !response) return;
    const status = response.status;
    aiStatusBadge.className = 'ai-status-badge';
    if (status === 'ready') {
      aiStatusBadge.classList.add('ready');
      aiStatusBadge.textContent = 'Ready';
    } else if (status === 'downloading') {
      aiStatusBadge.classList.add('downloading');
      aiStatusBadge.textContent = 'Downloading';
    } else if (status === 'initializing') {
      aiStatusBadge.textContent = 'Starting...';
    } else {
      aiStatusBadge.textContent = 'Not Available';
    }
  });
}


// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS = {
  enabled: true,
  intent: 'AI, Machine Learning, Engineering, Calculus, Mathematics, Programming',
  aiThreshold: 0.7,
  strictMode: true,
  filterHome: true,
};

// ─── Load settings on open ────────────────────────────────────────────────────

async function loadSettings() {
  const data = await chrome.storage.sync.get(DEFAULTS);

  enableToggle.checked = data.enabled;
  intentInput.value = data.intent;
  thresholdRange.value = data.aiThreshold;
  thresholdValue.textContent = data.aiThreshold;
  strictToggle.checked = data.strictMode;
  homeToggle.checked = data.filterHome;

  updateStatusBanner(data.enabled);
}

// ─── Save settings ────────────────────────────────────────────────────────────

async function saveSettings() {
  const settings = {
    enabled: enableToggle.checked,
    intent: intentInput.value.trim(),
    aiThreshold: parseFloat(thresholdRange.value),
    strictMode: strictToggle.checked,
    filterHome: homeToggle.checked,
  };

  // Animate button
  saveBtn.disabled = true;
  saveBtnText.textContent = 'Saving…';

  await chrome.storage.sync.set(settings);

  // Notify background + content scripts
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' });

  // Success feedback
  saveBtnText.textContent = 'Saved!';
  saveFeedback.textContent = '✅ Your intent has been updated. Refreshing YouTube will apply it.';

  setTimeout(() => {
    saveBtnText.textContent = 'Save Intent';
    saveBtn.disabled = false;
    saveFeedback.textContent = '';
  }, 2500);
}

// ─── Status Banner ────────────────────────────────────────────────────────────

function updateStatusBanner(enabled) {
  if (enabled) {
    statusBanner.classList.remove('disabled');
    statusText.textContent = 'Filtering active';
  } else {
    statusBanner.classList.add('disabled');
    statusText.textContent = 'Filtering paused — all videos shown';
  }
}

// ─── Chip Presets ────────────────────────────────────────────────────────────

chipContainer.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;

  const preset = chip.dataset.preset;
  intentInput.value = preset;

  // Visual feedback on chip
  chipContainer.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
  chip.classList.add('active');
});

// ─── Threshold Range Live Update ──────────────────────────────────────────────

thresholdRange.addEventListener('input', () => {
  thresholdValue.textContent = thresholdRange.value;
});

// ─── Enable Toggle ────────────────────────────────────────────────────────────

enableToggle.addEventListener('change', () => {
  updateStatusBanner(enableToggle.checked);
  // Auto-save the enabled state immediately for instant effect
  chrome.storage.sync.set({ enabled: enableToggle.checked });
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' });
});

// ─── Save Button ──────────────────────────────────────────────────────────────

saveBtn.addEventListener('click', saveSettings);

// Also save on Ctrl/Cmd + Enter in textarea
intentInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    saveSettings();
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

loadSettings();
updateAIStatus();

