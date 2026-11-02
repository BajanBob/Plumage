/* PLUMAGE Stealth engine (browser) — encrypt-then-scatter steganography.
   Encrypts a message (AES-256-GCM, PBKDF2 key from a passphrase), splits the
   ciphertext into shards, and hides each shard inside a cover carrier:
     image  -> least-significant-bit of RGB (PNG, lossless, invisible)
     audio  -> LSB of 16-bit PCM WAV samples
     text   -> zero-width characters between words
     video  -> appended trailer after the file's end (players ignore it)
   Rebuilds only from ALL carriers + the passphrase. Clear, self-contained. */
(function(){
  const MAGIC = new Uint8Array([0x50,0x4C,0x4D,0x31]); // "PLM1"
  const enc = new TextEncoder(), dec = new TextDecoder();

  // ---- crypto ----
  async function deriveKey(pass, salt){
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:200000, hash:'SHA-256'},
      base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
  }
  async function encryptMsg(bytes, pass){
    const salt=crypto.getRandomValues(new Uint8Array(16)), iv=crypto.getRandomValues(new Uint8Array(12));
    const key=await deriveKey(pass, salt);
    const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv}, key, bytes));
    const out=new Uint8Array(16+12+ct.length); out.set(salt); out.set(iv,16); out.set(ct,28); return out;
  }
  async function decryptMsg(blob, pass){
    const salt=blob.slice(0,16), iv=blob.slice(16,28), ct=blob.slice(28);
    const key=await deriveKey(pass, salt);
    return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv}, key, ct));
  }

  // ---- shards ----
  async function msgid(blob){ const h=new Uint8Array(await crypto.subtle.digest('SHA-256', blob)); return h.slice(0,4); }
  function u32(n){ return new Uint8Array([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]); }
  function rd32(a,o){ return (a[o]<<24)|(a[o+1]<<16)|(a[o+2]<<8)|a[o+3]; }
  async function split(blob, n){
    const mid=await msgid(blob), L=blob.length, step=Math.ceil(L/n), out=[];
    for(let i=0;i<n;i++){ const chunk=blob.slice(i*step,(i+1)*step);
      const hdr=new Uint8Array(18); hdr.set(MAGIC); hdr.set(mid,4); hdr[8]=i; hdr[9]=n;
      hdr.set(u32(chunk.length),10); hdr.set(u32(L),14);
      const s=new Uint8Array(18+chunk.length); s.set(hdr); s.set(chunk,18); out.push(s); }
    return out;
  }
  function reassemble(shards){
    let mid=null,total=null; const parts={};
    for(const s of shards){ if(!(s[0]==0x50&&s[1]==0x4C&&s[2]==0x4D&&s[3]==0x31)) continue;
      const m=s.slice(4,8), idx=s[8], tot=s[9], slen=rd32(s,10);
      if(mid===null){mid=m; total=tot;} parts[idx]=s.slice(18,18+slen); }
    if(total===null || Object.keys(parts).length!==total) throw new Error('Need all '+total+' carriers.');
    let len=0; for(let i=0;i<total;i++) len+=parts[i].length;
    const out=new Uint8Array(len); let o=0; for(let i=0;i<total;i++){ out.set(parts[i],o); o+=parts[i].length; }
    return out;
  }

  // ---- bit helpers ----
  function toBits(bytes){ const b=new Uint8Array(bytes.length*8); for(let i=0;i<bytes.length;i++) for(let j=0;j<8;j++) b[i*8+j]=(bytes[i]>>(7-j))&1; return b; }
  function fromBits(bits){ const n=bits.length>>3, out=new Uint8Array(n); for(let i=0;i<n;i++){ let v=0; for(let j=0;j<8;j++) v=(v<<1)|bits[i*8+j]; out[i]=v; } return out; }
  function framed(payload){ const f=new Uint8Array(4+payload.length); f.set(u32(payload.length)); f.set(payload,4); return f; }

  // ---- image carrier (canvas LSB) ----
  function loadImage(src){ return new Promise((res,rej)=>{ const im=new Image(); im.crossOrigin='anonymous'; im.onload=()=>res(im); im.onerror=rej; im.src=src; }); }
  async function hideImage(payload, coverURL){
    const im=await loadImage(coverURL); const c=document.createElement('canvas'); c.width=im.naturalWidth||im.width; c.height=im.naturalHeight||im.height;
    const ctx=c.getContext('2d'); ctx.drawImage(im,0,0); const id=ctx.getImageData(0,0,c.width,c.height); const px=id.data;
    const bits=toBits(framed(payload)); const cap=c.width*c.height*3;
    if(bits.length>cap) throw new Error('Picture carrier too small for this message.');
    let bi=0; for(let p=0; p<px.length && bi<bits.length; p+=4){ for(let ch=0;ch<3 && bi<bits.length;ch++){ px[p+ch]=(px[p+ch]&0xFE)|bits[bi++]; } px[p+3]=255; }
    ctx.putImageData(id,0,0); return await new Promise(r=>c.toBlob(r,'image/png'));
  }
  async function seekImage(fileOrURL){
    const url = (fileOrURL instanceof Blob)?URL.createObjectURL(fileOrURL):fileOrURL;
    const im=await loadImage(url); const c=document.createElement('canvas'); c.width=im.naturalWidth; c.height=im.naturalHeight;
    const ctx=c.getContext('2d'); ctx.drawImage(im,0,0); const px=ctx.getImageData(0,0,c.width,c.height).data;
    const grab=(count)=>{ const bits=new Uint8Array(count); let bi=0; for(let p=0;p<px.length && bi<count;p+=4){ for(let ch=0;ch<3 && bi<count;ch++) bits[bi++]=px[p+ch]&1; } return bits; };
    const L=rd32(fromBits(grab(32)),0); return fromBits(grab(32+L*8)).slice(4);
  }

  // ---- text carrier (zero-width) ----
  const ZW0='​', ZW1='‌';
  function hideText(payload, coverText){ const bits=toBits(framed(payload)); let z=''; for(const b of bits) z+= b?ZW1:ZW0;
    const sp=coverText.indexOf(' '); return sp>=0 ? coverText.slice(0,sp+1)+z+coverText.slice(sp+1) : coverText+z; }
  function seekText(s){ const zs=[]; for(const ch of s){ if(ch===ZW0)zs.push(0); else if(ch===ZW1)zs.push(1); }
    const bits=Uint8Array.from(zs); const L=rd32(fromBits(bits.slice(0,32)),0); return fromBits(bits.slice(32,32+L*8)); }

  // ---- audio carrier (WAV 16-bit PCM LSB) ----
  function parseWav(buf){ const dv=new DataView(buf); let o=12; let dataOff=-1,dataLen=0;
    while(o<buf.byteLength){ const id=String.fromCharCode(dv.getUint8(o),dv.getUint8(o+1),dv.getUint8(o+2),dv.getUint8(o+3)); const sz=dv.getUint32(o+4,true);
      if(id==='data'){ dataOff=o+8; dataLen=sz; break; } o+=8+sz+(sz&1); } return {dataOff,dataLen}; }
  async function hideAudio(payload, coverURL){
    const buf=await (await fetch(coverURL)).arrayBuffer(); const {dataOff,dataLen}=parseWav(buf);
    if(dataOff<0) throw new Error('Audio cover must be a 16-bit PCM WAV.');
    const out=buf.slice(0); const s16=new Int16Array(out, dataOff, dataLen>>1);
    const bits=toBits(framed(payload)); if(bits.length>s16.length) throw new Error('Audio carrier too small.');
    for(let i=0;i<bits.length;i++) s16[i]=(s16[i]&~1)|bits[i]; return new Blob([out],{type:'audio/wav'});
  }
  async function seekAudio(fileOrURL){
    const buf = (fileOrURL instanceof Blob)? await fileOrURL.arrayBuffer() : await (await fetch(fileOrURL)).arrayBuffer();
    const {dataOff}=parseWav(buf); const s16=new Int16Array(buf, dataOff, (buf.byteLength-dataOff)>>1);
    const grab=(n)=>{ const b=new Uint8Array(n); for(let i=0;i<n;i++) b[i]=s16[i]&1; return b; };
    const L=rd32(fromBits(grab(32)),0); return fromBits(grab(32+L*8)).slice(4);
  }

  // ---- video/binary carrier: [cover][shard][len u32][FOOTER] read from the fixed end ----
  const FOOT = new Uint8Array([0x50,0x4C,0x4D,0x7E]); // "PLM~" — distinct from the shard MAGIC
  async function hideVideo(payload, coverURL){
    const buf=new Uint8Array(await (await fetch(coverURL)).arrayBuffer());
    const out=new Uint8Array(buf.length+payload.length+8); out.set(buf); out.set(payload,buf.length);
    out.set(u32(payload.length), buf.length+payload.length); out.set(FOOT, buf.length+payload.length+4);
    return new Blob([out],{type:'video/mp4'});
  }
  async function seekVideo(fileOrURL){
    const buf=new Uint8Array((fileOrURL instanceof Blob)? await fileOrURL.arrayBuffer() : await (await fetch(fileOrURL)).arrayBuffer());
    const n=buf.length; if(!(buf[n-4]==0x50&&buf[n-3]==0x4C&&buf[n-2]==0x4D&&buf[n-1]==0x7E)) throw new Error('No hidden data found in this file.');
    const L=rd32(buf,n-8); return buf.slice(n-8-L, n-8);
  }

  // ---- high level ----
  // covers: [{type:'image'|'audio'|'text'|'video', url, name}]  (random from catalog)
  async function scatter(messageBytes, passphrase, covers){
    const blob=await encryptMsg(messageBytes, passphrase); const shards=await split(blob, covers.length); const outs=[];
    for(let i=0;i<covers.length;i++){ const c=covers[i], sh=shards[i]; let out,fn;
      if(c.type==='image'){ out=await hideImage(sh,c.url); fn=(c.name||'image')+'.png'; }
      else if(c.type==='audio'){ out=await hideAudio(sh,c.url); fn=(c.name||'audio')+'.wav'; }
      else if(c.type==='video'){ out=await hideVideo(sh,c.url); fn=(c.name||'video')+'.mp4'; }
      else if(c.type==='text'){ const t=hideText(sh, c.url); out=new Blob([t],{type:'text/plain'}); fn=(c.name||'note')+'.txt'; }
      outs.push({type:c.type, blob:out, filename:fn}); }
    return outs;
  }
  async function gather(carriers, passphrase){
    const shards=[];
    for(const c of carriers){ if(c.type==='image')shards.push(await seekImage(c.file));
      else if(c.type==='audio')shards.push(await seekAudio(c.file));
      else if(c.type==='video')shards.push(await seekVideo(c.file));
      else if(c.type==='text')shards.push(seekText(await c.file.text())); }
    return await decryptMsg(reassemble(shards), passphrase);
  }
  window.STEALTH={scatter,gather,encryptMsg,decryptMsg,split,reassemble,
    hideImage,seekImage,hideText,seekText,hideAudio,seekAudio,hideVideo,seekVideo,
    utf8:(s)=>enc.encode(s), fromUtf8:(b)=>dec.decode(b)};
})();
