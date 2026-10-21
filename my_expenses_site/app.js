const KEY='expense_db_v1',SES='expense_session';
const $=s=>document.querySelector(s);
let CUR='₽';
const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let db,U=null,me=null;
const SCHEMA=`
CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,color TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,pass_hash TEXT NOT NULL,salt TEXT NOT NULL,
 currency TEXT DEFAULT '₽',budget REAL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY AUTOINCREMENT,amount REAL NOT NULL CHECK(amount>0),category_id INTEGER NOT NULL REFERENCES categories(id),
 spent_on TEXT NOT NULL,note TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP,user_id INTEGER REFERENCES users(id));`;
const SEED=[['Еда','#d9822b'],['Транспорт','#3b82c4'],['Жильё','#7a5bbf'],['Здоровье','#2f9e6f'],['Развлечения','#c4467f'],['Покупки','#b4412f'],['Другое','#7b8a86']];
function save(){try{const u=db.export();let s='';for(let i=0;i<u.length;i+=8192)s+=String.fromCharCode.apply(null,u.subarray(i,i+8192));localStorage.setItem(KEY,btoa(s));}catch(e){}}
function load(SQL){try{const b=localStorage.getItem(KEY);if(b){const s=atob(b),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return new SQL.Database(u);}}catch(e){}return new SQL.Database();}
function all(sql,p=[]){const st=db.prepare(sql);st.bind(p);const r=[];while(st.step())r.push(st.getAsObject());st.free();return r;}
function run(sql,p=[]){db.run(sql,p);save();}
async function hash(pw,salt){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(salt+pw));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');}
const rnd=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
const initials=n=>n.trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'?';
const ses={get:()=>{try{return +localStorage.getItem(SES)||null}catch(e){return null}},set:v=>{try{v?localStorage.setItem(SES,v):localStorage.removeItem(SES)}catch(e){}}};

function init(SQL){
  db=load(SQL);db.run(SCHEMA);
  if(!all("SELECT 1 FROM pragma_table_info('expenses') WHERE name='user_id'").length)db.run('ALTER TABLE expenses ADD COLUMN user_id INTEGER REFERENCES users(id)');
  if(!all('SELECT 1 FROM categories LIMIT 1').length)SEED.forEach(c=>db.run('INSERT INTO categories(name,color) VALUES(?,?)',c));
  db.run('CREATE INDEX IF NOT EXISTS idx_exp ON expenses(user_id,spent_on)');save();
  $('#cat').innerHTML=all('SELECT id,name FROM categories ORDER BY id').map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const id=ses.get();
  if(id&&all('SELECT 1 FROM users WHERE id=?',[id]).length)enter(id);else showAuth();
}
let mode='in';
function showAuth(){
  U=null;$('#app').hidden=true;$('#authBox').hidden=false;
  const first=!all('SELECT 1 FROM users LIMIT 1').length;setMode(first?'up':'in');
  $('#authSub').textContent=first?'Создайте профиль, чтобы вести учёт расходов.':'Войдите, чтобы увидеть свои траты.';
}
function setMode(m){mode=m;document.querySelectorAll('[data-a]').forEach(t=>t.setAttribute('aria-selected',t.dataset.a===m));
  $('#aName').hidden=m!=='up';$('#aGo').textContent=m==='up'?'Создать профиль':'Войти';$('#aerr').textContent='';
  $('#apass').autocomplete=m==='up'?'new-password':'current-password';}
document.querySelectorAll('[data-a]').forEach(t=>t.onclick=()=>setMode(t.dataset.a));
$('#aGo').onclick=async()=>{
  const e=$('#aerr'),email=$('#aemail').value.trim().toLowerCase(),pw=$('#apass').value,name=$('#aname').value.trim();e.textContent='';
  if(!/^\S+@\S+\.\S+$/.test(email)){e.textContent='Введите корректный email.';return;}
  if(pw.length<6){e.textContent='Пароль должен быть не короче 6 символов.';return;}
  try{
    if(mode==='up'){
      if(!name){e.textContent='Введите имя.';return;}
      if(all('SELECT 1 FROM users WHERE email=?',[email]).length){e.textContent='Этот email уже зарегистрирован. Перейдите на вкладку «Вход».';return;}
      const salt=rnd(),h=await hash(pw,salt),first=!all('SELECT 1 FROM users LIMIT 1').length;
      run('INSERT INTO users(name,email,pass_hash,salt) VALUES(?,?,?,?)',[name,email,h,salt]);
      const id=all('SELECT id FROM users WHERE email=?',[email])[0].id;
      if(first)run('UPDATE expenses SET user_id=? WHERE user_id IS NULL',[id]);
      enter(id);
    }else{
      const u=all('SELECT * FROM users WHERE email=?',[email])[0];
      if(!u){e.textContent='Аккаунт с таким email не найден. Откройте вкладку «Регистрация».';return;}
      if(u.pass_hash!==await hash(pw,u.salt)){e.textContent='Неверный пароль.';return;}
      enter(u.id);
    }
  }catch(x){e.textContent='Ошибка: '+x.message;}
  $('#apass').value='';
};
['aemail','apass','aname'].forEach(i=>$('#'+i).addEventListener('keydown',e=>{if(e.key==='Enter')$('#aGo').click();}));

