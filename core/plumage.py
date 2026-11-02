#!/usr/bin/env python3
"""
PLUMAGE — encrypt-then-scatter steganographic transport
=======================================================
Carry a private message (chat text, a voice clip, a small video — any bytes)
by (1) encrypting it, (2) splitting the ciphertext into shards, and (3) hiding
each shard inside an ordinary-looking carrier: a picture, an audio/song file, or
a block of text. No single carrier reveals anything; the message is rebuilt only
from ALL the carriers plus the pass-phrase.

Why this is stronger than plain steganography or plain encryption:
  * Encryption (AES-256-GCM) hides the *content* and authenticates it.
  * Scattering hides the *existence* AND removes the single point of capture —
    intercept one carrier and you get an innocuous song with a meaningless shard.
  * GCM means a flipped bit or a wrong pass-phrase fails loudly, never silently.

Carriers implemented here: PNG image (LSB), WAV audio (LSB), text (zero-width
characters). The same idea extends to video (frame LSB) and larger media.

This is privacy tech for your own communications — like a sealed, split letter.
"""
import os, io, struct, wave, hashlib
import numpy as np
from PIL import Image
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

MAGIC = b"PLM1"

# ---- key / crypto ---------------------------------------------------------------
def derive_key(passphrase: str, salt: bytes) -> bytes:
    return Scrypt(salt=salt, length=32, n=2**15, r=8, p=1).derive(passphrase.encode())

def encrypt(data: bytes, passphrase: str) -> bytes:
    salt = os.urandom(16); key = derive_key(passphrase, salt)
    nonce = os.urandom(12); ct = AESGCM(key).encrypt(nonce, data, None)
    return salt + nonce + ct                       # self-contained blob

def decrypt(blob: bytes, passphrase: str) -> bytes:
    salt, nonce, ct = blob[:16], blob[16:28], blob[28:]
    key = derive_key(passphrase, salt)
    return AESGCM(key).decrypt(nonce, ct, None)    # raises on wrong key / tamper

# ---- shard container ------------------------------------------------------------
# header: MAGIC(4) msgid(4) idx(1) total(1) shard_len(4) total_len(4)
def _msgid(blob): return hashlib.sha256(blob).digest()[:4]
def split(blob: bytes, n: int):
    mid = _msgid(blob); L = len(blob); step = (L + n - 1) // n; out = []
    for i in range(n):
        chunk = blob[i*step:(i+1)*step]
        hdr = MAGIC + mid + struct.pack(">BBII", i, n, len(chunk), L)
        out.append(hdr + chunk)
    return out
def reassemble(shards: list) -> bytes:
    parts = {}; total = None; mid = None; L = None
    for s in shards:
        if s[:4] != MAGIC: continue
        m = s[4:8]; idx, tot, slen, tlen = struct.unpack(">BBII", s[8:18])
        if mid is None: mid, total, L = m, tot, tlen
        if m != mid: raise ValueError("shards are from different messages")
        parts[idx] = s[18:18+slen]
    if total is None or len(parts) != total:
        raise ValueError(f"need all {total} carriers (have {len(parts)})")
    return b"".join(parts[i] for i in range(total))

# ---- bit helpers ----------------------------------------------------------------
def _to_bits(b):  return np.unpackbits(np.frombuffer(b, dtype=np.uint8))
def _from_bits(bits):
    bits = np.asarray(bits, dtype=np.uint8)
    bits = bits[:len(bits) - (len(bits) % 8)]
    return np.packbits(bits).tobytes()

# ---- carrier: PNG image (LSB) ---------------------------------------------------
def hide_image(payload, cover_path, out_path):
    im = Image.open(cover_path).convert("RGB"); a = np.array(im); flat = a.reshape(-1)
    framed = struct.pack(">I", len(payload)) + payload
    bits = _to_bits(framed)
    if len(bits) > len(flat): raise ValueError("image carrier too small")
    flat[:len(bits)] = (flat[:len(bits)] & 0xFE) | bits
    Image.fromarray(flat.reshape(a.shape)).save(out_path)   # PNG = lossless
    return out_path
def seek_image(path):
    flat = np.array(Image.open(path).convert("RGB")).reshape(-1)
    L = struct.unpack(">I", _from_bits(flat[:32] & 1))[0]
    return _from_bits(flat[32:32 + L*8] & 1)

# ---- carrier: WAV audio/song (LSB) ---------------------------------------------
def hide_audio(payload, cover_wav, out_wav):
    with wave.open(cover_wav, "rb") as w:
        p = w.getparams(); frames = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").copy()
    framed = struct.pack(">I", len(payload)) + payload; bits = _to_bits(framed)
    if len(bits) > len(frames): raise ValueError("audio carrier too small")
    frames[:len(bits)] = (frames[:len(bits)] & ~1) | bits
    with wave.open(out_wav, "wb") as w:
        w.setparams(p); w.writeframes(frames.tobytes())
    return out_wav
def seek_audio(path):
    with wave.open(path, "rb") as w:
        frames = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    L = struct.unpack(">I", _from_bits(frames[:32] & 1))[0]
    return _from_bits(frames[32:32 + L*8] & 1)

# ---- carrier: text (zero-width characters) -------------------------------------
ZW0, ZW1 = "​", "‌"     # zero-width space / non-joiner
def hide_text(payload, cover_text):
    framed = struct.pack(">I", len(payload)) + payload
    hidden = "".join(ZW1 if b else ZW0 for b in _to_bits(framed))
    sp = cover_text.find(" ")
    return cover_text if False else (cover_text[:sp+1] + hidden + cover_text[sp+1:]) if sp >= 0 else cover_text + hidden
def seek_text(s):
    bits = np.array([1 if c == ZW1 else 0 for c in s if c in (ZW0, ZW1)], dtype=np.uint8)
    L = struct.unpack(">I", _from_bits(bits[:32]))[0]
    return _from_bits(bits[32:32 + L*8])

# ---- high level -----------------------------------------------------------------
# carriers: list of (kind, cover, out) where kind in image|audio|text
def scatter(message: bytes, passphrase: str, carriers: list):
    blob = encrypt(message, passphrase)
    shards = split(blob, len(carriers)); results = []
    for shard, (kind, cover, out) in zip(shards, carriers):
        if kind == "image": results.append(("image", hide_image(shard, cover, out)))
        elif kind == "audio": results.append(("audio", hide_audio(shard, cover, out)))
        elif kind == "text":
            cover_text = open(cover, encoding="utf-8").read() if os.path.exists(cover) else cover
            txt = hide_text(shard, cover_text); open(out, "w", encoding="utf-8").write(txt); results.append(("text", out))
        else: raise ValueError("unknown carrier kind: " + kind)
    return results
def gather(carriers: list, passphrase: str) -> bytes:
    shards = []
    for kind, path in carriers:
        if kind == "image": shards.append(seek_image(path))
        elif kind == "audio": shards.append(seek_audio(path))
        elif kind == "text": shards.append(seek_text(open(path, encoding="utf-8").read()))
    return decrypt(reassemble(shards), passphrase)
