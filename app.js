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
const FALLBACK = { name: "لم يُحدَّد بعد", lat: 21.4225, lng: 39.8262, approx: true };

let place = store.get("place", FALLBACK);
if (place.approx || place.manual) place = FALLBACK; // never show a made-up town as the user's location
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
  const ym = new Date(Date.UTC(y, m - 1, d - 1));
  const ty = prayerTimes(ym.getUTCFullYear(), ym.getUTCMonth() + 1, ym.getUTCDate(), place.lat, place.lng, false);
  day = {
    key: `${y}-${m}-${d}-${place.lat}-${place.lng}`, t, fajrTomorrow: tt[0] + 24, maghribYesterday: ty[4] - 24,
    hijri: h.text, ramadan: h.ramadan || !!window.__forceRamadan, friday: n.getUTCDay() === 5 || !!window.__forceFriday,
    hijriDay: +new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { day: "numeric", timeZone: "UTC" }).format(n),
    greg: new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(n)
  };
}

function renderPrayer() {
  const n = saNow();
  if (!day || !day.key.startsWith(`${n.getUTCFullYear()}-${n.getUTCMonth() + 1}-${n.getUTCDate()}-`)) computeDay();
  const now = n.getUTCHours() + n.getUTCMinutes() / 60 + n.getUTCSeconds() / 3600;
  const off = DEFAULT_OFF;
  const ni = day.t.findIndex((x, i) => i !== 1 && x > now);
  const idx = ni === -1 ? 0 : ni, target = ni === -1 ? day.fajrTomorrow : day.t[ni];
  const left = Math.max(0, Math.round((target - now) * 3600));
  $("countdown").textContent = [left / 3600 | 0, (left % 3600) / 60 | 0, left % 60].map(v => String(v).padStart(2, "0")).join(":");
  const names = NAMES.slice(); if (day.friday) names[2] = "الجمعة";
  $("nextName").textContent = names[idx];
  $("nextAdhan").textContent = hm(target);
  $("nextIqama").textContent = "الإقامة تقريباً " + hm(target + off[OFF_IDX[idx]] / 60);
  $("hijri").textContent = day.hijri; $("greg").textContent = day.greg;

  let html = '<div class="row head"><span>الصلاة</span><span class="t">الأذان</span><span class="t">الإقامة</span></div>';
  day.t.forEach((x, i) => {
    const cls = ni === -1 || i < ni ? " past" : i === ni ? " next" : "";
    const iq = OFF_IDX[i] === null ? "—" : hm(x + off[OFF_IDX[i]] / 60);
    html += `<div class="row${cls}"><span class="p">${names[i]}</span><span class="t">${hm(x)}</span><span class="t q">${iq}</span></div>`;
  });
  if (ni === -1) html += `<div class="row next"><span class="p">فجر الغد</span><span class="t">${hm(day.fajrTomorrow)}</span><span class="t q">${hm(day.fajrTomorrow + off[0] / 60)}</span></div>`;
  if ($("table").dataset.h !== html) { $("table").innerHTML = html; $("table").dataset.h = html; }
  renderExtra(now); renderSpecial(now); renderDhikrTitle(now);
}

const clock = s => [s / 3600 | 0, (s % 3600) / 60 | 0, s % 60].map(v => String(v).padStart(2, "0")).join(":");
const setHTML = (el, html) => { if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; } };

/* Duha, middle of the night, last third (night = Maghrib to the next Fajr) */
function renderExtra(now) {
  const t = day.t;
  const [m, f] = now < t[0] ? [day.maghribYesterday, t[0]] : [t[4], day.fajrTomorrow];
  const night = f - m;
  const items = [
    ["الضحى", "يبدأ", t[1] + 15 / 60, "بعد الشروق بربع ساعة"],
    ["منتصف الليل", "", m + night / 2, "آخر وقت العشاء المختار"],
    ["الثلث الأخير", "يبدأ", m + night * 2 / 3, "أفضل وقت لقيام الليل"]
  ];
  setHTML($("extra"), items.map(([n, pre, x, sub]) =>
    `<div class="ex"><span class="ex-n">${n}</span><span class="ex-t">${pre ? pre + " " : ""}${hm(x)}</span><span class="ex-s">${sub}</span></div>`).join(""));
}

