"use strict";
/* ===== storage ===== */
const store = {
  get(k, d) { try { const v = localStorage.getItem("ws_" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("ws_" + k, JSON.stringify(v)); } catch (e) {} }
};
const $ = id => document.getElementById(id);
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
const fix = (a, b) => { a = a - b * Math.floor(a / b); return a < 0 ? a + b : a; };

const NAMES = ["الفجر", "الشروق", "الظهر", "العصر", "المغرب", "العشاء"];
const DEFAULT_OFF = [25, 20, 20, 10, 20];
const OFF_IDX = [0, null, 1, 2, 3, 4];
const FALLBACK = { name: "سراة عبيدة (تقريبي)", lat: 18.16, lng: 43.12, approx: true };

let place = store.get("place", FALLBACK);
let mine = store.get("mine", []);
let selected = store.get("sel", null);
let editing = selected;
let nearby = [];
let shown = 8;
let heading = null;

/* ===== prayer times (Umm al-Qura: Fajr 18.5°, Isha 90 min after Maghrib, 120 in Ramadan) ===== */
const saNow = () => new Date(Date.now() + 3 * 3600e3); // Saudi time, independent of device zone
function julian(y, m, d) {
  if (m <= 2) { y--; m += 12; }
  const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}
function sun(jd) {
  const D = jd - 2451545, g = fix(357.529 + .98560028 * D, 360), q = fix(280.459 + .98564736 * D, 360),
    L = fix(q + 1.915 * Math.sin(rad(g)) + .020 * Math.sin(rad(2 * g)), 360), e = 23.439 - .00000036 * D,
    RA = fix(deg(Math.atan2(Math.cos(rad(e)) * Math.sin(rad(L)), Math.cos(rad(L)))) / 15, 24);
  let eqt = q / 15 - RA; eqt -= 24 * Math.round(eqt / 24);
  return { decl: deg(Math.asin(Math.sin(rad(e)) * Math.sin(rad(L)))), eqt };
}
function prayerTimes(y, m, d, lat, lng, ramadan) {
  const s = sun(julian(y, m, d) - lng / 360 + .5), dec = s.decl;
  const noon = 12 + 3 - lng / 15 - s.eqt;
  const T = a => deg(Math.acos((-Math.sin(rad(a)) - Math.sin(rad(dec)) * Math.sin(rad(lat))) / (Math.cos(rad(dec)) * Math.cos(rad(lat))))) / 15;
  const asrAngle = -deg(Math.atan(1 / (1 + Math.tan(rad(Math.abs(lat - dec))))));
  const maghrib = noon + T(.833);
  return [noon - T(18.5), noon - T(.833), noon + 2 / 60, noon + T(asrAngle), maghrib, maghrib + (ramadan ? 2 : 1.5)];
}
function hm(h) {
  h = fix(h, 24); let H = Math.floor(h), M = Math.round((h - H) * 60);
  if (M === 60) { H = (H + 1) % 24; M = 0; }
  return (H % 12 || 12) + ":" + String(M).padStart(2, "0") + " " + (H < 12 ? "ص" : "م");
}
function hijri(dt) {
  try {
    const text = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(dt);
    const mon = +new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { month: "numeric", timeZone: "UTC" }).format(dt);
    return { text, ramadan: mon === 9 };
  } catch (e) { return { text: "", ramadan: false }; }
}

