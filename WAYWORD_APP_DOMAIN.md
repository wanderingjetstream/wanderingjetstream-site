# Pointing wayword.app at /wayword/

Nothing in this file has been done. It is the checklist for later. No DNS was changed.

The [Launch day](#launch-day) section at the end lists the page changes to make when
Wayword 1.0 goes live on the App Store.

## Where things stand (read-only lookups, 2026-11-05)

| | wayword.app | wanderingjetstream.com |
|---|---|---|
| Nameservers | `ns1.crazydomains.com`, `ns2.crazydomains.com` | `byron.ns.cloudflare.com`, `cortney.ns.cloudflare.com` |
| Apex A record | `27.124.125.171` (registrar parking/hosting) | Cloudflare proxy (`104.21.66.63`, `172.67.201.135`) |
| Served by | nothing of ours | GitHub Pages, legacy build from `main` /, `CNAME` = `wanderingjetstream.com` |

## Three constraints that decide the approach

1. **One custom domain per GitHub Pages site.** This repo's `CNAME` is
   `wanderingjetstream.com`. You cannot add `wayword.app` as a second domain here, and
   changing `CNAME` would move the whole site. Do not touch `CNAME`.
2. **The app links to `https://wanderingjetstream.com/wayword/#privacy`** (AboutView), and
   the App Store listing uses `/wayword/` and `/wayword/#support`. Those URLs stay the
   canonical ones; `wayword.app` should forward to them, not replace them.
3. **`.app` is on the HSTS preload list.** Browsers only ever request
   `https://wayword.app`, so whatever answers needs a valid certificate. A plain-HTTP
   registrar forward fails with a certificate error.

## Recommended: Cloudflare redirect rule (301 to /wayword/)

Cloudflare already fronts wanderingjetstream.com, so this adds a second zone to the same
account and a redirect rule. Nothing changes in this repo.

**0. Before you start.** Log in at the registrar that holds wayword.app (the nameservers
point at Crazy Domains, so most likely there). Check that you own it, that auto-renew is
on, and whether **DNSSEC** is enabled. If it is, turn DNSSEC off at the registrar before
step 3, or resolution breaks during the move.

**1. Add the zone.** Cloudflare dashboard → *Add a domain* → `wayword.app` → Free plan.
When it imports the existing records, delete them all (the parking A record and anything
else). The domain needs no email.

**2. Note the nameservers** Cloudflare assigns to the zone (two `*.ns.cloudflare.com`
names, usually the same pair as wanderingjetstream.com).

**3. Change nameservers at the registrar.** Crazy Domains → the domain → *DNS / Name
Servers* → *Custom name servers* → replace `ns1/ns2.crazydomains.com` with the two
Cloudflare names. Save.

**4. Wait for "Active"** on the zone in Cloudflare (minutes, up to 24 h). Check:

```sh
dig +short NS wayword.app        # → the two Cloudflare names
```

**5. Add placeholder DNS records, proxied (orange cloud).** Redirect rules only run on
proxied traffic, so the hostnames need a record even though nothing is served from it.
`192.0.2.1` is a reserved documentation address that never receives traffic.

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `@` | `192.0.2.1` | Proxied |
| A | `www` | `192.0.2.1` | Proxied |
| AAAA | `@` | `100::` | Proxied |

**6. TLS.** *SSL/TLS → Edge Certificates*: confirm the Universal certificate covering
`wayword.app, *.wayword.app` is **Active**, and turn on **Always Use HTTPS**.

**7. Redirect rules.** *Rules → Redirect Rules → Create rule* (Single Redirect). Rules run
top to bottom; create them in this order.

- Rule 1, optional, "wayword.app/privacy":
  - Custom filter expression:
    `(http.host in {"wayword.app" "www.wayword.app"} and http.request.uri.path in {"/privacy" "/privacy/"})`
  - Then: URL redirect, **Static**, `https://wanderingjetstream.com/wayword/#privacy`,
    status **301**.
- Rule 2, "wayword.app → Wayword pages":
  - Custom filter expression: `(http.host in {"wayword.app" "www.wayword.app"})`
  - Then: URL redirect, **Dynamic**,
    `concat("https://wanderingjetstream.com/wayword", http.request.uri.path)`,
    status **301**, *Preserve query string* on.
  - `wayword.app/` lands on `/wayword/`, and `wayword.app/educators` lands on
    `/wayword/educators` (GitHub Pages then adds the trailing slash). An unknown path
    gets the site's 404.
  - If you would rather send everything to the overview, use **Static**
    `https://wanderingjetstream.com/wayword/` instead.

**8. Verify.**

```sh
curl -sI https://wayword.app            | grep -iE '^(HTTP|location)'
#  HTTP/2 301
#  location: https://wanderingjetstream.com/wayword/
curl -sI https://www.wayword.app/educators/ | grep -iE '^(HTTP|location)'
#  location: https://wanderingjetstream.com/wayword/educators/
curl -sI https://wayword.app/privacy    | grep -i '^location'
#  location: https://wanderingjetstream.com/wayword/#privacy
```

Then open `wayword.app` in Safari on an iPhone and check you land on the Wayword page.

**Rollback.** Disable or delete the redirect rules (takes effect within seconds). To hand
the domain back to the registrar entirely, set the nameservers back to
`ns1/ns2.crazydomains.com`.

## Alternatives, and why they are not recommended

**Registrar URL forwarding.** Crazy Domains offers domain forwarding, but because of the
HSTS preload it only works if the forwarder serves a valid HTTPS certificate for
`wayword.app` and answers with a real 301 (not a frame). Test
`curl -sI https://wayword.app` before relying on it.

**A separate GitHub Pages site for wayword.app** (only if the address bar should keep
showing `wayword.app`):

1. New public repo, e.g. `wanderingjetstream/wayword-app-site`, containing a copy of the
   Wayword pages, `/fonts/`, `/style.css`, and a `CNAME` file with `wayword.app`.
2. Account *Settings → Pages → Verified domains*: add `wayword.app` and create the TXT
   record GitHub asks for.
3. DNS (registrar, or Cloudflare with the proxy **off**): A `@` → `185.199.108.153`,
   `185.199.109.153`, `185.199.110.153`, `185.199.111.153`; AAAA `@` →
   `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`,
   `2606:50c0:8003::153`; CNAME `www` → `wanderingjetstream.github.io`.
4. Repo *Settings → Pages*: custom domain `wayword.app`; once the certificate is issued,
   tick *Enforce HTTPS*.
5. Add `<link rel="canonical">` pointing at one copy, and keep
   `wanderingjetstream.com/wayword/#privacy` working, because shipped builds link to it.

The cost is two copies of every page to keep in sync, which is why the redirect is the
recommendation.

## Launch day

Make these changes in one commit when Wayword 1.0 is live on the App Store. They are
all in this repo and none of them touch DNS.

1. **App Store badge** (`wayword/index.html`, hero). The `APP STORE BADGE PLACEHOLDER`
   HTML comment marks the spot.
   - Download Apple's official "Download on the App Store" badge (black, US English,
     SVG) from Apple's marketing tools (developer.apple.com/app-store/marketing/guidelines).
   - Save it in this repo as `wayword/app-store-badge.svg`. Never hot-link it from
     Apple: the pages must keep making no third-party requests.
   - Replace `<p class="store-badge">Coming soon to the App Store</p>` with:

     ```html
     <p class="store-link"><a href="https://apps.apple.com/app/id6784230698"><img
       src="/wayword/app-store-badge.svg" alt="Download on the App Store"
       width="120" height="40"></a></p>
     ```

     `6784230698` is Wayword's Apple ID in App Store Connect. Open the link once to
     confirm it reaches the listing.
   - In `wayword/wayword.css`, replace the `.store-badge` rule and the comment above it with
     `.store-link { margin-top: 26px; } .store-link img { display: block; }`.
     Keep the badge at least 40px tall, as Apple's guidelines require.
   - Then delete the placeholder comment.
