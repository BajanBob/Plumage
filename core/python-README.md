# 🪶 PLUMAGE — encrypt-then-scatter steganographic transport

Carry a private message — chat, a voice clip, a small video, any bytes — by
**encrypting it, splitting it into shards, and hiding each shard inside an
ordinary-looking carrier**: a picture, a song, or a block of text. The message
rebuilds only from **all the carriers + the pass-phrase**.

Like a carrier pigeon that hid its note in its feathers — hence the name.

## Why it's more than stego or encryption alone
- **AES-256-GCM** hides and authenticates the *content* (scrypt-derived key).
- **Scattering** hides the *existence* and removes the single point of capture:
  intercept one carrier and you get an innocent song holding a meaningless shard.
- **GCM** fails loudly on a wrong pass-phrase or a flipped bit — never a silent
  wrong answer.

## What's in the prototype (`plumage.py`, all tested)
| Carrier | Method | Status |
|---|---|---|
| Picture (PNG) | least-significant-bit, ≤1 LSB change (invisible) | ✅ |
| Song / audio (WAV) | LSB of PCM samples | ✅ |
| Text | zero-width characters between words (invisible) | ✅ |

Verified end-to-end: a 352-byte secret scattered across a photo + a 3 s song +
a one-line note, recovered exactly from all three; a **missing carrier is
refused**; a **wrong pass-phrase is rejected** by GCM; the image changes by at
most one LSB (mean 0.003).

```python
import plumage as P
P.scatter(b"meet at 21:00", "my pass-phrase",
          [("image","cat.png","out.png"),
           ("audio","song.wav","out.wav"),
           ("text","note.txt","out.txt")])
msg = P.gather([("image","out.png"),("audio","out.wav"),("text","out.txt")], "my pass-phrase")
```

## Honest limits / roadmap
Plain LSB is **detectable by steganalysis** (statistical LSB tests). For an
adversarial setting the embedding should move to:
- **±1 / adaptive embedding** and **DCT-domain** hiding for JPEG (survives
  recompression, resists first-order steganalysis),
- **spread-spectrum** audio embedding (survives transcoding),
- **video**: per-frame DCT embedding, and k-of-n erasure coding so the message
  survives losing some carriers,
- **k-of-n secret sharing** so you need any *k* of *n* carriers, not all.

This is privacy tooling for your own communications — a sealed, split letter.
Use it lawfully.