/* ===== geometry ===== */
function distance(a, b, c, d) {
  const R = 6371000, dp = rad(c - a), dl = rad(d - b);
  const x = Math.sin(dp / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function bearing(a, b, c, d) {
  const dl = rad(d - b);
  return fix(deg(Math.atan2(Math.sin(dl) * Math.cos(rad(c)), Math.cos(rad(a)) * Math.sin(rad(c)) - Math.sin(rad(a)) * Math.cos(rad(c)) * Math.cos(dl))), 360);
}
const qiblaAngle = () => bearing(place.lat, place.lng, 21.4225, 39.8262);
const fmtDist = m => m < 1000 ? Math.round(m / 10) * 10 + " م" : (m / 1000).toFixed(1) + " كم";

/* ===== prayer view ===== */
let day = null;
function computeDay() {
  const n = saNow(), y = n.getUTCFullYear(), m = n.getUTCMonth() + 1, d = n.getUTCDate();
  const h = hijri(n), t = prayerTimes(y, m, d, place.lat, place.lng, h.ramadan);
  const tm = new Date(Date.UTC(y, m - 1, d + 1));
  const tt = prayerTimes(tm.getUTCFullYear(), tm.getUTCMonth() + 1, tm.getUTCDate(), place.lat, place.lng, hijri(tm).ramadan);
  day = {
    key: `${y}-${m}-${d}-${place.lat}-${place.lng}`, t, fajrTomorrow: tt[0] + 24, hijri: h.text,
    greg: new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(n)
  };
}
const currentMosque = () => mine.find(x => x.id === selected) || { name: "إعدادات عامة", off: DEFAULT_OFF };

function renderPrayer() {
  const n = saNow();
  if (!day || !day.key.startsWith(`${n.getUTCFullYear()}-${n.getUTCMonth() + 1}-${n.getUTCDate()}-`)) computeDay();
  const now = n.getUTCHours() + n.getUTCMinutes() / 60 + n.getUTCSeconds() / 3600;
  const cm = currentMosque(), off = cm.off;
  const ni = day.t.findIndex((x, i) => i !== 1 && x > now);
  const idx = ni === -1 ? 0 : ni, target = ni === -1 ? day.fajrTomorrow : day.t[ni];
  const left = Math.max(0, Math.round((target - now) * 3600));
  $("countdown").textContent = [left / 3600 | 0, (left % 3600) / 60 | 0, left % 60].map(v => String(v).padStart(2, "0")).join(":");
  $("nextName").textContent = NAMES[idx];
  $("nextAdhan").textContent = hm(target);
  $("nextIqama").textContent = "الإقامة " + hm(target + off[OFF_IDX[idx]] / 60) + " · " + cm.name;
  $("hijri").textContent = day.hijri; $("greg").textContent = day.greg;
  $("iqMosque").textContent = cm.name;

  let html = '<div class="row head"><span>الصلاة</span><span class="t">الأذان</span><span class="t">الإقامة</span></div>';
  day.t.forEach((x, i) => {
    const cls = ni === -1 || i < ni ? " past" : i === ni ? " next" : "";
    const iq = OFF_IDX[i] === null ? "—" : hm(x + off[OFF_IDX[i]] / 60);
    html += `<div class="row${cls}"><span class="p">${NAMES[i]}</span><span class="t">${hm(x)}</span><span class="t q">${iq}</span></div>`;
  });
  if (ni === -1) html += `<div class="row next"><span class="p">فجر الغد</span><span class="t">${hm(day.fajrTomorrow)}</span><span class="t q">${hm(day.fajrTomorrow + off[0] / 60)}</span></div>`;
  if ($("table").dataset.h !== html) { $("table").innerHTML = html; $("table").dataset.h = html; }
}

/* ===== location ===== */
function renderPlace() { $("placeName").textContent = place.name; renderQibla(); setMapLinks(); }

/* Nearest mosques in Apple / Google Maps: centred on the GPS fix when we have one,
   otherwise the Maps app uses the phone's own location. */
function setMapLinks() {
  // Same links as the first version: no coordinates, so the Maps app searches from the phone's GPS
  renderPicker();
}

function locate() {
  if (!("geolocation" in navigator)) { setStatus("جهازك لا يدعم تحديد الموقع."); return; }
  $("locateBtn").disabled = true; $("locateBtn").textContent = "جارٍ تحديد موقعك…";
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    place = { name: "موقعك الحالي", lat, lng };
    store.set("place", place); store.set("located", true);
    $("locateBtn").hidden = true;
    day = null; renderPlace(); renderPrayer();
    loadMosques(false);
    placeName(lat, lng);
  }, err => {
    $("locateBtn").disabled = false; $("locateBtn").hidden = false; $("locateBtn").textContent = "حدّد موقعي";
    setStatus(err.code === 1
      ? "لم تسمح بالوصول للموقع. فعّله من الإعدادات ← الخصوصية ← خدمات الموقع ← Safari، ثم اضغط «حدّد موقعي»."
      : "تعذّر تحديد موقعك، حاول مرة أخرى في مكان مكشوف.");
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}

async function placeName(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&accept-language=ar`);
    const j = await r.json(), a = j.address || {};
    const parts = [a.suburb || a.neighbourhood || a.village || a.hamlet, a.city || a.town || a.county].filter(Boolean);
    if (parts.length) { place.name = parts.join("، "); store.set("place", place); renderPlace(); }
  } catch (e) {}
}


/* ===== Google Maps picker: choose what to search before leaving the site ===== */
const KINDS = {
  mosque:  { terms: ["مسجد", "جامع"], note: "يبحث عن المساجد والجوامع حول موقعك." },
  musalla: { terms: ["مصلى", "مصلى طريق", "مصلى محطة"], note: "المصليات الصغيرة في المحطات والطرق والأسواق." },
  women:   { terms: ["مصلى نساء", "مصلى النساء", "مصلى نسائي", "مصلى السيدات", "مصلى للنساء", "قسم النساء", "مصلى عائلات"],
             note: "المصليات النسائية تُسجَّل في الخرائط بأسماء مختلفة. إن لم تجد نتيجة قريبة جرّب اسماً آخر من الأعلى." }
};
let kind = store.get("kind", "mosque"), term = null;
function renderPicker() {
  if (!KINDS[kind]) kind = "mosque";
  const k = KINDS[kind];
  if (!k.terms.includes(term)) term = k.terms[0];
  document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-checked", b.dataset.kind === kind));
  const box = $("terms"); box.innerHTML = "";
  if (k.terms.length > 1) k.terms.forEach(t => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "term"; b.textContent = t;
    b.setAttribute("aria-pressed", t === term);
    b.onclick = () => { term = t; renderPicker(); };
    box.appendChild(b);
  });
  $("kindNote").textContent = k.note;
  $("mapsGo").textContent = "ابحث عن «" + term + "» في خرائط Google";
  $("mapsGo").href = "https://www.google.com/maps/search/" + encodeURIComponent(term);
}
document.querySelectorAll(".seg button").forEach(b => b.onclick = () => { kind = b.dataset.kind; term = null; store.set("kind", kind); renderPicker(); });

/* ===== nearby mosques (OpenStreetMap / Overpass) ===== */
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];
function setStatus(t) { $("mosqueStatus").textContent = t; }

/* Ask every server at once with a time limit; the first good answer wins. */
async function overpass(lat, lng, r) {
  const sel = `["amenity"="place_of_worship"]["religion"="muslim"](around:${r},${lat},${lng})`;
  const q = `[out:json][timeout:12];(node${sel};way${sel};);out center 80;`;
  const ctrls = OVERPASS.map(() => new AbortController());
  const timer = setTimeout(() => ctrls.forEach(c => c.abort()), 14000);
  try {
    return await Promise.any(OVERPASS.map(async (url, i) => {
      const res = await fetch(url + "?data=" + encodeURIComponent(q), { signal: ctrls[i].signal });
      if (!res.ok) throw new Error(res.status);
      const j = await res.json();
      if (!Array.isArray(j.elements)) throw new Error("bad");
      ctrls.forEach((c, k) => { if (k !== i) c.abort(); });
      return j.elements;
    }));
  } catch (e) { throw new Error("offline"); }
  finally { clearTimeout(timer); }
}

async function loadMosques(force) {
  const key = place.lat.toFixed(3) + "," + place.lng.toFixed(3);
  const cache = store.get("near", null);
  if (!force && cache && cache.key === key && Date.now() - cache.at < 7 * 864e5) { nearby = cache.list; shown = 8; renderMosques(); return; }
  setStatus("جارٍ البحث عن المساجد حولك…");
  try {
    let els = [];
    els = await overpass(place.lat, place.lng, 3000);
    if (els.length < 3) { setStatus("المساجد قليلة قربك، أوسّع البحث…"); els = await overpass(place.lat, place.lng, 12000); }
    nearby = els.map(e => {
      const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon, tg = e.tags || {};
      return { id: e.type[0] + e.id, name: tg["name:ar"] || tg.name || "مسجد بدون اسم", lat: la, lng: lo };
    }).filter(m => m.lat != null);
    store.set("near", { key, at: Date.now(), list: nearby });
    shown = 8; renderMosques();
  } catch (e) {
    $("mosqueStatus").innerHTML = (cache ? "خادم المساجد لا يستجيب، أعرض آخر نتائج محفوظة. " : "خادم المساجد لا يستجيب الآن. اضغط «تحديث» بعد قليل، أو ")
      + `<a href="https://www.google.com/maps/search/${encodeURIComponent("مسجد")}" target="_blank" rel="noopener">ابحث في خرائط Google</a>.`;
    if (cache) { nearby = cache.list; renderMosques(true); }
  }
}

const ARROW = '<svg viewBox="0 0 24 24"><path d="M12 2 L19 20 L12 16 L5 20 Z" fill="var(--accent)"/></svg>';
function renderMosques(keepStatus) {
  nearby.forEach(m => { m.d = distance(place.lat, place.lng, m.lat, m.lng); m.b = bearing(place.lat, place.lng, m.lat, m.lng); });
  nearby.sort((a, b) => a.d - b.d);
  const list = $("mosqueList"); list.innerHTML = "";
  if (!keepStatus) setStatus(nearby.length ? `${nearby.length} مسجداً في محيطك.` : "لم نجد مساجد مسجّلة قربك على الخريطة. أضف مسجدك من الأسفل.");
  nearby.slice(0, shown).forEach(m => {
    const li = document.createElement("li");
    li.className = "m" + (mine.some(x => x.osm === m.id && x.id === selected) ? " mine" : "");
    li.innerHTML = `<div class="arrow">${ARROW}</div>
      <div class="info"><div class="nm"></div><div class="meta"><b>${fmtDist(m.d)}</b> · ${Math.max(1, Math.round(m.d / 75))} د مشياً</div></div>
      <div class="acts"><a class="go" target="_blank" rel="noopener">اذهب</a><button class="pick" type="button">مسجدي</button></div>`;
    li.querySelector(".nm").textContent = m.name;
    li.querySelector(".arrow svg").dataset.b = m.b;
    li.querySelector(".go").href = `https://www.google.com/maps/dir/?api=1&destination=${m.lat},${m.lng}&travelmode=walking`;
    li.querySelector(".pick").onclick = () => adopt(m);
    list.appendChild(li);
  });
  $("moreBtn").hidden = nearby.length <= shown;
  rotateArrows();
}
function rotateArrows() {
  document.querySelectorAll(".arrow svg").forEach(s => {
    const r = heading == null ? +s.dataset.b : +s.dataset.b - heading;
    s.style.transform = `rotate(${r}deg)`;
  });
}
function adopt(m) {
  let x = mine.find(y => y.osm === m.id);
  if (!x) { x = { id: "m" + Date.now(), osm: m.id, name: m.name === "مسجد بدون اسم" ? "مسجدي" : m.name, off: DEFAULT_OFF.slice() }; mine.push(x); store.set("mine", mine); }
  selected = editing = x.id; store.set("sel", selected);
  renderMine(); renderMosques(); renderPrayer();
  $("mName").scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ===== qibla compass ===== */
function buildTicks() {
  let s = "";
  for (let a = 0; a < 360; a += 15) {
    const L = a % 90 === 0 ? 10 : 5, x1 = 80 + 70 * Math.sin(rad(a)), y1 = 80 - 70 * Math.cos(rad(a)),
      x2 = 80 + (70 - L) * Math.sin(rad(a)), y2 = 80 - (70 - L) * Math.cos(rad(a));
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--line)" stroke-width="2"/>`;
  }
  $("ticks").innerHTML = s;
}
function renderQibla() {
  const q = qiblaAngle();
  $("qDeg").textContent = Math.round(q) + "°";
  $("needle").setAttribute("transform", `rotate(${q} 80 80)`);
  if (heading != null) {
    $("rose").style.transform = `rotate(${-heading}deg)`;
    const diff = Math.abs(((q - heading + 540) % 360) - 180);
    $("qState").innerHTML = diff < 5 ? '<span class="aligned">أنت متجه للقبلة</span>' : `استدر ${Math.round(diff)}° ${((q - heading + 360) % 360) < 180 ? "يميناً" : "يساراً"}`;
  }
}
function onOrient(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === "number") h = e.webkitCompassHeading;
  else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
  if (h == null) return;
  heading = h; renderQibla(); rotateArrows();
}
async function startCompass() {
  try {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      const p = await DeviceOrientationEvent.requestPermission();
      if (p !== "granted") { $("qState").textContent = "لم تسمح باستخدام البوصلة."; return; }
    }
    window.addEventListener("deviceorientationabsolute", onOrient);
    window.addEventListener("deviceorientation", onOrient);
    $("compassBtn").hidden = true;
    $("qState").textContent = "أمسك الجوال بشكل مستوٍ…";
    setTimeout(() => { if (heading == null) $("qState").textContent = "البوصلة غير متاحة على هذا الجهاز. استخدم الزاوية من الشمال."; }, 3000);
  } catch (e) { $("qState").textContent = "البوصلة غير متاحة على هذا الجهاز."; }
}

