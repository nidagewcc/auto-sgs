const fs=require('fs'),vm=require('vm'),assert=require('assert');
class E{constructor(){this.children=[];this.dataset={};this.classList={add(){},toggle(){},remove(){}};this.style={};this.value='';this.readOnly=true;this.tagName='DIV';}appendChild(x){this.children.push(x);return x}addEventListener(k,f){this['on'+k]=f}getContext(){return new Proxy({},{get:()=>()=>{}})}getBoundingClientRect(){return {left:0,top:0,width:2772,height:1280}}setPointerCapture(){}setAttribute(k,v){this[k]=v}showModal(){}close(){}set textContent(v){this._text=v;this.children=[]}get textContent(){return this._text}}
const els={},tools=['point','roi','template'].map(t=>{let e=new E;e.dataset.tool=t;return e});let scene={version:2,id:'s',name:'旧场景',tier:'B',entry:{desc:'x'},onFail:'abort',frames:[{id:'f',name:'图',dataUrl:''},{id:'f2',name:'第二张',dataUrl:''}],elements:[{kind:'point',ref:'oldpoint',x:4,y:5,frameId:'f'},{kind:'template',ref:'available',rect:[1,2,3,4],frameId:'f'}],steps:[{type:'tap',target:{kind:'point',ref:'oldpoint'},ref:'obsolete-unrelated'},{type:'waitImage',ref:'missing',timeoutMs:1000}],snapshots:[]};let store={'auto-sgs-workbench-v2':JSON.stringify({version:2,sections:[{id:'daily',name:'日常任务',scenes:[scene]},{id:'dunhuang',name:'敦煌密窟',scenes:[]},{id:'event',name:'特殊活动',scenes:[]}],active:{sectionId:'daily',sceneId:'s',frameId:'f'}})};
const document={activeElement:null,addEventListener(){},getElementById:id=>els[id]||(els[id]=new E),createElement:()=>new E,querySelectorAll:s=>s==='[data-tool]'?tools:[],querySelector:()=>tools[0]};let prompts=['分支一','新点'];const ctx={document,localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>{store[k]=v}},console,alert(){},confirm:()=>true,prompt:()=>prompts.shift(),Image:function(){},setTimeout,Blob,URL,Math,Date,JSON,Number,Array,Promise,Set};vm.runInNewContext(fs.readFileSync('workbench/app.js','utf8'),ctx);
const project=()=>JSON.parse(store['auto-sgs-workbench-v3']);let sc=project().sections[0].scenes[0];assert.equal(sc.schedule,'repeat');assert.equal(sc.description,'');assert.equal(sc.steps[0].note,'');assert.equal(sc.elements[0].label,'oldpoint');assert.equal(sc.elements[0].ref,'oldpoint');
els.description.value='先打开界面';els.description.oninput();els.addBranch.onclick();sc=project().sections[0].scenes[0];assert.equal(sc.description,'先打开界面');assert.equal(sc.branches[0].name,'分支一');
els.screen.onwheel({preventDefault(){},clientX:0,clientY:0,deltaY:-1});els.screen.onpointerdown({clientX:115,clientY:230,button:0});sc=project().sections[0].scenes[0];assert.equal(sc.elements[2].x,100);assert.equal(sc.elements[2].y,200);assert.equal(sc.elements[2].label,'新点');assert.match(sc.elements[2].ref,/^point_/);
function find(node,text){if(node._text===text)return node;for(const c of node.children||[]){const r=find(c,text);if(r)return r;}return null;}
assert.equal(els.frameRail.children.length,2);els.frameRail.children[1].onclick();assert.equal(project().active.frameId,'f2');els.frameRail.children[0].onclick();assert.equal(project().active.frameId,'f');
const branchDelete=find(els.branchDetails,'删除分支');assert(branchDelete);branchDelete.onclick();assert.equal(project().sections[0].scenes[0].branches.length,0);assert(!els.steps.children[0].children[0]._text.includes('引用缺失'),'有效迁移引用不得被无关遗留字段误报');
prompts.push('文字识别');els.addText.onclick();sc=project().sections[0].scenes[0];const text=sc.elements.find(e=>e.kind==='text');assert(text);assert.equal(text.label,'文字识别');assert.equal(text.frameId,'f');assert.deepEqual(text.rect,[0,0,2772,1280]);assert.equal(text.text,'');
const stepTitle=els.steps.children[0].children[0]._text;assert(!stepTitle.includes('引用缺失'),'迁移引用仍然有效');const missingTitle=els.steps.children[1].children[0];assert(missingTitle._text.includes('引用缺失：missing'));missingTitle.onclick();assert(find(els.steps,'删除'),'缺失引用步骤应提供删除入口');const selectLabel=find(els.steps.children[1],'模板');assert(selectLabel,'缺失引用步骤应提供重新选择入口');selectLabel.children[0].value='available';selectLabel.children[0].onchange();assert(!els.steps.children[1].children[0]._text.includes('引用缺失'),'重新选择后应清除缺失提示');assert.equal(project().sections[0].scenes[0].steps[1].ref,'available');
console.log('PASS v2迁移、说明、分支删除、OCR结构、引用完整性与缩放逆变换');

