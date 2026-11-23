/* ===================================================================
 * contacts.js – מאגר אנשי קשר משותף לכל הטפסים של שמדר
 * (הזמנת עבודה, מסירה לתכנון, ישיבת היערכות, דוח סיור)
 *
 * - מקור אחד: הגיליון "contacts" דרך ה-Apps Script (SHEETS_API).
 * - עותק שמור במכשיר (localStorage) – הרשימה זמינה מיד, גם בלי רשת.
 * - חברה נבחרת מהמאגר: resolve() מתאים שם שהוקלד לשם המלא שבגיליון.
 * - איש קשר חדש / תפקיד / טלפון / מייל שהשתנו נשמרים מיד (save), בתור –
 *   שמירה אחת אחרי השנייה, כמו בטופס העבודות.
 * - כל שינוי מגיע מיד לשאר הטפסים הפתוחים (BroadcastChannel) – בלי רענון.
 * - אנשי שמדר (@smdrtech.co.il) לא נשמרים בגיליון.
 * - עדכון איש קשר קיים ותפקידים נשלחים לגיליון רק אם הסקריפט בגרסה 3
 *   (מחזיר role) – אחרת רק אנשי קשר חדשים, כדי לא ליצור כפילויות.
 *
 * מבנה: SmdrContacts.db = { "שם חברה": [ {n, p, e, r}, ... ] }
 * =================================================================== */
