'use strict';
// Run after cloning statechart-art to .work/statechart-art and npm ci in its tools directory.
const path = require('path');
const root = path.resolve(__dirname, '../.work/statechart-art');
const { plate } = require(path.join(root, 'tools/lib/storybook'));
const { person } = require(path.join(root, 'tools/lib/people'));
const D = require(path.join(root, 'tools/lib/draw'));
const out = name => path.join(__dirname, name);
function card(P,x,y,w,h,title,lines,color) {
  const shape=D.rrect(x,y,x+w,y+h,1.5);
  P.paper([shape]); P.colour([shape],color,{pressure:0.35,passes:1}); P.outline([shape],{nib:0.28});
  P.text(title,x+3,y+6,{face:'serif-bold',size:3.4});
  lines.forEach((line,i)=>P.text(line,x+3,y+12+i*4.1,{size:2.65}));
}
function arrow(P,x1,y1,x2,y2,label) {
  P.ink([[x1,y1],[x2,y2]],{nib:0.38,color:'#a44d40'});
  const a=Math.atan2(y2-y1,x2-x1), k=2;
  P.ink([[x2-k*Math.cos(a-.48),y2-k*Math.sin(a-.48)],[x2,y2],[x2-k*Math.cos(a+.48),y2-k*Math.sin(a+.48)]],{nib:0.38,color:'#a44d40'});
  if(label) P.italic(label,(x1+x2)/2,(y1+y2)/2-2,{size:2.1,align:'center'});
}
async function main(){
  const p=plate({id:'stakeholder-map',w:240,h:180,ppm:8,seed:'stakeholders-3',paper:'hotpress'});
  p.text('who is involved?',10,12,{face:'serif-bold',size:6});
  p.italic('Their needs and concerns around school fees',10,20,{size:3});
  const people=[
    [11,31,'PARENT / GUARDIAN',['Wants payment credited correctly.','Brief risk: money lands on','the wrong child’s account.'],'#d7e8ef','bob'],
    [125,31,'LEARNER / FAMILY',['Their invoices are affected.','Inferred concern: a reference','could point to the wrong family.'],'#f4dddf','short'],
    [11,79,'BURSAR',['Needs correct invoice balances','and a trail to explain them','to a parent.'],'#f1e5c5','bun'],
    [125,79,'SCHOOL',['Chooses its allocation policy.','Brief risk: a silent settings','reset can damage trust.'],'#e9eccd','short']];
  for(const [x,y,t,lines,col,hair] of people){card(p,x+16,y,93,39,t,lines,col);person(p,x+8,y+31,.43,{hair,pose:'stand',shirt:{color:col}});}
  card(p,11,129,105,34,'KNIT TEAM',['Builds reliable reconciliation.','Its team edits school configuration.','It must protect settings and evidence.'],'#e0eee0');
  card(p,125,129,104,34,'M-PESA AND THE BANK',['Supply callbacks and statements.','Records can repeat, arrive late,','overlap, or contain non-fee lines.'],'#e7e5f0');
  p.italic('Brief risk = stated in the assessment. Inferred concern = our interpretation.',11,173,{size:2.7});
  await p.finish(out('stakeholder-map.png'));
  const q=plate({id:'influence-map',w:240,h:180,ppm:8,seed:'influence-3',paper:'hotpress'});
  q.text('what shapes a balance?',10,12,{face:'serif-bold',size:6});
  q.italic('Arrows mean “can affect”. Colours show who can act.',10,20,{size:3});
  card(q,8,31,70,29,'OUTSIDE KNIT’S CONTROL',['Parent’s payment reference','Provider delays, repeats and','bank statement changes'],'#f3e3bf');
  card(q,8,82,70,29,'SCHOOL’S CHOICE',['The allocation policy decides','which open invoices should','receive the payment.'],'#e6eccf');
  card(q,8,133,70,29,'KNIT’S CHOICES',['Check and preserve evidence;','handle repeats; protect policy;','ask a person when unsure.'],'#dcebdc');
  card(q,100,37,63,30,'MATCHING',['Can the payment be linked','to the right family?'],'#e0edf2');
  card(q,100,91,63,30,'INVOICE ALLOCATION',['The family and school rule','determine which invoices.'],'#e0edf2');
  card(q,100,143,63,25,'BURSAR REVIEW',['A person resolves unclear','payments and records why.'],'#e0edf2');
  card(q,181,73,51,46,'REQUIRED RESULT',['Correct balance for','each invoice; bursar','can explain the money','and policy used.'],'#ece2ef');
  arrow(q,78,46,100,50,'reference and records');
  arrow(q,78,97,100,103,'sets the rule');
  arrow(q,78,145,100,151,'routes uncertainty');
  arrow(q,132,67,132,91,'identifies the family');
  arrow(q,163,104,181,96,'determines balance');
  arrow(q,163,151,207,119,'resolves uncertainty');
  q.italic('Wrong child’s account → principal call. Silent policy reset → lost trust.',11,174,{size:2.7});
  await q.finish(out('influence-diagram.png'));
}
main().catch(e=>{console.error(e);process.exit(1)});