function enter(id){
  U=id;ses.set(id);if(all('SELECT COUNT(*) n FROM users')[0].n===1)run('UPDATE expenses SET user_id=? WHERE user_id IS NULL',[id]);loadMe();
  $('#authBox').hidden=true;$('#app').hidden=false;
  const now=new Date(),t=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');$('#date').value=t;$('#month').value=t.slice(0,7);
  $('#themeBtn').textContent=(document.documentElement.dataset.theme==='dark'?'Светлая тема':'Тёмная тема');
  selTab('list');render();
}
function loadMe(){me=all('SELECT * FROM users WHERE id=?',[U])[0];CUR=me.currency||'₽';
  $('#whoAv').textContent=initials(me.name);$('#whoName').textContent=me.name.split(' ')[0];document.querySelector('label[for=amount]').textContent='Сумма, '+CUR;}
const month=()=>$('#month').value||new Date().toISOString().slice(0,7);

function render(){
  const m=month();
  const t=all("SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE user_id=? AND strftime('%Y-%m',spent_on)=?",[U,m])[0].s;
  $('#total').innerHTML=fmt(t)+' <small>'+esc(CUR)+'</small>';
  $('#bline').textContent=me.budget>0?`Бюджет: ${fmt(t)} из ${fmt(me.budget)} ${CUR} (${Math.round(t/me.budget*100)}%)`:'';
  const rows=all(`SELECT e.id,e.amount,e.category_id,e.spent_on,e.note,c.name,c.color FROM expenses e JOIN categories c ON c.id=e.category_id
    WHERE e.user_id=? AND strftime('%Y-%m',e.spent_on)=? ORDER BY e.spent_on DESC,e.id DESC`,[U,m]);
  const catOpts=all('SELECT id,name FROM categories ORDER BY name');
  const filter=$('#filterCat');
  if(filter && filter.options.length <= 1) filter.innerHTML='<option value="">Все категории</option>'+catOpts.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const search=($('#searchExpense')?.value||'').trim().toLowerCase();
  const catFilter=$('#filterCat')?.value||'';
  const sort=$('#sortExpenses')?.value||'date-desc';
  let visible=rows.filter(r=>(!search||(String(r.name)+' '+String(r.note||'')).toLowerCase().includes(search))&&(!catFilter||String(r.category_id)===catFilter));
  visible.sort((a,b)=>sort==='date-asc'?a.spent_on.localeCompare(b.spent_on)||a.id-b.id:sort==='amount-desc'?b.amount-a.amount:sort==='amount-asc'?a.amount-b.amount: b.spent_on.localeCompare(a.spent_on)||b.id-a.id);
  const rowsTarget=$('#expenseRows')||$('#list');
  rowsTarget.innerHTML=visible.length?visible.map(r=>`<div class="row"><span class="dot" style="background:${r.color}"></span>
    <div class="grow"><b>${esc(r.name)}</b><span>${r.spent_on.split('-').reverse().join('.')}${r.note?' · '+esc(r.note):''}</span></div>
    <div class="amt">−${fmt(r.amount)} ${esc(CUR)}</div><div class="row-actions"><button class="small-btn" data-edit="${r.id}" aria-label="Редактировать расход">Изм.</button><button class="x" data-id="${r.id}" aria-label="Удалить расход">×</button></div></div>`).join('')
    :'<div class="empty">'+(rows.length?'По фильтрам ничего не найдено.':'В этом месяце расходов нет. Добавьте первый слева.')+'</div>';
  const cats=all(`SELECT c.name,c.color,SUM(e.amount) s,COUNT(*) n FROM expenses e JOIN categories c ON c.id=e.category_id
    WHERE e.user_id=? AND strftime('%Y-%m',e.spent_on)=? GROUP BY c.id ORDER BY s DESC`,[U,m]);
  const hist=all(`SELECT strftime('%Y-%m',spent_on) m,SUM(amount) s FROM expenses WHERE user_id=? GROUP BY m ORDER BY m DESC LIMIT 6`,[U]).reverse();
  const mx=Math.max(1,...hist.map(h=>h.s));
  const MN=['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  $('#stats').innerHTML='<h3>По категориям</h3>'+(cats.length?cats.map(c=>`<div style="margin:12px 0"><div class="row" style="padding:0;border:0">
    <span class="dot" style="background:${c.color}"></span><div class="grow">${esc(c.name)} <span style="display:inline">· ${c.n} шт.</span></div>
    <div class="amt">${fmt(c.s)} ${esc(CUR)} <span style="color:var(--mute);font-weight:400">${Math.round(c.s/t*100)}%</span></div></div>
    <div class="bar"><i style="width:${c.s/t*100}%;background:${c.color}"></i></div></div>`).join(''):'<div class="empty">Нет данных за месяц.</div>')
    +'<h3>Последние месяцы</h3>'+(hist.length?`<div class="cols">${hist.map(h=>`<div class="col"><span>${fmt(Math.round(h.s))}</span><i style="height:${h.s/mx*100}px"></i><span>${MN[+h.m.slice(5)-1]}</span></div>`).join('')}</div>`:'<div class="empty">Нет данных.</div>');
  renderProfile(t);
}
function renderProfile(t){
  const k=all(`SELECT COALESCE(SUM(amount),0) s,COUNT(*) n,COALESCE(AVG(amount),0) a,COALESCE(MAX(amount),0) mx,MIN(spent_on) d FROM expenses WHERE user_id=?`,[U])[0];
  const top=all(`SELECT c.name,SUM(e.amount) s FROM expenses e JOIN categories c ON c.id=e.category_id WHERE e.user_id=? GROUP BY c.id ORDER BY s DESC LIMIT 1`,[U])[0];
  const pct=me.budget>0?Math.min(100,t/me.budget*100):0,over=me.budget>0&&t>me.budget;
  const cur=['₽','$','€','₸','₴','Br'].map(c=>`<option${c===CUR?' selected':''}>${c}</option>`).join('');
  $('#prof').innerHTML=`<div class="pf"><span class="av big">${esc(initials(me.name))}</span><div><b>${esc(me.name)}</b><span>${esc(me.email)}<br>В сервисе с ${esc(me.created_at.slice(0,10).split('-').reverse().join('.'))}</span></div></div>
  <div class="kpi"><div><span>Всего потрачено</span><b>${fmt(k.s)} ${esc(CUR)}</b></div><div><span>Записей</span><b>${k.n}</b></div>
  <div><span>Средний расход</span><b>${fmt(k.a)} ${esc(CUR)}</b></div><div><span>Самый крупный</span><b>${fmt(k.mx)} ${esc(CUR)}</b></div>
  <div><span>Главная категория</span><b>${top?esc(top.name):'—'}</b></div><div><span>Первая запись</span><b>${k.d?k.d.split('-').reverse().join('.'):'—'}</b></div></div>
  <h3>Бюджет на ${esc(month())}</h3>
  ${me.budget>0?`<div class="row" style="border:0;padding:4px 0"><div class="grow">${fmt(t)} из ${fmt(me.budget)} ${esc(CUR)}</div><div class="amt" style="color:${over?'var(--neg)':'inherit'}">${over?'Превышен на '+fmt(t-me.budget):'Осталось '+fmt(me.budget-t)}</div></div>
  <div class="bar"><i style="width:${pct}%;background:${over?'var(--neg)':'var(--acc)'}"></i></div>`:'<div style="color:var(--mute)">Лимит не задан. Укажите его ниже, чтобы видеть остаток.</div>'}
  <h3>Данные профиля</h3>
  <div class="f"><label for="pname">Имя</label><input id="pname" value="${esc(me.name)}"></div>
  <div class="two"><div class="f"><label for="pcur">Валюта</label><select id="pcur">${cur}</select></div>
  <div class="f"><label for="pbud">Бюджет на месяц</label><input id="pbud" type="number" min="0" step="1" value="${me.budget||''}" placeholder="0"></div></div>
  <button class="btn" style="width:auto" id="psave">Сохранить профиль</button><div class="ok" id="pok" role="status"></div>
  <h3>Смена пароля</h3>
  <div class="two"><div class="f"><label for="op">Текущий пароль</label><input id="op" type="password" autocomplete="current-password"></div>
  <div class="f"><label for="np">Новый пароль</label><input id="np" type="password" autocomplete="new-password"></div></div>
  <button class="btn sec" id="ppass">Изменить пароль</button><div class="err" id="perr" role="alert"></div>
  <div style="display:flex;gap:8px;margin-top:22px;flex-wrap:wrap"><button class="btn sec" id="plogout">Выйти</button><button class="btn sec danger" id="pdel">Удалить профиль</button></div>`;
}
$('#prof').addEventListener('click',async e=>{
  const id=e.target.id;if(!id)return;
  if(id==='psave'){const n=$('#pname').value.trim();if(!n){$('#pok').textContent='';$('#perr').textContent='Имя не может быть пустым.';return;}
    run('UPDATE users SET name=?,currency=?,budget=? WHERE id=?',[n,$('#pcur').value,Math.max(0,parseFloat($('#pbud').value)||0),U]);loadMe();render();$('#pok').textContent='Профиль сохранён.';}
  if(id==='ppass'){const er=$('#perr');er.textContent='';try{
    if(await hash($('#op').value,me.salt)!==me.pass_hash){er.textContent='Текущий пароль неверный.';return;}
    if($('#np').value.length<6){er.textContent='Новый пароль должен быть не короче 6 символов.';return;}
    const salt=rnd();run('UPDATE users SET pass_hash=?,salt=? WHERE id=?',[await hash($('#np').value,salt),salt,U]);loadMe();
    $('#op').value=$('#np').value='';$('#pok').textContent='Пароль изменён.';}catch(x){er.textContent='Ошибка: '+x.message;}}
  if(id==='plogout'){ses.set(null);showAuth();}
  if(id==='pdel'&&confirm('Удалить профиль и все его расходы? Это нельзя отменить.')){run('DELETE FROM expenses WHERE user_id=?',[U]);run('DELETE FROM users WHERE id=?',[U]);ses.set(null);showAuth();}
});
$('#whoBtn').onclick=()=>selTab('prof');
$('#add').onclick=()=>{
  const a=parseFloat($('#amount').value),d=$('#date').value,e=$('#ferr');
  if(!(a>0)){e.textContent='Введите сумму больше нуля.';return;}
  if(!d){e.textContent='Выберите дату.';return;}
  e.textContent='';
  run('INSERT INTO expenses(user_id,amount,category_id,spent_on,note) VALUES(?,?,?,?,?)',[U,a,+$('#cat').value,d,$('#note').value.trim()]);
  $('#amount').value='';$('#note').value='';$('#month').value=d.slice(0,7);render();$('#amount').focus();
};
$('#list').onclick=e=>{
  const del=e.target.closest('.x');
  if(del){run('DELETE FROM expenses WHERE id=? AND user_id=?',[+del.dataset.id,U]);render();return;}
  const edit=e.target.closest('[data-edit]');
  if(edit){
    const id=+edit.dataset.edit;
    const r=all('SELECT * FROM expenses WHERE id=? AND user_id=?',[id,U])[0];
    if(!r)return;
    const area=$('#editArea'); area.hidden=false;
    area.innerHTML=`<div class="edit-form"><div><label for="editAmount">Сумма, ${esc(CUR)}</label><input id="editAmount" type="number" min="0.01" step="0.01" value="${r.amount}"></div>
    <div><label for="editDate">Дата</label><input id="editDate" type="date" value="${esc(r.spent_on)}"></div>
    <div><label for="editCat">Категория</label><select id="editCat">${all('SELECT id,name FROM categories ORDER BY id').map(c=>`<option value="${c.id}" ${c.id===r.category_id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
    <div><label for="editNote">Заметка</label><input id="editNote" value="${esc(r.note||'')}"></div>
    <div class="wide" style="display:flex;gap:8px"><button class="btn" id="saveEdit" data-id="${id}">Сохранить изменения</button><button class="btn sec" id="cancelEdit">Отмена</button></div></div>`;
    $('#saveEdit').onclick=()=>{const a=Number($('#editAmount').value),d=$('#editDate').value;if(!(a>0)||!d){alert('Укажите положительную сумму и дату.');return;}
      run('UPDATE expenses SET amount=?,category_id=?,spent_on=?,note=? WHERE id=? AND user_id=?',[a,+$('#editCat').value,d,$('#editNote').value.trim(),id,U]);area.hidden=true;render();};
    $('#cancelEdit').onclick=()=>{area.hidden=true;area.innerHTML='';};
  }
};
$('#month').onchange=render;
function selTab(n){document.querySelectorAll('.tab[data-t]').forEach(x=>x.setAttribute('aria-selected',x.dataset.t===n));
  ['list','stats','prof','sql'].forEach(id=>$('#'+id).hidden=id!==n);}
document.querySelectorAll('.tab[data-t]').forEach(t=>t.onclick=()=>selTab(t.dataset.t));
$('#run').onclick=()=>{
  $('#qerr').textContent='';$('#qres').innerHTML='';
  try{
    const query=$('#q').value.replace(/\bCURRENT_USER_ID\b/g,String(U));
    const r=db.exec(query),w=/^\s*(insert|update|delete|create|drop|alter|replace)/i.test(query);
    if(w){save();if(!all('SELECT 1 FROM users WHERE id=?',[U]).length){ses.set(null);showAuth();return;}loadMe();render();}
    if(!r.length){$('#qres').innerHTML='<div class="empty">Выполнено'+(w?'. Изменено строк: '+db.getRowsModified():'')+'.</div>';return;}
    const l=r[r.length-1];
    $('#qres').innerHTML='<table><tr>'+l.columns.map(c=>`<th>${esc(c)}</th>`).join('')+'</tr>'+l.values.map(v=>'<tr>'+v.map(x=>`<td>${esc(x)}</td>`).join('')+'</tr>').join('')+'</table>';
  }catch(e){$('#qerr').textContent='Ошибка SQL: '+e.message;}
};
$('#csv').onclick=()=>{
  try{
    const r=all("SELECT e.spent_on AS date,e.amount,c.name AS category,e.note FROM expenses e JOIN categories c ON c.id=e.category_id WHERE e.user_id=? ORDER BY e.spent_on",[U]);
    if(!r.length){$('#qerr').textContent='Пока нечего экспортировать.';return;}
    const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"',cols=Object.keys(r[0]);
    const csv='\ufeff'+[cols.map(q).join(',')].concat(r.map(o=>cols.map(c=>q(o[c])).join(','))).join('\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='expenses.csv';a.click();
  }catch(e){$('#qerr').textContent='Не удалось скачать: '+e.message;}
};
$('#reset').onclick=()=>{if(!confirm('Удалить все ваши расходы? Это нельзя отменить.'))return;
  run('DELETE FROM expenses WHERE user_id=?',[U]);render();$('#qres').innerHTML='<div class="empty">Все расходы удалены.</div>';};
$('#searchExpense')?.addEventListener('input',render);
$('#filterCat')?.addEventListener('change',render);
$('#sortExpenses')?.addEventListener('change',render);
$('#themeBtn')?.addEventListener('click',()=>{
  const root=document.documentElement, next=root.dataset.theme==='dark'?'light':'dark';
  root.dataset.theme=next; try{localStorage.setItem('expense_theme',next);}catch(e){}
  $('#themeBtn').textContent=next==='dark'?'Светлая тема':'Тёмная тема';
});
$('#exportBtn')?.addEventListener('click',()=>{
  const data={exportedAt:new Date().toISOString(),profile:{name:me.name,email:me.email,currency:CUR,budget:me.budget},
    expenses:all('SELECT e.spent_on AS date,e.amount,c.name AS category,e.note FROM expenses e JOIN categories c ON c.id=e.category_id WHERE e.user_id=? ORDER BY e.spent_on',[U])};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='my-expenses-backup.json';a.click();URL.revokeObjectURL(a.href);
});
try{const savedTheme=localStorage.getItem('expense_theme');if(savedTheme)document.documentElement.dataset.theme=savedTheme;}catch(e){}
initSqlJs().then(init).catch(e=>{document.body.innerHTML='<p style="padding:20px">Не удалось запустить базу данных: '+esc(e.message)+'</p>';});
