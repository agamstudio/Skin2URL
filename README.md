# Skin2URL

Upload Minecraft skins and get copyable ImgBB URLs. Multi-file support with session-only duplicate detection. Static site for [GitHub Pages](https://pages.github.com/).

Nothing is stored in this repo. Refreshing or leaving the page clears the on-site list. URLs you already copied still work on ImgBB.

## Live site

After enabling Pages: `https://agamstudio.github.io/Skin2URL/`

## Setup

### 1. ImgBB API key

1. Open [api.imgbb.com](https://api.imgbb.com/).
2. Sign in / create an ImgBB account.
3. Copy your **API key**.
4. Put it in [`config.js`](config.js):

```js
window.SKIN2URL_CONFIG = {
  imgbbApiKey: "paste_your_api_key_here",
  maxConcurrent: 3,
};
```

### 2. GitHub Pages

1. Push this repo to GitHub (`agamstudio/Skin2URL`).
2. **Settings → Pages**
3. **Source:** Deploy from a branch
4. **Branch:** `main` / `/ (root)`
5. Save and wait a minute for the site to go live.

## Usage

1. Drop PNG skins anywhere on the page (or click the drop zone the first time).
2. Upload starts automatically — no Upload button.
3. Copy each `i.ibb.co` URL from the result cards.
4. Duplicates in the same visit are skipped silently (no extra cards). After a refresh, the session map resets.

## Notes

- Prefer standard skin sizes (64×64, 64×32, 128×128, 256×256). Other sizes still upload.
- ImgBB rate limits apply; keep `maxConcurrent` modest (default `3`).
- This page does not use `localStorage` / IndexedDB for skin history.

## License

MIT
