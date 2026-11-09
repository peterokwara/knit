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
  const q=plate({id:'influence-map',w:240,h:220,ppm:8,seed:'influence-4',paper:'hotpress'});
  q.text('what shapes a family’s balance?',10,12,{face:'serif-bold',size:5.4});
  q.italic('Read each row left to right. Arrows show how a factor affects the result.',10,20,{size:2.8});
  q.text('WHAT HAPPENS',10,30,{face:'serif-bold',size:2.8});
  q.text('WHO CAN ACT',89,30,{face:'serif-bold',size:2.8});
  q.text('WHY IT MATTERS',169,30,{face:'serif-bold',size:2.8});
  const rows = [
    [['PARENT’S REFERENCE','Admission or family number','may be missing or mistyped.'],['KNIT','Check the reference; hold','unclear matches for review.'],['RIGHT FAMILY','A payment should reach','the correct family account.']],
    [['PROVIDER RECORDS','Callbacks may repeat; bank','exports can overlap.'],['KNIT','Keep the original evidence','and make repeats safe.'],['COUNTED ONCE','The same payment should','not inflate the account.']],
    [['SCHOOL POLICY','The school chooses which','open invoices come first.'],['KNIT','Protect the school’s setting','and apply the right version.'],['RIGHT INVOICES','The allocation should follow','the school’s chosen rule.']],
    [['UNCLEAR PAYMENT','Evidence may not identify','a family confidently.'],['BURSAR','Review the evidence, decide','and record the reason.'],['EXPLAINABLE','The decision can be traced','and explained to a parent.']]
  ];
  rows.forEach((row,i)=>{
    const y=35+i*34;
    card(q,8,y,69,27,row[0][0],row[0].slice(1),'#f3e3bf');
    card(q,87,y,69,27,row[1][0],row[1].slice(1),'#dcebdc');
    card(q,166,y,66,27,row[2][0],row[2].slice(1),'#e0edf2');
    arrow(q,77,y+13,87,y+13); arrow(q,156,y+13,166,y+13);
  });
  card(q,8,177,224,22,'THE REQUIRED RESULT',['The bursar can see a correct, explainable balance for every invoice.'],'#ece2ef');
  q.italic('Wrong child’s account: a call to the principal. Silent settings reset: lost trust.',10,210,{size:2.6});
  await q.finish(out('influence-diagram.png'));
  const m=plate({id:'struggle',w:240,h:220,ppm:8,seed:'moment-1',paper:'hotpress'});
  m.text('when a payment reaches the wrong child',10,12,{face:'serif-bold',size:4.8});
  m.italic('Illustrative scenario: the sequence and individual reactions are inferred.',10,20,{size:2.8});
  const moments=[
    ['1  PARENT / GUARDIAN',['Trying to pay school fees and have','the payment credited correctly.'],['Struggle: the payment appears on','the wrong child’s account.']],
    ['2  LEARNER / FAMILY',['Their fee records should reflect','the payment made for their family.'],['Struggle: the accounts now show','a misleading picture of what is owed.']],
    ['3  BURSAR',['Trying to explain each invoice','balance to the parent.'],['Struggle: must find the payment,','its source and allocation history.']],
    ['4  SCHOOL / PRINCIPAL',['Trying to maintain accurate records','and the family’s confidence.'],['Brief: the error can lead to a','phone call to the principal.']],
    ['5  KNIT TEAM',['Trying to give the school reliable,','explainable reconciliation.'],['Struggle: determine what happened','and help the school correct it.']]];
  moments.forEach((r,i)=>{const y=29+i*31; card(m,9,y,108,26,r[0],r[1],'#e0edf2'); person(m,108,y+23,.28,{hair:['bob','short','bun','short','short'][i],shirt:{color:'#d7e8ef'}}); card(m,123,y,108,26,'THE STRUGGLE',r[2],'#f3e3bf'); if(i<4) arrow(m,120,y+26,120,y+30);});
  card(m,9,190,222,20,'TRUST AT STAKE',['The family needs an explanation; the school needs confidence in its records.'],'#ece2ef');
  await m.finish(out('struggling-moment.png'));

  const f=plate({id:'forces',w:240,h:190,ppm:8,seed:'forces-1',paper:'hotpress'});
  f.text('why might a school change?',10,12,{face:'serif-bold',size:5.5});
  f.italic('Four Forces of Progress, from a school decision-maker’s perspective.',10,20,{size:2.7});
  f.text('FORCES TOWARD CHANGE',12,31,{face:'serif-bold',size:3});
  f.text('FORCES HOLDING CHANGE BACK',125,31,{face:'serif-bold',size:3});
  card(f,10,36,104,48,'POTENTIAL PUSH',['Brief: a payment can land on','the wrong child’s account.','Brief: a silent settings reset','can destroy a week of trust.'],'#f3e3bf');
  card(f,125,36,104,48,'ANXIETY: THE NEW CHOICE',['Hypothesis: can we trust the','new system to use our policy','and explain its decisions?'],'#f4dddf');
  card(f,10,91,104,48,'POTENTIAL PULL',['Brief: correct, explainable','balances for every invoice.','Hypothesis: less effort to','answer family questions.'],'#dcebdc');
  card(f,125,91,104,48,'HABIT: THE PRESENT',['Unknown: what routines does','the school rely on today?','Hypothesis: familiar ways may','feel safer than changing.'],'#e0edf2');
  card(f,10,149,219,25,'WHAT WE STILL NEED TO LEARN',['Ask a school decision-maker about a real decision to change;','do not treat these hypotheses as interview findings.'],'#ece2ef');
  await f.finish(out('four-forces.png'));

  const b=plate({id:'boundary',w:240,h:220,ppm:8,seed:'boundary-1',paper:'hotpress'});
  b.text('what crosses the system boundary?',10,12,{face:'serif-bold',size:5});
  b.italic('The assessment supplies records. The exercise must make their consequences explainable.',10,20,{size:2.5});
  b.text('EVIDENCE PROVIDED',10,30,{face:'serif-bold',size:3});
  b.text('EXERCISE RESPONSIBILITY',89,30,{face:'serif-bold',size:3});
  b.text('WHAT THE BURSAR NEEDS',169,30,{face:'serif-bold',size:3});
  card(b,8,36,70,41,'M-PESA',['Transaction callbacks;','retries and reversals can','arrive out of order.'],'#f3e3bf');
  card(b,8,83,70,41,'BANK',['Daily CSV exports; rows','can overlap, change format','or be unrelated to fees.'],'#f3e3bf');
  card(b,8,130,70,41,'SCHOOL RECORDS',['Families, learners, invoices,','configuration history and','approved policy changes.'],'#e6eccf');
  card(b,89,48,68,103,'WITHIN THE EXERCISE',['Ingest both sources safely.','Identify the family or hold','uncertain items for review.','Apply the school’s policy.','Protect configuration and','preserve policy history.','Record why decisions were','made, including review.'],'#dcebdc');
  card(b,168,52,64,91,'FAMILY VIEW',['Every invoice balance.','Which money was used,','where it came from, and','which policy version applied.','Unresolved items and a','safe way to resolve them.'],'#e0edf2');
  arrow(b,78,56,89,61); arrow(b,78,102,89,100); arrow(b,78,150,89,141); arrow(b,157,101,168,101);
  card(b,8,180,224,26,'QUESTIONS TO RESOLVE',['How should ambiguous references be handled? Which policy version applies','at the change boundary? How should a bursar correct an error?'],'#ece2ef');
  b.italic('Arrows mean records enter the exercise and the bursar receives an explanation.',10,216,{size:2.4});
  await b.finish(out('system-boundary.png'));
}
main().catch(e=>{console.error(e);process.exit(1)});
