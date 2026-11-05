// Review harness for this PR (not published: Jekyll skips _review/).
// Run: python3 -m http.server 8765 --directory <repo> && NODE_PATH=<playwright+axe-core node_modules> node _review/check.js http://127.0.0.1:8765 _review
// Usage: node check.js <baseURL> <screenshotDir|->
// Checks every Wayword page (and the studio root) and optionally writes screenshots.
const { chromium, webkit } = require('playwright');
const fs = require('fs');
const path = require('path');
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const BASE = process.argv[2];
const SHOTS = process.argv[3] && process.argv[3] !== '-' ? process.argv[3] : null;
const PAGES = [
  ['wayword', '/wayword/'],
  ['terms', '/wayword/terms/'],
  ['educators', '/wayword/educators/'],
  ['courses', '/wayword/courses/'],
  ['support', '/wayword/support/'],
  ['studio-root', '/'],
];
const LEIPZIG = 'Leipzig Corpora Collection data is used under the Creative Commons Attribution licence (CC BY). We gratefully acknowledge Universität Leipzig, the Sächsische Akademie der Wissenschaften zu Leipzig, and InfAI as the source of corpus data used in building these word lists.';
const NOCORPUS = 'No corpus text is included in the app — only frequency-ranked headwords and our own editorial enrichment.';

let failures = 0;
const fail = (m) => { failures++; console.log('FAIL ' + m); };
const ok = (m) => console.log('ok   ' + m);

async function waitScrollStable(page) {
  let last = -1, since = Date.now(); const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    const y = await page.evaluate(() => window.scrollY);
    if (y !== last) { last = y; since = Date.now(); } else if (Date.now() - since > 500) return;
    await page.waitForTimeout(100);
  }
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

