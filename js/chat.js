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
  unsubPay?.(
