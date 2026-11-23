/***************************************************************
 *  שמדר – גיליון אנשי קשר + מעקבים (גרסה 2, נובמבר 2026)
 *  - אנשי קשר ואדריכלים: בדיוק כמו קודם (לא שונה)
 *  - חדש: מעקבים משותפים לכל המכשירים – לשונית לכל מעקב
 *  - חדש: תמונות סיורים ו-PDF של דוחות נשמרים בגוגל דרייב
 *  - גרסה 3 (23.11.2026): אנשי קשר – עמודת "תפקיד" (E), ואיש קשר שכבר קיים
 *    (אותה חברה + אותו שם) מתעדכן במקום להיכפל; נעילה נגד שמירות במקביל
 ***************************************************************/
const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();
const SHEET_NAME = 'contacts';
const ARCH_SHEET_NAME = 'architects';   // גיליון האדריכלים – נוצר אוטומטית בפעם הראשונה

// המעקבים: שם פנימי -> שם הלשונית בגיליון
const TRACKERS = {
  handover: 'מעקב מסירות',
  hiarchut: 'מעקב היערכות',
  siyur:    'מעקב סיורים',
  work:     'מעקב עבודות'
};
const META_COLS = 3;      // מזהה | עודכן | נמחק
const VIEW_COLS = 10;     // עמודות קריאות (לקוח, פרויקט, תאריך...) – רק לעין, האפליקציה לא קוראת מהן
const DATA_COL  = META_COLS + VIEW_COLS + 1;   // מכאן והלאה: הנתונים המלאים (JSON), מפוצלים לתאים
const CHUNK     = 45000;  // תא בגוגל שיט מחזיק עד 50,000 תווים
const ROOT_FOLDER = 'שמדר – טפסים';   // תיקייה בדרייב לתמונות ולדוחות

/* ============================ אנשי קשר / אדריכלים (ללא שינוי) ============================ */

// גיליון האדריכלים: עמודות משרד אדריכלים | שם | טלפון | מייל
function getArchSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(ARCH_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(ARCH_SHEET_NAME);
    sh.appendRow(['משרד אדריכלים', 'שם', 'טלפון', 'מייל']);
    sh.setRightToLeft(true);
    sh.getRange(1, 1, 1, 4).setFontWeight('bold');
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const p = (e && e.parameter) || {};

  // מעקב: ?type=trk&name=handover  (אופציונלי: &since=<ms> – רק מה שהשתנה מאז)
  if (p.type === 'trk') return json_(readTracker_(p.name, Number(p.since) || 0));

  // קובץ מהדרייב (תמונת סיור): ?type=file&id=<fileId>
  if (p.type === 'file') return json_(readFile_(p.id));

  // אדריכלים – רק לטופס מסירת פרויקטים לתכנון
  if (p.type === 'architects') {
    const data = getArchSheet().getDataRange().getValues();
    const rows = data.slice(1).map(row => ({ office: row[0], name: row[1], phone: row[2], email: row[3] }));
    return json_(rows);
  }

  // אנשי קשר – בדיוק כמו קודם
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  // role תמיד קיים בתשובה (גם ריק) – כך הטפסים יודעים שהסקריפט תומך בתפקידים ובעדכון
  const rows = data.slice(1).map(row => ({ company: row[0], name: row[1], phone: row[2], email: row[3], role: row[4] || '' }));
  return json_(rows);
}

