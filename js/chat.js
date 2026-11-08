import { esc, formatText, safeUrl, toast, icon, initTheme, debounce, registerSW, uuid } from './shared.js';
import { configured, db, fs } from './firebase.js';

const FALLBACK = "Sorry! We don't have an answer yet. Your question has been forwarded to the admin.";
const WELCOME = 'Namaste! 👋 Apna sawaal Hindi, English ya Hinglish mein likho. Jo answer saved hoga, turant mil jayega — links aur downloads ke saath.';
const KINDS = {
  app: { text: 'Open App', icon: 'app' },
  website: { text: 'Open Website', icon: 'globe' },
  apk: { text: 'Download APK', icon: 'download' },
};

const $ = (s) => document.querySelector(s);
const listEl = $('#messages');
const inputEl = $('#input');
const sendBtn = $('#sendBtn');
const chipsEl = $('#chips');
const panel = $('#searchPanel');
const sInput = $('#searchInput');
const sResults = $('#searchResults');

let session = localStorage.getItem('ar-session');
if (!session) {
  session = uuid();
  localStorage.setItem('ar-session', session);
}
const seen = new Set();
const mine = new Set();
let lastDay = '';
let busy = false;
let typingEl = null;
let qa = [];
let unsub = null;
let results = [];

/* ---------- static UI ---------- */
$('#logo').innerHTML = icon('chat', 22);
$('#searchBtn').innerHTML = icon('search');
$('#newBtn').innerHTML = icon('plus');
$('#installBtn').innerHTML = icon('download');
sendBtn.innerHTML = icon('send');
initTheme($('#themeBtn'));
registerSW();

if (!configured) {
  $('#setupBanner').textContent = 'Setup pending: js/config.js mein Firebase config daalo.';
  $('#setupBanner').classList.remove('hidden');
  inputEl.disabled = true;
  sendBtn.disabled = true;
}

/* ---------- render ---------- */
const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function dayLabel(t) {
  const d = new Date(t);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function linkBtn(l) {
  const href = safeUrl(l?.url);
  if (!href) return '';
  const k = KINDS[l.kind] || KINDS.website;
  const text = esc(l.label || k.text);
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
  const el = document.createElement('div');
  el.className = `msg ${m.role}`;
  el.innerHTML = `${m.role === 'bot' ? `<div class="avatar">${icon('bot', 18)}</div>` : ''}
    <div class="col"><div class="bubble">${formatText(m.content)}${links ? `<div class="links">${links}</div>` : ''}</div>
    <div class="time">${fmtTime(m.ts)}</div></div>`;
  put(el);
  if (scroll) listEl.scrollTop = listEl.scrollHeight;
}

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
  fs.onSnapshot(
    fs.query(fs.collection(db, 'qa'), fs.where('isActive', '==', true)),
    (snap) => {
      qa = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const top = [...qa].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 8);
      chipsEl.innerHTML = top.map((r) => `<button type="button" class="chip" title="${esc(r.question)}">${esc(r.question)}</button>`).join('');
    },
    (err) => console.warn('qa listen failed', err)
  );
}

function listenChat() {
  unsub?.();
  let first = true;
  const q = fs.query(fs.collection(db, 'chats', session, 'messages'), fs.orderBy('ts', 'asc'), fs.limit(300));
  unsub = fs.onSnapshot(
    q,
    (snap) => {
      if (first && snap.empty) addMessage({ id: 'welcome', role: 'bot', content: WELCOME, ts: Date.now() }, { scroll: false });
      snap.docChanges().forEach((ch) => {
        if (ch.type !== 'added') return;
        const m = { id: ch.doc.id, ...ch.doc.data() };
        if (!first && m.role === 'bot' && !mine.has(m.id)) toast('New reply received');
        addMessage(m, { scroll: false });
      });
      first = false;
      listEl.scrollTop = listEl.scrollHeight;
    },
    (err) => {
      console.warn(err);
      toast('Chat load nahi hui. Firestore rules check karo.', 'error');
    }
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const saveMsg = (m) =>
  fs.setDoc(fs.doc(db, 'chats', session, 'messages', m.id), {
    role: m.role, content: m.content, links: m.links || [], qaId: m.qaId || null, ts: m.ts,
  });

async function ask(text, direct = null) {
  text = (text || '').trim().slice(0, 500);
  if (!text || busy || !configured) return;
  busy = true;
  sendBtn.disabled = true;

  const userMsg = { id: uuid(), role: 'user', content: text, ts: Date.now() };
  mine.add(userMsg.id);
  try {
    saveMsg(userMsg).catch((e) => console.warn('save failed', e));
    showTyping();

    const item = direct || findAnswers(text, 1)[0] || null;
    await sleep(450);

    const bot = { id: uuid(), role: 'bot', ts: Date.now() + 1 };
    mine.add(bot.id);
    if (item) {
      bot.content = item.answer;
      bot.links = (item.links || []).map(({ kind, label, url }) => ({ kind, label: label || '', url }));
      bot.qaId = item.id;
    } else {
      bot.content = FALLBACK;
      bot.links = [];
      fs.addDoc(fs.collection(db, 'unanswered'), {
        question: text, sessionId: session, status: 'pending', createdAt: Date.now(),
      }).catch((e) => console.warn('unanswered save failed', e));
    }
    fs.setDoc(fs.doc(db, 'asked', uuid()), { question: text, matched: !!item, ts: Date.now() }).catch(() => {});
    hideTyping();
    await saveMsg(bot);
  } catch (e) {
    console.error(e);
    hideTyping();
    toast('Network problem. Please try again.', 'error');
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
    sResults.innerHTML = '<p class="hint" style="margin:8px 2px">Kam se kam 2 letters likho.</p>';
    return;
  }
  const low = q.toLowerCase();
  const map = new Map();
  findAnswers(q, 8).forEach((r) => map.set(r.id, r));
  qa.forEach((r) => {
    if ([r.question, r.answer, (r.keywords || []).join(' ')].join(' ').toLowerCase().includes(low)) map.set(r.id, r);
  });
  results = [...map.values()].slice(0, 10);
  sResults.innerHTML = results.length
    ? results.map((r, i) => `<button type="button" class="result" data-i="${i}"><b>${esc(r.question)}</b><span>${esc(r.answer)}</span></button>`).join('')
    : '<p class="hint" style="margin:8px 2px">Kuch nahi mila. Chat mein sawaal bhejo — admin ko forward ho jayega.</p>';
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

$('#newBtn').addEventListener('click', () => {
  if (!confirm('Nayi chat shuru karein? Purani chat is device par nahi dikhegi.')) return;
  session = uuid();
  localStorage.setItem('ar-session', session);
  listEl.innerHTML = '';
  seen.clear();
  lastDay = '';
  listenChat();
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

/* ---------- go ---------- */
if (configured) {
  listenQA();
  listenChat();
}
