# mybizpulse.in

Official website of BizPulse by Srijee Creations. Plain HTML / CSS / JavaScript — no build step,
no server-side code. Hosted on Domain India (cPanel); every file here goes into `public_html/`.

| File | Page |
|---|---|
| `index.html` | Home — About Srijee Creations (landing page) |
| `products.html` | Products & Features — the five editions, each card with its feature checklist (green ✓ included, red ✗ not included), and the full comparison table |
| `pricing.html` | Pricing (Standard Silver ₹2,999 / ₹1,499; Standard Gold and Platinum up to 3 Multiuser + 3 Voice Express seats; Pro Gold and Platinum up to 7 + 7; Pro Platinum lifetime ₹41,999) and the Download section (`#download`) |
| `partners.html` | Partner Network |
| `contact.html` | Contact |
| `404.html` | Page not found (used by `.htaccess`) |
| `assets/site.css`, `assets/site.js` | Shared styles and script (downloads, hotlines, animations, footer year) |
| `assets/fonts/` | Optional `Playball-Regular.ttf` (tagline font fallback) |
| `downloads/` | The Windows installers and their `.sha256.txt` checksums |
| `.htaccess` | HTTPS, download headers, clean links, 404, security headers, caching |
| `CNAME` | Only for GitHub Pages; ignored (and hidden) on Domain India |

## Publish on Domain India

1. cPanel → **SSL/TLS Status** → *Run AutoSSL* until mybizpulse.in shows a valid certificate.
2. Upload everything in this folder into **public_html/** (cPanel File Manager → Upload → Extract the
   zip, or FTP). Show hidden files to see `.htaccess`.
3. Upload the installers and their checksums into **public_html/downloads/** with FTP (see
   `downloads/README.txt`).
4. Open https://mybizpulse.in, then https://mybizpulse.in/download/pro — the Pro setup should start
   downloading as **BizPulse_Setup_v1.0.0.exe**.
5. When HTTPS works everywhere, un-comment the `Strict-Transport-Security` line in `.htaccess`.

## Download links

The buttons use `downloads/<file>` on this server (`DOWNLOAD_BASE` in `assets/site.js`; the same
links are written in `pricing.html`). Short links: `/download`, `/download/pro`, `/download/standard`,
`/download/lite`, `/download/billing`, `/download/voice-express`.

| Edition | File |
|---|---|
| Voice Express | BizPulse_Voice_Express_Setup_v1.0.0.exe |
| Billing | BizPulse_Billing_Setup_v1.0.0.exe |
| Lite | BizPulse_Lite_Setup_v1.0.0.exe |
| Standard (Silver, Gold, Platinum) | BizPulse_Standard_Setup_v1.0.0.exe |
| Pro (Silver, Gold, Platinum) | BizPulse_Setup_v1.0.0.exe |

For a new version: upload the new files, then change the version in `assets/site.js` (DOWNLOADS),
in `pricing.html` and in the short links in `.htaccess`.

## Windows "unknown publisher" warning

Browsers stop warning about the download once it comes over HTTPS (step 1). Windows SmartScreen
("Windows protected your PC") is decided by Windows from the file's code signature and reputation;
no website setting removes it. Sign the setup with a code-signing certificate in the name of
Srijee Creations (desktop `build-installer.bat`, `SIGN_PFX`) before the public launch.
