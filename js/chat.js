import { makeClient, configured, esc, formatText, safeUrl, toast, icon, initTheme, debounce, registerSW, uuid } from './shared.js';

const FALLBACK = "Sorry! We don't have an answer yet. Your question has been forwarded to the admin.";
const WELCOME = 'Namaste! 👋 Apna sawaal Hindi, English ya Hinglish mein likho. Jo answer saved hoga, turant mil jayega — links aur downloads ke saath.';
const KINDS = {
  app: { text: 'Open App', icon: 'app' },
  website: { text: 'Open Website', icon: 'globe' },
  apk: { text: 'Download APK', icon: 'download' },
};

const sb = makeClient(false);
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
let lastDay = '';
let busy = false;
let typingEl = null;

/* ---------- static UI ---------- */
$('#logo').innerHTML = icon('chat', 22);
$('#searchBtn').innerHTML = icon('search');
$('#newBtn').innerHTML = icon('plus');
$('#installBtn').innerHTML = icon('download');
sendBtn.innerHTML = icon('send');
initTheme($('#themeBtn'));
registerSW();

if (!configured) {
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

function addMessage(m, { scroll = true } = {}) {
  if (m.id) {
    if (seen.has(m.id)) return;
    seen.add(m.id);
  }
  const label = dayLabel(m.created_at);
  if (label !== lastDay) {
    lastDay = label;
    const d = document.createElement('div');
    d.className = 'day';
    d.textContent = label;
    listEl.appendChild(d);
  }
  const links = (Array.isArray(m.links) ? m.links : []).map(linkBtn).join('');
  const el = document.createElement('div');
  el.className = `msg ${m.role}`;
  el.innerHTML = `${m.role === 'bot' ? `<div class="avatar">${icon('bot', 18)}</div>` : ''}
    <div class="col"><div class="bubble">${formatText(m.content)}${links ? `<div class="links">${links}</div>` : ''}</div>
    <div class="time">${fmtTime(m.created_at)}</div></div>`;
  listEl.appendChild(el);
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

/* ---------- data ---------- */
async function persist(m) {
  const { error } = await sb.from('chat_messages').insert({
    id: m.id, session_id: session, role: m.role, content: m.content,
    links: m.links || [], qa_id: m.qa_id || null, created_at: m.created_at,
  });
  if (error) console.warn('chat save failed', error.message);
}

async function fetchLinks(qaId) {
  const { data, error } = await sb.from('qa_links').select('kind,label,url,sort_order').eq('qa_id', qaId).order('sort_order');
  if (error) throw error;
  return (data || []).map(({ kind, label, url }) => ({ kind, label, url }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(text, direct = null) {
  text = (text || '').trim().slice(0, 500);
  if (!text || busy || !sb) return;
  busy = true;
  sendBtn.disabled = true;

  const userMsg = { id: uuid(), role: 'user', content: text, created_at: new Date().toISOString() };
  addMessage(userMsg);
  persist(userMsg);
  showTyping();

  try {
    let item = direct;
    if (!item) {
      const { data, error } = await sb.rpc('search_answers', { q: text, max_results: 1 });
      if (error) throw error;
      item = data?.[0] || null;
    }
    const [links] = await Promise.all([item ? fetchLinks(item.id) : Promise.resolve([]), sleep(450)]);

    let bot;
    if (item) {
      bot = { id: uuid(), role: 'bot', content: item.answer, links, qa_id: item.id };
    } else {
      const { error } = await sb.from('unanswered_questions').insert({ question: text, session_id: session });
      if (error) console.warn('unanswered save failed', error.message);
      bot = { id: uuid(), role: 'bot', content: FALLBACK, links: [] };
    }
    bot.created_at = new Date(Date.now() + 1).toISOString();
    hideTyping();
    addMessage(bot);
    persist(bot);
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

/* ---------- history + live sync ---------- */
async function sync(initial = false) {
  if (!sb) return;
  const { data, error } = await sb.rpc('get_chat_history', { p_session: session });
  if (error) return;
  let fresh = 0;
  for (const m of data || []) {
    if (seen.has(m.id)) continue;
    addMessage(m, { scroll: false });
    fresh++;
    if (!initial && m.role === 'bot') toast('New reply received');
  }
  if (fresh) listEl.scrollTop = listEl.scrollHeight;
  return (data || []).length;
}

async function loadChips() {
  if (!sb) return;
  const { data } = await sb.from('qa_items').select('question').order('updated_at', { ascending: false }).limit(8);
  chipsEl.innerHTML = (data || []).map((r) => `<button type="button" class="chip" title="${esc(r.question)}">${esc(r.question)}</button>`).join('');
}

async function start() {
  listEl.innerHTML = '';
  seen.clear();
  lastDay = '';
  const count = await sync(true);
  if (!count) addMessage({ id: 'welcome', role: 'bot', content: WELCOME, created_at: new Date().toISOString() });
  loadChips();
}

/* ---------- keyword search panel ---------- */
const runSearch = debounce(async () => {
  const q = sInput.value.replace(/[,()%*\\]/g, ' ').trim();
  if (q.length < 2) {
    sResults.innerHTML = '<p class="hint" style="margin:8px 2px">Kam se kam 2 letters likho.</p>';
    return;
  }
  sResults.innerHTML = '<p class="hint" style="margin:8px 2px">Searching…</p>';
  const [a, b] = await Promise.all([
    sb.rpc('search_answers', { q, max_results: 8 }),
    sb.from('qa_items').select('id,question,answer').or(`question.ilike.*${q}*,answer.ilike.*${q}*`).limit(8),
  ]);
  const map = new Map();
  [...(a.data || []), ...(b.data || [])].forEach((r) => map.set(r.id, r));
  const rows = [...map.values()].slice(0, 10);
  window.__results = rows;
  sResults.innerHTML = rows.length
    ? rows.map((r, i) => `<button type="button" class="result" data-i="${i}"><b>${esc(r.question)}</b><span>${esc(r.answer)}</span></button>`).join('')
    : '<p class="hint" style="margin:8px 2px">Kuch nahi mila. Chat mein sawaal bhejo — admin ko forward ho jayega.</p>';
}, 280);

$('#searchBtn').addEventListener('click', () => {
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) sInput.focus();
});
sInput.addEventListener('input', runSearch);
sResults.addEventListener('click', (e) => {
  const b = e.target.closest('.result');
  if (!b) return;
  const item = window.__results[Number(b.dataset.i)];
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
  start();
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
if (sb) {
  start();
  setInterval(() => !document.hidden && sync(false), 12000);
  document.addEventListener('visibilitychange', () => !document.hidden && sync(false));
}
