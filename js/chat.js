import { esc, formatText, safeUrl, toast, icon, initTheme, debounce, registerSW, uuid } from './shared.js';
import { configured, app, db, fs } from './firebase.js';
import { t, getLang, setLanguage, applyStatic, savedLanguage } from './i18n.js';
import { LANGS, CONTENT_LANG, TRANSLATE, translateText, safeTranslate, detectScriptLang } from './translate.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, GoogleAuthProvider, signInWithPopup,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const KINDS = {
  app: { key: 'openApp', icon: 'app' },
  website: { key: 'openWebsite', icon: 'globe' },
  apk: { key: 'downloadApk', icon: 'download' },
};

const $ = (s) => document.querySelector(s);
const listEl = $('#messages');
const inputEl = $('#input');
const sendBtn = $('#sendBtn');
const chipsEl = $('#chips');
const panel = $('#searchPanel');
const sInput = $('#searchInput');
const sResults = $('#searchResults');
const drawer = $('#drawer');
const dScrim = $('#dScrim');
const threadListEl = $('#threadList');
const sheetBd = $('#sheetBd');
const sheet = $('#sheet');

let session = null;
let threadId = null;
let hadStored = false;
const seen = new Set();
const mine = new Set();
let lastDay = '';
let busy = false;
let typingEl = null;
let qa = [];
let results = [];
let threads = [];
let sub = null;
let settings = null;
let payments = [];
let selPlan = 'monthly';
let currentUid = null;
let unsub = null, unsubQA = null, unsubSub = null, unsubSet = null, unsubPay = null, unsubTh = null;

/* ---------- static UI ---------- */
$('#logo').innerHTML = icon('chat', 22);
$('#menuBtn').innerHTML = icon('menu');
$('#searchBtn').innerHTML = icon('search');
$('#installBtn').innerHTML = icon('download');
sendBtn.innerHTML = icon('send');
initTheme($('#themeBtn'));
registerSW();

if (!configured) {
  $('#setupBanner').textContent = 'Setup pending: add your Firebase config in js/config.js.';
  $('#setupBanner').classList.remove('hidden');
  $('#authScreen').classList.add('hidden');
  inputEl.disabled = true;
  sendBtn.disabled = true;
}

const fmtTime = (ts) => new Date(ts).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' });
const fmtDate = (ts) => new Date(ts).toLocaleDateString(getLang(), { day: 'numeric', month: 'short', year: 'numeric' });
const isPremium = () => !!(sub && sub.expiresAt > Date.now());

/* ---------- render ---------- */
function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t('today');
  if (d.toDateString() === y.toDateString()) return t('yesterday');
  return fmtDate(ts);
}

function linkBtn(l) {
  const href = safeUrl(l?.url);
  if (!href) return '';
  const k = KINDS[l.kind] || KINDS.website;
  const text = esc(l.label || t(k.key));
  const dl = l.kind === 'apk' ? ' download' : '';
  return `<a class="link-btn ${esc(l.kind)}" href="${esc(href)}" target="_blank" rel="noopener noreferrer"${dl}>${icon(k.icon, 20)}<span>${text}</span></a>`;
}

function put(el) {
  if (typingEl && typingEl.parentNode === listEl) listEl.insertBefore(el, typingEl);
  else listEl.appendChild(el);
}

function addMessage(m, { scroll = true } = {}) {
  if (m.id) {
    if (seen.has(m.id)) return;
    seen.add(m.id);
  }
  const label = dayLabel(m.ts);
  if (label !== lastDay) {
    lastDay = label;
    const d = document.createElement('div');
    d.className = 'day';
    d.textContent = label;
    put(d);
  }
  const links = (Array.isArray(m.links) ? m.links : []).map(linkBtn).join('');
  const lock = m.premium ? `<button type="button" class="link-btn apk" data-premium>👑<span>${esc(t('getPremiumLock'))}</span></button>` : '';
  const el = document.createElement('div');
  el.className = `msg ${m.role}`;
  el.innerHTML = `${m.role === 'bot' ? `<div class="avatar">${icon('bot', 18)}</div>` : ''}
    <div class="col"><div class="bubble">${formatText(m.content)}${links || lock ? `<div class="links">${links}${lock}</div>` : ''}</div>
    <div class="time">${fmtTime(m.ts)}</div></div>`;
  put(el);
  if (scroll) listEl.scrollTop = listEl.scrollHeight;
}
listEl.addEventListener('click', (e) => {
  if (e.target.closest('[data-premium]')) openPremium();
});

