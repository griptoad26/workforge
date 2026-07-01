/* =====================================================================
 * help.js — Seele Agency static help widget
 *
 * Renders a chat UI for seele.agency/help.html. Each user message is
 * POSTed to the cluster-hub at HUB_API/api/tasks, which assigns a task
 * ID. The widget then shows an agent-side bubble confirming the routing.
 *
 * Auth: requires the seele_session cookie. This page is gated by gate.js
 * (since it's NOT in PUBLIC_PATHS) — gate.js will redirect to /login.html
 * if /v1/auth/me returns no user. We double-check here too as a safety net.
 *
 * Storage: messages are kept in localStorage under SEELE_HELP_THREAD so
 * the user sees history on refresh.
 * ===================================================================== */
(function () {
  'use strict';

  const HUB_API = 'http://100.112.11.35:8090';
  const AUTH_API = (window.SEELE_AUTH && window.SEELE_AUTH.apiBase) || '/api/pay';
  const STORAGE_KEY = 'SEELE_HELP_THREAD';
  const FETCH_TIMEOUT_MS = 8000;

  // ---- DOM ----
  const chatBody = document.getElementById('chatBody');
  const chatEmpty = document.getElementById('chatEmpty');
  const composer = document.getElementById('composer');
  const msgInput = document.getElementById('msgInput');
  const sendBtn = document.getElementById('sendBtn');
  const sendLabel = document.getElementById('sendLabel');
  const errBox = document.getElementById('errBox');
  const clearBtn = document.getElementById('clearBtn');

  // ---- Auth check (safety net on top of gate.js) ----
  function authMe() {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    return fetch(AUTH_API + '/v1/auth/me', { credentials: 'include', signal: ac.signal })
      .then((r) => { clearTimeout(t); return r.ok ? r.json() : null; })
      .catch(() => null);
  }

  // ---- Storage ----
  function loadThread() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }
  function saveThread(thread) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(thread)); }
    catch (e) { /* quota etc — ignore */ }
  }

  // ---- Rendering ----
  function fmtTime(ts) {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  function renderMessage(msg) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + (msg.from === 'user' ? 'user' : msg.from === 'system' ? 'system' : 'agent');

    const bub = document.createElement('div');
    bub.className = 'bubble';
    bub.textContent = msg.text;
    wrap.appendChild(bub);

    if (msg.ts) {
      const ts = document.createElement('div');
      ts.className = 'ts';
      ts.textContent = fmtTime(msg.ts);
      wrap.appendChild(ts);
    }
    if (msg.taskId) {
      const m = document.createElement('div');
      m.className = 'meta-line';
      m.textContent = 'Task ' + msg.taskId;
      wrap.appendChild(m);
    }
    return wrap;
  }

  function renderAll() {
    const thread = loadThread();
    // Remove existing messages but keep empty placeholder element hidden
    Array.from(chatBody.querySelectorAll('.msg')).forEach((el) => el.remove());
    if (thread.length === 0) {
      chatEmpty.style.display = '';
      return;
    }
    chatEmpty.style.display = 'none';
    const frag = document.createDocumentFragment();
    thread.forEach((m) => frag.appendChild(renderMessage(m)));
    chatBody.appendChild(frag);
    scrollToBottom();
  }

  function appendMessage(msg) {
    chatEmpty.style.display = 'none';
    chatBody.appendChild(renderMessage(msg));
    scrollToBottom();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => { chatBody.scrollTop = chatBody.scrollHeight; });
  }

  // ---- Cluster-hub API ----
  async function createHubTask(text) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const title = 'Help: ' + (text.slice(0, 60).replace(/\s+/g, ' ').trim());
    const body = {
      title: title,
      description: text,
      category: 'support',
      source: 'help-widget',
    };
    const res = await fetch(HUB_API + '/api/tasks', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).detail || (await res.text()); } catch (e) {}
      const err = new Error('Hub returned ' + res.status + (detail ? ': ' + detail : ''));
      err.status = res.status;
      throw err;
    }
    return await res.json();
  }

  // ---- Send flow ----
  function setSending(sending) {
    sendBtn.disabled = sending;
    msgInput.disabled = sending;
    sendLabel.innerHTML = sending ? '<span class="spinner"></span>' : 'Send';
  }

  function showError(msg) {
    errBox.textContent = msg;
    errBox.style.display = msg ? 'block' : 'none';
  }

  async function handleSend(ev) {
    ev.preventDefault();
    if (sendBtn.disabled) return;
    const text = (msgInput.value || '').trim();
    if (!text) return;

    showError('');
    setSending(true);

    const thread = loadThread();
    const userMsg = { from: 'user', text: text, ts: Date.now() };
    thread.push(userMsg);
    appendMessage(userMsg);
    saveThread(thread);

    const draft = msgInput.value;
    msgInput.value = '';
    autoresize();

    try {
      const created = await createHubTask(text);
      // The hub assigns an id like "TASK-XXX-XXX" or returns an object with `id`.
      const taskId = (created && (created.id || created.task_id || created.taskId)) || 'pending';
      const replyText = 'Routed to ' + taskId + ', our team will reply within 1 business day.';
      const agentMsg = { from: 'agent', text: replyText, ts: Date.now(), taskId: taskId };
      thread.push(agentMsg);
      appendMessage(agentMsg);
      saveThread(thread);
    } catch (err) {
      const errText = 'Could not route your message (' + (err.message || 'network error') + '). Please try again or email support@seele.agency.';
      const sysMsg = { from: 'system', text: errText, ts: Date.now() };
      thread.push(sysMsg);
      appendMessage(sysMsg);
      saveThread(thread);
      showError(err.message || 'Failed to send');
      // Restore user input so they can retry
      msgInput.value = draft;
      autoresize();
    } finally {
      setSending(false);
      msgInput.focus();
    }
  }

  // ---- UI helpers ----
  function autoresize() {
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(140, msgInput.scrollHeight) + 'px';
  }

  msgInput.addEventListener('input', autoresize);
  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      composer.requestSubmit ? composer.requestSubmit() : composer.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  composer.addEventListener('submit', handleSend);

  clearBtn.addEventListener('click', () => {
    if (!confirm('Clear this conversation on this device? (Your support tickets remain in our system.)')) return;
    localStorage.removeItem(STORAGE_KEY);
    renderAll();
  });

  // ---- Boot ----
  (async function boot() {
    // Safety net: if gate.js didn't run / didn't redirect, redirect here.
    const me = await authMe();
    if (!me) {
      // Allow a tiny grace period for gate.js to also redirect; if we're still here, redirect ourselves.
      window.location.replace('/login.html?next=' + encodeURIComponent('/help.html'));
      return;
    }
    renderAll();
    msgInput.focus();
  })();
})();