assert.equal(project().sections[0].scenes[0].order,10);
function addScene(name,order){els.newScene.onclick();els.newName.value=name;els.newOrder.value=String(order);els.newForm.onsubmit({preventDefault(){}});}
addScene('第二场景',20);addScene('第三场景',20);
assert.deepEqual(els.navigation.children.map(x=>x.children[0]._text.split(' · ')[0]),['旧场景','第二场景','第三场景']);
let row=els.navigation.children[2],edit=row.children[1].children[1].children[0];edit.onclick();els.newOrder.value='5';els.newForm.onsubmit({preventDefault(){}});
assert.deepEqual(els.navigation.children.map(x=>x.children[0]._text.split(' · ')[0]),['第三场景','旧场景','第二场景']);
row=els.navigation.children[0];row.children[1].children[1].children[0].onclick();els.newSection.value='event';els.newForm.onsubmit({preventDefault(){}});
assert.equal(project().active.sectionId,'event');assert.equal(project().sections[2].scenes[0].name,'第三场景');assert.equal(project().sections[0].scenes.length,2);
els.sectionTabs.children[0].onclick();assert.equal(project().active.sectionId,'daily');assert.equal(els.navigation.children.length,2);
console.log('PASS 排序权重、稳定排序、板块切换和场景迁移');

assert.deepEqual(project().sections[0].scenes[0].frames.map(f=>f.order),[10,20]);
let frameRow=els.frames.children[1];frameRow.children[1].children[1].children[0].onclick();els.frameName.value='改名截图';els.frameNote.value='备注';els.frameOrder.value='5';els.frameForm.onsubmit({preventDefault(){}});
assert.equal(project().sections[0].scenes[0].frames[0].name,'改名截图');assert.equal(project().sections[0].scenes[0].frames[0].note,'备注');
assert(els.elementList.children.length>=3,'全库应包含跨帧元素');els.frameRail.children[0].onclick();assert.equal(els.frameElementList.children.length,0,'当前帧无元素');els.frameRail.children[1].onclick();assert(els.frameElementList.children.length>=3,'当前帧元素应显示');els.frameElementList.children[0].children[0].onclick();assert(els.frameElementList.children[0].className.includes('active'),'选择清单项应高亮');els.elementSearch.value='oldpoint';els.elementSearch.oninput();assert.equal(els.frameElementList.children.length,1);els.elementSearch.value='';els.elementSearch.oninput();
let original=els.frames.children[1];original.children[1].children[1].children[2].onclick();assert(els.steps.children[0].children[0]._text.includes('引用缺失：oldpoint'));assert.equal(project().sections[0].scenes[0].steps.length,2);
console.log('PASS 截图权重、弹窗编辑、删除后引用提示');
// v6：画布侧条只显示当前帧、选择联动及持久化。
const html=fs.readFileSync('workbench/index.html','utf8');assert(html.includes('<details><summary>高级：手动编辑步骤（通常不用管）</summary>'));assert(html.indexOf('id="description"')<html.indexOf('高级：手动编辑步骤'));
els.sectionTabs.children[0].onclick();let targetScene=els.navigation.children.find(x=>x.children[0]._text.startsWith('旧场景'));targetScene.children[0].onclick();
let frames=project().sections[0].scenes.find(x=>x.name==='旧场景').frames;assert(frames.length);assert.equal(els.frameElementList.children.length,0); // 当前剩余帧无识别物
els.elementCollapse.onclick();assert.equal(JSON.parse(store['auto-sgs-workbench-v6-ui']).collapsed,true);els.elementSide.onclick();assert.equal(JSON.parse(store['auto-sgs-workbench-v6-ui']).side,'left');
const appSource=fs.readFileSync('workbench/app.js','utf8');assert(appSource.indexOf("## 机器配置")>appSource.indexOf("## 识别物清单"));assert(project().sections[0].scenes.find(x=>x.name==='旧场景').steps.length===2);
console.log('PASS v6默认折叠、当前帧过滤、偏好及步骤保留');
