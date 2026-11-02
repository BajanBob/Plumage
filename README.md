# 🪶 Plumage

**Encrypt-then-scatter steganographic messenger.** Hide a private message — text,
a voice note, a photo, a clip — by encrypting it and splitting it across ordinary
media: **pictures, songs, text and video**. The message rebuilds only from **all
the carriers + the pass-phrase**. Everything happens on your device; nothing is
uploaded.

Part of the Pigeon family, and also a module inside the Pigeon app. One codebase,
three builds: **Android, iOS, Windows**.

## How it works
1. **Encrypt** — AES-256-GCM, key stretched from your pass-phrase (PBKDF2).
2. **Split** — the ciphertext is cut into shards.
3. **Scatter** — each shard is hidden inside a cover carrier:
   - **Picture** — least-significant-bit of RGB (invisible, ≤1 LSB change)
   - **Audio / song** — LSB of 16-bit PCM WAV samples
   - **Text** — zero-width characters between words
   - **Video** — appended trailer the player ignores
4. **Reveal** — add every carrier + the pass-phrase; a missing carrier or a wrong
   pass-phrase fails safely (GCM authentication), never a silent wrong answer.

Tested end-to-end in a browser: a secret scattered across a picture + song + note,
recovered exactly; missing-carrier refused; wrong pass-phrase rejected.

## Install
From [**Releases**](../../releases):

| Platform | File |
|---|---|
| Android | `Plumage.apk` |
| iOS | `Plumage-iPhone-unsigned.ipa` (sideload-sign with your Apple ID) |
| Windows | `Plumage-Setup-*.exe` |

## Cover library (optional, monthly-refreshed)
`catalog-worker/worker.js` is a Cloudflare Worker that serves a monthly-refreshed
catalog of **free-licensed** cover media (≈50 pictures, 50 songs, 50 texts, 50
videos), re-hosted with CORS so the app's canvas embedding works. Deploy it, bind
a KV namespace as `LIB`, add a monthly cron trigger (`0 0 1 * *`), hit `/refresh`
once, then paste the Worker's `/catalog` URL into Plumage → **Settings → Cover
library URL**. Without it, Plumage uses built-in local covers.

## Build locally
```bash
npm install
# Android:  npx cap add android && npx cap sync android && (cd android && ./gradlew assembleDebug)
# iOS:      npx cap add ios && npx cap sync ios   (open ios/App/App.xcworkspace in Xcode)
# Windows:  npm run dist:win
```
`core/plumage.py` is the reference Python implementation of the same scheme.

## Privacy & legal
On-device only; AES-256 end to end. Plain LSB is detectable by steganalysis —
treat the hiding as concealment and the encryption as the real protection. This
is privacy tooling for your own communications; use it lawfully.

## License
MIT.