(async () => {
  const chrome = await chromium.launch();
  const external = new Set();

  // ---- per-page structure, a11y, overflow ----
  for (const [name, url] of PAGES) {
    for (const vp of [{ w: 1280, h: 800 }, { w: 390, h: 844 }, { w: 320, h: 568 }, { w: 320, h: 180 }]) {
      const ctx = await chrome.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await ctx.newPage();
      page.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:')) external.add(r.url()); });
      const resp = await page.goto(BASE + url);
      await settle(page);
      const tag = `${name} @${vp.w}x${vp.h}`;
      if (resp.status() !== 200) fail(`${tag} status ${resp.status()}`);
      const info = await page.evaluate(() => ({
        lang: document.documentElement.lang,
        h1: document.querySelectorAll('h1').length,
        imgNoAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length,
        scripts: document.querySelectorAll('script').length,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        header: Math.round(document.querySelector('.site-head').getBoundingClientRect().height),
        headPos: getComputedStyle(document.querySelector('.site-head')).position,
        cookies: document.cookie,
      }));
      if (vp.w === 1280) {
        info.lang === 'en' ? ok(`${tag} lang=en`) : fail(`${tag} lang=${info.lang}`);
        info.h1 === 1 ? ok(`${tag} one h1`) : fail(`${tag} h1 count ${info.h1}`);
        info.imgNoAlt === 0 ? ok(`${tag} no img without alt`) : fail(`${tag} ${info.imgNoAlt} img without alt`);
        info.scripts === 0 ? ok(`${tag} no <script>`) : fail(`${tag} ${info.scripts} <script>`);
        info.cookies === '' ? ok(`${tag} no cookies`) : fail(`${tag} cookies ${info.cookies}`);
      }
      info.overflow <= 0 ? ok(`${tag} no horizontal overflow; header ${info.header}px ${info.headPos}`)
                         : fail(`${tag} horizontal overflow ${info.overflow}px`);
      if (vp.w === 1280 || vp.w === 320 && vp.h === 568) {
        await page.addScriptTag({ content: axeSource });
        const res = await page.evaluate(async () => {
          const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
          return r.violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
        });
        res.length === 0 ? ok(`${tag} axe: 0 violations`) : res.forEach((v) => fail(`${tag} axe ${v}`));
      }
      await ctx.close();
    }
  }
  external.size === 0 ? ok('no third-party requests on any page') : [...external].forEach((u) => fail('external request ' + u));

  // ---- links + fragments resolve ----
  {
    const ctx = await chrome.newContext();
    const page = await ctx.newPage();
    const targets = new Set();
    for (const [, url] of PAGES) {
      await page.goto(BASE + url);
      const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
      hrefs.forEach((h) => targets.add(JSON.stringify([url, h])));
    }
    const externalLinks = new Set();
    for (const t of targets) {
      const [from, href] = JSON.parse(t);
      if (/^mailto:/.test(href)) { if (href !== 'mailto:support@wanderingjetstream.com') fail(`odd mailto ${href}`); continue; }
      if (/^https?:/.test(href)) { externalLinks.add(href); continue; }
      const abs = new URL(href, BASE + from);
      const r = await page.goto(abs.href.split('#')[0]);
      if (r.status() !== 200) { fail(`${from} -> ${href} status ${r.status()}`); continue; }
      if (abs.hash) {
        const id = decodeURIComponent(abs.hash.slice(1));
        const tagName = await page.evaluate((i) => document.getElementById(i)?.tagName || null, id);
        tagName ? null : fail(`${from} -> ${href}: no element #${id}`);
      }
    }
    ok(`checked ${targets.size} (page, href) pairs; external links: ${[...externalLinks].join(', ')}`);

    // Leipzig byte-identical + own <p>
    await page.goto(BASE + '/wayword/');
    const paras = await page.$$eval('p', (ps) => ps.map((p) => p.textContent));
    paras.includes(LEIPZIG) ? ok('Leipzig attribution present byte-identical as its own <p>') : fail('Leipzig attribution not byte-identical');
    const li = paras.indexOf(LEIPZIG);
    paras[li + 1] === NOCORPUS ? ok('"No corpus text…" is the next <p>, byte-identical') : fail('no-corpus <p> missing or not next');
    await ctx.close();
  }

  // ---- #privacy lands on the heading, below the sticky header (Chromium + WebKit) ----
  const wk = await webkit.launch();
  for (const [engName, eng] of [['chromium', chrome], ['webkit', wk]]) {
    for (const vp of [{ w: 1280, h: 800 }, { w: 390, h: 844 }, { w: 375, h: 667 }, { w: 320, h: 568 }]) {
      for (const target of ['/wayword/#privacy', '/wayword/#support', '/wayword/#terms', '/wayword/support/#delete-data']) {
        const ctx = await eng.newContext({ viewport: { width: vp.w, height: vp.h } });
        const page = await ctx.newPage();
        await page.goto(BASE + target);
        await settle(page);
        await waitScrollStable(page);
        const r = await page.evaluate((id) => {
          const h = document.getElementById(id).getBoundingClientRect();
          const head = document.querySelector('.site-head').getBoundingClientRect();
          return { top: Math.round(h.top), bottom: Math.round(h.bottom), headBottom: Math.round(head.bottom), vh: window.innerHeight, sy: Math.round(window.scrollY) };
        }, target.split('#')[1]);
        const tag = `${engName} ${target} @${vp.w}x${vp.h}`;
        (r.top >= r.headBottom && r.bottom <= r.vh && r.sy > 0)
          ? ok(`${tag} heading at y=${r.top}, header ends y=${r.headBottom} (gap ${r.top - r.headBottom}px)`)
          : fail(`${tag} heading top ${r.top} header bottom ${r.headBottom} vh ${r.vh} scrollY ${r.sy}`);
        await ctx.close();
      }
    }
  }

  // ---- screenshots ----
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const [name, url] of PAGES) {
      for (const [label, vp, dpr] of [['desktop', { width: 1280, height: 800 }, 1], ['mobile-390', { width: 390, height: 844 }, 1]]) {
        const ctx = await chrome.newContext({ viewport: vp, deviceScaleFactor: dpr });
        const page = await ctx.newPage();
        await page.goto(BASE + url);
        await settle(page);
        await page.screenshot({ path: path.join(SHOTS, `${name}-${label}.png`), fullPage: true });
        await ctx.close();
      }
    }
    // The in-app link as an iPhone opens it (WebKit, viewport only).
    const ctx = await wk.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(BASE + '/wayword/#privacy');
    await settle(page);
    await waitScrollStable(page);
    await page.screenshot({ path: path.join(SHOTS, 'wayword-privacy-anchor-mobile-390-webkit.png') });
    await ctx.close();
    ok('screenshots written to ' + SHOTS);
  }

  await wk.close();
  await chrome.close();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURE(S)`);
  process.exit(failures ? 1 : 0);
})();
