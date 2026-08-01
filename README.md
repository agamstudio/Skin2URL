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

1. Drop or select one or more PNG skin files.
2. Click **Upload**.
3. Copy each `i.ibb.co` URL.
4. In the same visit, uploading the same skin again is skipped (content hash). After a refresh, the session map is empty again.

## Notes

- Prefer standard skin sizes (64×64, 64×32, 128×128, 256×256). Other sizes show a warning but still upload.
- ImgBB rate limits apply; keep `maxConcurrent` modest (default `3`).
- This page does not use `localStorage` / IndexedDB for skin history.

## License

MIT