/* ===== my mosques ===== */
function renderMine() {
  const box = $("myChips"); box.innerHTML = "";
  mine.forEach(m => {
    const b = document.createElement("button");
    b.className = "chip"; b.type = "button"; b.textContent = m.name;
    b.setAttribute("aria-pressed", m.id === selected);
    b.onclick = () => { selected = editing = m.id; store.set("sel", selected); renderMine(); renderMosques(true); renderPrayer(); };
    box.appendChild(b);
  });
  const m = mine.find(x => x.id === editing);
  $("formTitle").textContent = m ? "تعديل: " + m.name : "أضف مسجداً";
  $("delMosque").hidden = !m;
  $("mName").value = m ? m.name : "";
  (m ? m.off : DEFAULT_OFF).forEach((v, i) => $("o" + i).value = v);
}
$("saveMosque").onclick = () => {
  const name = $("mName").value.trim();
  if (!name) { $("mName").placeholder = "اكتب اسم المسجد أولاً"; $("mName").focus(); return; }
  const off = [0, 1, 2, 3, 4].map(i => Math.min(90, Math.max(0, parseInt($("o" + i).value, 10) || 0)));
  let m = mine.find(x => x.id === editing);
  if (m) { m.name = name; m.off = off; } else { m = { id: "m" + Date.now(), name, off }; mine.push(m); }
  selected = editing = m.id; store.set("mine", mine); store.set("sel", selected);
  renderMine(); renderPrayer();
  $("saveMosque").textContent = "تم الحفظ"; setTimeout(() => $("saveMosque").textContent = "حفظ", 1500);
};
$("newMosque").onclick = () => { editing = null; renderMine(); $("mName").focus(); };
$("delMosque").onclick = () => {
  mine = mine.filter(x => x.id !== editing);
  if (selected === editing) selected = mine[0]?.id || null;
  editing = selected; store.set("mine", mine); store.set("sel", selected);
  renderMine(); renderMosques(true); renderPrayer();
};

/* ===== wiring ===== */
$("locateBtn").onclick = locate;
$("refreshBtn").onclick = () => { if (store.get("located", false)) locate(); else loadMosques(true); };
$("moreBtn").onclick = () => { shown += 8; renderMosques(true); };
$("compassBtn").onclick = startCompass;

const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone && !store.get("hideInstall", false)) $("installHint").hidden = false;
$("installClose").onclick = () => { $("installHint").hidden = true; store.set("hideInstall", true); };

buildTicks(); renderPlace(); renderMine(); renderPrayer();
setInterval(renderPrayer, 1000);
if (store.get("located", false)) { $("locateBtn").hidden = true; loadMosques(false); locate(); }
else setStatus("اضغط «حدّد موقعي» لعرض أقرب المساجد وضبط المواقيت على مكانك.");

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