function showTyping() {
  typingEl = document.createElement('div');
  typingEl.className = 'msg bot';
  typingEl.innerHTML = `<div class="avatar">${icon('bot', 18)}</div><div class="col"><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>`;
  listEl.appendChild(typingEl);
  listEl.scrollTop = listEl.scrollHeight;
}
function hideTyping() {
  typingEl?.remove();
  typingEl = null;
}

/* ---------- answer matching (Hindi / English / Hinglish) ---------- */
const tokenize = (s) => [...new Set(String(s).toLowerCase().split(/[^\p{L}\p{N}\p{M}]+/u).filter((w) => w.length >= 2))];

function bigrams(s) {
  const c = [...s.replace(/\s+/g, ' ').trim()];
  const out = new Map();
  for (let i = 0; i < c.length - 1; i++) {
    const g = c[i] + c[i + 1];
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}
function dice(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  let na = 0, nb = 0, inter = 0;
  A.forEach((v) => (na += v));
  B.forEach((v) => (nb += v));
  if (!na || !nb) return a && a === b ? 1 : 0;
  A.forEach((v, g) => {
    if (B.has(g)) inter += Math.min(v, B.get(g));
  });
  return (2 * inter) / (na + nb);
}
function score(item, text) {
  const toks = tokenize(text);
  if (!toks.length) return 0;
  const q = String(item.question).toLowerCase();
  const kws = item.keywords || [];
  let sum = 0;
  for (const w of toks) {
    if (kws.includes(w)) sum += 2;
    else if (q.includes(w)) sum += 1;
  }
  return (sum / (2 * toks.length)) * 2 + dice(q, text.toLowerCase().trim());
}
function findAnswers(text, max = 1) {
  return qa
    .map((i) => ({ ...i, score: score(i, text) }))
    .filter((i) => i.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

/* ---------- live data ---------- */
function listenQA() {
  unsubQA?.();
  unsubQA = fs.onSnapshot(
    fs.query(fs.collection(db, 'qa'), fs.where('isActive', '==', true)),
    (snap) => {
      qa = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const top = [...qa].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 8);
      chipsEl.innerHTML = top.map((r) => `<button type="button" class="chip" title="${esc(r.question)}">${r.isPremium ? '👑 ' : ''}${esc(r.question)}</button>`).join('');
    },
    (err) => console.warn('qa listen failed', err)
  );
}

function listenChat() {
  unsub?.();
  let first = true;
  const q = fs.query(fs.collection(db, 'chats', session, 'threads', threadId, 'messages'), fs.orderBy('ts', 'asc'), fs.limit(300));
  unsub = fs.onSnapshot(
    q,
    (snap) => {
      if (first && snap.empty) addMessage({ id: 'welcome', role: 'bot', content: t('welcome'), ts: Date.now() }, { scroll: false });
      snap.docChanges().forEach((ch) => {
        if (ch.type !== 'added') return;
        const m = { id: ch.doc.id, ...ch.doc.data() };
        if (!first && m.role === 'bot' && !mine.has(m.id)) toast(t('newReply'));
        addMessage(m, { scroll: false });
      });
      first = false;
      listEl.scrollTop = listEl.scrollHeight;
    },
    (err) => {
      console.warn(err);
      toast(t('loadFail'), 'error');
    }
  );
}

function listenThreads() {
  unsubTh?.();
  let first = true;
  unsubTh = fs.onSnapshot(
    fs.query(fs.collection(db, 'chats', session, 'threads'), fs.orderBy('updatedAt', 'desc'), fs.limit(100)),
    (snap) => {
      threads = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (first) {
        first = false;
        if (!hadStored && threads.length) {
          openThread(threads[0].id);
          return;
        }
      }
      renderThreads();
    },
    (err) => console.warn('threads listen failed', err)
  );
}

function renderThreads() {
  threadListEl.innerHTML = threads.length
    ? threads
        .map((th) => `<button type="button" class="th ${th.id === threadId ? 'on' : ''}" data-tid="${esc(th.id)}"><b>${esc(th.title || 'Chat')}</b><small>${fmtDate(th.updatedAt || th.createdAt || Date.now())}</small></button>`)
        .join('')
    : `<p class="hint" style="margin:4px">${esc(t('noChats'))}</p>`;
}

function openThread(tid) {
  threadId = tid;
  localStorage.setItem('ar-thread-' + session, tid);
  listEl.innerHTML = '';
  seen.clear();
  lastDay = '';
  typingEl = null;
  listenChat();
  renderThreads();
  closeDrawer();
}

function openDrawer() {
  drawer.classList.add('open');
  dScrim.classList.add('open');
}
function closeDrawer() {
  drawer.classList.remove('open');
  dScrim.classList.remove('open');
}
$('#menuBtn').addEventListener('click', openDrawer);
dScrim.addEventListener('click', closeDrawer);
$('#newChatBtn').addEventListener('click', () => openThread(uuid()));
threadListEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-tid]');
  if (b) openThread(b.dataset.tid);
});

