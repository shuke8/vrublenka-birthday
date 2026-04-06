import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = '/Users/ruzibekov/Projects/tochka';
const baseUrl = 'http://127.0.0.1:4174/rko/happy-birthday/';
const outputDir = path.join(rootDir, 'output', 'case-tests');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function sanitize(name) {
  return name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
}

async function createPage(browser, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1440, height: 900 },
    locale: 'ru-RU',
  });

  if (options.initScript) {
    await context.addInitScript(options.initScript);
  }

  return { context, page: await context.newPage() };
}

async function goto(page, query = '') {
  await page.goto(baseUrl + query, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
}

async function grabState(page) {
  return await page.evaluate(() => {
    const title = document.querySelector('.title .tn-atom')?.innerText?.trim() ?? '';
    const description = document.querySelector('.description .tn-atom')?.innerText?.trim() ?? '';
    const visibleButtons = Array.from(document.querySelectorAll('a[href="#go"]'))
      .filter((link) => {
        const style = window.getComputedStyle(link);
        const rect = link.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })
      .map((link) => link.textContent?.trim() ?? '')
      .filter(Boolean);
    return {
      title,
      description,
      visibleButtons,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
}

async function saveShot(page, name) {
  const filePath = path.join(outputDir, sanitize(name) + '.png');
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function clickVisibleButton(page, buttonText) {
  await page.getByRole('link', { name: buttonText }).click();
  await page.waitForTimeout(1200);
}

async function forceManualDone(page) {
  await page.evaluate(() => {
    const flames = Array.from(document.querySelectorAll('.flame')).filter((flame) => {
      const style = window.getComputedStyle(flame);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    flames.slice(0, -1).forEach((flame) => {
      flame.setAttribute('data-out', '1');
    });
  });

  const flameCount = await page.locator('.flame').count();
  for (let index = flameCount - 1; index >= 0; index -= 1) {
    const flame = page.locator('.flame').nth(index);
    if (await flame.isVisible().catch(() => false)) {
      await flame.click({ force: true });
      await page.waitForTimeout(3500);
      return;
    }
  }
}

async function detectOverlap(page) {
  return await page.evaluate(() => {
    const title = document.querySelector('.title');
    const description = document.querySelector('.description');
    const cake = document.querySelector('.cake');
    if (!title || !description || !cake) {
      return { overlap: null };
    }

    const titleRect = title.getBoundingClientRect();
    const descRect = description.getBoundingClientRect();
    const cakeRect = cake.getBoundingClientRect();
    const intersects =
      Math.max(titleRect.bottom, descRect.bottom) > cakeRect.top &&
      Math.min(titleRect.top, descRect.top) < cakeRect.bottom;

    return {
      overlap: intersects,
      titleBottom: titleRect.bottom,
      descBottom: descRect.bottom,
      cakeTop: cakeRect.top,
    };
  });
}

async function runCase(browser, config) {
  const result = {
    name: config.name,
    status: 'passed',
  };

  const { context, page } = await createPage(browser, {
    viewport: config.viewport,
    initScript: config.initScript,
  });

  try {
    await goto(page, config.query);
    if (config.steps) {
      for (const step of config.steps) {
        await step(page);
      }
    }

    result.state = await grabState(page);
    result.screenshot = await saveShot(page, config.name);

    if (config.extra) {
      Object.assign(result, await config.extra(page, result.state));
    }

    if (config.assert) {
      const error = await config.assert(result);
      if (error) {
        result.status = 'failed';
        result.error = error;
      }
    }
  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof Error ? error.message : String(error);
    result.screenshot = await saveShot(page, config.name + '-error').catch(() => null);
  } finally {
    await context.close();
  }

  return result;
}

const denyMicInit = `
Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: {
    getUserMedia() {
      return Promise.reject(new Error('denied'));
    }
  }
});
`;

const allowMicInit = `
Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: {
    getUserMedia() {
      return Promise.resolve({
        getTracks() {
          return [{ stop() {} }];
        }
      });
    }
  }
});
class FakeAnalyser {
  constructor() {
    this.fftSize = 512;
  }
  getByteTimeDomainData(arr) {
    for (let i = 0; i < arr.length; i += 1) {
      arr[i] = i % 2 === 0 ? 255 : 0;
    }
  }
}
class FakeAudioContext {
  constructor() {
    this.state = 'running';
  }
  resume() {
    return Promise.resolve();
  }
  createAnalyser() {
    return new FakeAnalyser();
  }
  createMediaStreamSource() {
    return {
      connect() {}
    };
  }
  close() {
    return Promise.resolve();
  }
}
window.AudioContext = FakeAudioContext;
window.webkitAudioContext = FakeAudioContext;
`;

const cases = [
  {
    name: 'desktop-default-initial',
    assert(result) {
      if (!result.state.title.includes('Это не дело')) return 'Boshlang‘ich title noto‘g‘ri';
      if (!result.state.visibleButtons.includes('Задуть свечи')) return 'Start tugma topilmadi';
      return null;
    },
  },
  {
    name: 'desktop-deny-mic-manual',
    initScript: denyMicInit,
    steps: [async (page) => clickVisibleButton(page, 'Задуть свечи')],
    assert(result) {
      if (!result.state.title.includes('Загадывайте')) return 'Deny mic branch manual holatga o‘tmadi';
      if (!result.state.description.includes('Нажмите на свечи')) return 'Manual description noto‘g‘ri';
      return null;
    },
  },
  {
    name: 'desktop-allow-mic-done',
    initScript: allowMicInit,
    steps: [async (page) => clickVisibleButton(page, 'Задуть свечи'), async (page) => page.waitForTimeout(4500)],
    assert(result) {
      if (!result.state.title.includes('С днём')) return 'Mic allow branch final holatga o‘tmadi';
      return null;
    },
  },
  {
    name: 'desktop-belated-initial',
    query: '?26-03',
    assert(result) {
      if (!result.state.title.includes('не задуть свечи')) return 'Belated boshlang‘ich title noto‘g‘ri';
      return null;
    },
  },
  {
    name: 'desktop-belated-manual-done',
    query: '?26-03',
    initScript: denyMicInit,
    steps: [
      async (page) => clickVisibleButton(page, 'Задуть свечи'),
      async (page) => forceManualDone(page),
    ],
    assert(result) {
      if (!result.state.description.includes('главной задачей')) return 'Belated final holatga o‘tmadi';
      return null;
    },
  },
  {
    name: 'desktop-future-month-date',
    query: '?31-12',
    assert(result) {
      if (!result.state.title.includes('не задуть свечи')) return 'Future month branch kutilgan belated holatni bermadi';
      return null;
    },
  },
  {
    name: 'mobile-320-initial',
    viewport: { width: 320, height: 800 },
    extra: async (page) => ({
      overlap: await detectOverlap(page),
    }),
    assert(result) {
      if (result.state.scrollWidth > result.state.innerWidth) return '320px initial horizontal overflow bor';
      return null;
    },
  },
  {
    name: 'mobile-320-manual',
    viewport: { width: 320, height: 800 },
    initScript: denyMicInit,
    steps: [async (page) => clickVisibleButton(page, 'Задуть свечи')],
    extra: async (page) => ({
      overlap: await detectOverlap(page),
    }),
    assert(result) {
      if (result.state.scrollWidth > result.state.innerWidth) return '320px manual horizontal overflow bor';
      return null;
    },
  },
  {
    name: 'mobile-320-manual-done',
    viewport: { width: 320, height: 800 },
    initScript: denyMicInit,
    steps: [
      async (page) => clickVisibleButton(page, 'Задуть свечи'),
      async (page) => forceManualDone(page),
    ],
    extra: async (page) => ({
      overlap: await detectOverlap(page),
    }),
    assert(result) {
      if (result.state.scrollWidth > result.state.innerWidth) return '320px final horizontal overflow bor';
      if (result.overlap?.overlap) return '320px final holatda matn tort bilan ustma-ust tushgan';
      return null;
    },
  },
];

await ensureDir(outputDir);

const browser = await chromium.launch({ headless: true });
const results = [];

for (const testCase of cases) {
  results.push(await runCase(browser, testCase));
}

await browser.close();

const reportPath = path.join(outputDir, 'report.json');
await fs.writeFile(reportPath, JSON.stringify(results, null, 2));
console.log(reportPath);
console.log(JSON.stringify(results, null, 2));