2. **Remove the "Coming in 1.0" labels** (each is a `<p class="soon">`):
   - `wayword/index.html`, under "Lessons" and under "Snapshots"
   - `wayword/educators/index.html`: "Lessons and Snapshots arrive in Wayword 1.0"
   - `wayword/courses/index.html`: "Courses arrive in Wayword 1.0"

   Then delete the `.soon` rule and the comment above it in `wayword/wayword.css`.
3. **Remove "from version 1.0"** from the two places that say it:
   - `wayword/index.html` lede: "— and, from version 1.0, build and share short courses
     on any subject" becomes "— and build and share short courses on any subject"
   - `index.html` (studio home), Wayword card: "— and, from version 1.0, short courses
     anyone can build and share" becomes "— and short courses anyone can build and share"
4. **Check before pushing.** This should print nothing:

   ```sh
   grep -rnE '1\.0|class="soon"|store-badge|PLACEHOLDER|Coming soon' index.html wayword/
   ```

   Then serve the site locally (`python3 -m http.server`) and look at `/wayword/` on a
   desktop and a phone-width window. The badge should load from this site, not from
   Apple.
5. **After GitHub Pages redeploys**, open https://wanderingjetstream.com/wayword/ and tap
   the badge on an iPhone to confirm it opens the App Store listing.