/* ---------- sending ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const saveMsg = (m) =>
  fs.setDoc(fs.doc(db, 'chats', session, 'threads', threadId, 'messages', m.id), {
    role: m.role, content: m.content, links: m.links || [], qaId: m.qaId || null, ts: m.ts,
    ...(m.premium ? { premium: true } : {}),
  });

function touchThread(text) {
  const ref = fs.doc(db, 'chats', session, 'threads', threadId);
  const now = Date.now();
  if (threads.some((x) => x.id === threadId)) return fs.updateDoc(ref, { updatedAt: now });
  return fs.setDoc(ref, { title: text.slice(0, 40), createdAt: now, updatedAt: now });
}

let transWarned = false;
/** Translate admin-written text (CONTENT_LANG) into the user's language. Falls back to the original text. */
async function toUserLang(text) {
  const lang = getLang();
  if (!text || lang === CONTENT_LANG) return text;
  const r = await safeTranslate(text, CONTENT_LANG, lang);
  if (!r.ok && !transWarned) {
    transWarned = true;
    toast(t('transFail'), 'error');
  }
  return r.text;
}

/** Find the best saved answer. If nothing matches, translate the question to the admin's language and try again. */
async function findForQuestion(text) {
  const hit = findAnswers(text, 1)[0];
  if (hit || TRANSLATE.provider === 'none') return hit || null;
  const src = detectScriptLang(text) || (getLang() !== CONTENT_LANG ? getLang() : null);
  if (!src || src === CONTENT_LANG) return null;
  const r = await safeTranslate(text, src, CONTENT_LANG);
  if (!r.ok || r.text.trim().toLowerCase() === text.trim().toLowerCase()) return null;
  return findAnswers(r.text, 1)[0] || null;
}

async function buildReply(item, text) {
  const bot = { id: uuid(), role: 'bot', links: [] };
  if (!item) {
    bot.content = t('fallback');
    fs.addDoc(fs.collection(db, 'unanswered'), {
      question: text, sessionId: session, threadId, email: auth.currentUser?.email || '', lang: getLang(), status: 'pending', createdAt: Date.now(),
    }).catch((e) => console.warn('unanswered save failed', e));
    return bot;
  }
  bot.qaId = item.id;
  if (!item.isPremium) {
    bot.content = await toUserLang(item.answer);
    bot.links = (item.links || []).map(({ kind, label, url }) => ({ kind, label: label || '', url }));
    return bot;
  }
  if (isPremium()) {
    try {
      const d = await fs.getDoc(fs.doc(db, 'qa_premium', item.id));
      if (d.exists()) {
        bot.content = await toUserLang(d.data().answer);
        bot.links = (d.data().links || []).map(({ kind, label, url }) => ({ kind, label: label || '', url }));
        return bot;
      }
    } catch (e) {
      console.warn('premium fetch failed', e);
    }
  }
  bot.premium = true;
  bot.content = t('locked');
  if (item.answer && !String(item.answer).startsWith('🔒')) bot.content += '\n\n' + t('preview', { text: await toUserLang(item.answer) });
  return bot;
}

