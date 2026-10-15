// Optional browser regression tests: node tests/browser.cjs (requires Playwright).
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent(fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8'));
    const source = '<vehicle><!-- keep --><o bc="808080" ac="808080" sc="2,808080,FFFFFF" other="stay"/><o bc="808080" ac="123456"/><o bc="808080"/><o bc="808080"/><o bc="808080"/></vehicle>';
    const checks = await page.evaluate(source => {
      const options = {mode: 'replace', target: '808080', replacements: ['#225588', '#AA7733']};
      const result = stippleVehicle(source, 0, 42, options);
      const parsed = new DOMParser().parseFromString(result.xml, 'application/xml');
      const first = parsed.querySelector('o');
      const replacements = ['225588', 'AA7733'];
      const colors = [...parsed.querySelectorAll('o')].map(o => o.getAttribute('bc'));
      const varied = stippleVehicle(source, 12, 42, options);
      let rejected = false;
      try {stippleVehicle(source, 12, 42, {...options, replacements: ['invalid']});} catch {rejected = true;}
      return {
        paletteOnly: colors.every(c => replacements.includes(c)),
        randomSelection: new Set(colors).size === 2,
        sameBlock: first.getAttribute('bc') === first.getAttribute('ac') && first.getAttribute('sc') === '2,' + first.getAttribute('bc') + ',FFFFFF',
        untouched: parsed.querySelectorAll('o')[1].getAttribute('ac') === '123456' && first.getAttribute('other') === 'stay' && result.xml.includes('<!-- keep -->'),
        repeatable: varied.xml === stippleVehicle(source, 12, 42, options).xml,
        previewMatches: result.preview[0].color === '808080' && result.preview[0].samples.every(c => replacements.includes(c)),
        varianceWorks: varied.xml !== result.xml,
        finalSampleMatches: result.final_preview.length === 256 && result.final_preview.every(([before, after]) => before === '808080' ? replacements.includes(after) : before === after),
        rejected,
      };
    }, source);
    for (const [name, passed] of Object.entries(checks)) assert.equal(passed, true, name);
    await page.locator('#file').setInputFiles({name:'example.xml', mimeType:'application/xml', buffer:Buffer.from(source)});
    await page.waitForFunction(() => document.querySelectorAll('.color-card').length === 3);
    assert.equal(await page.locator('.target-choice').count(), 3);
    assert.equal(await page.locator('.target-choice .target-chip').first().evaluate(e => e.style.backgroundColor), 'rgb(128, 128, 128)');
    await page.locator('#mode').selectOption('replace');
    await page.locator('#replacements').fill('#225588, #AA7733');
    await page.locator('#strength').fill('0');
    await page.waitForFunction(() => document.querySelectorAll('.color-card').length === 3 && [...document.querySelector('.mosaic').children].every(e => ['#225588','#AA7733'].includes(e.title)));
    assert.ok(await page.locator('#final-preview').isVisible());
    assert.equal(await page.locator('#final-after span').count(), 256);
    await page.locator('.target-choice[data-color="FFFFFF"]').click();
    assert.equal(await page.locator('#target').inputValue(), 'FFFFFF');
    assert.equal(await page.locator('.target-choice[data-color="FFFFFF"]').getAttribute('aria-pressed'), 'true');
    await page.waitForFunction(() => document.querySelector('.color-card code').textContent === '#FFFFFF');
    await page.locator('#target').selectOption('808080');
    await page.waitForFunction(() => document.querySelector('.color-card code').textContent === '#808080');
    const retained = await page.evaluate(() => {
      const old = document.querySelector('#palette').innerHTML;
      document.querySelector('#strength').value = '10';
      document.querySelector('#strength').dispatchEvent(new Event('input', {bubbles:true}));
      return document.querySelector('#palette').innerHTML === old && !document.querySelector('#preview-status').textContent;
    });
    assert.ok(retained, 'Keep previous preview during updates');
    await page.locator('#submit').click();
    await page.waitForFunction(() => !document.querySelector('#download').hidden);
    assert.equal(await page.locator('#download').getAttribute('download'), 'example-repainted.xml');
    assert.deepEqual(errors, []);
    console.log('Browser replacement mode, preview, download, variance and preservation checks passed.');
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
