/* PLUMAGE app UI */
(function(){
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const LS='plumage-settings';
  const DEFAULTS={catalogUrl:'',defaults:['image','audio','text'],theme:'dark'};
  let settings=load(); let catalog=null;

  function load(){ try{return Object.assign({},DEFAULTS,JSON.parse(localStorage.getItem(LS)||'{}'));}catch(e){return {...DEFAULTS};} }
  function save(){ try{localStorage.setItem(LS,JSON.stringify(settings));}catch(e){} }
  function applyTheme(){ document.documentElement.setAttribute('data-theme',settings.theme==='light'?'light':''); if(settings.theme!=='light')document.documentElement.removeAttribute('data-theme'); }

  // ---- tabs ----
  $$('.tabs button').forEach(b=>b.onclick=()=>{ $$('.tabs button').forEach(x=>x.classList.toggle('on',x===b));
    ['hide','reveal','settings'].forEach(t=>$('#tab-'+t).style.display=(t===b.dataset.tab)?'':'none'); });

  // ---- carrier chips ----
  function wireChips(sel){ $$(sel+' .chip').forEach(c=>c.onclick=()=>{ c.classList.toggle('on'); if(sel==='#default-chips'){ settings.defaults=$$('#default-chips .chip.on').map(x=>x.dataset.type); } renderUploadCovers(); if(typeof updateSizeHint==='function') updateSizeHint(); }); }
  wireChips('#carrier-chips'); wireChips('#default-chips');
  function chosenTypes(){ return $$('#carrier-chips .chip.on').map(c=>c.dataset.type); }

  // ---- local fallback covers (work with no library) ----
  const SENTENCES=["Thanks for the update, I'll review the notes and reply tomorrow.",
    "Great catching up earlier — let's sync again next week.","Here are the photos from the weekend, hope you like them!",
    "Reminder: the meeting moved to 3pm, same room as before.","All set on my end, let me know if you need anything else."];
  // ---- capacity math (a carrier must hold 4-byte length + shard bytes) ----
  const fmtB=b=> b>=1048576?(b/1048576).toFixed(1)+' MB':b>=1024?(b/1024).toFixed(1)+' KB':Math.max(0,b)+' B';
  const needPixels=bytes=> Math.ceil((4+bytes)*8/3);
  function noiseImageURL(minBytes){ const px=needPixels(minBytes||1)+64; const W=Math.min(4096,Math.max(96,Math.ceil(Math.sqrt(px)))); const H=Math.ceil(px/W)+2;
    const c=document.createElement('canvas'); c.width=W;c.height=H; const ctx=c.getContext('2d'); const id=ctx.createImageData(W,H);
    for(let i=0;i<id.data.length;i+=4){ id.data[i]=Math.random()*255;id.data[i+1]=Math.random()*255;id.data[i+2]=Math.random()*255;id.data[i+3]=255; } ctx.putImageData(id,0,0); return c.toDataURL('image/png'); }
  function toneWavURL(minBytes){ const fs=16000; const n=Math.max(fs*2,(4+(minBytes||1))*8+16000); const buf=new ArrayBuffer(44+n*2); const dv=new DataView(buf);
    const ws=(o,s)=>{for(let i=0;i<s.length;i++)dv.setUint8(o+i,s.charCodeAt(i));};
    ws(0,'RIFF');dv.setUint32(4,36+n*2,true);ws(8,'WAVE');ws(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);dv.setUint32(24,fs,true);dv.setUint32(28,fs*2,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);ws(36,'data');dv.setUint32(40,n*2,true);
    for(let i=0;i<n;i++) dv.setInt16(44+i*2, Math.sin(2*Math.PI*440*i/fs)*8000, true);
    return URL.createObjectURL(new Blob([buf],{type:'audio/wav'})); }
  function randVideoURL(minBytes){ const a=new Uint8Array(Math.max(24000,(minBytes||0)+4096)); crypto.getRandomValues(a); return URL.createObjectURL(new Blob([a],{type:'video/mp4'})); }
  // capacity of an existing cover (bytes it can carry), for uploaded or library covers
  function imageCapacity(url){ return new Promise(res=>{ const im=new Image(); im.crossOrigin='anonymous'; im.onload=()=>res(Math.floor(im.naturalWidth*im.naturalHeight*3/8)-4); im.onerror=()=>res(0); im.src=url; }); }
  async function audioCapacity(url){ try{ const buf=await (await fetch(url)).arrayBuffer(); const dv=new DataView(buf); let o=12,dataLen=0;
    while(o<buf.byteLength){ const id=String.fromCharCode(dv.getUint8(o),dv.getUint8(o+1),dv.getUint8(o+2),dv.getUint8(o+3)); const sz=dv.getUint32(o+4,true); if(id==='data'){dataLen=sz;break;} o+=8+sz+(sz&1);} return Math.floor((dataLen>>1)/8)-4; }catch(e){ return 0; } }

  // ---- upload-your-own covers ----
  function renderUploadCovers(){ const box=$('#upload-covers'); if($('#cover-src').value!=='upload'){ box.style.display='none'; box.innerHTML=''; return; }
    box.style.display=''; box.innerHTML=''; chosenTypes().forEach(t=>{ const row=document.createElement('div'); row.className='row';
      row.innerHTML=`<span class="small muted" style="min-width:66px">${t}</span><input type="file" data-ctype="${t}" ${t==='image'?'accept="image/*"':t==='audio'?'accept="audio/*"':t==='video'?'accept="video/*"':''}>`; box.appendChild(row); }); }
  $('#cover-src').onchange=()=>{ renderUploadCovers(); updateSizeHint(); };
  $('#msg').addEventListener('input', ()=>{ if(typeof updateSizeHint==='function') updateSizeHint(); });

  async function coversFromUploads(types){ const out=[];
    for(const t of types){ const inp=$(`#upload-covers input[data-ctype="${t}"]`); const f=inp&&inp.files[0];
      if(!f) throw new Error('Pick a cover file for: '+t);
      if(t==='text'){ out.push({type:'text',url:await f.text(),name:f.name.replace(/\.\w+$/,'')}); }
      else out.push({type:t,url:URL.createObjectURL(f),name:f.name.replace(/\.\w+$/,'')}); }
    return out; }

  // ---- message wrapper (text or attached file) ----
  let attached=null;
  $('#attach').onchange=e=>{ attached=e.target.files[0]||null; $('#attach-name').textContent=attached?('📎 '+attached.name):''; updateSizeHint(); };
  async function buildMessage(){ const text=$('#msg').value;
    if(attached){ const data=new Uint8Array(await attached.arrayBuffer()); const nm=new TextEncoder().encode(attached.name).slice(0,255);
      const out=new Uint8Array(2+nm.length+data.length); out[0]=1; out[1]=nm.length; out.set(nm,2); out.set(data,2+nm.length); return out; }
    const t=new TextEncoder().encode(text); const out=new Uint8Array(1+t.length); out[0]=0; out.set(t,1); return out; }
  function unwrap(bytes){ if(bytes[0]===1){ const nl=bytes[1]; const name=new TextDecoder().decode(bytes.slice(2,2+nl)); return {file:true,name,data:bytes.slice(2+nl)}; }
    return {file:false,text:new TextDecoder().decode(bytes.slice(1))}; }

  // ---- live size hint (detect required capacity before scattering) ----
  function msgSize(){ if(attached) return attached.size + (new TextEncoder().encode(attached.name).length) + 2; return new TextEncoder().encode($('#msg').value||'').length + 1; }
  function updateSizeHint(){ const h=$('#size-hint'); if(!h) return; const types=chosenTypes(); const n=types.length||1;
    const per=Math.ceil((msgSize()+44)/n)+18;
    h.textContent = (attached?('Attached '+attached.name+' · '):'') + 'message ≈ '+fmtB(msgSize())+' → each of '+n+' carrier'+(n>1?'s':'')+' must hold ≈ '+fmtB(per)+'. Auto covers are sized to fit; uploaded covers are checked first.';
  }

  // ---- scatter ----
  const IC={image:'🖼️',audio:'🎵',text:'📝',video:'🎬'};
  async function chooseCover(t, need){
    // uploaded cover for this type?
    if($('#cover-src').value==='upload'){
      const inp=$(`#upload-covers input[data-ctype="${t}"]`); const f=inp&&inp.files[0];
      if(!f) throw new Error('Pick a cover file for the '+t+' carrier.');
      const nm=f.name.replace(/\.\w+$/,'');
      if(t==='text') return {url:await f.text(), name:nm};
      if(t==='image'){ const url=URL.createObjectURL(f); const cap=await imageCapacity(url);
        if(cap<need) throw new Error(`Picture “${f.name}” holds ~${fmtB(cap)} but this carrier needs ${fmtB(need)}. Choose a larger image (more pixels), add a Video carrier to share the load, or switch Cover source to “Random from library (auto)”.`);
        return {url, name:nm}; }
      if(t==='audio'){ const url=URL.createObjectURL(f); const cap=await audioCapacity(url);
        if(cap<need) throw new Error(`Audio “${f.name}” holds ~${fmtB(cap)} but this carrier needs ${fmtB(need)}. Choose a longer 16-bit WAV, or use auto covers.`);
        return {url, name:nm}; }
      return {url:URL.createObjectURL(f), name:nm};   // video: appended, any size
    }
    // auto: use a library cover if it is big enough, else an auto-sized local cover
    let lib=null, nm=t;
    if(catalog && catalog[t] && catalog[t].length){ const e=catalog[t][Math.floor(Math.random()*catalog[t].length)]; lib=(t==='text')?(e.text||e):(e.url||e); nm=e.name||t; }
    if(t==='image'){ if(lib){ const cap=await imageCapacity(lib); if(cap>=need) return {url:lib,name:nm}; } return {url:noiseImageURL(need),name:'picture'}; }
    if(t==='audio'){ if(lib){ const cap=await audioCapacity(lib); if(cap>=need) return {url:lib,name:nm}; } return {url:toneWavURL(need),name:'audio'}; }
    if(t==='video') return {url:lib||randVideoURL(need), name:lib?nm:'video'};
    return {url:lib||SENTENCES[Math.floor(Math.random()*SENTENCES.length)], name:lib?nm:'note'};
  }
  $('#scatter').onclick=async()=>{
    const out=$('#scatter-out'); out.innerHTML='';
    const pass=$('#pass').value, types=chosenTypes();
    if(!pass){ out.innerHTML='<p class="bad small">Enter a pass-phrase.</p>'; return; }
    if(!types.length){ out.innerHTML='<p class="bad small">Choose at least one carrier.</p>'; return; }
    if(!$('#msg').value && !attached){ out.innerHTML='<p class="bad small">Type a message or attach a file.</p>'; return; }
    $('#scatter').disabled=true; $('#scatter').textContent='Scattering…';
    try{
      const msg=await buildMessage();
      const blob=await STEALTH.encryptMsg(msg, pass);
      const shards=await STEALTH.split(blob, types.length);
      const outs=[];
      for(let i=0;i<types.length;i++){ const t=types[i], sh=shards[i]; const cov=await chooseCover(t, sh.length);
        let b,fn;
        if(t==='image'){ b=await STEALTH.hideImage(sh,cov.url); fn=(cov.name||'picture')+'.png'; }
        else if(t==='audio'){ b=await STEALTH.hideAudio(sh,cov.url); fn=(cov.name||'audio')+'.wav'; }
        else if(t==='video'){ b=await STEALTH.hideVideo(sh,cov.url); fn=(cov.name||'video')+'.mp4'; }
        else { b=new Blob([STEALTH.hideText(sh,cov.url)],{type:'text/plain'}); fn=(cov.name||'note')+'.txt'; }
        outs.push({type:t,blob:b,filename:fn}); }
      out.innerHTML='<p class="small ok">Done — send ALL '+outs.length+' files to your recipient (any channel). They need every one + the pass-phrase.</p>';
      outs.forEach(o=>{ const url=URL.createObjectURL(o.blob); const div=document.createElement('div'); div.className='carrier';
        div.innerHTML=`<span class="ic">${IC[o.type]}</span><span class="nm">${o.filename} <span class="muted small">(${fmtB(o.blob.size)})</span></span>`;
        const a=document.createElement('a'); a.href=url; a.download=o.filename; a.className='btn sm'; a.textContent='Download'; div.appendChild(a); out.appendChild(div); });
    }catch(e){ out.innerHTML='<p class="bad small">'+e.message+'</p>'; }
    $('#scatter').disabled=false; $('#scatter').textContent='🪶 Scatter into carriers';
  };

  // ---- reveal ----
  function typeOf(name){ const n=name.toLowerCase(); if(/\.(png|bmp|gif)$/.test(n))return 'image'; if(/\.(wav)$/.test(n))return 'audio'; if(/\.(txt)$/.test(n))return 'text'; return 'video'; }
  $('#reveal-files').onchange=()=>{ const list=$('#reveal-list'); list.innerHTML=''; [...$('#reveal-files').files].forEach(f=>{ const d=document.createElement('div'); d.className='small muted'; d.textContent='• '+f.name+' ('+typeOf(f.name)+')'; list.appendChild(d); }); };
  $('#reveal').onclick=async()=>{
    const out=$('#reveal-out'); out.innerHTML=''; const files=[...$('#reveal-files').files]; const pass=$('#reveal-pass').value;
    if(!files.length){ out.innerHTML='<p class="bad small">Add the carrier files.</p>'; return; }
    if(!pass){ out.innerHTML='<p class="bad small">Enter the pass-phrase.</p>'; return; }
    try{
      $('#reveal').textContent='Revealing…'; $('#reveal').disabled=true;
      const carriers=files.map(f=>({type:typeOf(f.name),file:f}));
      const bytes=await STEALTH.gather(carriers, pass);
      $('#reveal').textContent='🔓 Reveal message'; $('#reveal').disabled=false;
      const m=unwrap(bytes);
      if(m.file){ const url=URL.createObjectURL(new Blob([m.data])); out.innerHTML='<p class="small ok">Recovered a file:</p>';
        const a=document.createElement('a'); a.href=url; a.download=m.name; a.className='btn go sm'; a.textContent='⬇ '+m.name; out.appendChild(a); }
      else { out.innerHTML='<p class="small ok">Recovered message:</p><div class="out">'+m.text.replace(/</g,'&lt;')+'</div>'; }
    }catch(e){ $('#reveal').textContent='🔓 Reveal message'; $('#reveal').disabled=false;
      out.innerHTML='<p class="bad small">Could not reveal: '+e.message+' — check you added every carrier and the right pass-phrase.</p>'; }
  };

  // ---- catalog / library ----
  async function loadCatalog(url){ if(!url) { catalog=null; $('#lib-state').textContent='built-in local covers'; return; }
    try{ const r=await fetch(url,{cache:'no-store'}); const j=await r.json();
      catalog={image:j.image||[],audio:j.audio||[],text:j.text||[],video:j.video||[]};
      $('#lib-state').textContent='library: '+['image','audio','text','video'].map(t=>`${(catalog[t]||[]).length} ${t}`).join(', ');
    }catch(e){ catalog=null; $('#lib-state').textContent='library unreachable — using local covers'; } }
  $('#refresh-lib').onclick=()=>loadCatalog($('#catalog-url').value.trim());

  // ---- settings ----
  function applySettings(){ applyTheme();
    $('#catalog-url').value=settings.catalogUrl||''; $('#theme').value=settings.theme||'dark';
    $$('#default-chips .chip').forEach(c=>c.classList.toggle('on',settings.defaults.includes(c.dataset.type)));
    $$('#carrier-chips .chip').forEach(c=>c.classList.toggle('on',settings.defaults.includes(c.dataset.type)));
  }
  $('#save-settings').onclick=()=>{ settings.catalogUrl=$('#catalog-url').value.trim(); settings.theme=$('#theme').value;
    settings.defaults=$$('#default-chips .chip.on').map(c=>c.dataset.type); save(); applyTheme();
    $('#settings-msg').textContent='Saved ✓'; setTimeout(()=>$('#settings-msg').textContent='',1500); loadCatalog(settings.catalogUrl); };

  applySettings(); loadCatalog(settings.catalogUrl); renderUploadCovers(); updateSizeHint();
})();
