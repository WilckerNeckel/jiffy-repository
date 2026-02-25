const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const ROOT_DIR = path.resolve(__dirname);
const VERSIONS_DIR = path.join(ROOT_DIR, 'versions');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.apk': 'application/vnd.android.package-archive',
  '.sha1': 'text/plain; charset=utf-8',
};

function safeResolve(baseDir, requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const safePath = decoded.replace(/\\/g, '/');
  const resolved = path.resolve(baseDir, '.' + safePath);
  if (!resolved.startsWith(baseDir)) return null;
  return resolved;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '-';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

function parseVersionFromName(name) {
  const dotted = name.match(/(\d+)\.(\d+)\.(\d+)/);
  if (dotted) {
    return {
      version: `${dotted[1]}.${dotted[2]}.${dotted[3]}`,
      parts: [Number(dotted[1]), Number(dotted[2]), Number(dotted[3])],
    };
  }
  const compact = name.match(/(\d{3})/);
  if (compact) {
    const digits = compact[1].split('').map((d) => Number(d));
    return {
      version: `${digits[0]}.${digits[1]}.${digits[2]}`,
      parts: digits,
    };
  }
  return null;
}

function compareSemver(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function resolveLatestFolder(entries) {
  let latest = null;
  entries.forEach((entry) => {
    if (!entry.isDirectory()) return;
    const parsed = parseVersionFromName(entry.name);
    if (!parsed) return;
    if (!latest || compareSemver(parsed.parts, latest.parts) > 0) {
      latest = { name: entry.name, version: parsed.version, parts: parsed.parts };
    }
  });
  return latest;
}

function dirListingPage({ title, baseUrl, items, breadcrumbs }) {
  const rows = items
    .map((item) => {
      const icon = item.isDirectory ? '📁' : '⬇️';
      const badge = item.isDirectory ? 'Folder' : 'APK';
      const size = item.isDirectory ? '-' : formatBytes(item.size);
      const latestBadge = item.isLatest ? '<span class="badge latest">Última</span>' : '';
      const versionLabel = item.version ? `<span class="version">v${item.version}</span>` : '';
      return `
        <a class="row" href="${item.href}">
          <div class="cell name">
            <span class="icon" aria-hidden="true">${icon}</span>
            <span>${item.name}</span>
          </div>
          <div class="cell meta">
            <span class="badge">${badge}</span>
            ${versionLabel}
            ${latestBadge}
            <span class="size">${size}</span>
          </div>
        </a>
      `;
    })
    .join('');

  const crumbHtml = breadcrumbs
    .map((crumb, idx) => {
      const isLast = idx === breadcrumbs.length - 1;
      if (isLast) return `<span>${crumb.label}</span>`;
      return `<a href="${crumb.href}">${crumb.label}</a>`;
    })
    .join(' / ');

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@500;700&family=Space+Grotesk:wght@400;500;600&display=swap" rel="stylesheet" />
    <style>
      :root {
        --primary: #003366;
        --secondary: #530CA3;
        --tertiary: #006699;
        --alternate: #8338EC;
        --primary-text: #171A1C;
        --secondary-text: #57636C;
        --primary-bg: #EEEEF5;
        --secondary-bg: #91B4C6;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: 'Space Grotesk', system-ui, sans-serif;
        color: var(--primary-text);
        background: radial-gradient(1200px 600px at 10% -10%, rgba(83, 12, 163, 0.2), transparent),
                    radial-gradient(900px 500px at 90% 10%, rgba(0, 102, 153, 0.25), transparent),
                    linear-gradient(180deg, #F8F9FC 0%, var(--primary-bg) 100%);
        min-height: 100vh;
      }
      header {
        padding: 32px 20px 0;
        max-width: 1100px;
        margin: 0 auto;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      .logo {
        width: 56px;
        height: 56px;
        border-radius: 14px;
        background: #fff;
        box-shadow: 0 10px 30px rgba(0,0,0,0.12);
        padding: 8px;
        object-fit: contain;
      }
      .title {
        font-family: 'Fraunces', serif;
        font-size: 28px;
        margin: 0;
        color: var(--primary);
      }
      .subtitle {
        margin: 8px 0 0;
        color: var(--secondary-text);
        font-size: 15px;
      }
      main {
        max-width: 1100px;
        margin: 24px auto 60px;
        padding: 0 20px;
      }
      .crumbs {
        font-size: 14px;
        color: var(--secondary-text);
        background: rgba(255, 255, 255, 0.7);
        border: 1px solid rgba(0, 51, 102, 0.08);
        border-radius: 999px;
        padding: 8px 16px;
        display: inline-flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .crumbs a {
        color: var(--secondary);
        text-decoration: none;
      }
      .panel {
        margin-top: 18px;
        background: rgba(255, 255, 255, 0.85);
        border: 1px solid rgba(0, 51, 102, 0.08);
        border-radius: 20px;
        padding: 16px;
        box-shadow: 0 20px 40px rgba(0,0,0,0.08);
        backdrop-filter: blur(6px);
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        border-radius: 12px;
        text-decoration: none;
        color: inherit;
        transition: transform 0.15s ease, background 0.15s ease;
      }
      .row:hover {
        transform: translateY(-2px);
        background: rgba(0, 51, 102, 0.06);
      }
      .row + .row {
        margin-top: 6px;
      }
      .cell {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .icon {
        font-size: 20px;
      }
      .meta {
        gap: 12px;
      }
      .badge {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        background: rgba(83, 12, 163, 0.12);
        color: var(--secondary);
        padding: 4px 8px;
        border-radius: 999px;
        font-weight: 600;
      }
      .badge.latest {
        background: rgba(0, 102, 153, 0.18);
        color: var(--primary);
      }
      .version {
        font-size: 12px;
        font-weight: 600;
        color: var(--primary);
      }
      .size {
        color: var(--secondary-text);
        font-size: 12px;
      }
      footer {
        margin-top: 28px;
        color: var(--secondary-text);
        font-size: 12px;
      }
      @media (max-width: 640px) {
        .row {
          flex-direction: column;
          align-items: flex-start;
          gap: 6px;
        }
        .meta {
          width: 100%;
          justify-content: space-between;
        }
        .title {
          font-size: 22px;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="brand">
        <img class="logo" src="/assets/avatar-pequeno.png" alt="Jiffy" />
        <div>
          <h1 class="title">Distribuicao de APKs</h1>
          <p class="subtitle">Navegue pelas versoes e baixe qualquer APK.</p>
        </div>
      </div>
    </header>
    <main>
      <div class="crumbs">${crumbHtml}</div>
      <section class="panel">
        ${rows || '<p>Esta pasta esta vazia.</p>'}
      </section>
    </main>
  </body>
</html>`;
}

function buildBreadcrumbs(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  const crumbs = [{ label: 'versões', href: '/versions/' }];
  let current = '/versions';
  for (let i = 1; i < parts.length; i += 1) {
    current += `/${parts[i]}`;
    crumbs.push({ label: parts[i], href: `${current}/` });
  }
  return crumbs;
}

function handleDirectory(res, dirPath, urlPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const latestFolder = urlPath === '/versions/' ? resolveLatestFolder(entries) : null;
  const items = entries
    .map((entry) => {
      const entryPath = path.join(dirPath, entry.name);
      const stats = fs.statSync(entryPath);
      const parsedVersion = entry.isDirectory() ? parseVersionFromName(entry.name) : null;
      const href = `${urlPath}${entry.name}${entry.isDirectory() ? '/' : ''}`;
      return {
        name: entry.name,
        href,
        isDirectory: entry.isDirectory(),
        size: stats.size,
        version: parsedVersion ? parsedVersion.version : null,
        versionParts: parsedVersion ? parsedVersion.parts : null,
        isLatest: latestFolder ? entry.name === latestFolder.name : false,
      };
    })
    .sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      if (urlPath === '/versions/' && a.isDirectory && b.isDirectory) {
        if (a.versionParts && b.versionParts) {
          return compareSemver(b.versionParts, a.versionParts);
        }
        if (a.versionParts && !b.versionParts) return -1;
        if (!a.versionParts && b.versionParts) return 1;
      }
      return a.name.localeCompare(b.name);
    });

  const html = dirListingPage({
    title: `Jiffy APKs - ${urlPath}`,
    baseUrl: urlPath,
    items,
    breadcrumbs: buildBreadcrumbs(urlPath),
  });

  res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
  res.end(html);
}

function handleFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Content-Disposition': ext === '.apk' ? `attachment; filename="${path.basename(filePath)}"` : 'inline',
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname === '/' || pathname === '') {
      res.writeHead(302, { Location: '/versions/' });
      res.end();
      return;
    }

    if (pathname.startsWith('/assets/')) {
      const assetPath = safeResolve(ASSETS_DIR, pathname.replace('/assets', ''));
      if (!assetPath || !fs.existsSync(assetPath) || fs.statSync(assetPath).isDirectory()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      handleFile(res, assetPath);
      return;
    }

    if (!pathname.startsWith('/versions')) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const targetPath = safeResolve(VERSIONS_DIR, pathname.replace('/versions', ''));
    if (!targetPath || !fs.existsSync(targetPath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
      const normalized = pathname.endsWith('/') ? pathname : `${pathname}/`;
      if (pathname !== normalized) {
        res.writeHead(302, { Location: normalized });
        res.end();
        return;
      }
      handleDirectory(res, targetPath, normalized);
      return;
    }

    handleFile(res, targetPath);
  } catch (err) {
    res.writeHead(500);
    res.end('Internal server error');
  }
});

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
