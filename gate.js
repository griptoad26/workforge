/* =====================================================================
 * gate.js — Seele Agency auth gate (client-side).
 *
 * Loaded by every page via <script src="/gate.js" defer></script> just
 * before </body>.
 *
 * Disable on a page with <meta name="auth-gate" content="off"> — used by
 * /login.html and /register.html so they don't gate themselves.
 *
 * Behavior:
 *   - Pages in GATE_PATHS (downloads, checkout, support, dashboard, account,
 *     admin) require auth. Unauthenticated visitors are redirected to
 *     /login.html?next=<original-path>.
 *   - Pages in PUBLIC_PATHS (home, login, register, docs, marketing) are
 *     never redirected. Logout button is still injected.
 *   - If the /v1/auth/me check throws / 5xx / times out / 404s (no proxy):
 *     FAIL OPEN for static content, FAIL CLOSED for download / checkout
 *     buttons (they redirect to login on click).
 *
 * The script also reconciles with the static nav HTML added by the page
 * templates (id="navLogin", id="navLogout", id="navUser") so that only
 * ONE login/logout button is visible at a time.
 *
 * API base resolution (in priority order):
 *   1. window.SEELE_AUTH.apiBase — explicit override
 *   2. Same origin /api/pay — works once a CF Worker / Pages Function
 *      proxies /api/pay/* to xkg-payments
 *   3. http://127.0.0.1:8765 — direct backend for local dev
 * ===================================================================== */
