const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const money=n=>'Rp '+Number(n||0).toLocaleString('id-ID');
const today=()=>new Date().toISOString().slice(0,10);
// Data contoh hanya untuk pratinjau desain. Hapus/ganti saat mulai memakai kas sebenarnya.
const demoTransactions=[
 {id:'demo1',date:'2026-10-30',type:'Pemasukan',category:'Tarif penyeberangan',note:'Tarif penyeberangan',amount:150000,recordedBy:'Admin'},
 {id:'demo2',date:'2026-10-30',type:'Pemasukan',category:'Tarif penyeberangan',note:'Tarif penyeberangan',amount:200000,recordedBy:'Admin'},
 {id:'demo3',date:'2026-10-29',type:'Pengeluaran',category:'Pembelian BBM',note:'Beli solar',amount:250000,recordedBy:'Admin'},
 {id:'demo4',date:'2026-10-29',type:'Pemasukan',category:'Tarif penyeberangan',note:'Tarif penyeberangan',amount:175000,recordedBy:'Admin'},
 {id:'demo5',date:'2026-10-28',type:'Pengeluaran',category:'Perawatan sampan',note:'Perbaikan sampan',amount:500000,recordedBy:'Admin'}
];
let transactions=JSON.parse(localStorage.getItem('kd_transactions')||'null') ?? demoTransactions;
let feedback=JSON.parse(localStorage.getItem('kd_feedback')||'null') ?? [
 {name:'Andi Saputra',kind:'Saran',date:'30 Oktober 2026, 20:15',message:'Pelayanan penyeberangan sudah sangat baik. Semoga bisa ditambah jadwal malam.'},
 {name:'Siti Aminah',kind:'Kritik',date:'30 Oktober 2026, 18:42',message:'Mohon lampu di dermaga diperbaiki karena malam hari masih gelap.'},
 {name:'Joko',kind:'Saran',date:'29 Oktober 2026, 17:20',message:'Tarif sudah sesuai. Terima kasih kepada pengelola yang selalu menjaga kebersihan dermaga.'}
];
let boats=JSON.parse(localStorage.getItem('kd_boats')||'[{"name":"Sampan 01","note":"Aktif","status":"Beroperasi"},{"name":"Sampan 02","note":"Aktif","status":"Beroperasi"},{"name":"Sampan 03","note":"Aktif","status":"Beroperasi"},{"name":"Sampan 04","note":"Perbaikan","status":"Tidak Operasi"}]');
function save(){localStorage.setItem('kd_transactions',JSON.stringify(transactions));localStorage.setItem('kd_feedback',JSON.stringify(feedback));localStorage.setItem('kd_boats',JSON.stringify(boats));}
function totals(){let ins=transactions.filter(t=>t.type==='Pemasukan').reduce((a,t)=>a+Number(t.amount),0),outs=transactions.filter(t=>t.type==='Pengeluaran').reduce((a,t)=>a+Number(t.amount),0);$('#totalIn').textContent=money(ins);$('#totalOut').textContent=money(outs);$('#balance').textContent=money(ins-outs);$('#count').textContent=transactions.length;$('#reportSummary').innerHTML=`<p>Total pemasukan: <b>${money(ins)}</b></p><p>Total pengeluaran: <b>${money(outs)}</b></p><p>Saldo: <b>${money(ins-outs)}</b></p>`;}
function transactionRows(list){return list.slice().reverse().map(t=>`<tr><td>${t.date}</td><td><span class="pill ${t.type==='Pemasukan'?'in':'out'}">${t.type}</span></td><td><b>${esc(t.category||'-')}</b><br>${esc(t.note)}<br><small>Dicatat: ${esc(t.recordedBy||'Admin')}${t.receiptName?' · Bukti: '+esc(t.receiptName):''}</small></td><td>${money(t.amount)}</td><td><button class="small-action" onclick="editTx('${t.id}')">Edit</button> <button class="small-action danger" onclick="deleteTx('${t.id}')">Hapus</button></td></tr>`).join('')||'<tr><td colspan="5" class="empty">Belum ada transaksi.</td></tr>'}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function render(){totals();$('#recentRows').innerHTML=transactionRows(transactions.slice(-5));renderHistory();renderBoats();renderFeedback();renderChart();}
function renderHistory(){let q=($('#searchHistory')?.value||'').toLowerCase(),type=$('#typeFilter')?.value||'';$('#historyRows').innerHTML=transactionRows(transactions.filter(t=>(!type||t.type===type)&&t.note.toLowerCase().includes(q)));}
function renderBoats(){let html=boats.map((b,i)=>`<tr><td>${i+1}</td><td>${esc(b.name)}</td><td>${esc(b.note)}</td><td><span class="boat-status">${esc(b.status)}</span></td></tr>`).join('')||'<tr><td colspan="4">Belum ada sampan.</td></tr>';$('#boatRows').innerHTML=html;$('#boatRowsFull').innerHTML=html;}
function renderFeedback(){let html=feedback.slice().reverse().map(f=>`<div class="feedback"><div class="person">${esc(f.name.slice(0,1).toUpperCase())}</div><div><b>${esc(f.name)}</b> <span class="pill ${f.kind==='Kritik'?'out':'in'}">${esc(f.kind)}</span><br><small>${f.date}</small><p>${esc(f.message)}</p>${f.reply?`<div class="reply"><b>Balasan pengelola:</b> ${esc(f.reply)}</div>`:''}</div></div>`).join('')||'<div class="empty">Belum ada kritik atau saran dari warga.</div>';$('#feedbackList').innerHTML=html;$('#feedbackPreview').innerHTML=feedback.slice(-3).reverse().map(f=>`<div class="feedback"><div class="person">${esc(f.name.slice(0,1).toUpperCase())}</div><div><b>${esc(f.name)}</b> <span class="pill ${f.kind==='Kritik'?'out':'in'}">${esc(f.kind)}</span><small> · ${f.date}</small><p>${esc(f.message)}</p></div></div>`).join('')||'<div class="empty">Belum ada komentar.</div>';}
function renderChart(){let groups=Array.from({length:7},(_,i)=>({in:0,out:0,label:['1','5','10','15','20','25','30'][i]}));transactions.forEach(t=>{let day=Number(t.date.slice(-2)),idx=Math.min(6,Math.floor((day-1)/5));groups[idx][t.type==='Pemasukan'?'in':'out']+=Number(t.amount)});let max=Math.max(1,...groups.flatMap(g=>[g.in,g.out]));$('#chart').innerHTML=groups.map(g=>`<div class="bar-group"><div class="bar" style="height:${Math.max(2,g.in/max*85)}%"></div><div class="bar out" style="height:${Math.max(2,g.out/max*85)}%"></div><small>${g.label}</small></div>`).join('');}
function addTx(data){transactions.push({...data,id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),amount:Number(data.amount)});save();render();}
window.editTx=(id)=>{let t=transactions.find(x=>x.id===id);if(!t)return;let note=prompt('Ubah keterangan:',t.note);if(note===null)return;let amount=prompt('Ubah jumlah (angka saja):',t.amount);if(amount===null)return;if(!Number(amount)||Number(amount)<1){alert('Jumlah tidak valid.');return;}t.note=note;t.amount=Number(amount);save();render();};
window.deleteTx=(id)=>{if(!confirm('Hapus transaksi ini?'))return;transactions=transactions.filter(x=>x.id!==id);save();render();};
function bindForm(id,type){$('#'+id).addEventListener('submit',e=>{e.preventDefault();let fd=new FormData(e.target),d=Object.fromEntries(fd);let file=fd.get('receipt');d.receiptName=file&&file.size?file.name:'';delete d.receipt;addTx({...d,type});e.target.reset();alert(type+' berhasil dicatat.');});}
bindForm('incomeForm','Pemasukan');bindForm('expenseForm','Pengeluaran');
$('#quickForm').addEventListener('submit',e=>{if(e.submitter?.value==='cancel')return;e.preventDefault();let d=Object.fromEntries(new FormData(e.target));d.id=undefined;addTx(d);$('#transactionDialog').close();e.target.reset();});
$('#addTransaction').onclick=()=>{$('#quickForm [name=date]').value=today();$('#transactionDialog').showModal();};
$('#feedbackForm').addEventListener('submit',e=>{e.preventDefault();let d=Object.fromEntries(new FormData(e.target));feedback.push({...d,date:new Date().toLocaleString('id-ID')});save();renderFeedback();e.target.reset();alert('Komentar berhasil disimpan pada perangkat ini.');});
$('#addBoat').onclick=()=>{let name=prompt('Nama sampan:');if(!name)return;boats.push({name,note:'Aktif',status:'Beroperasi'});save();renderBoats();};
$('#searchHistory').addEventListener('input',renderHistory);$('#typeFilter').addEventListener('change',renderHistory);
$('#exportCsv').onclick=()=>{let rows=[['Tanggal','Jenis','Keterangan','Jumlah'],...transactions.map(t=>[t.date,t.type,t.note,t.amount])];let csv=rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\\n');let a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='riwayat-kas-dermaga.csv';a.click();URL.revokeObjectURL(a.href);};
$('#printReport').onclick=()=>window.print();
function go(page){$$('.page').forEach(p=>p.classList.toggle('active',p.id==='page-'+page));$$('.nav').forEach(n=>n.classList.toggle('active',n.dataset.page===page));if(page==='riwayat')renderHistory();}
$$('.nav').forEach(n=>n.onclick=()=>go(n.dataset.page));$$('[data-goto]').forEach(b=>b.onclick=()=>go(b.dataset.goto));
render();$$('input[type=date]').forEach(i=>i.value=today());
