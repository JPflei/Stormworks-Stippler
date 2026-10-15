// Optional browser regression tests: node tests/browser.cjs (requires Playwright).
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');

(async () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
  const server = http.createServer((request, response) => {
    response.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    response.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    async function setPaletteColors(value) {
      const active=await page.locator('#palette-select').inputValue();
      const column=page.locator(`[data-palette="${active}"]`);
      while(await column.locator('.remove-color').count()) await column.locator('.remove-color').first().click();
      for(const color of value.split(',').map(c=>c.trim())) {
        await page.locator('#add-color').click();
        await column.locator('input[type=color]').last().evaluate((input,color)=>{input.value=color;input.dispatchEvent(new Event('input',{bubbles:true}));},color);
      }
    }
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    assert.deepEqual(await page.locator('.palette-title').allTextContents(), ['Desert camo','Woods camo','Arctic camo']);
    assert.equal(await page.locator('[data-palette="0"] input[type=color]').first().inputValue(),'#c2b280');
    assert.equal(await page.locator('[data-palette="1"] input[type=color]').count(),4);
    assert.equal(await page.locator('[data-palette="2"] input[type=color]').first().inputValue(),'#f0f2f2');
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
        perSlot: [first.getAttribute('bc'),first.getAttribute('ac'),first.getAttribute('sc').split(',')[1]].every(c=>replacements.includes(c)) && first.getAttribute('sc').endsWith(',FFFFFF'),
        untouched: parsed.querySelectorAll('o')[1].getAttribute('ac') === '123456' && first.getAttribute('other') === 'stay' && result.xml.includes('<!-- keep -->'),
        repeatable: varied.xml === stippleVehicle(source, 12, 42, options).xml,
        previewMatches: result.preview[0].color === '808080' && result.preview[0].samples.every(c => replacements.includes(c)),
        varianceWorks: varied.xml !== result.xml,
        rejected,
      };
    }, source);
    for (const [name, passed] of Object.entries(checks)) assert.equal(passed, true, name);
    const faceChecks = await page.evaluate(() => {
      const source='<vehicle><o bc="808080" sc="4"/><o bc="808080" sc="4,808080,808080,808080,123456"/></vehicle>';
      const vary=stippleVehicle(source,30,42,{selectedColors:['808080']});
      const replace=stippleVehicle(source,0,42,{mode:'replace',target:'808080',replacements:['112233','AABBCC']});
      const parse=x=>[...new DOMParser().parseFromString(x,'application/xml').querySelectorAll('o')].map(o=>o.getAttribute('sc').split(','));
      const vs=parse(vary.xml),rs=parse(replace.xml);
      return {implicitExpanded:vs[0][0]==='4' && vs[0].length===5,
        independentShades:new Set(vs[0].slice(1)).size>1,
        independentReplacements:new Set(rs[0].slice(1)).size>1,
        unselectedFace:vs[1][4]==='123456' && rs[1][4]==='123456',
        zeroUnchanged:stippleVehicle(source,0,42,{selectedColors:['808080']}).xml===source};
    });
    for(const [name,passed] of Object.entries(faceChecks)) assert.equal(passed,true,name);

    const selectionChecks = await page.evaluate(source => {
      const untouched = stippleVehicle(source, 12, 42);
      const selected = stippleVehicle(source, 12, 42, {selectedColors:['808080']});
      const root = new DOMParser().parseFromString(selected.xml, 'application/xml');
      const more = '<vehicle><o bc="111111" ac="222222" bc2="333333" bc3="444444"/></vehicle>';
      return {defaultUnchanged:untouched.xml===source && untouched.preview.length===0,
        selectedOnly:selected.preview.length===1 && selected.preview[0].color==='808080' && selected.changed_fields>0,
        unselectedIntact:root.querySelector('o').getAttribute('sc').endsWith(',FFFFFF') && root.querySelectorAll('o')[1].getAttribute('ac')==='123456',
        noPreviewCap:stippleVehicle(more,12,42,{selectedColors:['111111','222222','333333','444444']}).preview.length===4};
    }, source);
    for(const [name,passed] of Object.entries(selectionChecks)) assert.equal(passed,true,name);
    const shortHexChecks = await page.evaluate(() => {
      const source = '<vehicle><o bc="E232" ac="00e232" sc="2,E232,454545"/><o bc="0" sc="6"/></vehicle>';
      const scan = stippleVehicle(source, 0);
      const vary = stippleVehicle(source, 12, 42, {selectedColors:['00E232']});
      const replace = stippleVehicle(source, 0, 42, {mode:'replace', target:'00E232', replacements:['123456']});
      return {scan:scan.colors.find(c=>c.color==='00E232').count===3 && scan.xml===source,
        selected:vary.changed_fields===3 && vary.preview.length===1,
        replaced:replace.matched_fields===3 && replace.xml.includes('bc="123456" ac="123456" sc="2,123456,454545"'),
        marker:replace.xml.includes('bc="0" sc="6"')};
    });
    for(const [name,passed] of Object.entries(shortHexChecks)) assert.equal(passed,true,name);
    await page.locator('#file').setInputFiles({name:'example.xml', mimeType:'application/xml', buffer:Buffer.from(source)});
    await page.waitForFunction(() => document.querySelectorAll('#vary-colors input').length === 3);
    assert.equal(await page.locator('#vary-colors input:checked').count(),0);
    assert.equal(await page.locator('.color-card').count(),0);
    assert.ok(await page.locator('#submit').isDisabled());
    for(const checkbox of await page.locator('#vary-colors input').all()) await checkbox.check();
    await page.waitForFunction(() => document.querySelectorAll('.color-card').length === 3);
    await page.locator('#vary-colors input[value="123456"]').uncheck();
    await page.waitForFunction(() => document.querySelectorAll('.color-card').length === 2);
    assert.equal(await page.locator('#target-colors .target-choice').count(), 3);
    assert.equal(await page.locator('#target-colors .target-choice .target-chip').first().evaluate(e => e.style.backgroundColor), 'rgb(128, 128, 128)');
    await page.locator('#mode').selectOption('replace');
    await setPaletteColors('#225588, #AA7733');
    assert.equal(await page.locator('[data-palette="0"] .target-choice').count(),2);
    await page.getByRole('button',{name:'Remove Palette 1 color 1',exact:true}).click();
    assert.equal(await page.locator('#replacements').inputValue(),'#AA7733');
    assert.equal(await page.locator('[data-palette="0"] .target-choice').count(),1);
    await setPaletteColors('#225588, #AA7733');
    await page.locator('#strength').fill('0');
    await page.waitForFunction(() => document.querySelectorAll('.color-card').length === 3 && [...document.querySelector('.mosaic').children].every(e => ['#225588','#AA7733'].includes(e.title)));
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
    await page.locator('#file').setInputFiles({name:'new.xml',mimeType:'application/xml',buffer:Buffer.from(source)});
    await page.locator('#mode').selectOption('vary');
    await page.waitForFunction(() => document.querySelectorAll('#vary-colors input').length===3 && document.querySelectorAll('.color-card').length===0);
    assert.equal(await page.locator('#vary-colors input:checked').count(),0);
    await page.locator('#mode').selectOption('replace');
    await page.locator('[data-palette="0"] .palette-title').click();
    await setPaletteColors('#112233, #445566');
    await page.locator('[data-palette="1"] .palette-title').click();
    await setPaletteColors('#778899');
    await page.locator('[data-palette="2"] .palette-title').click();
    await setPaletteColors('#AABBCC, #DDEEFF');
    await page.getByRole('button',{name:'Remove Palette 3 color 1',exact:true}).click();
    await page.locator('[data-palette="0"] .palette-title').click();
    assert.equal(await page.locator('#replacements').inputValue(),'#112233, #445566');
    await page.locator('[data-palette="1"] .palette-title').click();
    assert.equal(await page.locator('#replacements').inputValue(),'#778899');
    await page.reload();
    await page.locator('#mode').selectOption('replace');
    assert.equal(await page.locator('#palette-select').inputValue(),'1');
    assert.equal(await page.locator('#replacements').inputValue(),'#778899');
    await page.locator('[data-palette="2"] .palette-title').click();
    assert.equal(await page.locator('#replacements').inputValue(),'#DDEEFF');
    await page.locator('[data-palette="0"] .palette-title').click();
    assert.equal(await page.locator('[data-palette="0"] .target-choice').count(),2);
    await page.locator('[data-palette="1"] input[type=color]').first().evaluate(input=>{input.value='#abcdef';input.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('#palette-select').inputValue(),'0');
    assert.equal(await page.locator('#replacements').inputValue(),'#112233, #445566');
    await page.reload();
    await page.locator('#mode').selectOption('replace');
    assert.equal(await page.locator('[data-palette="1"] input[type=color]').first().inputValue(),'#abcdef');
    await page.setViewportSize({width:375,height:800});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), 'Mobile palette layout fits viewport');
    assert.deepEqual(errors, []);
    console.log('Browser replacement mode, preview, download, variance and preservation checks passed.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
