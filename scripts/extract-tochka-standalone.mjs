import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = '/Users/ruzibekov/Projects/tochka';
const pageUrl = 'https://tochka.com/rko/happy-birthday/';
const allowedHosts = new Set([
  'tochka.com',
  'static.tildacdn.com',
  'cdnjs.cloudflare.com',
  'gist.githubusercontent.com',
  'i.tochka.com',
]);
const blockedUrlParts = [
  'mc.yandex.ru',
  'googletagmanager.com',
  'top-fwz1.mail.ru',
  'privacy-cs.mail.ru',
  'vk.com',
  'hybrid.ai',
  'targetads',
  'adhigh.net',
  'uaas.yandex.ru',
  'google.com/ccm/collect',
  'yandex.ru/an/',
  'mail.ru/cm.gif',
  'openx.net',
  'an/mapuid/',
];
const usefulExtensions = new Set([
  '.css',
  '.js',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.json',
  '.ico',
]);

function shouldKeepUrl(resourceUrl) {
  if (!resourceUrl || resourceUrl.startsWith('data:') || resourceUrl.startsWith('blob:')) {
    return false;
  }

  for (const blockedPart of blockedUrlParts) {
    if (resourceUrl.includes(blockedPart)) {
      return false;
    }
  }

  const parsedUrl = new URL(resourceUrl);
  if (!allowedHosts.has(parsedUrl.host)) {
    return false;
  }

  const extension = path.posix.extname(parsedUrl.pathname).toLowerCase();
  return usefulExtensions.has(extension);
}

function toLocalWebPath(resourceUrl) {
  const parsedUrl = new URL(resourceUrl);
  const cleanPath = decodeURIComponent(parsedUrl.pathname);

  if (parsedUrl.host === 'tochka.com') {
    return cleanPath;
  }

  return path.posix.join('/external', parsedUrl.host, cleanPath);
}

function toFilePath(webPath) {
  return path.join(rootDir, webPath.replace(/^\/+/, ''));
}

function addReplacementEntries(replacements, originalUrl, localPath) {
  const parsedUrl = new URL(originalUrl);
  replacements.set(originalUrl, localPath);
  replacements.set(parsedUrl.origin + parsedUrl.pathname, localPath);
  replacements.set('//' + parsedUrl.host + parsedUrl.pathname, localPath);
}

function applyReplacements(content, replacements) {
  let result = content;

  for (const [from, to] of replacements.entries()) {
    result = result.split(from).join(to);
  }

  return result;
}

async function ensureDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function writeBinary(filePath, buffer) {
  await ensureDirectory(filePath);
  await fs.writeFile(filePath, buffer);
}

async function writeText(filePath, content) {
  await ensureDirectory(filePath);
  await fs.writeFile(filePath, content, 'utf8');
}

console.log('launch');
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  viewport: { width: 1512, height: 982 },
  locale: 'ru-RU',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
});
const page = await context.newPage();
const resourceStore = new Map();

page.on('response', async (response) => {
  const resourceUrl = response.url();
  if (!shouldKeepUrl(resourceUrl)) {
    return;
  }

  if (resourceStore.has(resourceUrl)) {
    return;
  }

  try {
    const body = await response.body();
    resourceStore.set(resourceUrl, {
      body,
      contentType: response.headers()['content-type'] ?? '',
    });
  } catch {
    return;
  }
});

page.setDefaultTimeout(45000);
console.log('open');
await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(4000);

console.log('capture-html');
const initialHtml = await page.content();

console.log('click-1');
await page.getByRole('link', { name: 'Задуть свечи' }).click();
await page.waitForTimeout(2500);
console.log('click-2');
await page.getByRole('link', { name: 'Задуть без микрофона' }).click();
await page.waitForTimeout(2500);

console.log('collect-resources');
const performanceUrls = await page.evaluate(() =>
  Array.from(new Set(performance.getEntriesByType('resource').map((entry) => entry.name))),
);

for (const resourceUrl of performanceUrls) {
  if (!shouldKeepUrl(resourceUrl) || resourceStore.has(resourceUrl)) {
    continue;
  }

  try {
    const response = await context.request.get(resourceUrl, {
      headers: {
        referer: pageUrl,
      },
    });

    if (!response.ok()) {
      continue;
    }

    resourceStore.set(resourceUrl, {
      body: await response.body(),
      contentType: response.headers()['content-type'] ?? '',
    });
  } catch {
    continue;
  }
}

const replacements = new Map();

for (const [resourceUrl] of resourceStore.entries()) {
  const localPath = toLocalWebPath(resourceUrl);
  addReplacementEntries(replacements, resourceUrl, localPath);
}

const textLikeExtensions = new Set(['.css', '.js', '.json']);

console.log('write-assets', resourceStore.size);
for (const [resourceUrl, asset] of resourceStore.entries()) {
  const localPath = toLocalWebPath(resourceUrl);
  const filePath = toFilePath(localPath);
  const extension = path.posix.extname(new URL(resourceUrl).pathname).toLowerCase();

  if (textLikeExtensions.has(extension)) {
    const originalText = asset.body.toString('utf8');
    const rewrittenText = applyReplacements(originalText, replacements);
    await writeText(filePath, rewrittenText);
    continue;
  }

  await writeBinary(filePath, asset.body);
}

let standaloneHtml = applyReplacements(initialHtml, replacements);
standaloneHtml = standaloneHtml.replaceAll(
  'https://tochka.com/rko/happy-birthday/',
  '/rko/happy-birthday/',
);
standaloneHtml = standaloneHtml.replace(
  '</title>',
  '</title><script>window.dataLayer=window.dataLayer||[];window.google_tag_manager=window.google_tag_manager||{rm:{"950805":function(){return function(){return"";};}}};window.ym=window.ym||function(){};window.ymab=window.ymab||function(){};window.VK=window.VK||{Retargeting:{Init:function(){},Hit:function(){}}};window._tmr=window._tmr||[];</script>',
);

await writeText(path.join(rootDir, 'rko/happy-birthday/index.html'), standaloneHtml);
await writeText(
  path.join(rootDir, 'output/resource-manifest.json'),
  JSON.stringify(
    {
      resources: Array.from(resourceStore.keys()).sort(),
    },
    null,
    2,
  ),
);

console.log('done');
await browser.close();