async function ask(text, direct = null) {
  text = (text || '').trim().slice(0, 500);
  if (!text || busy || !configured || !session || !threadId) return;
  busy = true;
  sendBtn.disabled = true;

  const userMsg = { id: uuid(), role: 'user', content: text, ts: Date.now() };
  mine.add(userMsg.id);
  try {
    touchThread(text).catch((e) => console.warn('thread save failed', e));
    saveMsg(userMsg).catch((e) => console.warn('save failed', e));
    showTyping();

    const item = direct || (await findForQuestion(text));
    const [bot] = await Promise.all([buildReply(item, text), sleep(450)]);
    bot.ts = Date.now() + 1;
    mine.add(bot.id);
    fs.setDoc(fs.doc(db, 'asked', uuid()), { question: text, matched: !!item, ts: Date.now() }).catch(() => {});
    hideTyping();
    await saveMsg(bot);
  } catch (e) {
    console.error(e);
    hideTyping();
    toast(t('netProblem'), 'error');
  } finally {
    busy = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

/* ---------- keyword search panel ---------- */
const runSearch = debounce(() => {
  const q = sInput.value.trim();
  if (q.length < 2) {
    sResults.innerHTML = `<p class="hint" style="margin:8px 2px">${esc(t('typeMore'))}</p>`;
    return;
  }
  const low = q.toLowerCase();
  const map = new Map();
  findAnswers(q, 8).forEach((r) => map.set(r.id, r));
  qa.forEach((r) => {
    if ([r.question, r.premium ? '' : r.answer, (r.keywords || []).join(' ')].join(' ').toLowerCase().includes(low)) map.set(r.id, r);
  });
  results = [...map.values()].slice(0, 10);
  sResults.innerHTML = results.length
    ? results
        .map((r, i) => `<button type="button" class="result" data-i="${i}"><b>${r.isPremium ? '👑 ' : ''}${esc(r.question)}</b><span>${r.isPremium ? esc(t('premiumAnswer')) : esc(r.answer)}</span></button>`)
        .join('')
    : `<p class="hint" style="margin:8px 2px">${esc(t('noResults'))}</p>`;
}, 250);

$('#searchBtn').addEventListener('click', () => {
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) sInput.focus();
});
sInput.addEventListener('input', runSearch);
sResults.addEventListener('click', (e) => {
  const b = e.target.closest('.result');
  if (!b) return;
  const item = results[Number(b.dataset.i)];
  panel.classList.add('hidden');
  sInput.value = '';
  sResults.innerHTML = '';
  ask(item.question, item);
});

/* ---------- composer ---------- */
$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = inputEl.value;
  inputEl.value = '';
  inputEl.style.height = 'auto';
  ask(t);
});
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('#composer').requestSubmit();
  }
});
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
});
chipsEl.addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (c) ask(c.title);
});

/* ---------- PWA install ---------- */
let deferred = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  $('#installBtn').classList.remove('hidden');
});
$('#installBtn').addEventListener('click', async () => {
  if (!deferred) return;
  deferred.prompt();
  await deferred.userChoice;
  deferred = null;
  $('#installBtn').classList.add('hidden');
});

/* =====================================================================
   PREMIUM  (plans, UPI payment, payment requests)
   ===================================================================== */
function updatePremiumUI() {
  const on = isPremium();
  $('#premiumBtn').textContent = on ? t('premiumOn') : t('getPremium');
  $('#dPlan').textContent = on ? t('premiumUntil', { date: fmtDate(sub.expiresAt) }) : t('freePlan');
  $('#drawerPremium').textContent = on ? t('managePremium') : t('getPremium');
}

function listenPremiumData(uid) {
  unsubSub?.();
  unsubSet?.();
  unsubPay?.();
  unsubSub = fs.onSnapshot(fs.doc(db, 'subscriptions', uid), (snap) => {
    const was = isPremium();
    sub = snap.exists() ? snap.data() : null;
    updatePremiumUI();
    renderSheetParts();
    if (!was && isPremium()) toast(t('premActivated'), 'success');
  }, (e) => console.warn('sub listen failed', e));
  unsubSet = fs.onSnapshot(fs.doc(db, 'settings', 'premium'), (snap) => {
    settings = snap.exists() ? snap.data() : null;
    renderSheetParts();
  }, (e) => console.warn('settings listen failed', e));
  unsubPay = fs.onSnapshot(fs.query(fs.collection(db, 'payments'), fs.where('uid', '==', uid)), (snap) => {
    payments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderSheetParts();
  }, (e) => console.warn('payments listen failed', e));
}

