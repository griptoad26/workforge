/* seele.agency — auth gate client-side script.
 * - Adds a "Logout" button to the top nav.
 * - If the page is in GATE_PATHS, redirects unauthenticated visitors to /login.html.
 * - Fails OPEN for static content (the page still loads), but FAIL-CLOSES any
 *   download/buy button.
 *
 * Usage: <script src="gate.js" defer></script> just before </body>.
 *
 * Disable via <meta name="auth-gate" content="off"> (used by /login.html, /register.html,
 * /api/pay/*, /v1/x402/*, etc.)
 */

(function () {
  'use strict';

  // Pages that must be gated.
  const GATE_PATHS = [
    'downloads.html',
    'checkout.html',
    'support.html',
    'dashboard.html',
    'account.html',
    'admin.html',
  ];

  // Pages that are ALWAYS public (never gate, never redirect).
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

  // 1. Bail out if explicitly disabled via <meta name="auth-gate" content="off">.
  const meta = document.querySelector('meta[name="auth-gate"]');
  if (meta && meta.content === 'off') return;

  const here = location.pathname.split('/').pop() || 'index.html';

  // 2. Always-public pages: bail out.
  if (PUBLIC_PATHS.includes(here)) {
    injectLogoutButton();
    return;
  }

  // 3. Gated pages: check session, redirect if missing.
  const API = (() => {
    if (location.hostname.endsWith('seele.agency')) return location.origin + '/api/pay';
    if (location.hostname.endsWith('ts.net'))      return location.origin + '/api/pay';
    return 'http://127.0.0.1:8765';
  })();

  const REDIRECT_DELAY_MS = 0;   // redirect immediately if not logged in
  let user = null;

  fetch(API + '/v1/auth/me', { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : null))
    .then((u) => {
      user = u;
      if (!user && GATE_PATHS.includes(here)) {
        const next = encodeURIComponent(here + location.search);
        location.replace('login.html?next=' + next);
        return;
      }
      // Logged in (or page isn't gated): inject logout button.
      injectLogoutButton();
    })
    .catch((err) => {
      // Fail OPEN for content, fail CLOSED for actions.
      console.warn('[gate] auth check failed; allowing content but disabling actions:', err);
      disableActions();
      injectLogoutButton();
    });

  function injectLogoutButton() {
    const navLinks = document.querySelector('nav .nav-links');
    if (!navLinks) return;

    // Don't double-insert.
    if (navLinks.querySelector('[data-gate="logout"]')) return;

    const logoutLink = document.createElement('a');
    logoutLink.href = '#';
    logoutLink.textContent = user ? 'Log out' : 'Log in';
    logoutLink.setAttribute('data-gate', 'logout');
    logoutLink.style.fontWeight = '600';

    logoutLink.addEventListener('click', async (e) => {
      e.preventDefault();
      if (user) {
        await fetch(API + '/v1/auth/logout', {
          method: 'POST',
          credentials: 'include',
        }).catch(() => {});
      }
      location.href = 'login.html';
    });

    navLinks.appendChild(logoutLink);

    // If logged in, also show the user name.
    if (user && user.email) {
      const userSpan = document.createElement('span');
      userSpan.textContent = user.email.split('@')[0];
      userSpan.style.cssText = 'color: var(--text3); font-size: 13px; margin-right: 4px;';
      userSpan.setAttribute('data-gate', 'user');
      navLinks.insertBefore(userSpan, logoutLink);
    }
  }

  function disableActions() {
    // Disable download buttons and checkout links so they don't fire.
    const SELECTORS = [
      'a[href$=".zip"]',
      'a[href$=".dmg"]',
      'a[href$=".exe"]',
      'a[href$=".AppImage"]',
      'a[href$=".deb"]',
      'a[href$=".pkg"]',
      'a[href*="/checkout"]',
      'a[href*="/buy"]',
      'a[href*="/download"]',
      'button[type="submit"]',
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