/* Ramadan and Friday cards */
function renderSpecial(now) {
  const t = day.t; let html = "";
  if (day.ramadan) {
    let label, target;
    if (now < t[0]) { label = "باقي على الإمساك"; target = t[0]; }
    else if (now < t[4]) { label = "باقي على الإفطار"; target = t[4]; }
    else { label = "باقي على الإمساك"; target = day.fajrTomorrow; }
    const left = Math.max(0, Math.round((target - now) * 3600));
    html += `<div class="sp ramadan"><div class="sp-top"><span class="sp-tag">رمضان</span><span class="sp-day">اليوم ${day.hijriDay}</span></div>
      <div class="sp-lbl">${label}</div><div class="sp-count">${clock(left)}</div>
      <div class="sp-row"><span>الإمساك ${hm(now >= t[4] ? day.fajrTomorrow : t[0])}</span><span>الإفطار ${hm(t[4])}</span></div></div>`;
  }
  if (day.friday) {
    const left = Math.max(0, Math.round((t[2] - now) * 3600));
    html += `<div class="sp friday"><div class="sp-top"><span class="sp-tag">يوم الجمعة</span>${now < t[2] ? `<span class="sp-day">الأذان بعد ${clock(left)}</span>` : ""}</div>
      <ul class="sunan"><li>قراءة سورة الكهف</li><li>الإكثار من الصلاة على النبي صلى الله عليه وسلم</li><li>الاغتسال والتطيب والتبكير إلى المسجد</li><li>تحرّي ساعة الإجابة آخر ساعة بعد العصر</li></ul></div>`;
  }
  setHTML($("special"), html);
}

/* ===== adhkar after prayer (Hisn al-Muslim) ===== */
const DHIKR = [
  { t: "أستغفر الله", n: 3 },
  { t: "اللهم أنت السلام ومنك السلام، تباركت يا ذا الجلال والإكرام", n: 1 },
  { t: "لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير، اللهم لا مانع لما أعطيت، ولا معطي لما منعت، ولا ينفع ذا الجد منك الجد", n: 1 },
  { t: "سبحان الله", n: 33 },
  { t: "الحمد لله", n: 33 },
  { t: "الله أكبر", n: 33 },
  { t: "لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير", n: 1, note: "تمام المئة" },
  { t: "قراءة آية الكرسي", n: 1 },
  { t: "قراءة سورة الإخلاص والفلق والناس", n: 1, n3: 3, note: "ثلاث مرات بعد الفجر والمغرب" },
  { t: "لا إله إلا الله وحده لا شريك له، له الملك وله الحمد، يحيي ويميت، وهو على كل شيء قدير", n: 10, only: "fm", note: "بعد الفجر والمغرب" }
];
let dhikrCounts = DHIKR.map(() => 0), dhikrFM = false;
function renderDhikrTitle(now) {
  const t = day.t;
  const last = [0, 2, 3, 4, 5].filter(i => t[i] <= now).pop();
  const recent = last != null && now - t[last] < 1;
  const fm = last === 0 || last === 4;
  const names = NAMES.slice(); if (day.friday) names[2] = "الجمعة";
  const txt = recent ? `أذكار ما بعد صلاة ${names[last]}. اضغط على الذكر لتعدّه.` : "اضغط على الذكر لتعدّه.";
  if ($("dhikrFor").textContent !== txt) $("dhikrFor").textContent = txt;
  const hint = recent ? `بعد صلاة ${names[last]}` : "من حصن المسلم، مع عدّاد";
  if ($("dhikrHint").textContent !== hint) $("dhikrHint").textContent = hint;
  if (fm !== dhikrFM) { dhikrFM = fm; renderDhikr(); }
}
function renderDhikr() {
  const list = $("dhikr"); list.innerHTML = "";
  DHIKR.forEach((d, i) => {
    if (d.only === "fm" && !dhikrFM) return;
    const goal = dhikrFM && d.n3 ? d.n3 : d.n, c = Math.min(dhikrCounts[i], goal);
    const li = document.createElement("li"), b = document.createElement("button");
    b.type = "button"; b.className = "dk" + (c >= goal ? " done" : "");
    b.innerHTML = `<span class="dk-t"></span><span class="dk-c">${c >= goal ? "✓" : c + " / " + goal}</span>`;
    b.querySelector(".dk-t").textContent = d.t + (d.note ? ` (${d.note})` : "");
    b.style.setProperty("--p", (c / goal * 100) + "%");
    b.onclick = () => { if (dhikrCounts[i] < goal) { dhikrCounts[i]++; if (navigator.vibrate) navigator.vibrate(dhikrCounts[i] === goal ? 40 : 8); renderDhikr(); } };
    li.appendChild(b); list.appendChild(li);
  });
}
$("dhikrReset").onclick = () => { dhikrCounts = DHIKR.map(() => 0); renderDhikr(); };

