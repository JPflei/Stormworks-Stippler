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
    const source = '<vehicle><!-- keep --><o bc="808080" ac="808080" sc="2,808080,FFFFFF" other="stay"><vp x="0"/></o><o bc="808080" ac="123456"><vp x="1"/></o><o bc="808080"><vp x="2"/></o><o bc="808080"><vp x="3"/></o><o bc="808080"><vp x="4"/></o></vehicle>';
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
      const source='<vehicle><o bc="808080" sc="4"><vp x="0"/></o><o bc="808080" sc="4,808080,808080,808080,123456"><vp x="1"/></o></vehicle>';
      const vary=stippleVehicle(source,30,42,{selectedColors:['808080']});
      const replace=stippleVehicle(source,0,42,{mode:'replace',target:'808080',replacements:['112233','AABBCC']});
      const parse=x=>[...new DOMParser().parseFromString(x,'application/xml').querySelectorAll('o')].map(o=>o.getAttribute('sc').split(','));
      const vs=parse(vary.xml),rs=parse(replace.xml);
      return {implicitExpanded:vs[0][0]==='4' && vs[0].length===5,
        independentShades:new Set(vs[0].slice(1)).size>1,
        validReplacementFaces:rs[0].slice(1).every(c=>['112233','AABBCC'].includes(c)),
        unselectedFace:vs[1][4]==='123456' && rs[1][4]==='123456',
        zeroUnchanged:stippleVehicle(source,0,42,{selectedColors:['808080']}).xml===source};
    });
    for(const [name,passed] of Object.entries(faceChecks)) assert.equal(passed,true,name);
    const advancedChecks = await page.evaluate(() => {
      const width=20,nodes=Array.from({length:400},(_,i)=>({xyz:[i%width,Math.floor(i/width),0]}));
      const neighbors=nodes.map((node,i)=>[i%width?i-1:-1,i%width<width-1?i+1:-1,i>=width?i-width:-1,i<400-width?i+width:-1].filter(i=>i>=0));
      function rng(){let state=42;return()=>{state+=0x6D2B79F5;let t=Math.imul(state^state>>>15,1|state);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296;};}
      const spacings=[6,6,6],sizes=[12,12,12],repulsion=2;
      const result=growSeededCanvas(nodes,neighbors,spacings,sizes,rng(),repulsion);
      const replay=result.initialColors.slice(),anchors=[],claimed=new Set();let current=-1,valid=true,scored=true,nonMinimum=false,connected=true,counts=true,exhausted=true;
      const distance=(a,b)=>Math.abs(nodes[a].xyz[0]-nodes[b].xyz[0])+Math.abs(nodes[a].xyz[1]-nodes[b].xyz[1]);
      function component(tile,color){const seen=new Set([tile]),queue=[tile];for(let i=0;i<queue.length;i++)for(const next of neighbors[queue[i]])if(replay[next]===color&&!seen.has(next)){seen.add(next);queue.push(next);}return seen;}
      for(const [blobIndex,blob] of result.blobs.entries()){
        if(current!==blob.color){current=blob.color;claimed.clear();}
        function score(tile){
          if(anchors.some(a=>a.tile===tile)||(replay[tile]===current&&claimed.has(tile)))return Infinity;
          const own=anchors.filter(a=>a.color===current).map(a=>distance(a.tile,tile));
          const d=own.length?Math.min(...own):Infinity;if(Number.isFinite(d)&&(d<4||d>8))return Infinity;
          let score=Number.isFinite(d)?Math.abs(d-6):0;
          for(let other=0;other<3;other++)if(other!==current){const ds=anchors.filter(a=>a.color===other).map(a=>distance(a.tile,tile));if(ds.length)score+=repulsion/(1+Math.min(...ds));}
          return score;
        }
        const chosenScore=score(blob.tile),minimum=Math.min(...nodes.map((_,tile)=>score(tile)));
        scored&&=Number.isFinite(chosenScore)&&Math.abs(chosenScore-blob.score)<1e-9;
        nonMinimum||=chosenScore>minimum+1e-9;
        const own=anchors.filter(a=>a.color===current).map(a=>distance(a.tile,blob.tile));
        valid&&=!own.length||(Math.min(...own)>=4&&Math.min(...own)<=8);
        replay[blob.tile]=current;anchors.push(blob);claimed.add(blob.tile);const owned=new Set([blob.tile]);
        for(const [from,to] of blob.growthEdges){connected&&=neighbors[from].includes(to)&&owned.has(from)&&!claimed.has(to)&&!anchors.some(a=>a.tile===to);replay[to]=current;owned.add(to);claimed.add(to);}
        counts&&=owned.size===blob.connectedSize&&owned.size===blob.generated;
        if(blobIndex===result.blobs.length-1||result.blobs[blobIndex+1].color!==current)exhausted&&=nodes.every((_,tile)=>!Number.isFinite(score(tile)));
      }
      const small=growSeededCanvas(nodes,neighbors,spacings,[2,2,2],rng(),repulsion);
      const strict=growSeededCanvas(nodes,neighbors,spacings,sizes,rng(),repulsion,1);
      const weighted=growSeededCanvas(nodes,neighbors,spacings,sizes,rng(),repulsion,0.65);
      function frontierExcess(run){
        const reserved=new Set(),passOwned=new Set();let excess=0,steps=0,color=-1;
        for(const blob of run.blobs){if(color!==blob.color){color=blob.color;passOwned.clear();}reserved.add(blob.tile);passOwned.add(blob.tile);const owned=new Set([blob.tile]);
          for(const [from,to] of blob.growthEdges){
            const frontier=new Set();for(const tile of owned)for(const next of neighbors[tile])if(!passOwned.has(next)&&!reserved.has(next))frontier.add(next);
            const closest=Math.min(...[...frontier].map(tile=>distance(blob.tile,tile)));
            excess+=distance(blob.tile,to)-closest;steps++;owned.add(to);passOwned.add(to);
          }
        }
        return {excess,mean:excess/steps,steps};
      }
      const randomGrowth=frontierExcess(result),weightedGrowth=frontierExcess(weighted),strictGrowth=frontierExcess(strict);
      let strictnessRejected=false;try{growSeededCanvas(nodes,neighbors,spacings,sizes,rng(),repulsion,1.01);}catch{strictnessRejected=true;}
      const mean=blobs=>blobs.reduce((sum,b)=>sum+b.generated,0)/blobs.length;
      const overgrown=growSeededCanvas(nodes,neighbors,[0,6],[2,2],()=>0.5,2);
      const averageNodes=Array.from({length:1600},(_,i)=>({xyz:[i%40,Math.floor(i/40),0]}));
      const averageNeighbors=averageNodes.map((_,i)=>[i%40?i-1:-1,i%40<39?i+1:-1,i>=40?i-40:-1,i<1560?i+40:-1].filter(i=>i>=0));
      const calibrated=growSeededCanvas(averageNodes,averageNeighbors,[0,12],[24,24],rng(),2,1);
      const actualMean=mean(calibrated.blobs);
      const baseOnly=growSeededCanvas(nodes,neighbors,[0],[12],rng());
      return {validSpacing:valid,validScores:scored,randomNonMinimum:nonMinimum,orthogonalGrowth:connected,connectedCounts:counts,
        replayMatches:JSON.stringify(replay)===JSON.stringify(result.colors),
        reservedAnchors:result.seeds.every(seed=>result.colors[seed.tile]===seed.color),
        uniqueSeeds:new Set(result.seeds.map(seed=>seed.tile)).size===result.seeds.length,
        paletteOrder:result.seeds.every((seed,i)=>i===0||result.seeds[i-1].color<=seed.color),
        sizeControlsGrowth:mean(result.blobs)>mean(small.blobs)*1.5,
        canvasNotCounted:overgrown.blobs[0].generated===2 && overgrown.blobs.every(blob=>blob.generated<=blob.maximumSize),
        averageTargetsSize:actualMean>23&&actualMean<25,
        noPrematureFinishes:calibrated.blobs.every(blob=>blob.reason==='boundary'||blob.generated>=blob.minimumSize),
        finite:result.seeds.length<=nodes.length,exhausted,
        repeatable:JSON.stringify(result)===JSON.stringify(growSeededCanvas(nodes,neighbors,spacings,sizes,rng(),repulsion)),
        zeroStrictnessUnchanged:JSON.stringify(result)===JSON.stringify(growSeededCanvas(nodes,neighbors,spacings,sizes,rng(),repulsion,0)),
        strictAlwaysNearest:strictGrowth.steps>0&&strictGrowth.excess===0,
        intermediateFavorsNear:weightedGrowth.mean<randomGrowth.mean,
        strictnessRejected,
        baseOnlyWorks:baseOnly.colors.every(c=>c===0)&&baseOnly.seeds.length===0,
        baseCanvas:result.initialColors.every(c=>c===0),
        baseDoesNotGrow:result.seeds.every(seed=>seed.color!==0)};
    });
    for(const [name,passed] of Object.entries(advancedChecks)) assert.equal(passed,true,name);

    const sharedFaceChecks=await page.evaluate(()=>{
      const source='<vehicle><bodies><body><components>'+Array.from({length:100},(_,i)=>`<o bc="808080" ac="808080" sc="2,808080,808080"><vp x="${i%10}" y="${Math.floor(i/10)}"/></o>`).join('')+'</components></body></bodies></vehicle>';
      const options={mode:'replace',target:'808080',replacements:['112233','AABBCC'],outliers:0};
      const result=stippleVehicle(source,0,42,options);
      const objects=[...new DOMParser().parseFromString(result.xml,'application/xml').querySelectorAll('o')];
      return objects.every(object=>[object.getAttribute('ac'),...object.getAttribute('sc').split(',').slice(1)].every(color=>color===object.getAttribute('bc')))
        &&result.tileMap.every(layer=>layer.tiles.every(tile=>tile.color===objects[tile.xyz[1]*10+tile.xyz[0]].getAttribute('bc')));
    });
    assert.equal(sharedFaceChecks,true,'All matching face slots and preview layers follow the shared exported spatial field');

    const directionalChecks=await page.evaluate(()=>{
      const nodes=Array.from({length:101},(_,x)=>({xyz:[x,0,0]})),neighbors=nodes.map((_,i)=>[i-1,i+1].filter(j=>j>=0&&j<101));
      function displacement(x,strictness=0){const result=growSeededCanvas(nodes,neighbors,[0,100],[20,20],()=>0.5,2,[0,strictness],[{x:0,y:0},{x,y:0}]);return result.blobs[0].growthEdges.reduce((sum,edge)=>sum+nodes[edge[1]].xyz[0]-nodes[result.blobs[0].tile].xyz[0],0);}
      return displacement(1)>0&&displacement(-1)<0&&displacement(1,1)>displacement(0,1)+20&&displacement(-1,1)<displacement(0,1)-20;
    });
    assert.equal(directionalChecks,true,'Vectors bias growth in opposite directions and strictness follows the directed metric');

    const selectionChecks = await page.evaluate(source => {
      const untouched = stippleVehicle(source, 12, 42);
      const selected = stippleVehicle(source, 12, 42, {selectedColors:['808080']});
      const root = new DOMParser().parseFromString(selected.xml, 'application/xml');
      const more = '<vehicle><o bc="111111" ac="222222" bc2="333333" bc3="444444"/></vehicle>';
      const baseOptions={mode:'replace',target:'808080',replacements:['112233'],seedSpacings:[0],groupingSizes:[24]};
      const base=stippleVehicle(source,0,42,baseOptions),variedBase=stippleVehicle(source,8,42,baseOptions);
      const shades=variedBase.tileMap.flatMap(layer=>layer.tiles.map(tile=>tile.color));
      return {defaultUnchanged:untouched.xml===source && untouched.preview.length===0,
        baseFill:base.tileMap.every(layer=>layer.seeds===0&&layer.tiles.every(tile=>tile.color==='112233')),
        baseVariance:new Set(shades).size>1&&shades.every(color=>[0,2,4].every(i=>Math.abs(parseInt(color.slice(i,i+2),16)-parseInt('112233'.slice(i,i+2),16))<=8)),
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
    assert.equal(await page.locator('.simulation-mosaic span').count(),2500);
    assert.equal(await page.locator('.simulation-mosaic').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),50);
    const simulationChecks=await page.evaluate(()=>{
      const options={mode:'replace',target:'808080',replacements:['112233','AABBCC','778899'],seedSpacings:[6,6,6],groupingSizes:[12,12,12],seedRepulsion:2,growthStrictness:0.65,outliers:0};
      const simulation=simulateReplacementGrid(0,42,options),nodes=Array.from({length:2500},(_,i)=>({xyz:[i%50,Math.floor(i/50),0]}));
      const neighbors=nodes.map((_,i)=>[i%50?i-1:-1,i%50<49?i+1:-1,i>=50?i-50:-1,i<2450?i+50:-1].filter(i=>i>=0));
      let state=42;const random=()=>{state+=0x6D2B79F5;let t=Math.imul(state^state>>>15,1|state);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296;};
      const grown=growSeededCanvas(nodes,neighbors,options.seedSpacings,options.groupingSizes,random,options.seedRepulsion,options.growthStrictness),expected=[];
      for(let y=49;y>=0;y--)for(let x=0;x<50;x++)expected.push(options.replacements[grown.colors[y*50+x]]);
      return {matchesGrowth:JSON.stringify(expected)===JSON.stringify(simulation.samples),repeatable:JSON.stringify(simulation)===JSON.stringify(simulateReplacementGrid(0,42,options)),includesBlobs:new Set(simulation.samples).size>1};
    });
    for(const [name,passed] of Object.entries(simulationChecks))assert.equal(passed,true,name);
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
    await page.locator('#frequency-controls input[data-index]').nth(1).fill('6');
    await page.locator('.color-grouping').nth(1).fill('28');
    await page.locator('#seed-repulsion').fill('4');
    await page.locator('.color-strictness').last().fill('0.75');
    await page.locator('#blob-outliers').fill('3');
    assert.equal(await page.locator('.frequency-share').first().textContent(),'Base');
    assert.ok(await page.locator('.color-grouping').first().isDisabled());
    assert.ok(await page.locator('#frequency-controls input[data-index]').first().isDisabled());
    await page.locator('[data-palette="1"] .palette-title').click();
    assert.equal(await page.locator('.color-grouping').first().inputValue(),'10');
    assert.equal(await page.locator('.color-strictness').last().inputValue(),'0.5');
    await page.reload();await page.locator('#mode').selectOption('replace');
    await page.locator('[data-palette="0"] .palette-title').click();
    assert.equal(await page.locator('.color-grouping').nth(1).inputValue(),'28');
    assert.equal(await page.locator('#seed-repulsion').inputValue(),'4');
    assert.equal(await page.locator('.color-strictness').last().inputValue(),'0.75');
    assert.equal(await page.locator('#blob-outliers').inputValue(),'3');
    await page.locator('#advanced-options').evaluate(element=>element.open=true);
    const chart=page.locator('.splat-chart').last();await chart.scrollIntoViewIfNeeded();
    const chartBounds=await chart.boundingBox();await page.mouse.click(chartBounds.x+chartBounds.width-3,chartBounds.y+3);
    assert.equal(await page.locator('.direction-x').last().inputValue(),'1');
    assert.equal(await page.locator('.direction-y').last().inputValue(),'1');
    assert.equal(await page.locator('.color-strictness').first().inputValue(),'0.5');
    await page.locator('.direction-x').last().fill('0.8');
    await page.locator('.direction-y').last().fill('0.6');
    await page.reload();await page.locator('#mode').selectOption('replace');
    assert.equal(await page.locator('.direction-x').last().inputValue(),'0.8');
    assert.equal(await page.locator('.direction-y').last().inputValue(),'0.6');
    assert.equal(await page.locator('.color-strictness').last().inputValue(),'0.75');
    assert.equal(await page.locator('#frequency-controls input[data-index]').nth(1).inputValue(),'6');
    await page.getByRole('button',{name:'Move Palette 1 color 2 up',exact:true}).click();
    assert.equal(await page.locator('#replacements').inputValue(),'#445566, #112233');
    assert.equal(await page.locator('.direction-x').first().inputValue(),'0.8');
    assert.equal(await page.locator('.color-strictness').first().inputValue(),'0.75');
    assert.equal(await page.locator('#frequency-controls input[data-index]').first().inputValue(),'6');
    assert.equal(await page.locator('.color-grouping').first().inputValue(),'28');
    assert.ok(await page.locator('.color-grouping').first().isDisabled());
    assert.ok(await page.getByRole('button',{name:'Move Palette 1 color 1 up',exact:true}).isDisabled());
    await page.reload();await page.locator('#mode').selectOption('replace');
    assert.equal(await page.locator('#replacements').inputValue(),'#445566, #112233');
    assert.equal(await page.locator('.direction-x').first().inputValue(),'0.8');
    assert.equal(await page.locator('.color-strictness').first().inputValue(),'0.75');
    assert.equal(await page.locator('.color-grouping').first().inputValue(),'28');
    await page.getByRole('button',{name:'Move Palette 1 color 1 down',exact:true}).click();
    assert.equal(await page.locator('#replacements').inputValue(),'#112233, #445566');
    assert.equal(await page.locator('.color-grouping').nth(1).inputValue(),'28');
    assert.ok(await page.locator('[data-palette="0"] input[type=color]').first().isEnabled());
    await page.locator('#file').setInputFiles({name:'slice.xml',mimeType:'application/xml',buffer:Buffer.from(source)});
    await page.waitForTimeout(250);
    assert.ok(await page.locator('#tile-map-preview').isHidden(),'Layer preview waits for Replace selected paint');
    await page.getByRole('button',{name:'Replace selected paint',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('#tile-map-preview').hidden);
    assert.ok(await page.locator('#tile-layer option').count()>0);
    await page.locator('#tile-axis').selectOption('0');
    assert.ok((await page.locator('#tile-map-summary').textContent()).includes('tiles in this slice'));
    await page.locator('#seed').fill('123');
    assert.ok(await page.locator('#tile-map-preview').isHidden(),'Settings invalidate the exported layer preview');
    await page.setViewportSize({width:375,height:800});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), 'Mobile palette layout fits viewport');
    await page.evaluate(()=>{
      localStorage.removeItem('stormworks-stippler.seed-growth-palettes.v1');
      localStorage.setItem('stormworks-stippler.blob-palettes.v1',JSON.stringify({colors:['#112233, #445566','#778899','#AABBCC'],active:0,advanced:[{weights:[9,1],groupingSizes:[6,6]},{},{}]}));
    });
    await page.reload();await page.locator('#mode').selectOption('replace');
    assert.deepEqual(await page.locator('.color-grouping').evaluateAll(inputs=>inputs.map(i=>i.value)),['10','10']);
    assert.equal(await page.locator('#frequency-controls input[data-index]').nth(1).inputValue(),'8');
    assert.equal(await page.locator('#replacements').inputValue(),'#112233, #445566');
    assert.equal(await page.locator('.color-strictness').last().inputValue(),'0.5');
    assert.equal(await page.locator('#blob-outliers').inputValue(),'5');
    const savedDefaults=await page.evaluate(()=>JSON.parse(localStorage.getItem('stormworks-stippler.seed-growth-palettes.v1')).advanced[0]);
    assert.deepEqual(savedDefaults.groupingSizes,[10,10]);
    assert.deepEqual(savedDefaults.weights,[8,8]);
    assert.deepEqual(savedDefaults.strictnesses,[0.5,0.5]);
    assert.equal(savedDefaults.outliers,5);
    assert.ok(await page.evaluate(()=>localStorage.getItem('stormworks-stippler.blob-palettes.v1').includes('groupingSizes')));
    assert.deepEqual(errors, []);
    console.log('Browser replacement mode, preview, download, variance and preservation checks passed.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