const planPrice = (k) => Number(settings?.[k + 'Price']) || 0;
const premiumReady = () => !!(settings && settings.enabled !== false && settings.upiId && (planPrice('monthly') || planPrice('yearly')));

function openPremium() {
  closeDrawer();
  sheet.innerHTML = `
    <div class="sh-head"><h2>👑 <span data-i18n="premium"></span></h2><button class="icon-btn" type="button" data-close aria-label="Close">${icon('x')}</button></div>
    <div id="shStatus"></div>
    <div id="shPlans"></div>
    <div id="shPay"></div>
    <form id="shForm" class="hidden" novalidate>
      <h3 data-i18n="step2"></h3>
      <div class="a-field"><label for="shUtr" data-i18n="utrLabel"></label>
        <input class="input" id="shUtr" inputmode="text" autocomplete="off" data-i18n-ph="utrPh"></div>
      <div class="a-field"><label for="shName" data-i18n="nameLabel"></label>
        <input class="input" id="shName" autocomplete="name" maxlength="60" data-i18n-ph="namePh"></div>
      <div class="a-field"><label for="shMobile" data-i18n="mobileLabel"></label>
        <input class="input" id="shMobile" inputmode="tel" maxlength="15" data-i18n-ph="mobilePh"></div>
      <div class="a-msg hidden" id="shMsg" role="alert"></div>
      <button class="a-btn a-primary" id="shSubmit" type="submit" data-i18n="submitPay"></button>
      <p class="a-note" data-i18n="startsAfter"></p>
    </form>
    <h3 data-i18n="myRequests"></h3>
    <div id="shList"></div>`;
  applyStatic(sheet);
  sheetBd.classList.remove('hidden');
  if (!planPrice(selPlan)) selPlan = planPrice('monthly') ? 'monthly' : 'yearly';
  renderSheetParts();
}
function closePremium() {
  sheetBd.classList.add('hidden');
}
sheetBd.addEventListener('mousedown', (e) => {
  if (e.target === sheetBd) closePremium();
});
$('#premiumBtn').addEventListener('click', openPremium);
$('#drawerPremium').addEventListener('click', openPremium);

function renderSheetParts() {
  if (sheetBd.classList.contains('hidden') || !$('#shStatus')) return;
  const ok = premiumReady();
  $('#shStatus').innerHTML = isPremium()
    ? `<div class="sh-ok">${esc(t('premActive', { plan: sub.plan === 'yearly' ? t('yearly') : t('monthly'), date: fmtDate(sub.expiresAt) }))}</div>`
    : `<p class="hint" style="margin:0 0 10px">${esc(t('premIntro'))}</p>`;
  if (!ok) {
    $('#shPlans').innerHTML = `<p class="hint">${esc(t('premUnavailable'))}</p>`;
    $('#shPay').innerHTML = '';
    $('#shForm').classList.add('hidden');
  } else {
    const items = [['monthly', t('monthly'), t('days30')], ['yearly', t('yearly'), t('days365')]].filter(([k]) => planPrice(k));
    if (!planPrice(selPlan)) selPlan = items[0][0];
    $('#shPlans').innerHTML = `<div class="plans">${items
      .map(([k, n, d]) => `<button type="button" class="plan ${selPlan === k ? 'on' : ''}" data-plan="${k}"><b>${esc(n)}</b><span>₹${planPrice(k)}</span><small>${esc(d)}</small></button>`)
      .join('')}</div>`;
    const price = planPrice(selPlan);
    const link = `upi://pay?pa=${settings.upiId}&pn=${encodeURIComponent(settings.payeeName || 'Illegal AI')}&am=${price}&cu=INR&tn=${encodeURIComponent('Illegal AI ' + selPlan)}`;
    $('#shPay').innerHTML = `
      <h3>${esc(t('step1', { price }))}</h3>
      <a class="a-btn a-primary" href="${esc(link)}">${esc(t('openUpi', { price }))}</a>
      <div class="copyrow"><span>${esc(t('upiId'))}: <b>${esc(settings.upiId)}</b></span><button type="button" data-copy="${esc(settings.upiId)}">${esc(t('copy'))}</button></div>
      ${settings.note ? `<p class="hint">${esc(settings.note)}</p>` : ''}
      <p class="hint">${esc(t('payExact', { price }))}</p>`;
    $('#shForm').classList.remove('hidden');
  }
  const sorted = [...payments].sort((a, b) => b.createdAt - a.createdAt);
  $('#shList').innerHTML = sorted.length
    ? sorted
        .map((p) => `<div class="pr"><div><b>₹${p.amount}</b> ${esc(p.plan === 'yearly' ? t('yearly') : t('monthly'))} <small class="hint">${fmtDate(p.createdAt)}</small></div>
          <span class="chip-s ${esc(p.status)}">${esc(t(p.status))}</span>
          ${p.status === 'rejected' && p.reason ? `<small class="hint" style="width:100%">${esc(t('reasonLbl', { text: p.reason }))}</small>` : ''}</div>`)
        .join('')
    : `<p class="hint">${esc(t('noRequests'))}</p>`;
}

