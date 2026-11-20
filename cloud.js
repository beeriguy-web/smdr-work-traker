/* ==========================================================================
   cloud.js – שמירת המעקבים בגוגל שיט (משותף לכל המכשירים)
   Each tracker keeps working from its local copy (localStorage / IndexedDB) and
   this module keeps that copy in sync with the tracker's tab in the contacts
   Google Sheet (Apps Script, see apps-script/Code.gs):
     • pull  GET  ?type=trk&name=<name>          → [{id, updated, deleted, data}]
     • push  POST {type:'trk', name, recs:[...]}  (newest "updated" wins on the sheet)
   Change detection is by signature: we remember a hash of every record as it was
   last synced (localStorage 'cloud_sig_<name>'). A record whose hash differs is
   pushed; an id we synced before that is now missing locally was deleted here →
   a tombstone is pushed so the other devices drop it too. Keys starting with "_"
   (_u = last update time, _new …) are local only and never sent / hashed.
   Adapter: {name, list() → array, setList(arr), cols(rec) → [[header, value]…],
             id?(rec), toCloud?(rec) → Promise<data>, onChange?()}
   ========================================================================== */
(function () {
  const API = 'https://script.google.com/macros/s/AKfycbxy_ApQma-kWOy05t8XaoukNeIr44z9KluSRdw4niWlX-9MbERgC1P9o9alMA3KH4o5/exec';
  const BATCH = 8;

  function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + '.' + s.length; }
  function strip(r) { const c = {}; Object.keys(r).forEach(k => { if (k[0] !== '_') c[k] = r[k]; }); return c; }
  function sigOf(r) { return fnv(JSON.stringify(strip(r))); }
  function getSig(n) { try { return JSON.parse(localStorage.getItem('cloud_sig_' + n) || '{}'); } catch (e) { return {}; } }
  function setSig(n, m) { try { localStorage.setItem('cloud_sig_' + n, JSON.stringify(m)); } catch (e) {} }

  async function pull(n) {
    const r = await fetch(API + '?type=trk&name=' + encodeURIComponent(n) + '&t=' + Date.now());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error('bad answer');
    return j;
  }
  async function post(o) {
    const r = await fetch(API, { method: 'POST', body: JSON.stringify(o) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j.status !== 'ok') throw new Error(j.error || 'error');
    return j;
  }

  /* ---------- status badge (small pill in the corner) ---------- */
  const TXT = { syncing: '☁ שומר בענן…', ok: '☁ שמור בענן', offline: '⚠ אין חיבור – נשמר במכשיר, יעלה לענן בהמשך' };
  let badgeT = null;
  function badge(state) {
    let b = document.getElementById('cloudBadge');
    if (!b) {
      b = document.createElement('div'); b.id = 'cloudBadge';
      b.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:60;font:12px Heebo,Arial,sans-serif;padding:3px 10px;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.15);transition:opacity .4s;pointer-events:none';
      (document.body || document.documentElement).appendChild(b);
    }
    b.textContent = TXT[state] || '';
    b.style.background = state === 'offline' ? '#fff3cd' : state === 'ok' ? '#e3f4ea' : '#eef0f2';
    b.style.color = state === 'offline' ? '#856404' : state === 'ok' ? '#1e7a46' : '#555';
    b.style.opacity = '1';
    clearTimeout(badgeT);
    if (state === 'ok') badgeT = setTimeout(() => { b.style.opacity = '0'; }, 2500);
  }

  const running = {}, again = {}, timers = {};

  async function sync(o, opts) {
    const n = o.name, idOf = o.id || (r => String(r.id));
    if (running[n]) { again[n] = o; return; }
    running[n] = true;
    const quiet = opts && opts.quiet;
    if (!quiet) badge('syncing');
    try {
      const remote = await pull(n);
      const sig = getSig(n);
      let local = o.list().slice();
      const byId = new Map(local.map(r => [idOf(r), r]));
      const remoteIds = new Set();
      const tomb = [];
      let changed = false;

      remote.forEach(R => {
        remoteIds.add(R.id);
        const L = byId.get(R.id);
        if (R.deleted) {                                   // deleted on another device (or here earlier)
          if (L) { local = local.filter(x => idOf(x) !== R.id); byId.delete(R.id); changed = true; }
          delete sig[R.id];
          return;
        }
        if (!L) {
          if (sig[R.id]) tomb.push(R.id);                  // we deleted it here → tell the others
          else if (R.data) { const rec = R.data; rec._u = R.updated; local.push(rec); byId.set(R.id, rec); sig[R.id] = sigOf(rec); changed = true; }
          return;
        }
        const dirty = sig[R.id] !== sigOf(L);
        if (!dirty && R.updated > (L._u || 0) && R.data) {   // changed on another device
          const rec = R.data; rec._u = R.updated;
          local = local.map(x => idOf(x) === R.id ? rec : x); byId.set(R.id, rec); sig[R.id] = sigOf(rec); changed = true;
        }
      });
      Object.keys(sig).forEach(id => { if (!byId.has(id) && !remoteIds.has(id)) delete sig[id]; });

      // new or changed here → push
      const outs = [];
      local.forEach(L => { const id = idOf(L), s = sigOf(L); if (sig[id] !== s) outs.push({ L, id, s }); });
      const now = Date.now();
      const recs = [];
      for (const x of outs) {
        x.L._u = now;
        const data = o.toCloud ? await o.toCloud(x.L) : strip(x.L);
        recs.push({ id: x.id, updated: now, deleted: false, cols: o.cols ? o.cols(x.L) : [], data, _s: x.s });
      }
      tomb.forEach(id => recs.push({ id, updated: now, deleted: true, cols: [], data: null, _tomb: true }));
      if (outs.length) changed = true;
      if (changed) o.setList(local);

      for (let i = 0; i < recs.length; i += BATCH) {
        const part = recs.slice(i, i + BATCH);
        await post({ type: 'trk', name: n, recs: part.map(r => ({ id: r.id, updated: r.updated, deleted: r.deleted, cols: r.cols, data: r.data })) });
        part.forEach(r => { if (r._tomb) delete sig[r.id]; else sig[r.id] = r._s; });
        setSig(n, sig);
      }
      setSig(n, sig);
      if (changed && o.onChange) o.onChange();
      badge('ok');
      return true;
    } catch (e) {
      badge('offline');
      return false;
    } finally {
      running[n] = false;
      if (again[n]) { const a = again[n]; again[n] = null; setTimeout(() => sync(a, { quiet: true }), 300); }
    }
  }

  // call after every local save: if something changed since the last sync, sync (debounced)
  function queue(o, delay) {
    clearTimeout(timers[o.name]);
    timers[o.name] = setTimeout(() => {
      const idOf = o.id || (r => String(r.id));
      const sig = getSig(o.name);
      const list = o.list();
      const ids = new Set(list.map(idOf));
      const dirty = list.some(r => sig[idOf(r)] !== sigOf(r)) || Object.keys(sig).some(id => !ids.has(id));
      if (dirty) sync(o);
    }, delay == null ? 1500 : delay);
  }

  /* ---------- files on Drive (site-visit photos / report PDFs) ---------- */
  async function saveFile(folder, filename, mime, b64, replace) {
    const j = await post({ type: 'file', folder, filename, mime, b64, replace: !!replace });
    return j; // {id, url}
  }
  async function readFile(id) {
    const r = await fetch(API + '?type=file&id=' + encodeURIComponent(id));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j.status !== 'ok') throw new Error(j.status);
    return 'data:' + j.mime + ';base64,' + j.b64;
  }

  /* ---------- מעקב עבודות – shared by index.html (adds jobs) and avodot.html (the tracker) ---------- */
  const WORK = {
    name: 'work',
    list: () => { try { return JSON.parse(localStorage.getItem('wt_v4') || '[]'); } catch (e) { return []; } },
    setList: l => {
      localStorage.setItem('wt_v4', JSON.stringify(l));
      const max = l.reduce((m, j) => Math.max(m, Number(j.num) || 0), Number(localStorage.getItem('wt_cnt4') || 0));
      localStorage.setItem('wt_cnt4', max);
    },
    cols: j => [['מס׳', j.num], ['תאריך', j.date], ['לקוח', j.cust], ['פרויקט', j.proj], ['תיאור', j.desc], ['סטטוס', j.status === 'done' ? 'בוצע' : 'לא בוצע'], ['הערות', j.notes || ''], ['נסגר', j.closedDate || '']]
  };

  window.Cloud = { API, sync, queue, pull, post, saveFile, readFile, badge, WORK, sigOf, strip };
})();
