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
  function wireChips(sel){ $$(sel+' .chip').forEach(c=>c.onclick=()=>{ c.classList.toggle('on'); if(sel==='#default-chips'){ settings.defaults=$$('#default-chips .chip.on').map(x=>x.dataset.type); } renderUploadCovers(); }); }
  wireChips('#carrier-chips'); wireChips('#default-chips');
  function chosenTypes(){ return $$('#carrier-chips .chip.on').map(c=>c.dataset.type); }

  // ---- local fallback covers (work with no library) ----
  const SENTENCES=["Thanks for the update, I'll review the notes and reply tomorrow.",
    "Great catching up earlier — let's sync again next week.","Here are the photos from the weekend, hope you like them!",
    "Reminder: the meeting moved to 3pm, same room as before.","All set on my end, let me know if you need anything else."];
  function noiseImageURL(){ const c=document.createElement('canvas'); c.width=320;c.height=240; const ctx=c.getContext('2d');
    const id=ctx.createImageData(320,240); for(let i=0;i<id.data.length;i+=4){ id.data[i]=Math.random()*255;id.data[i+1]=Math.random()*255;id.data[i+2]=Math.random()*255;id.data[i+3]=255; } ctx.putImageData(id,0,0); return c.toDataURL('image/png'); }
  function toneWavURL(){ const fs=16000,sec=2,n=fs*sec; const buf=new ArrayBuffer(44+n*2); const dv=new DataView(buf);
    const ws=(o,s)=>{for(let i=0;i<s.length;i++)dv.setUint8(o+i,s.charCodeAt(i));};
    ws(0,'RIFF');dv.setUint32(4,36+n*2,true);ws(8,'WAVE');ws(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);dv.setUint32(24,fs,true);dv.setUint32(28,fs*2,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);ws(36,'data');dv.setUint32(40,n*2,true);
    for(let i=0;i<n;i++) dv.setInt16(44+i*2, Math.sin(2*Math.PI*440*i/fs)*8000, true);
    return URL.createObjectURL(new Blob([buf],{type:'audio/wav'})); }
  function randVideoURL(){ const a=new Uint8Array(24000); crypto.getRandomValues(a); return URL.createObjectURL(new Blob([a],{type:'video/mp4'})); }
  function pickCover(type){
    if(catalog && catalog[type] && catalog[type].length){ const e=catalog[type][Math.floor(Math.random()*catalog[type].length)];
      return {type, url:(type==='text'?(e.text||e):e.url||e), name:e.name||type}; }
    if(type==='image') return {type,url:noiseImageURL(),name:'picture'};
    if(type==='audio') return {type,url:toneWavURL(),name:'audio'};
    if(type==='video') return {type,url:randVideoURL(),name:'video'};
    return {type,url:SENTENCES[Math.floor(Math.random()*SENTENCES.length)],name:'note'};
  }

  // ---- upload-your-own covers ----
  function renderUploadCovers(){ const box=$('#upload-covers'); if($('#cover-src').value!=='upload'){ box.style.display='none'; box.innerHTML=''; return; }
    box.style.display=''; box.innerHTML=''; chosenTypes().forEach(t=>{ const row=document.createElement('div'); row.className='row';
      row.innerHTML=`<span class="small muted" style="min-width:66px">${t}</span><input type="file" data-ctype="${t}" ${t==='image'?'accept="image/*"':t==='audio'?'accept="audio/*"':t==='video'?'accept="video/*"':''}>`; box.appendChild(row); }); }
  $('#cover-src').onchange=renderUploadCovers;

  async function coversFromUploads(types){ const out=[];
    for(const t of types){ const inp=$(`#upload-covers input[data-ctype="${t}"]`); const f=inp&&inp.files[0];
      if(!f) throw new Error('Pick a cover file for: '+t);
      if(t==='text'){ out.push({type:'text',url:await f.text(),name:f.name.replace(/\.\w+$/,'')}); }
      else out.push({type:t,url:URL.createObjectURL(f),name:f.name.replace(/\.\w+$/,'')}); }
    return out; }

  // ---- message wrapper (text or attached file) ----
  let attached=null;
  $('#attach').onchange=e=>{ attached=e.target.files[0]||null; $('#attach-name').textContent=attached?('📎 '+attached.name):''; };
  async function buildMessage(){ const text=$('#msg').value;
    if(attached){ const data=new Uint8Array(await attached.arrayBuffer()); const nm=new TextEncoder().encode(attached.name).slice(0,255);
      const out=new Uint8Array(2+nm.length+data.length); out[0]=1; out[1]=nm.length; out.set(nm,2); out.set(data,2+nm.length); return out; }
    const t=new TextEncoder().encode(text); const out=new Uint8Array(1+t.length); out[0]=0; out.set(t,1); return out; }
  function unwrap(bytes){ if(bytes[0]===1){ const nl=bytes[1]; const name=new TextDecoder().decode(bytes.slice(2,2+nl)); return {file:true,name,data:bytes.slice(2+nl)}; }
    return {file:false,text:new TextDecoder().decode(bytes.slice(1))}; }

  // ---- scatter ----
  $('#scatter').onclick=async()=>{
    const out=$('#scatter-out'); out.innerHTML='';
    const pass=$('#pass').value; const types=chosenTypes();
    if(!pass){ out.innerHTML='<p class="bad small">Enter a pass-phrase.</p>'; return; }
    if(!types.length){ out.innerHTML='<p class="bad small">Choose at least one carrier.</p>'; return; }
    if(!$('#msg').value && !attached){ out.innerHTML='<p class="bad small">Type a message or attach a file.</p>'; return; }
    try{
      const msg=await buildMessage();
      const covers = $('#cover-src').value==='upload' ? await coversFromUploads(types) : types.map(pickCover);
      $('#scatter').textContent='Scattering…'; $('#scatter').disabled=true;
      const outs=await STEALTH.scatter(msg, pass, covers);
      $('#scatter').textContent='🪶 Scatter into carriers'; $('#scatter').disabled=false;
      const ic={image:'🖼️',audio:'🎵',text:'📝',video:'🎬'};
      out.innerHTML='<p class="small ok">Done — send ALL '+outs.length+' files to your recipient (any channel). They need every one + the pass-phrase.</p>';
      outs.forEach(o=>{ const url=URL.createObjectURL(o.blob); const div=document.createElement('div'); div.className='carrier';
        div.innerHTML=`<span class="ic">${ic[o.type]}</span><span class="nm">${o.filename} <span class="muted small">(${(o.blob.size/1024).toFixed(1)} KB)</span></span>`;
        const a=document.createElement('a'); a.href=url; a.download=o.filename; a.className='btn sm'; a.textContent='Download'; div.appendChild(a); out.appendChild(div); });
    }catch(e){ $('#scatter').textContent='🪶 Scatter into carriers'; $('#scatter').disabled=false; out.innerHTML='<p class="bad small">'+e.message+'</p>'; }
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

  applySettings(); loadCatalog(settings.catalogUrl); renderUploadCovers();
})();
