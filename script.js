(() => {
  'use strict';

  /* ---------- Config ---------- */
  // Ports tried in order. Your message mentioned both 2200 and 2000, so both are covered.
  const CANDIDATE_URLS = [
    'http://127.0.0.1:2200'
  ];
  const STORE_KEY = 'mhs_api_url';
  const OPTIONS = {
    Gender: ['Male', 'Female'],
    Academic_Level: ['High School', 'Undergraduate', 'Graduate'],
    Most_Used_Platform: ['Facebook','LinkedIn','Instagram','Snapchat','Twitter','YouTube','TikTok','LINE','KakaoTalk','VKontakte','WhatsApp','WeChat'],
    Purpose_Of_Use: ['Networking','Education','Entertainment','News'],
    Stress_Level: ['Low','Medium','High','Very High']
  };
  const COUNTRIES = ['India','USA','Canada','Australia','UK','Germany','Mexico','Turkey','France','Brazil','Japan','China','Spain','Italy','Pakistan','Bangladesh','Nigeria','South Africa'];
  const RANGES = { Avg_Daily_Usage_Hours:' h', Study_Hours:' h', Sleep_Hours_Per_Night:' h', Physical_Activity_Hours:' h' };
  const DEFAULTS = {
    Age:20, Gender:'Male', Country:'India', Academic_Level:'Undergraduate', Most_Used_Platform:'Instagram',
    Purpose_Of_Use:'Entertainment', Avg_Daily_Usage_Hours:5, Daily_Unlocks:60, Study_Hours:4,
    Physical_Activity_Hours:1, Sleep_Hours_Per_Night:7, Stress_Level:'Medium'
  };

  const $ = id => document.getElementById(id);
  const form = $('form');
  let baseUrl = null;          // set once an API is found
  let history = [];            // in-memory prediction history
  let liveTimer = null, reqId = 0;

  const store = {
    get() { try { return localStorage.getItem(STORE_KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(STORE_KEY, v); } catch {} }
  };

  /* ---------- Build controls ---------- */
  for (const key of ['Gender','Academic_Level','Stress_Level']) {
    $(key).innerHTML = OPTIONS[key].map((v,i) =>
      `<input type="radio" name="${key}" id="${key}_${i}" value="${v}"><label for="${key}_${i}">${v}</label>`).join('');
  }
  for (const key of ['Most_Used_Platform','Purpose_Of_Use']) {
    $(key).innerHTML = OPTIONS[key].map(v => `<option>${v}</option>`).join('');
  }
  $('countries').innerHTML = COUNTRIES.map(c => `<option value="${c}">`).join('');

  /* ---------- Form helpers ---------- */
  function setValues(v) {
    for (const [k, val] of Object.entries(v)) {
      const radio = document.querySelector(`input[type="radio"][name="${k}"][value="${val}"]`);
      if (radio) radio.checked = true;
      else if ($(k) && !(k in {Gender:1, Academic_Level:1, Stress_Level:1})) $(k).value = val;
    }
    syncOutputs();
  }
  function syncOutputs() {
    for (const k in RANGES) {
      const el = $(k);
      el.nextElementSibling.textContent = String(+el.value) + RANGES[k];
    }
  }
  function getValues() {
    const g = n => (document.querySelector(`input[name="${n}"]:checked`) || {}).value;
    return {
      Age: parseInt($('Age').value, 10),
      Gender: g('Gender'),
      Country: $('Country').value.trim(),
      Academic_Level: g('Academic_Level'),
      Most_Used_Platform: $('Most_Used_Platform').value,
      Purpose_Of_Use: $('Purpose_Of_Use').value,
      Avg_Daily_Usage_Hours: parseFloat($('Avg_Daily_Usage_Hours').value),
      Daily_Unlocks: parseInt($('Daily_Unlocks').value, 10),
      Study_Hours: parseFloat($('Study_Hours').value),
      Physical_Activity_Hours: parseFloat($('Physical_Activity_Hours').value),
      Sleep_Hours_Per_Night: parseFloat($('Sleep_Hours_Per_Night').value),
      Stress_Level: g('Stress_Level')
    };
  }
  function validate(show = true) {
    const v = getValues();
    const checks = {
      Age: Number.isInteger(v.Age) && v.Age >= 10 && v.Age <= 100,
      Country: v.Country.length > 0,
      Daily_Unlocks: Number.isInteger(v.Daily_Unlocks) && v.Daily_Unlocks >= 0
    };
    let ok = true;
    for (const [k, pass] of Object.entries(checks)) {
      if (!pass) ok = false;
      if (show) document.querySelector(`[data-f="${k}"]`).classList.toggle('invalid', !pass);
    }
    return ok ? v : null;
  }

  /* ---------- API helpers ---------- */
  function showBanner(msg) { const b = $('banner'); b.textContent = msg; b.classList.toggle('show', !!msg); }
  function setStatus(state, text) { $('statusDot').className = 'dot ' + state; $('statusText').textContent = text; }

  async function ping(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1800);
    try {
      const r = await fetch(url + '/', { cache: 'no-store', signal: ctrl.signal });
      return r.ok;
    } catch { return false; }
    finally { clearTimeout(t); }
  }

  // Finds a working backend. `preferred` (typed by the user) is tried first, then the saved URL, then the defaults.
  async function findApi(preferred) {
    setStatus('', 'Looking for API…');
    const list = [preferred, store.get(), ...CANDIDATE_URLS]
      .filter(Boolean).map(u => u.replace(/\/+$/, ''));
    const unique = [...new Set(list)];
    const results = await Promise.all(unique.map(async u => [u, await ping(u)]));
    const hit = unique.find(u => results.find(([x, ok]) => x === u && ok));
    if (hit) {
      baseUrl = hit; store.set(hit);
      setStatus('on', 'API connected · ' + hit.replace(/^https?:\/\//, ''));
      showBanner('');
      return true;
    }
    baseUrl = null;
    setStatus('off', 'API offline');
    showBanner(
      "Can't reach the API. I tried:\n" + unique.join('\n') +
      "\n\nStart the backend with: uvicorn main:app --port 2000 (or 2200), then press the status button. " +
      "If it is running on another port, enter it in API settings."
    );
    return false;
  }

  function errorText(status, body) {
    if (status === 422 && body && Array.isArray(body.detail)) {
      return 'The API rejected some values: ' + body.detail.map(d => `${(d.loc || []).slice(1).join('.')} (${d.msg})`).join('; ');
    }
    if (status === 500) {
      return 'The model crashed while predicting (HTTP 500). Check the uvicorn terminal for the traceback. ' +
             'It usually means the input columns do not match what the model was trained on.';
    }
    return `The API returned HTTP ${status}. Check the backend terminal for details.`;
  }

  async function predict(payload, silent = false) {
    const id = ++reqId;
    if (!silent) { $('submitBtn').disabled = true; $('submitBtn').innerHTML = '<span class="spin"></span>Predicting…'; }
    try {
      if (!baseUrl && !(await findApi())) return;
      let r;
      try {
        r = await fetch(baseUrl + '/predict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (netErr) {
        // Server may have moved or stopped: re-detect once and retry.
        console.warn('Network error, re-detecting API', netErr);
        baseUrl = null;
        if (!(await findApi())) return;
        r = await fetch(baseUrl + '/predict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
      let body = null;
      try { body = await r.json(); } catch {}
      if (!r.ok) { console.error('Predict failed', r.status, body); if (id === reqId) showBanner(errorText(r.status, body)); return; }
      if (id !== reqId) return;     // a newer request replaced this one
      const score = Number(body && body.predicted_mental_health_score);
      if (!Number.isFinite(score)) { showBanner('The API replied, but the response had no predicted_mental_health_score.'); console.error(body); return; }
      showBanner('');
      renderResult(score, payload);
      addHistory(score, payload);
    } catch (e) {
      console.error(e);
      if (id === reqId) showBanner('Something went wrong: ' + (e && e.message ? e.message : e));
    } finally {
      if (!silent || id === reqId) { $('submitBtn').disabled = false; $('submitBtn').textContent = 'Predict score'; }
    }
  }

  /* ---------- Result rendering ---------- */
  const ARC = 314.16;
  function band(s) {
    if (s >= 7.5) return { c:'var(--good)',   t:'Doing well',      d:'Habits point to a healthy score.' };
    if (s >= 6)   return { c:'var(--accent)', t:'Fairly stable',   d:'Mostly balanced, with room to improve.' };
    if (s >= 4.5) return { c:'var(--warn)',   t:'Needs attention', d:'Some habits may be pulling the score down.' };
    return          { c:'var(--bad)',    t:'At risk',         d:'Several factors suggest a low score.' };
  }
  function renderResult(score, p) {
    const pct = Math.max(0, Math.min(1, score / 10));
    const b = band(score);
    const arc = $('arc');
    arc.style.stroke = b.c;
    arc.style.strokeDashoffset = ARC * (1 - pct);
    $('verdict').textContent = b.t; $('verdict').style.color = b.c;
    $('verdictSub').textContent = b.d;
    countUp($('gaugeNum'), score);
    renderInsights(p);
  }
  let cu;
  function countUp(el, to) {
    cancelAnimationFrame(cu);
    const from = parseFloat(el.textContent) || 0, t0 = performance.now(), dur = 800;
    const step = t => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = (from + (to - from) * e).toFixed(2);
      if (k < 1) cu = requestAnimationFrame(step);
    };
    cu = requestAnimationFrame(step);
  }
  function renderInsights(p) {
    const items = [];
    const add = (cls, txt) => items.push(`<li class="${cls}">${txt}</li>`);
    if (p.Sleep_Hours_Per_Night < 6) add('bad', `Sleep is ${p.Sleep_Hours_Per_Night} h a night. Under 6 h is linked with lower wellbeing.`);
    else if (p.Sleep_Hours_Per_Night >= 7 && p.Sleep_Hours_Per_Night <= 9) add('good', `Sleep of ${p.Sleep_Hours_Per_Night} h is in the healthy 7–9 h range.`);
    if (p.Avg_Daily_Usage_Hours >= 6) add('bad', `${p.Avg_Daily_Usage_Hours} h of daily social media use is high.`);
    else if (p.Avg_Daily_Usage_Hours <= 3) add('good', `Social media use is moderate at ${p.Avg_Daily_Usage_Hours} h a day.`);
    if (p.Stress_Level === 'High' || p.Stress_Level === 'Very High') add('warn', `Stress is reported as ${p.Stress_Level.toLowerCase()}.`);
    if (p.Physical_Activity_Hours >= 1) add('good', `${p.Physical_Activity_Hours} h of physical activity helps.`);
    else add('warn', `Physical activity is only ${p.Physical_Activity_Hours} h.`);
    if (p.Daily_Unlocks > 100) add('warn', `${p.Daily_Unlocks} phone unlocks a day suggests frequent checking.`);
    $('insights').innerHTML = items.slice(0, 5).join('');
    $('insightCard').hidden = items.length === 0;
  }

  /* ---------- History ---------- */
  function addHistory(score, p) {
    history.unshift({ score, p, time: new Date() });
    history = history.slice(0, 8);
    renderHistory();
  }
  function renderHistory() {
    $('histEmpty').hidden = history.length > 0;
    $('hist').innerHTML = history.map((h, i) => {
      const t = h.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `<li><span>${h.p.Age}y, ${h.p.Sleep_Hours_Per_Night}h sleep, ${h.p.Avg_Daily_Usage_Hours}h screen<br><small style="color:var(--muted)">${t}</small></span><span><b style="color:${band(h.score).c}">${h.score.toFixed(2)}</b> <button type="button" data-i="${i}">Load</button></span></li>`;
    }).join('');
    const sp = $('spark');
    if (history.length < 2) { sp.hidden = true; return; }
    sp.hidden = false;
    const pts = history.slice().reverse().map((h, i, a) => [(i / (a.length - 1)) * 290 + 5, 42 - (h.score / 10) * 38]);
    sp.innerHTML =
      `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
      pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="var(--accent)"/>`).join('');
  }
  $('hist').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    const h = history[+b.dataset.i]; setValues(h.p); renderResult(h.score, h.p);
  });

  /* ---------- Events ---------- */
  form.addEventListener('submit', e => {
    e.preventDefault();
    const v = validate(true);
    if (!v) { const bad = form.querySelector('.field.invalid .input'); if (bad) bad.focus(); return; }
    predict(v);
  });
  form.addEventListener('input', e => {
    syncOutputs();
    const v = validate(false);
    if (e.target.closest('.field.invalid')) validate(true);
    if ($('live').checked && v) { clearTimeout(liveTimer); liveTimer = setTimeout(() => predict(v, true), 450); }
  });
  $('resetBtn').addEventListener('click', () => { setValues(DEFAULTS); validate(true); showBanner(''); });
  $('sampleBtn').addEventListener('click', () => {
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const r = (min, max, step) => Math.round((min + Math.random() * (max - min)) / step) * step;
    setValues({
      Age: 17 + Math.floor(Math.random() * 12), Gender: pick(OPTIONS.Gender), Country: pick(COUNTRIES.slice(0, 9)),
      Academic_Level: pick(OPTIONS.Academic_Level), Most_Used_Platform: pick(OPTIONS.Most_Used_Platform),
      Purpose_Of_Use: pick(OPTIONS.Purpose_Of_Use), Avg_Daily_Usage_Hours: r(1, 9, .5), Daily_Unlocks: Math.floor(20 + Math.random() * 140),
      Study_Hours: r(1, 9, .5), Physical_Activity_Hours: r(0, 2, .25), Sleep_Hours_Per_Night: r(4.5, 9, .5),
      Stress_Level: pick(OPTIONS.Stress_Level)
    });
    const v = validate(true); if (v) predict(v);
  });

  /* Settings dialog */
  const dlg = $('settings');
  $('settingsBtn').addEventListener('click', () => { $('baseUrl').value = baseUrl || store.get() || ''; dlg.showModal(); });
  $('closeSettings').addEventListener('click', () => dlg.close());
  $('saveSettings').addEventListener('click', async () => {
    const typed = $('baseUrl').value.trim();
    dlg.close();
    await findApi(typed || undefined);
  });
  $('statusPill').addEventListener('click', () => findApi());

  /* Theme */
  $('themeBtn').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
  });

  /* ---------- Init ---------- */
  setValues(DEFAULTS);
  findApi();
})();