sheet.addEventListener('click', async (e) => {
  if (e.target.closest('[data-close]')) return closePremium();
  const p = e.target.closest('[data-plan]');
  if (p) {
    selPlan = p.dataset.plan;
    return renderSheetParts();
  }
  const c = e.target.closest('[data-copy]');
  if (c) {
    try {
      await navigator.clipboard.writeText(c.dataset.copy);
      toast(t('copied'));
    } catch {
      toast(t('copyFail'), 'error');
    }
  }
});

sheet.addEventListener('submit', async (e) => {
  if (e.target.id !== 'shForm') return;
  e.preventDefault();
  const msg = $('#shMsg');
  const utr = $('#shUtr').value.trim().toUpperCase();
  const name = $('#shName').value.trim();
  const mobile = $('#shMobile').value.trim();
  const fail = (k) => say(msg, t(k));
  if (!/^[A-Z0-9]{10,25}$/.test(utr)) return fail('errUtr');
  if (name.length < 2) return fail('errName');
  if (mobile && !/^[0-9+ ]{8,15}$/.test(mobile)) return fail('errMobile');
  const price = planPrice(selPlan);
  if (!price) return fail('errPlan');
  const btn = $('#shSubmit');
  busyBtn(btn, true, t('submitPay'));
  say(msg, '');
  try {
    await fs.setDoc(fs.doc(db, 'payments', utr), {
      uid: session, email: auth.currentUser?.email || '', name, mobile, plan: selPlan, amount: price, status: 'pending', createdAt: Date.now(),
    });
    fs.setDoc(fs.doc(db, 'users', session), { name, ...(mobile ? { mobile } : {}) }, { merge: true }).catch(() => {});
    $('#shUtr').value = '';
    toast(t('paySubmitted'), 'success');
  } catch (err) {
    console.warn(err);
    fail(err.code === 'permission-denied' ? 'utrDup' : 'submitFail');
  }
  busyBtn(btn, false, t('submitPay'));
});

/* =====================================================================
   LOGIN / SIGN UP  (email + verification, or Google)
   ===================================================================== */
const auth = configured ? getAuth(app) : null;
const authScreen = $('#authScreen');
const verifyScreen = $('#verifyScreen');
let mode = 'login';
let justSent = false;
let pollTimer = null;
let authRun = 0;
let lastMsg = {}; // remembers the last message key per box so it can be re-translated

const ERR = {
  'auth/invalid-email': 'eEmail', 'auth/missing-password': 'eNoPass', 'auth/weak-password': 'eWeak',
  'auth/email-already-in-use': 'eInUse', 'auth/invalid-credential': 'eCred', 'auth/user-not-found': 'eNoUser',
  'auth/wrong-password': 'eCred', 'auth/too-many-requests': 'eMany', 'auth/network-request-failed': 'eNet',
  'auth/popup-closed-by-user': 'ePopup', 'auth/cancelled-popup-request': 'ePopup', 'auth/popup-blocked': 'ePopupBlocked',
  'auth/unauthorized-domain': 'eDomain', 'auth/operation-not-allowed': 'eMethod',
};
const authErrKey = (e) => ERR[e?.code] || 'eGeneric';

