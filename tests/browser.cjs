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
    const advancedChecks = await page.evaluate(() => {
      const components=Array.from({length:1024},(_,x)=>`<c><o bc="808080" sc="2,808080,123456"><vp x="${x}"/></o></c>`);
      const vehicle=items=>'<vehicle><bodies><body unique_id="5"><components>'+items.join('')+'</components></body></bodies></vehicle>';
      const source=vehicle(components);
      const options={mode:'replace',target:'808080',replacements:['112233','AABBCC'],weights:[30,10]};
      const read=xml=>[...new DOMParser().parseFromString(xml,'application/xml').querySelectorAll('o')].map(o=>({x:Number(o.querySelector('vp').getAttribute('x')),color:o.getAttribute('bc'),face:o.getAttribute('sc').split(',')[1],other:o.getAttribute('sc').split(',')[2]}));
      const independent=read(stippleVehicle(source,0,42,options).xml);
      const groupedOptions={...options,weights:[10,10],groupingSize:8};
      const groupedResult=stippleVehicle(source,0,42,groupedOptions);
      const grouped=read(groupedResult.xml);
      const reversed=read(stippleVehicle(vehicle([...components].reverse()),0,42,groupedOptions).xml).sort((a,b)=>a.x-b.x);
      const adjacent=rows=>rows.slice(1).filter((row,i)=>row.color===rows[i].color).length/(rows.length-1);
      const share=independent.filter(o=>o.color==='112233').length/independent.length;
      let zeroRejected=false;try{stippleVehicle(source,0,42,{...options,weights:[0,0]});}catch{zeroRejected=true;}
      const excluded=read(stippleVehicle(source,0,42,{...options,weights:[0,10],groupingSize:8}).xml);
      const longer=vehicle(Array.from({length:4096},(_,x)=>`<c><o bc="808080"><vp x="${x}"/></o></c>`));
      const colorList=xml=>[...new DOMParser().parseFromString(xml,'application/xml').querySelectorAll('o')].map(o=>o.getAttribute('bc'));
      const small=colorList(stippleVehicle(longer,0,42,{...options,weights:[10,10],groupingSizes:[2,2]}).xml);
      const mixedOptions={...options,weights:[10,10],groupingSizes:[16,2]};
      const mixed=stippleVehicle(longer,0,42,mixedOptions),mixedColors=colorList(mixed.xml);
      const sameNeighbor=colors=>{let same=0,total=0;for(let i=1;i<colors.length;i++)if(colors[i-1]==='112233'){total++;if(colors[i]==='112233')same++;}return same/total;};
      const mixedShare=mixedColors.filter(c=>c==='112233').length/mixedColors.length;
      return {weightedShare:share>0.70 && share<0.80,
        perColorScale:sameNeighbor(mixedColors)>sameNeighbor(small)+0.03,
        mixedFrequency:mixedShare>0.4 && mixedShare<0.6,
        mixedRepeatable:mixed.xml===stippleVehicle(longer,0,42,mixedOptions).xml,
        excluded:excluded.every(o=>o.color==='AABBCC' && o.face==='AABBCC'),
        grouping:grouped.every((o,i)=>o.color===grouped[Math.floor(i/8)*8].color && o.face===o.color),
        moreNeighbors:adjacent(grouped)>adjacent(independent)+0.20,
        orderIndependent:JSON.stringify(grouped)===JSON.stringify(reversed),
        unchangedPaint:grouped.every(o=>o.other==='123456'),
        repeatable:groupedResult.xml===stippleVehicle(source,0,42,groupedOptions).xml,
        zeroRejected};
    });
    for(const [name,passed] of Object.entries(advancedChecks)) assert.equal(passed,true,name);

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
    await page.locator('#advanced-options').evaluate(element=>element.open=true);
    await page.locator('#frequency-controls input[data-index]').first().fill('30');
    await page.locator('#frequency-controls input[data-index]').nth(1).fill('10');
    await page.locator('.color-grouping').first().fill('8');
    await page.locator('.color-grouping').nth(1).fill('2');
    assert.equal(await page.locator('.frequency-share').first().textContent(),'75.0%');
    await page.locator('[data-palette="1"] .palette-title').click();
    assert.equal(await page.locator('.color-grouping').first().inputValue(),'1');
    await page.locator('.color-grouping').first().fill('3');
    await page.reload();
    await page.locator('#mode').selectOption('replace');
    assert.equal(await page.locator('.color-grouping').first().inputValue(),'3');
    await page.locator('[data-palette="0"] .palette-title').click();
    assert.equal(await page.locator('.color-grouping').first().inputValue(),'8');
    assert.equal(await page.locator('.color-grouping').nth(1).inputValue(),'2');
    assert.equal(await page.locator('#frequency-controls input[data-index]').first().inputValue(),'30');
    assert.equal(await page.locator('#frequency-controls input[data-index]').nth(1).inputValue(),'10');
    await page.locator('[data-palette="0"] .remove-color').first().click();
    assert.equal(await page.locator('#frequency-controls input[data-index]').first().inputValue(),'10');
    assert.equal(await page.locator('.color-grouping').first().inputValue(),'2');
    await page.setViewportSize({width:375,height:800});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), 'Mobile palette layout fits viewport');
    await page.evaluate(()=>{
      const key='stormworks-stippler.palettes.v1',saved=JSON.parse(localStorage.getItem(key));
      saved.colors[0]='#112233, #445566';saved.active=0;saved.advanced[0]={weights:[9,1],groupingSize:6};
      localStorage.setItem(key,JSON.stringify(saved));
    });
    await page.reload();await page.locator('#mode').selectOption('replace');
    assert.deepEqual(await page.locator('.color-grouping').evaluateAll(inputs=>inputs.map(i=>i.value)),['6','6']);
    assert.equal(await page.locator('#frequency-controls input[data-index]').first().inputValue(),'9');
    assert.deepEqual(errors, []);
    console.log('Browser replacement mode, preview, download, variance and preservation checks passed.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