(function () {
  'use strict';

  // Pages that REQUIRE auth (redirect to login if no session).
  const GATE_PATHS = [
    'downloads.html',
    'checkout.html',
    'support.html',
    'dashboard.html',
    'account.html',
    'admin.html',
  ];

  // Pages that are ALWAYS public (no redirect).
  const PUBLIC_PATHS = [
    'login.html',
    'register.html',
    'index.html',
    'about.html',
    'privacy.html',
    'terms.html',
    'docs.html',
    'changelog.html',
  ];

  // API paths that must stay publicly accessible (Stripe webhooks, x402, etc.).
  function isPublicApiPath(path) {
    return path.indexOf('/api/pay/') === 0
        || path.indexOf('/api/x402/') === 0
        || path.indexOf('/api/checkout') === 0
        || path.indexOf('/api/webhook') === 0
        || path.indexOf('/api/.well-known/') === 0
        || path.indexOf('/v1/x402/') === 0;
  }

  // 1. Bail if explicitly disabled.
  const meta = document.querySelector('meta[name="auth-gate"]');
  if (meta && (meta.content === 'off' || meta.content === 'false')) return;

  const here = location.pathname.split('/').pop() || 'index.html';

  // 2. Bail on public pages (but still inject logout button).
  if (PUBLIC_PATHS.includes(here) || isPublicApiPath(location.pathname)) {
    reconcileNav(null);
    return;
  }

  // 3. Resolve API base.
  const API = (() => {
    if (window.SEELE_AUTH && window.SEELE_AUTH.apiBase) return window.SEELE_AUTH.apiBase;
    if (location.hostname.endsWith('seele.agency')) return location.origin + '/api/pay';
    if (location.hostname.endsWith('ts.net'))      return location.origin + '/api/pay';
    if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') return 'http://127.0.0.1:8765';
    return '/api/pay';
  })();

  const DEBUG = !!(window.SEELE_AUTH && window.SEELE_AUTH.debug);
  const FETCH_TIMEOUT_MS = 4000;
  let user = null;

  // Set up a hard timeout so the page never hangs on a slow API.
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

  fetch(API + '/v1/auth/me', { credentials: 'include', signal: ac.signal })
    .then((r) => {
      clearTimeout(timeoutId);
      return r.ok ? r.json() : null;
    })
    .then((u) => {
      user = u;
      if (!user && GATE_PATHS.includes(here)) {
        const next = encodeURIComponent(here + location.search);
        location.replace('login.html?next=' + next);
        return;
      }
      reconcileNav(user);
    })
    .catch((err) => {
      clearTimeout(timeoutId);
      if (DEBUG) console.warn('[gate] auth check failed; failing open for content, fail-closed for actions', err);
      // Fail open for content, fail closed for downloads/checkout.
      disableActions();
      reconcileNav(null);
    });

  // ---- reconcileNav: ensure only one login/logout button is visible ----
  // If the page template already has static #navLogin / #navLogout / #navUser
  // placeholders (login.html, register.html, downloads.html, checkout.html,
  // support.html), use them. Otherwise inject a Logout link dynamically so
  // signed-in users can sign out from any page (about.html, changelog.html,
  // docs.html, index.html, etc.).
  function reconcileNav(me) {
    const navLinks = document.querySelector('nav .nav-links');
    if (!navLinks) return;

    // Skip if we already ran (e.g. duplicate script include).
    if (navLinks.dataset.seeleGateReconciled === '1') return;
    navLinks.dataset.seeleGateReconciled = '1';

    const loginLink = document.getElementById('navLogin');
    const registerLink = document.getElementById('navRegister');
    const logoutLink = document.getElementById('navLogout');
    const userSpan = document.getElementById('navUser');

    const hasStaticLogout = !!logoutLink;

    if (me) {
      // Signed in — hide Sign in / Register, show Hi + Sign out
      if (loginLink) loginLink.style.display = 'none';
      if (registerLink) registerLink.style.display = 'none';
      if (hasStaticLogout) {
        logoutLink.style.display = '';
        logoutLink.onclick = (e) => {
          e.preventDefault();
          fetch(API + '/v1/auth/logout', { method: 'POST', credentials: 'include' })
            .catch(() => {})
            .then(() => { window.location.href = 'login.html'; });
        };
      } else {
        // No static logout — inject one for signed-in users.
        const li = document.createElement('a');
        li.href = '#';
        li.textContent = 'Log out';
        li.setAttribute('data-gate', 'logout');
        li.style.cssText = 'color: var(--text2); font-size: 14px; cursor: pointer;';
        li.addEventListener('click', (e) => {
          e.preventDefault();
          fetch(API + '/v1/auth/logout', { method: 'POST', credentials: 'include' })
            .catch(() => {})
            .then(() => { window.location.href = 'login.html'; });
        });
        const us = document.createElement('span');
        const name = me.name || (me.email ? me.email.split('@')[0] : 'there');
        us.textContent = 'Hi, ' + name;
        us.style.cssText = 'color: var(--text3); font-size: 13px; margin-right: 4px;';
        us.setAttribute('data-gate', 'user');
        navLinks.appendChild(us);
        navLinks.appendChild(li);
      }
      if (userSpan) {
        const name = me.name || (me.email ? me.email.split('@')[0] : 'there');
        userSpan.textContent = 'Hi, ' + name;
        userSpan.style.display = '';
      }
    } else {
      // Not signed in — show Sign in (if it exists), hide Sign out / Hi
      if (loginLink) loginLink.style.display = '';
      if (registerLink) registerLink.style.display = '';
      if (logoutLink) logoutLink.style.display = 'none';
      if (userSpan) userSpan.style.display = 'none';
      // Remove any previously-injected logout/user elements from a prior load.
      navLinks.querySelectorAll('[data-gate="logout"], [data-gate="user"]').forEach(el => el.remove());
    }
  }

  // ---- disableActions: fail-closed for downloads when API is unreachable ----
  function disableActions() {
    const SELECTORS = [
      'a[href$=".zip"]',
      'a[href$=".dmg"]',
      'a[href$=".exe"]',
      'a[href$=".AppImage"]',
      'a[href$=".deb"]',
      'a[href$=".pkg"]',
      'a.dl-btn',
      // Per brief: "make download buttons fail closed". We mark the nav CTA
      // and primary download buttons so they redirect to login.
      'a.nav-cta',
      'a.btn-primary[href*="download"]',
      'a.btn-primary[href*="#downloads"]',
    ];
    document.querySelectorAll(SELECTORS.join(',')).forEach((el) => {
      el.dataset.gateDisabled = '1';
      el.addEventListener('click', gateRedirect, { capture: true });
    });
  }

  function gateRedirect(e) {
    e.preventDefault();
    e.stopPropagation();
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = 'login.html?next=' + next;
  }
})();