/** Show a translated message in a box. Pass a key (translated now and again if the language changes). */
function say(el, key, ok = false) {
  lastMsg[el.id] = key ? { key, ok } : null;
  el.textContent = key ? t(key) : '';
  el.classList.toggle('hidden', !key);
  el.classList.toggle('ok', !!ok);
}
function busyBtn(btn, on, label) {
  btn.disabled = on;
  btn.textContent = on ? t('wait') : label;
}

function setMode(m) {
  mode = m;
  document.querySelectorAll('.a-tab').forEach((x) => x.classList.toggle('on', x.dataset.mode === m));
  $('#aSubmit').textContent = m === 'login' ? t('login') : t('create');
  $('#aSub').textContent = m === 'login' ? t('authSubLogin') : t('authSubSignup');
  $('#aPass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('#forgotBtn').classList.toggle('hidden', m !== 'login');
  say($('#aMsg'), '');
}
document.querySelectorAll('.a-tab').forEach((x) => x.addEventListener('click', () => setMode(x.dataset.mode)));

$('#aPwToggle').addEventListener('click', () => {
  const p = $('#aPass');
  const show = p.type === 'password';
  p.type = show ? 'text' : 'password';
  $('#aPwToggle').textContent = show ? t('hide') : t('show');
});

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#aEmail').value.trim();
  const pass = $('#aPass').value;
  if (!email || !pass) return say($('#aMsg'), 'enterBoth');
  const btn = $('#aSubmit');
  const label = mode === 'login' ? t('login') : t('create');
  busyBtn(btn, true, label);
  say($('#aMsg'), '');
  try {
    if (mode === 'signup') {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      justSent = true;
      await sendEmailVerification(cred.user);
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
    $('#aPass').value = '';
  } catch (err) {
    justSent = false;
    say($('#aMsg'), authErrKey(err));
  }
  busyBtn(btn, false, label);
});

$('#googleBtn').addEventListener('click', async () => {
  say($('#aMsg'), '');
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    say($('#aMsg'), authErrKey(err));
  }
});

$('#forgotBtn').addEventListener('click', async () => {
  const email = $('#aEmail').value.trim();
  if (!email) return say($('#aMsg'), 'enterEmailFirst');
  try {
    await sendPasswordResetEmail(auth, email);
    say($('#aMsg'), 'resetSent', true);
  } catch (err) {
    say($('#aMsg'), authErrKey(err));
  }
});

/* ---------- verify screen ---------- */
async function checkVerified(user, manual = false) {
  try {
    await user.reload();
  } catch (e) {
    if (manual) say($('#vMsg'), authErrKey(e));
    return false;
  }
  if (user.emailVerified) return true;
  if (manual) say($('#vMsg'), 'notVerifiedYet');
  return false;
}

function showVerify(user) {
  show('verify');
  $('#vEmail').textContent = user.email || '';
  say($('#vMsg'), justSent ? 'verifySent' : 'verifyFirst', justSent);
  justSent = false;
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (auth.currentUser && (await checkVerified(auth.currentUser))) handleUser(auth.currentUser);
  }, 4000);
}

$('#vCheck').addEventListener('click', async () => {
  const u = auth.currentUser;
  if (!u) return;
  if (await checkVerified(u, true)) handleUser(u);
});

let cool = 0;
$('#vResend').addEventListener('click', async () => {
  const u = auth.currentUser;
  if (!u || cool > 0) return;
  try {
    await sendEmailVerification(u);
    say($('#vMsg'), 'sentAgain', true);
    cool = 60;
    const timer = setInterval(() => {
      cool--;
      $('#vResend').textContent = cool > 0 ? t('resendIn', { n: cool }) : t('resend');
      if (cool <= 0) clearInterval(timer);
    }, 1000);
  } catch (err) {
    say($('#vMsg'), authErrKey(err));
  }
});
$('#vLogout').addEventListener('click', () => signOut(auth));
$('#logoutBtn').addEventListener('click', () => {
  if (confirm(t('logoutConfirm'))) {
    closeDrawer();
    signOut(auth);
  }
});

/* =====================================================================
   LANGUAGE  (UI + answers + questions)
   ===================================================================== */
