/*
  Plumage cover-library Worker (Cloudflare)
  -----------------------------------------
  Serves a monthly-refreshed catalog of innocent, free-licensed COVER media that
  the Plumage app randomly picks from: ~50 pictures, ~50 songs, ~50 texts, ~50
  videos. It RE-HOSTS the media itself (same-origin, CORS *) so the app's canvas
  LSB embedding is never blocked by a tainted cross-origin image.

  Sources (all free / openly licensed):
    - images & audio: Openverse API (CC0 / public-domain filter)
    - video: Wikimedia Commons (public-domain / CC video files)
    - text: a built-in pool of innocuous sentences (no external call)

  Bindings:  KV namespace  LIB
  Routes:
    GET /catalog        -> { image:[{url,name}], audio:[...], text:[{text,name}], video:[...] }
    GET /m/<id>         -> the cached media bytes (CORS *)
  Cron (monthly) refreshes the cache. You can also hit /refresh?key=... manually.
*/
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,OPTIONS" };
const PER = 50;
const SENTENCES = [
  "Thanks for the update, I'll review the notes and reply tomorrow.",
  "Great catching up earlier — let's sync again next week.",
  "Here are the photos from the weekend, hope you like them!",
  "Reminder: the meeting moved to 3pm, same room as before.",
  "All set on my end, let me know if you need anything else.",
  "Just landed, grabbing a coffee then heading over.",
  "The report looks good — a couple of small comments inline.",
  "Happy birthday! Hope you have a wonderful day.",
  "Let's confirm numbers on Friday once the figures are in.",
  "Weather looks clear for the hike this weekend."
];

const json = (o, s=200) => new Response(JSON.stringify(o), { status:s, headers:{ "content-type":"application/json", ...CORS }});

async function openverse(kind, env) {
  // kind: 'images' | 'audio'
  const url = `https://api.openverse.org/v1/${kind}/?license=cc0,pdm&page_size=${PER}&mature=false&q=nature`;
  const r = await fetch(url, { headers: { "User-Agent": "Plumage/1.0 (cover library)" } });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.results || []).map(x => ({ src: x.url, name: (x.title||kind).slice(0,40) })).filter(x => x.src);
}
async function wikimediaVideos() {
  const url = "https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search" +
              "&gsrsearch=filetype:video&gsrnamespace=6&gsrlimit=" + PER +
              "&prop=imageinfo&iiprop=url&origin=*";
  const r = await fetch(url, { headers: { "User-Agent": "Plumage/1.0" } });
  if (!r.ok) return [];
  const j = await r.json(); const pages = (j.query && j.query.pages) || {};
  return Object.values(pages).map(p => ({ src: p.imageinfo && p.imageinfo[0] && p.imageinfo[0].url, name: (p.title||"video").replace(/^File:/,"").slice(0,40) })).filter(x => x.src);
}

async function cacheMedia(list, kind, env) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    try {
      const resp = await fetch(list[i].src);
      if (!resp.ok) continue;
      const buf = new Uint8Array(await resp.arrayBuffer());
      if (buf.length > 20 * 1024 * 1024) continue;              // KV value cap safety
      const id = `${kind}_${i}`;
      await env.LIB.put(`m:${id}`, buf, { metadata: { ct: resp.headers.get("content-type") || "application/octet-stream" } });
      out.push({ id, name: list[i].name });
    } catch (e) {}
  }
  return out;
}

async function refresh(env, origin) {
  const [imgs, auds, vids] = await Promise.all([ openverse("images", env), openverse("audio", env), wikimediaVideos() ]);
  const image = await cacheMedia(imgs, "img", env);
  const audio = await cacheMedia(auds, "aud", env);
  const video = await cacheMedia(vids, "vid", env);
  const catalog = {
    image: image.map(x => ({ url: `${origin}/m/${x.id}`, name: x.name })),
    audio: audio.map(x => ({ url: `${origin}/m/${x.id}`, name: x.name })),
    video: video.map(x => ({ url: `${origin}/m/${x.id}`, name: x.name })),
    text:  SENTENCES.map((s, i) => ({ text: s, name: "note" + i })),
    updated: new Date().toISOString()
  };
  await env.LIB.put("catalog", JSON.stringify(catalog));
  return catalog;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (url.pathname === "/catalog") {
      const c = await env.LIB.get("catalog");
      return c ? new Response(c, { headers: { "content-type":"application/json", ...CORS } })
               : json({ image:[], audio:[], text: SENTENCES.map((s,i)=>({text:s,name:"note"+i})), video:[], note:"empty — run /refresh" });
    }
    const m = url.pathname.match(/^\/m\/([a-z]+_\d+)$/);
    if (m) {
      const { value, metadata } = await env.LIB.getWithMetadata(`m:${m[1]}`, { type:"arrayBuffer" });
      if (!value) return new Response("not found", { status:404, headers: CORS });
      return new Response(value, { headers: { "content-type": (metadata&&metadata.ct)||"application/octet-stream", ...CORS } });
    }
    if (url.pathname === "/refresh") {
      const c = await refresh(env, url.origin);
      return json({ ok:true, counts:{ image:c.image.length, audio:c.audio.length, video:c.video.length, text:c.text.length } });
    }
    return json({ error:"not found" }, 404);
  },
  async scheduled(event, env, ctx) {           // monthly cron
    ctx.waitUntil(refresh(env, "https://plumage-catalog.workers.dev"));
  }
};