// השוואת שמות: בלי רווחים מיותרים ובלי סימני כיוון בלתי נראים
function normKey_(s) {
  return String(s || '').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);

  // מעקב: רשומה אחת או כמה ({type:'trk', name, recs:[...]} או {type:'trk', name, rec:{...}})
  if (data.type === 'trk') {
    const recs = data.recs || (data.rec ? [data.rec] : []);
    return json_(writeTracker_(data.name, recs));
  }

  // קובץ לדרייב (תמונה / PDF): {type:'file', folder, filename, mime, b64}
  if (data.type === 'file') return json_(saveFile_(data));

  // אדריכל חדש – נכנס לגיליון האדריכלים, ליד שאר האדריכלים מאותו משרד
  if (data.type === 'architect') {
    const sh = getArchSheet();
    const offices = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
    let lastMatchRow = -1;
    for (let i = 1; i < offices.length; i++) {
      if (offices[i][0] === data.office) lastMatchRow = i + 1;
    }
    const row = [data.office || '', data.name || '', data.phone || '', data.email || ''];
    if (lastMatchRow === -1) {
      sh.appendRow(row);
    } else {
      sh.insertRowAfter(lastMatchRow);
      sh.getRange(lastMatchRow + 1, 1, 1, 4).setValues([row]);
    }
    return json_({status: 'ok'});
  }

  // איש קשר: אם כבר קיים (אותה חברה + אותו שם) – מעדכנים טלפון/מייל/תפקיד; אחרת מוסיפים ליד אנשי הקשר של אותה חברה
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);   // שתי שמירות באותו רגע לא דורסות זו את זו
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    if (sheet.getRange(1, 5).getValue() === '') sheet.getRange(1, 5).setValue('תפקיד').setFontWeight('bold');
    const last = sheet.getLastRow();
    const vals = last ? sheet.getRange(1, 1, last, 5).getValues() : [];
    const co = normKey_(data.company), nm = normKey_(data.name);
    let lastMatchRow = -1, existRow = -1;
    for (let i = 0; i < vals.length; i++) {
      if (normKey_(vals[i][0]) === co) {
        lastMatchRow = i + 1;
        if (normKey_(vals[i][1]) === nm) existRow = i + 1;
      }
    }
    if (existRow !== -1) {
      const cur = vals[existRow - 1];
      const row = [cur[0], cur[1],
        data.phone ? data.phone : cur[2],
        data.email ? data.email : cur[3],
        data.role  ? data.role  : cur[4]];   // תפקיד חדש דורס את הקודם
      sheet.getRange(existRow, 1, 1, 5).setValues([row]);
      return json_({status: 'updated'});
    }
    const row = [data.company, data.name, data.phone || '', data.email || '', data.role || ''];
    if (lastMatchRow === -1) {
      sheet.appendRow(row);
    } else {
      sheet.insertRowAfter(lastMatchRow);
      sheet.getRange(lastMatchRow + 1, 1, 1, 5).setValues([row]);
    }
    return json_({status: 'added'});
  } finally {
    lock.releaseLock();
  }
}

/* ============================ מעקבים ============================ */

function trackerSheet_(name) {
  const title = TRACKERS[name];
  if (!title) throw new Error('unknown tracker: ' + name);
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(title);
  if (!sh) {
    sh = ss.insertSheet(title);
    const head = ['מזהה', 'עודכן', 'נמחק'];
    for (let i = 0; i < VIEW_COLS; i++) head.push('');
    head.push('נתונים (לא לגעת)');
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#fbe4e4');
    sh.setRightToLeft(true);
    sh.setFrozenRows(1);
  }
  return sh;
}

// כל הרשומות של מעקב (כולל מחוקות, כדי שכל מכשיר ידע למחוק אצלו)
function readTracker_(name, since) {
  const sh = trackerSheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const width = sh.getLastColumn();
  const vals = sh.getRange(2, 1, last - 1, width).getValues();
  const out = [];
  vals.forEach(r => {
    if (!r[0]) return;
    const updated = Number(r[1]) || 0;
    if (since && updated <= since) return;
    let txt = '';
    for (let c = DATA_COL - 1; c < width; c++) txt += (r[c] || '');
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (err) { data = null; }
    out.push({ id: String(r[0]), updated: updated, deleted: r[2] === true || r[2] === 'כן', data: data });
  });
  return out;
}