(function () {
  if (window.SmdrContacts) return;
  const API = 'https://script.google.com/macros/s/AKfycbxy_ApQma-kWOy05t8XaoukNeIr44z9KluSRdw4niWlX-9MbERgC1P9o9alMA3KH4o5/exec';
  const CACHE = 'smdr_contacts_cache_v1';
  const ROLES = ['מנהל פרויקט', 'מהנדס ביצוע', 'מנהל עבודה', 'מנהל אזור', 'מנכ"ל', 'רכש', 'הנהלת חשבונות', 'ממונה בטיחות', 'אחר'];

  const norm = s => String(s == null ? '' : s).replace(/[​-‏‪-‮⁠-⁯﻿]/g, '').replace(/\s+/g, ' ').trim();
  const isInternal = e => /@smdrtech\.co\.il\s*$/i.test(String(e || ''));

  const db = {};              // אותו אובייקט לאורך כל החיים – טפסים יכולים להחזיק הפניה אליו
  let roleSupport = false;    // הסקריפט בגרסה 3 (תפקידים + עדכון)?
  let loaded = false;
  const listeners = [];

  function replaceAll(src) {
    Object.keys(db).forEach(k => delete db[k]);
    Object.keys(src || {}).forEach(k => { db[k] = (src[k] || []).map(c => ({ n: c.n || '', p: c.p || '', e: c.e || '', r: c.r || '' })); });
  }
  function saveCache() { try { localStorage.setItem(CACHE, JSON.stringify({ db, roleSupport, t: Date.now() })); } catch (e) {} }
  function notify(what) { listeners.slice().forEach(fn => { try { fn(what); } catch (e) {} }); }

  // 1) מיד: מה שנשמר במכשיר
  try { const c = JSON.parse(localStorage.getItem(CACHE) || 'null'); if (c && c.db) { replaceAll(c.db); roleSupport = !!c.roleSupport; } } catch (e) {}

  // 2) מהגיליון
  const ready = fetch(API).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(rows => {
    const src = {};
    roleSupport = rows.some(r => r && Object.prototype.hasOwnProperty.call(r, 'role'));
    rows.forEach(r => {
      const co = norm(r.company), n = norm(r.name);
      if (!co || !n) return;
      const L = (src[co] = src[co] || []);
      const ex = L.find(x => norm(x.n) === n);
      const c = { n, p: norm(r.phone), e: norm(r.email), r: norm(r.role) };
      if (ex) { if (c.p) ex.p = c.p; if (c.e) ex.e = c.e; if (c.r) ex.r = c.r; } else L.push(c);
    });
    // תפקידים שנשמרו רק במכשיר (לפני עדכון הסקריפט) – נשמרים כל עוד בגיליון אין תפקיד
    Object.keys(db).forEach(co => (db[co] || []).forEach(o => {
      if (!o.r || !src[co]) return;
      const s = src[co].find(x => norm(x.n) === norm(o.n));
      if (s && !s.r) s.r = o.r;
    }));
    replaceAll(src);
    loaded = true; saveCache(); notify({ type: 'load' });
    return db;
  }).catch(() => { loaded = true; notify({ type: 'load-failed' }); return db; });

  // פולבק (רק אם אין כלום – לא מהגיליון ולא מהמכשיר)
  function setFallback(fb) {
    ready.then(() => {
      if (Object.keys(db).length) return;
      const src = {};
      Object.keys(fb || {}).forEach(co => { src[co] = (fb[co] || []).map(c => ({ n: c.n || c.name || '', p: c.p || c.phone || '', e: c.e || c.m || c.email || '', r: c.r || '' })); });
      replaceAll(src); notify({ type: 'load' });
    });
  }

  function companies() { return Object.keys(db); }
  // חברה שהוקלדה → השם המלא מהמאגר. {name, known, changed}
  function resolve(typed) {
    const t = norm(typed);
    if (!t) return { name: '', known: false, changed: false };
    if (db[t]) return { name: t, known: true, changed: t !== typed };
    const keys = Object.keys(db);
    const ex = keys.find(k => norm(k) === t);
    if (ex) return { name: ex, known: true, changed: ex !== typed };
    const part = keys.filter(k => norm(k).includes(t));
    if (part.length === 1) return { name: part[0], known: true, changed: true };
    return { name: t, known: false, changed: t !== typed };
  }
  function list(company) { const r = resolve(company); return r.known ? db[r.name] : []; }
  function find(company, name) { return list(company).find(c => norm(c.n) === norm(name)) || null; }

  // מעדכן את המאגר המקומי. מחזיר מה צריך לשלוח לגיליון (או null)
  function upsertLocal(company, c) {
    const co = norm(company), n = norm(c.n);
    if (!co || !n) return null;
    const L = (db[co] = db[co] || []);
    let ex = L.find(x => norm(x.n) === n);
    const p = norm(c.p), e = norm(c.e), r = norm(c.r);
    if (!ex) { ex = { n, p, e, r }; L.push(ex); return { isNew: true, c: ex }; }
    let changed = false;
    if (p && p !== ex.p) { ex.p = p; changed = true; }
    if (e && e !== ex.e) { ex.e = e; changed = true; }
    if (r && r !== ex.r) { ex.r = r; changed = true; }   // תפקיד חדש דורס את הקודם
    return changed ? { isNew: false, c: ex } : null;
  }

  const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('smdr_contacts') : null;
  if (bc) bc.onmessage = ev => {
    const m = ev.data || {};
    if (m.type === 'upsert') { upsertLocal(m.company, m.c); saveCache(); notify({ type: 'upsert', company: norm(m.company), c: m.c, remote: true }); }
  };

  let queue = Promise.resolve();
  let warnFn = msg => { try { console.warn(msg); } catch (e) {} };
  function onWarn(fn) { warnFn = fn; }

  // שמירה: איש קשר חדש → נוסף לגיליון; קיים שהשתנה (תפקיד/טלפון/מייל) → מתעדכן בגיליון (סקריפט גרסה 3)
  function save(company, c) {
    if (!c || !norm(c.n)) return Promise.resolve(false);
    const co = norm(company);
    if (!co) return Promise.resolve(false);
    if (isInternal(c.e)) return Promise.resolve(false);   // אנשי שמדר – לא לגיליון
    const res = upsertLocal(co, c);
    if (!res) return Promise.resolve(false);
    saveCache();
    if (bc) bc.postMessage({ type: 'upsert', company: co, c: { ...res.c } });
    notify({ type: 'upsert', company: co, c: res.c });
    const sendToSheet = res.isNew || roleSupport;          // עדכון קיים רק כשהסקריפט תומך – בלי כפילויות
    if (!sendToSheet) return Promise.resolve(true);
    const body = { company: co, name: res.c.n, phone: res.c.p, email: res.c.e };
    if (roleSupport) body.role = res.c.r;
    queue = queue.then(() => fetch(API, { method: 'POST', body: JSON.stringify(body) })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); })
      .catch(() => warnFn('⚠ שמירת "' + res.c.n + '" למאגר נכשלה — בדוק את הגיליון')));
    return queue.then(() => true);
  }

  function onChange(fn) { listeners.push(fn); }

  window.SmdrContacts = {
    db, ready, ROLES, norm, isInternal,
    companies, resolve, list, find, save, onChange, onWarn, setFallback,
    get roleSupport() { return roleSupport; }, get loaded() { return loaded; }
  };
})();
