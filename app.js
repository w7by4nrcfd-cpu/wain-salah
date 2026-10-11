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
const FALLBACK = { name: "مكة المكرمة (حدّد موقعك لمواقيت مكانك)", lat: 21.4225, lng: 39.8262, approx: true };

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
/* Each time is refined with the sun's position at that moment (two passes), as in PrayTimes */
function prayerTimes(y, m, d, lat, lng, ramadan) {
  const jd0 = julian(y, m, d) - lng / 360;
  const at = h => sun(jd0 + (h - 3) / 24 + lng / 360); // h is local Saudi clock time
  const noonAt = h => { const s = at(h); return { s, noon: 12 + 3 - lng / 15 - s.eqt }; };
  const T = (a, dec) => deg(Math.acos((-Math.sin(rad(a)) - Math.sin(rad(dec)) * Math.sin(rad(lat))) / (Math.cos(rad(dec)) * Math.cos(rad(lat))))) / 15;
  const asrA = dec => -deg(Math.atan(1 / (1 + Math.tan(rad(Math.abs(lat - dec))))));
  let t = [5, 6, 12, 15, 18];
  for (let pass = 0; pass < 2; pass++) {
    const f = noonAt(t[0]), r = noonAt(t[1]), z = noonAt(t[2]), a = noonAt(t[3]), g = noonAt(t[4]);
    t = [f.noon - T(18.5, f.s.decl), r.noon - T(.833, r.s.decl), z.noon, a.noon + T(asrA(a.s.decl), a.s.decl), g.noon + T(.833, g.s.decl)];
  }
  // one-minute precaution on Dhuhr and Asr so a prayer is never shown before its time
  return [t[0], t[1], t[2] + 1 / 60, t[3] + 1 / 60, t[4], t[4] + (ramadan ? 2 : 1.5)];
}
function hm(h, down) {
  h = fix(h, 24); let H = Math.floor(h), M = (down ? Math.floor : Math.ceil)((h - H) * 60 - 1e-9);
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
  const idx = ni === -1 ? 0 : ni, target = Math.ceil((ni === -1 ? day.fajrTomorrow : day.t[ni]) * 60 - 1e-9) / 60; // count down to the shown minute
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
    html += `<div class="row${cls}"><span class="p">${names[i]}</span><span class="t">${hm(x, i === 1)}</span><span class="t q">${iq}</span></div>`;
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

/* ===== adhkar: morning, evening, after prayer (Hisn al-Muslim, authentic narrations only) ===== */
const R = "صلى الله عليه وسلم";
const COMMON_ME = (m) => {
  const am = m === "morning";
  return [
    { t: "قراءة آية الكرسي", n: 1, src: "النسائي" },
    { t: "قراءة سور الإخلاص والفلق والناس", n: 3, src: "أبو داود والترمذي" },
    { t: am
        ? "أصبحنا وأصبح الملك لله، والحمد لله، لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير، رب أسألك خير ما في هذا اليوم وخير ما بعده، وأعوذ بك من شر ما في هذا اليوم وشر ما بعده، رب أعوذ بك من الكسل وسوء الكبر، رب أعوذ بك من عذاب في النار وعذاب في القبر"
        : "أمسينا وأمسى الملك لله، والحمد لله، لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير، رب أسألك خير ما في هذه الليلة وخير ما بعدها، وأعوذ بك من شر ما في هذه الليلة وشر ما بعدها، رب أعوذ بك من الكسل وسوء الكبر، رب أعوذ بك من عذاب في النار وعذاب في القبر",
      n: 1, src: "مسلم" },
    { t: am ? "اللهم بك أصبحنا، وبك أمسينا، وبك نحيا، وبك نموت، وإليك النشور"
            : "اللهم بك أمسينا، وبك أصبحنا، وبك نحيا، وبك نموت، وإليك المصير", n: 1, src: "الترمذي" },
    { t: "اللهم أنت ربي لا إله إلا أنت، خلقتني وأنا عبدك، وأنا على عهدك ووعدك ما استطعت، أعوذ بك من شر ما صنعت، أبوء لك بنعمتك علي، وأبوء بذنبي فاغفر لي، فإنه لا يغفر الذنوب إلا أنت", n: 1, src: "البخاري", note: "سيد الاستغفار" },
    { t: "اللهم إني أسألك العفو والعافية في الدنيا والآخرة، اللهم إني أسألك العفو والعافية في ديني ودنياي وأهلي ومالي، اللهم استر عوراتي، وآمن روعاتي، اللهم احفظني من بين يدي، ومن خلفي، وعن يميني، وعن شمالي، ومن فوقي، وأعوذ بعظمتك أن أغتال من تحتي", n: 1, src: "أبو داود وابن ماجه" },
    { t: "اللهم عالم الغيب والشهادة، فاطر السماوات والأرض، رب كل شيء ومليكه، أشهد أن لا إله إلا أنت، أعوذ بك من شر نفسي، ومن شر الشيطان وشركه، وأن أقترف على نفسي سوءا، أو أجره إلى مسلم", n: 1, src: "الترمذي وأبو داود" },
    { t: "بسم الله الذي لا يضر مع اسمه شيء في الأرض ولا في السماء وهو السميع العليم", n: 3, src: "أبو داود والترمذي" },
    { t: "اللهم عافني في بدني، اللهم عافني في سمعي، اللهم عافني في بصري، لا إله إلا أنت. اللهم إني أعوذ بك من الكفر والفقر، وأعوذ بك من عذاب القبر، لا إله إلا أنت", n: 3, src: "أبو داود" },
    { t: "يا حي يا قيوم برحمتك أستغيث، أصلح لي شأني كله، ولا تكلني إلى نفسي طرفة عين", n: 1, src: "الحاكم" },
    ...(am ? [] : [{ t: "أعوذ بكلمات الله التامات من شر ما خلق", n: 3, src: "مسلم" }]),
    ...(am ? [
      { t: "سبحان الله وبحمده عدد خلقه، ورضا نفسه، وزنة عرشه، ومداد كلماته", n: 3, src: "مسلم" },
      { t: "اللهم إني أسألك علما نافعا، ورزقا طيبا، وعملا متقبلا", n: 1, src: "ابن ماجه" }
    ] : []),
    { t: "سبحان الله وبحمده", n: 100, src: "مسلم" },
    ...(am ? [{ t: "لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير", n: 100, src: "البخاري ومسلم" }] : []),
    { t: "أستغفر الله وأتوب إليه", n: 100, src: "البخاري ومسلم" }
  ];
};
const ADHKAR = {
  morning: { title: "أذكار الصباح", when: "من الفجر حتى ارتفاع الشمس", list: COMMON_ME("morning") },
  evening: { title: "أذكار المساء", when: "من العصر حتى المغرب", list: COMMON_ME("evening") },
  salah: { title: "بعد الصلاة", when: "", list: [
    { t: "أستغفر الله", n: 3, src: "مسلم" },
    { t: "اللهم أنت السلام ومنك السلام، تباركت يا ذا الجلال والإكرام", n: 1, src: "مسلم" },
    { t: "لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير، اللهم لا مانع لما أعطيت، ولا معطي لما منعت، ولا ينفع ذا الجد منك الجد", n: 1, src: "البخاري ومسلم" },
    { t: "سبحان الله", n: 33, src: "مسلم" },
    { t: "الحمد لله", n: 33, src: "مسلم" },
    { t: "الله أكبر", n: 33, src: "مسلم" },
    { t: "لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير", n: 1, src: "مسلم", note: "تمام المئة" },
    { t: "قراءة آية الكرسي", n: 1, src: "النسائي" },
    { t: "قراءة سور الإخلاص والفلق والناس", n: 1, n3: 3, src: "أبو داود والترمذي", note: "ثلاث مرات بعد الفجر والمغرب" },
    { t: "لا إله إلا الله وحده لا شريك له، له الملك وله الحمد، يحيي ويميت، وهو على كل شيء قدير", n: 10, only: "fm", src: "الترمذي", note: "بعد الفجر والمغرب" }
  ] }
};
let tab = null, dhikrFM = false;
const counts = { morning: [], evening: [], salah: [] };
const goalOf = d => (tab === "salah" && dhikrFM && d.n3) ? d.n3 : d.n;
const visible = () => ADHKAR[tab].list.map((d, i) => i).filter(i => !(ADHKAR[tab].list[i].only === "fm" && !dhikrFM));

function lastPrayer(now) {
  const t = day.t; const last = [0, 2, 3, 4, 5].filter(i => t[i] <= now).pop();
  return { last, recent: last != null && now - t[last] < 1 };
}
function suggestTab(now) {
  const t = day.t, { recent } = lastPrayer(now);
  if (recent) return "salah";
  if (now >= t[0] && now < t[2]) return "morning";
  if (now >= t[3] && now < t[5]) return "evening";
  return "salah";
}
function renderDhikrTitle(now) {
  const { last, recent } = lastPrayer(now);
  const fm = last === 0 || last === 4;
  const names = NAMES.slice(); if (day.friday) names[2] = "الجمعة";
  const s = suggestTab(now);
  const hint = s === "salah" ? (recent ? `بعد صلاة ${names[last]}` : "الصباح والمساء وبعد الصلاة")
    : s === "morning" ? "حان وقت أذكار الصباح" : "حان وقت أذكار المساء";
  if ($("dhikrHint").textContent !== hint) $("dhikrHint").textContent = hint;
  if (fm !== dhikrFM) { dhikrFM = fm; if (tab === "salah") renderDhikr(); }
}

const RING = 2 * Math.PI * 17;
function setTab(k) {
  tab = k;
  document.querySelectorAll(".dtab").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === k));
  $("dhikrWhen").textContent = ADHKAR[k].when;
  renderDhikr();
  $("dhikrView").querySelector(".view-body").scrollTop = 0;
}
/* Build the list once; each tap only updates its own card, so fast taps are never lost */
function renderDhikr() {
  if (!tab) return;
  const list = $("dhikr"); list.innerHTML = "";
  const L = ADHKAR[tab].list, c = counts[tab];
  visible().forEach(i => {
    const d = L[i]; c[i] = c[i] || 0;
    const li = document.createElement("li"), b = document.createElement("button");
    b.type = "button"; b.className = "dk";
    b.innerHTML = `<span class="dk-t"><span class="dk-x"></span><span class="dk-note"></span></span>
      <span class="dk-ring"><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" class="r-bg"/><circle cx="20" cy="20" r="17" class="r-fg"/></svg><span class="dk-n"></span></span>`;
    b.querySelector(".dk-x").textContent = d.t;
    b.querySelector(".dk-note").textContent = [d.note, d.src && "رواه " + d.src].filter(Boolean).join(" · ");
    b.addEventListener("click", () => tapDhikr(i, b));
    li.appendChild(b); list.appendChild(li);
    paintDhikr(i, b);
  });
  paintTotal();
}
function paintDhikr(i, b) {
  const d = ADHKAR[tab].list[i], goal = goalOf(d), c = Math.min(counts[tab][i] || 0, goal), done = c >= goal;
  b.classList.toggle("done", done);
  b.querySelector(".r-fg").style.strokeDashoffset = RING * (1 - c / goal);
  b.querySelector(".dk-n").textContent = done ? "✓" : (goal === 1 ? "مرة" : c + "/" + goal);
  b.setAttribute("aria-label", `${d.t}، ${c} من ${goal}`);
}
function paintTotal() {
  const v = visible(), L = ADHKAR[tab].list;
  const done = v.filter(i => (counts[tab][i] || 0) >= goalOf(L[i])).length;
  $("dhikrTotal").textContent = done === v.length ? "أكملت الأذكار، تقبّل الله" : `أكملت ${done} من ${v.length}`;
  $("dhikrBar").style.width = (done / v.length * 100) + "%";
}
function tapDhikr(i, b) {
  const goal = goalOf(ADHKAR[tab].list[i]);
  if ((counts[tab][i] || 0) >= goal) return;
  counts[tab][i] = (counts[tab][i] || 0) + 1;
  const finished = counts[tab][i] === goal;
  if (navigator.vibrate) navigator.vibrate(finished ? 35 : 6);
  paintDhikr(i, b);
  b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump");
  if (finished) {
    paintTotal();
    const next = [...document.querySelectorAll(".dk:not(.done)")][0];
    if (next) setTimeout(() => next.scrollIntoView({ behavior: "smooth", block: "center" }), 250);
  }
}
$("dhikrReset").onclick = () => { counts[tab] = []; renderDhikr(); };
document.querySelectorAll(".dtab").forEach(b => b.onclick = () => setTab(b.dataset.tab));

/* Adhkar open as their own screen; the phone's back gesture closes it */
function showDhikr(open) {
  $("dhikrView").hidden = !open;
  document.body.style.overflow = open ? "hidden" : "";
}
$("openDhikr").onclick = () => {
  const n = saNow(); setTab(suggestTab(n.getUTCHours() + n.getUTCMinutes() / 60));
  history.pushState({ v: "dhikr" }, ""); showDhikr(true);
};
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

buildTicks(); renderPlace(); renderPrayer();
setInterval(renderPrayer, 1000);
// Ask for the real location straight away; until then times are only a placeholder
locate();
if (place.approx) setStatus("اسمح بالوصول لموقعك حتى تُحسب المواقيت لمكانك.");

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