// rec = {id, updated, deleted, cols:[[כותרת, ערך], ...], data:{...}}
// המעודכן ביותר מנצח: רשומה ישנה יותר ממה שכבר בגיליון לא דורסת אותה
function writeTracker_(name, recs) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = trackerSheet_(name);
    const last = sh.getLastRow();
    const ids = last > 1 ? sh.getRange(2, 1, last - 1, 2).getValues() : [];
    const rowOf = {};
    ids.forEach((r, i) => { rowOf[String(r[0])] = { row: i + 2, updated: Number(r[1]) || 0 }; });
    const result = [];
    recs.forEach(rec => {
      const id = String(rec.id);
      const cur = rowOf[id];
      if (cur && cur.updated > (Number(rec.updated) || 0)) { result.push({ id: id, status: 'older' }); return; }
      // view columns: headers come from the app (first time each header is seen)
      const cols = (rec.cols || []).slice(0, VIEW_COLS);
      if (cols.length) {
        const head = sh.getRange(1, META_COLS + 1, 1, VIEW_COLS).getValues()[0];
        let changed = false;
        cols.forEach((c, i) => { if (!head[i] && c[0]) { head[i] = c[0]; changed = true; } });
        if (changed) sh.getRange(1, META_COLS + 1, 1, VIEW_COLS).setValues([head]).setFontWeight('bold').setBackground('#fbe4e4');
      }
      const txt = rec.data == null ? '' : JSON.stringify(rec.data);
      const chunks = [];
      for (let i = 0; i < txt.length; i += CHUNK) chunks.push(txt.substring(i, i + CHUNK));
      if (!chunks.length) chunks.push('');
      const row = [id, Number(rec.updated) || Date.now(), rec.deleted ? 'כן' : ''];
      for (let i = 0; i < VIEW_COLS; i++) row.push(cols[i] ? cols[i][1] : '');
      chunks.forEach(c => row.push(c));
      const r = cur ? cur.row : sh.getLastRow() + 1;
      // clear old data chunks that may be longer than the new ones
      if (cur && sh.getLastColumn() >= DATA_COL) sh.getRange(r, DATA_COL, 1, sh.getLastColumn() - DATA_COL + 1).clearContent();
      sh.getRange(r, 1, 1, row.length).setValues([row]);
      rowOf[id] = { row: r, updated: row[1] };
      result.push({ id: id, status: 'ok' });
    });
    return { status: 'ok', results: result };
  } finally {
    lock.releaseLock();
  }
}

/* ============================ קבצים בדרייב ============================ */

function folder_(sub) {
  const roots = DriveApp.getFoldersByName(ROOT_FOLDER);
  const root = roots.hasNext() ? roots.next() : DriveApp.createFolder(ROOT_FOLDER);
  if (!sub) return root;
  const it = root.getFoldersByName(sub);
  return it.hasNext() ? it.next() : root.createFolder(sub);
}

// {folder:'סיורים - תמונות', filename, mime, b64} -> {status, id, url}
function saveFile_(d) {
  const bytes = Utilities.base64Decode(d.b64);
  const blob = Utilities.newBlob(bytes, d.mime || 'application/octet-stream', d.filename || ('file-' + Date.now()));
  const folder = folder_(d.folder || 'כללי');
  if (d.replace) { const old = folder.getFilesByName(blob.getName()); while (old.hasNext()) old.next().setTrashed(true); }
  const f = folder.createFile(blob);
  return { status: 'ok', id: f.getId(), url: f.getUrl() };
}

function readFile_(id) {
  const f = DriveApp.getFileById(id);
  // מותר לקרוא רק קבצים שנמצאים בתוך התיקייה "שמדר – טפסים"
  const rootId = folder_().getId();
  let ok = false;
  const parents = f.getParents();
  while (parents.hasNext() && !ok) {
    const p = parents.next();
    if (p.getId() === rootId) ok = true;
    const up = p.getParents();
    while (up.hasNext()) if (up.next().getId() === rootId) ok = true;
  }
  if (!ok) return { status: 'denied' };
  const blob = f.getBlob();
  return { status: 'ok', mime: blob.getContentType(), b64: Utilities.base64Encode(blob.getBytes()) };
}

/* ============================ הפעלה ראשונה ============================ */
// להריץ פעם אחת מהעורך (▶ הפעלה) – יוצר את הלשוניות ואת התיקייה בדרייב, ומבקש הרשאה לדרייב
function setup() {
  Object.keys(TRACKERS).forEach(trackerSheet_);
  folder_('סיורים - תמונות');
  folder_('סיורים - דוחות');
  Logger.log('מוכן ✓');
}