function fillLangSelects() {
  document.querySelectorAll('.langsel').forEach((sel) => {
    if (!sel.options.length) sel.innerHTML = LANGS.map((l) => `<option value="${l.code}">${l.native}</option>`).join('');
    sel.value = getLang();
  });
}

/** Re-draw everything that contains translated text. */
function refreshLanguage() {
  applyStatic(document);
  $('#newChatBtn').innerHTML = `${icon('plus', 18)} ${esc(t('newChat'))}`;
  $('#logoutBtn').innerHTML = `${icon('logout', 18)} ${esc(t('logout'))}`;
  $('#aPwToggle').textContent = $('#aPass').type === 'password' ? t('show') : t('hide');
  $('#vResend').textContent = cool > 0 ? t('resendIn', { n: cool }) : t('resend');
  $('#googleLabel').textContent = t('google');
  setModeText();
  for (const [id, m] of Object.entries(lastMsg)) if (m) say($('#' + id), m.key, m.ok);
  updatePremiumUI();
  renderThreads();
  renderSheetParts();
  fillLangSelects();
}
function setModeText() {
  $('#aSubmit').textContent = mode === 'login' ? t('login') : t('create');
  $('#aSub').textContent = mode === 'login' ? t('authSubLogin') : t('authSubSignup');
}

async function changeLanguage(code) {
  await setLanguage(code, refreshLanguage);
  refreshLanguage();
  if (session && threadId) {
    fs.setDoc(fs.doc(db, 'users', session), { lang: code }, { merge: true }).catch(() => {});
    // redraw the chat so the welcome message appears in the new language (the menu stays open)
    listEl.innerHTML = '';
    seen.clear();
    lastDay = '';
    typingEl = null;
    listenChat();
  }
}
document.addEventListener('change', (e) => {
  if (e.target.classList?.contains('langsel')) changeLanguage(e.target.value);
});

/* ---------- screens ---------- */
function show(which) {
  authScreen.classList.toggle('hidden', which !== 'auth');
  verifyScreen.classList.toggle('hidden', which !== 'verify');
}

function stopApp() {
  [unsub, unsubQA, unsubSub, unsubSet, unsubPay, unsubTh].forEach((u) => u?.());
  unsub = unsubQA = unsubSub = unsubSet = unsubPay = unsubTh = null;
  currentUid = null;
  session = null;
  threadId = null;
  sub = null;
  settings = null;
  payments = [];
  threads = [];
  listEl.innerHTML = '';
  chipsEl.innerHTML = '';
  threadListEl.innerHTML = '';
  seen.clear();
  lastDay = '';
  closeDrawer();
  closePremium();
  updatePremiumUI();
}

async function startApp(user) {
  if (currentUid === user.uid) return;
  stopApp();
  currentUid = user.uid;
  session = user.uid;
  await user.getIdToken(true); // refresh the token so Firestore sees "email verified"
  $('#dUser').textContent = user.email || '';
  const stored = localStorage.getItem('ar-thread-' + session);
  hadStored = !!stored;
  threadId = stored || uuid();
  fs.setDoc(
    fs.doc(db, 'users', session),
    {
      email: user.email || '',
      ...(user.displayName ? { name: user.displayName } : {}),
      createdAt: Number(user.metadata?.createdAt) || Date.now(),
      lastSeen: Date.now(),
      lang: getLang(),
    },
    { merge: true }
  ).catch((e) => console.warn('profile save failed', e));
  listenQA();
  listenChat();
  listenThreads();
  listenPremiumData(session);
  updatePremiumUI();
}

async function handleUser(user) {
  const run = ++authRun;
  if (!user) {
    clearInterval(pollTimer);
    stopApp();
    show('auth');
    return;
  }
  if (!(await checkVerified(user))) {
    if (run === authRun) {
      stopApp();
      showVerify(user);
    }
    return;
  }
  if (run !== authRun) return;
  clearInterval(pollTimer);
  show('app');
  await startApp(user);
}

/* ---------- go ---------- */
(async function boot() {
  fillLangSelects();
  await setLanguage(savedLanguage(), refreshLanguage);
  refreshLanguage();
  if (configured) {
    setMode('login');
    onAuthStateChanged(auth, handleUser);
  }
})();