/* Adhkar open as their own screen; the phone's back gesture closes it */
function showDhikr(open) {
  $("dhikrView").hidden = !open;
  document.body.style.overflow = open ? "hidden" : "";
  if (open) $("dhikrView").querySelector(".view-body").scrollTop = 0;
}
$("openDhikr").onclick = () => { history.pushState({ v: "dhikr" }, ""); showDhikr(true); };
$("closeDhikr").onclick = () => history.state && history.state.v === "dhikr" ? history.back() : showDhikr(false);
window.addEventListener("popstate", () => showDhikr(history.state && history.state.v === "dhikr"));

/* ===== location ===== */
function renderPlace() {
  $("placeName").textContent = place.name;
  $("coords").textContent = place.approx ? "" : `(${place.lat.toFixed(4)}، ${place.lng.toFixed(4)})`; renderQibla(); setMapLinks(); }

/* Nearest mosques in Apple / Google Maps: centred on the GPS fix when we have one,
   otherwise the Maps app uses the phone's own location. */
function setMapLinks() {
  // Same links as the first version: no coordinates, so the Maps app searches from the phone's GPS
  renderPicker();
}

function locate() {
  if (!("geolocation" in navigator)) { setStatus("جهازك لا يدعم تحديد الموقع."); return; }
  $("locateBtn").disabled = true; $("locateBtn").textContent = "جارٍ التحديد…";
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    place = { name: "موقعك الحالي", lat, lng };
    store.set("place", place); store.set("located", true);
    $("locateBtn").disabled = false; $("locateBtn").textContent = "تحديث الموقع"; setStatus("");
    day = null; renderPlace(); renderPrayer();
    placeName(lat, lng);
  }, err => {
    $("locateBtn").disabled = false; $("locateBtn").textContent = "حدّد موقعي";
    setStatus(err.code === 1
      ? "لم تسمح بالوصول للموقع. فعّله من الإعدادات ← الخصوصية ← خدمات الموقع ← Safari، ثم اضغط «حدّد موقعي»."
      : "تعذّر تحديد موقعك، حاول مرة أخرى في مكان مكشوف.");
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}

/* Name of the place: two free sources, so villages anywhere still get a name */
async function withTimeout(url, ms) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw 0; return await r.json(); }
  finally { clearTimeout(t); }
}
async function placeName(lat, lng) {
  const uniq = arr => arr.filter((v, i) => v && arr.indexOf(v) === i);
  const sources = [
    async () => {
      const j = await withTimeout(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&accept-language=ar`, 8000);
      const a = j.address || {};
      const local = a.hamlet || a.village || a.neighbourhood || a.suburb || a.quarter || a.isolated_dwelling || a.town || a.city;
      const wider = a.county || a.state_district || a.municipality || a.state;
      return local ? uniq([local, wider]) : [];
    },
    async () => {
      const j = await withTimeout(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=ar`, 8000);
      return j.locality ? uniq(["قرب " + j.locality, j.city]) : [];
    }
  ];
  for (const src of sources) {
    try {
      const parts = await src();
      if (parts.length) { place.name = parts.join("، "); store.set("place", place); renderPlace(); return; }
    } catch (e) {}
  }
  place.name = "موقعك الحالي (بدون اسم في الخرائط)"; store.set("place", place); renderPlace();
}


/* ===== Google Maps picker: choose what to search before leaving the site ===== */
const KINDS = {
  mosque: { term: "مسجد", note: "المساجد حول موقعك." },
  women:  { term: "مصلى نساء", note: "المصليات النسائية حول موقعك." }
};
let kind = store.get("kind", "mosque");
function renderPicker() {
  if (!KINDS[kind]) kind = "mosque";
  const k = KINDS[kind];
  document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-checked", b.dataset.kind === kind));
  $("kindNote").textContent = k.note;
  $("mapsGo").textContent = "ابحث عن أقرب " + k.term + " في خرائط Google";
  $("mapsGo").href = "https://www.google.com/maps/search/" + encodeURIComponent(k.term);
}
document.querySelectorAll(".seg button").forEach(b => b.onclick = () => { kind = b.dataset.kind; store.set("kind", kind); renderPicker(); });

function setStatus(t) { $("mosqueStatus").textContent = t; }

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
  heading = h; renderQibla();
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

/* ===== wiring ===== */
$("locateBtn").onclick = locate;
$("compassBtn").onclick = startCompass;

const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone && !store.get("hideInstall", false)) $("installHint").hidden = false;
$("installClose").onclick = () => { $("installHint").hidden = true; store.set("hideInstall", true); };

buildTicks(); renderPlace(); renderPrayer(); renderDhikr();
setInterval(renderPrayer, 1000);
// Ask for the real location straight away; until then times are only a placeholder
locate();
if (place.approx) setStatus("اسمح بالوصول لموقعك حتى تُحسب المواقيت لمكانك.");

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
