# YouTube Purge 🩸🌑
### Semantic Filtering for an Intent-Driven Feed

**YouTube Purge** is a Chrome extension that uses local, on-device AI to semantically filter your YouTube feed. It ensures you only see content that aligns with your current learning intent, instantly vaporizing distractions like gaming, food vlogs, and clickbait.

---

## 🚀 Key Features

- **🧠 Local AI Engine**: Runs a `DeBERTa-v3` model directly in your browser using Transformers.js. No data leaves your machine.
- **🎯 Intent-Based Filtering**: Simply type what you're studying (e.g., "Machine Learning, Calculus, Rust") and the AI handles the rest.
- **🛡️ Hard-Block System**: Built-in protection against common "dopamine loops" like gaming, music mixes, and vlogs.
- **🌓 Blood Red Theme**: A premium, high-contrast dark mode interface designed for deep focus.
- **⚡ Zero-Flicker Technology**: Videos are blurred or hidden instantly before they can grab your attention.
- **🔋 Resource Efficient**: Automatically shuts down the AI engine when no YouTube tabs are open.

---

## 🛠️ Usage Guide

### 1. Installation
1. Clone this repository or download the ZIP.
2. Go to `chrome://extensions` in your browser.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the extension folder.

### 2. Setting Your Intent
1. Click the **YouTube Purge** icon in your toolbar.
2. Enter your current focus topics (e.g., `Neural Networks, Linear Algebra`).
3. Click **Save Intent**.

### 3. Tuning the Filter
- **AI Confidence Threshold**: 
  - `0.5 - 0.6`: Permissive (some "near-miss" content shows).
  - `0.7 - 0.8`: Recommended (balanced).
  - `0.9+`: Strict (only high-confidence matches show).
- **Filter Home Page**: Toggle this OFF if you want to browse freely on the main feed but keep filtering on search and sidebars.
- **Strict Mode**: If the AI is unsure, it will err on the side of caution and hide the video.

---

## 🛡️ Privacy
All AI inference is performed **locally** using WebAssembly (WASM). Your watch history and intent keywords never leave your browser.

---

## 📜 License
MIT
