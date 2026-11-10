/* KAS DERMAGA — Supabase connected */
const SUPABASE_URL = 'https://stfruttolbhpgpjkbeys.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4MWOY_Kig6y4wKO0OHZVCA_JhFRxJrt';
const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = s => document.querySelector(s);
const money = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const monthKey = today().slice(0, 7);
const fmtDate = s => new Date(s + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let transactions = [], comments = [], participants = [], dutySchedule = [], session = null, isAdmin = false, loading = false;

function totals(rows) {
  return rows.reduce((x, t) => { x[t.type === 'Pemasukan' ? 'in' : 'out'] += Number(t.amount); return x; }, { in: 0, out: 0 });
}
function setStatus(text, good = true) {
  const el = $('#connectionStatus');
  if (el) { el.textContent = text; el.classList.toggle('offline', !good); }
}
function txHtml(t, editable = false) {
  return `<article class="transaction"><div class="tx-icon ${t.type === 'Pemasukan' ? 'in' : 'out'}">${t.type === 'Pemasukan' ? '↙' : '↗'}</div><div class="tx-info"><b>${esc(t.category)}</b><small>${fmtDate(t.date)} · ${esc(t.note)}</small></div><div class="tx-side"><strong class="tx-amount ${t.type === 'Pemasukan' ? 'in' : 'out'}">${t.type === 'Pemasukan' ? '+' : '−'}${money(t.amount)}</strong>${editable ? `<button class="edit-link" data-edit="${esc(t.id)}">Edit</button> <button class="edit-link danger-link" data-delete="${esc(t.id)}">Hapus</button>` : ''}</div></article>`;
}
function render() {
  const all = totals(transactions), m = totals(transactions.filter(t => t.date.startsWith(monthKey)));
  $('#balance').textContent = money(all.in - all.out);
  $('#totalIn').textContent = money(m.in); $('#totalOut').textContent = money(m.out);
  $('#reportIn').textContent = money(m.in); $('#reportOut').textContent = money(m.out); $('#reportNet').textContent = money(m.in - m.out);
  $('#monthLabel').textContent = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  const recent = [...transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  $('#recentList').innerHTML = recent.length ? recent.map(t => txHtml(t)).join('') : '<div class="empty">Belum ada transaksi.</div>';
  $('#adminLabel').textContent = isAdmin ? 'ADMIN AKTIF' : 'PENGUNJUNG';
  document.querySelectorAll('[data-open]').forEach(b => { b.disabled = !isAdmin; b.title = isAdmin ? '' : 'Login admin untuk mencatat transaksi'; });
}
async function loadTransactions() {
  const { data, error } = await db.from('transactions').select('*').order('transaction_date', { ascending: false });
  if (error) { console.error(error); setStatus('Gagal memuat transaksi', false); return; }
  transactions = (data || []).map(r => ({ id: r.id, type: r.type, date: r.transaction_date, category: r.category, note: r.description, amount: Number(r.amount) }));
  render(); setStatus('Terhubung ke database');
}
async function loadComments() {
  const query = db.from('comments').select('*').order('created_at', { ascending: false });
  const { data, error } = await query;
  if (error) { console.error(error); return; }
  comments = data || [];
}
async function refreshSession() {
  const { data } = await db.auth.getSession(); session = data.session;
  isAdmin = false;
  if (session?.user) {
    const { data: adminRow, error } = await db.from('admin_users').select('user_id').eq('user_id', session.user.id).maybeSingle();
    // RLS on admin_users may block direct reads; test admin capability through an insert-safe RPC-free check.
    // The transactions write policies still enforce admin status on the server.
    isAdmin = !!adminRow && !error;
  }
  if (session?.user && !isAdmin) {
    // Check via an update-free authenticated read of own admin record. If table read is restricted,
    // admin can still be recognized after the server rejects/accepts a protected operation.
    const { data: ownAdmin } = await db.rpc('is_admin');
    isAdmin = ownAdmin === true;
  }
  $('#profileBtn').textContent = isAdmin ? 'A' : '↗';
  render();
}
async function loadCommunityData() {
  const [p, d] = await Promise.all([
    db.from('participants').select('id,full_name,is_active').order('full_name'),
    db.from('duty_schedule').select('id,participant_id,duty_date,shift_label,notes,participants(full_name)').order('duty_date', { ascending: true })
  ]);
  if (p.error) console.error('Peserta:', p.error);
  else participants = p.data || [];
  if (d.error) console.error('Jadwal:', d.error);
  else dutySchedule = d.data || [];
}
function renderParticipants() {
  const rows = participants.filter(p => p.is_active !== false);
  const list = rows.length ? rows.map((p,i) => `<div class="community-row"><span class="row-number">${i+1}</span><b>${esc(p.full_name)}</b>${isAdmin ? `<button class="edit-link danger-link" data-participant-delete="${esc(p.id)}">Hapus</button>` : ''}</div>`).join('') : '<div class="empty">Belum ada nama peserta yang dimasukkan.</div>';
  show('Daftar Peserta', `${isAdmin ? `<form id="participantForm" class="inline-admin-form"><label>Nama peserta<input name="full_name" required maxlength="120" placeholder="Masukkan nama peserta"></label><button class="submit-button">Tambah Peserta</button><p class="form-note" id="participantMessage"></p></form>` : '<p class="muted">Daftar nama peserta tambangan.</p>'}<div class="community-list">${list}</div><p class="form-note">Jumlah peserta aktif: ${rows.length}</p>`);
  const form = $('#participantForm');
  if (form) form.onsubmit = async e => { e.preventDefault(); const btn=form.querySelector('button'); btn.disabled=true; const {error}=await db.from('participants').insert({full_name:form.full_name.value.trim(),is_active:true}); btn.disabled=false; if(error){$('#participantMessage').textContent='Gagal menyimpan: '+error.message;return;} await loadCommunityData(); renderParticipants(); };
}
function renderSchedule() {
  const rows = dutySchedule;
  const list = rows.length ? rows.map(d => `<article class="schedule-row"><div class="schedule-date"><b>${new Date(d.duty_date+'T00:00:00').toLocaleDateString('id-ID',{day:'2-digit'})}</b><small>${new Date(d.duty_date+'T00:00:00').toLocaleDateString('id-ID',{month:'short',year:'numeric'})}</small></div><div class="schedule-info"><b>${esc(d.participants?.full_name || 'Peserta tidak ditemukan')}</b><small>${esc(d.shift_label || 'Giliran')}${d.notes ? ' · '+esc(d.notes) : ''}</small></div>${isAdmin ? `<button class="edit-link danger-link" data-schedule-delete="${esc(d.id)}">Hapus</button>` : ''}</article>`).join('') : '<div class="empty">Jadwal belum dimasukkan.</div>';
  const options = participants.filter(p=>p.is_active!==false).map(p=>`<option value="${esc(p.id)}">${esc(p.full_name)}</option>`).join('');
  show('Jadwal Giliran', `${isAdmin ? `<form id="scheduleForm" class="inline-admin-form"><label>Nama peserta<select name="participant_id" required>${options || '<option value="">Tambahkan peserta terlebih dahulu</option>'}</select></label><label>Tanggal giliran<input type="date" name="duty_date" required value="${today()}"></label><label>Keterangan giliran<input name="shift_label" maxlength="80" value="Giliran mingguan" required></label><label>Catatan (opsional)<input name="notes" maxlength="250" placeholder="Catatan tambahan"></label><button class="submit-button" ${options?'':'disabled'}>Tambah Jadwal</button><p class="form-note" id="scheduleMessage"></p></form>` : '<p class="muted">Jadwal giliran peserta tambangan.</p>'}<div class="community-list">${list}</div>`);
  const form=$('#scheduleForm');
  if(form) form.onsubmit=async e=>{e.preventDefault();const btn=form.querySelector('button');btn.disabled=true;const {error}=await db.from('duty_schedule').insert({participant_id:form.participant_id.value,duty_date:form.duty_date.value,shift_label:form.shift_label.value.trim(),notes:form.notes.value.trim()||null});btn.disabled=false;if(error){$('#scheduleMessage').textContent='Gagal menyimpan: '+error.message;return;}await loadCommunityData();renderSchedule();};
}
function openTx(type = 'Pemasukan', id = null) {
  if (!isAdmin) { showLogin(); return; }
  const f = $('#transactionForm'); f.reset(); f.elements.id.value = ''; f.elements.date.value = today();
  const old = id ? transactions.find(x => x.id === id) : null;
  f.elements.type.value = old ? old.type : type;
  if (old) { f.elements.id.value = old.id; f.elements.date.value = old.date; f.elements.category.value = old.category; f.elements.note.value = old.note; f.elements.amount.value = old.amount; }
  $('#dialogTitle').textContent = (old ? 'Edit ' : 'Tambah ') + f.elements.type.value;
  $('#transactionDialog').showModal();
}
document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openTx(b.dataset.open === 'expense' ? 'Pengeluaran' : 'Pemasukan')));
$('#closeDialog').onclick = () => $('#transactionDialog').close();
$('#transactionForm').addEventListener('submit', async e => {
  e.preventDefault(); if (!isAdmin) return showLogin();
  const f = e.currentTarget, id = f.elements.id.value;
  const row = { type: f.elements.type.value, transaction_date: f.elements.date.value, category: f.elements.category.value, description: f.elements.note.value.trim(), amount: Number(f.elements.amount.value), created_by: session.user.id };
  if (!row.description || !row.amount || row.amount < 1) return;
  const button = f.querySelector('[type="submit"]'); button.disabled = true; button.textContent = 'Menyimpan...';
  const result = id ? await db.from('transactions').update(row).eq('id', id) : await db.from('transactions').insert(row);
  button.disabled = false; button.textContent = 'Simpan Transaksi';
  if (result.error) { alert('Gagal menyimpan: ' + result.error.message); return; }
  $('#transactionDialog').close(); await loadTransactions();
});
function show(title, body) { $('#simpleTitle').textContent = title; $('#simpleBody').innerHTML = body; $('#simpleDialog').showModal(); }
function showLogin() {
  show('Login Admin', `<p class="muted">Masuk menggunakan akun admin KAS DERMAGA.</p><form id="loginForm"><label>Email<input name="email" type="email" autocomplete="username" required value=""></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="submit-button">Masuk sebagai Admin</button><p class="form-note" id="loginMessage"></p></form>`);
  $('#loginForm').onsubmit = async e => {
    e.preventDefault(); const f = e.currentTarget, msg = $('#loginMessage'), btn = f.querySelector('button');
    btn.disabled = true; btn.textContent = 'Memeriksa...';
    const { error } = await db.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    btn.disabled = false; btn.textContent = 'Masuk sebagai Admin';
    if (error) { msg.textContent = 'Login gagal: ' + error.message; return; }
    await refreshSession();
    if (!isAdmin) { await db.auth.signOut(); await refreshSession(); msg.textContent = 'Akun berhasil masuk, tetapi belum terdaftar sebagai admin. Periksa UID di tabel admin_users.'; return; }
    $('#simpleDialog').close(); setStatus('Login admin berhasil');
  };
}
function showTab(tab) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === tab));
  if (tab === 'home') return;
  if (tab === 'history') { show('Riwayat Transaksi', transactions.length ? [...transactions].sort((a, b) => b.date.localeCompare(a.date)).map(t => txHtml(t, isAdmin)).join('') : '<p>Belum ada transaksi.</p>'); return; }
  if (tab === 'reports') { const x = totals(transactions.filter(t => t.date.startsWith(monthKey))), all = totals(transactions); show('Laporan Bulan Ini', `<p>Periode: <b>${esc($('#monthLabel').textContent)}</b></p><p>Total pemasukan: <b class="green-text">${money(x.in)}</b></p><p>Total pengeluaran: <b class="red-text">${money(x.out)}</b></p><p>Saldo bersih bulan ini: <b>${money(x.in - x.out)}</b></p><hr><p>Saldo keseluruhan: <b>${money(all.in - all.out)}</b></p><p>Jumlah transaksi: <b>${transactions.length}</b></p><button class="submit-button" id="exportCsv">Unduh laporan CSV</button>`); $('#exportCsv').onclick = exportCsv; return; }
  if (tab === 'comments') { renderComments(); return; }
}
async function renderComments() {
  await loadComments();
  const visible = comments.filter(c => c.status === 'approved' || isAdmin);
  const list = visible.length ? visible.map(c => `<article class="comment"><b>${esc(c.name)}</b><small>${new Date(c.created_at).toLocaleDateString('id-ID')}</small><p>${esc(c.message)}</p>${isAdmin ? `<small>Status: ${esc(c.status)}</small>${c.status !== 'approved' ? `<button class="edit-link" data-approve="${c.id}">Setujui</button>` : ''} <button class="edit-link danger-link" data-hide="${c.id}">Sembunyikan</button>` : ''}</article>`).join('') : '<p>Belum ada komentar yang ditampilkan.</p>';
  show('Komentar Warga', `<p class="muted">Komentar warga akan diperiksa admin sebelum ditampilkan.</p><form id="commentForm"><label>Nama warga<input name="name" required minlength="2" maxlength="80" placeholder="Nama Anda"></label><label>Komentar<textarea name="message" rows="3" required minlength="2" maxlength="2000" placeholder="Tulis saran atau pertanyaan..."></textarea></label><button class="submit-button">Kirim komentar</button><p class="form-note" id="commentMessage"></p></form><hr>${isAdmin ? '<p><b>Moderasi admin:</b> komentar menunggu persetujuan juga terlihat di sini.</p>' : ''}${list}`);
  $('#commentForm').onsubmit = async e => { e.preventDefault(); const f = e.currentTarget, msg = $('#commentMessage'), btn = f.querySelector('button'); btn.disabled = true; const { error } = await db.from('comments').insert({ name: f.name.value.trim(), message: f.message.value.trim(), status: 'pending' }); btn.disabled = false; if (error) { msg.textContent = 'Komentar gagal dikirim: ' + error.message; return; } msg.textContent = 'Komentar terkirim dan menunggu persetujuan admin.'; f.reset(); };
}
document.querySelectorAll('[data-community]').forEach(b => b.addEventListener('click', async () => { await loadCommunityData(); b.dataset.community === 'participants' ? renderParticipants() : renderSchedule(); }));
$('#simpleBody').addEventListener('click', async e => {
  const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-delete]'), approve = e.target.closest('[data-approve]'), hide = e.target.closest('[data-hide]'), pd = e.target.closest('[data-participant-delete]'), sd = e.target.closest('[data-schedule-delete]');
  if (ed) { $('#simpleDialog').close(); openTx('Pemasukan', ed.dataset.edit); }
  if (del && isAdmin && confirm('Hapus transaksi ini?')) { const { error } = await db.from('transactions').delete().eq('id', del.dataset.delete); if (error) alert('Gagal menghapus: ' + error.message); else { await loadTransactions(); showTab('history'); } }
  if (approve && isAdmin) { const { error } = await db.from('comments').update({ status: 'approved' }).eq('id', approve.dataset.approve); if (error) alert(error.message); else renderComments(); }
  if (hide && isAdmin) { const { error } = await db.from('comments').update({ status: 'hidden' }).eq('id', hide.dataset.hide); if (error) alert(error.message); else renderComments(); }
});
$('#closeSimple').onclick = () => $('#simpleDialog').close();
$('#profileBtn').onclick = async () => { if (!isAdmin) return showLogin(); show('Akun Admin', `<p>Login sebagai <b>${esc(session.user.email)}</b></p><button class="submit-button" id="logoutBtn">Keluar</button>`); $('#logoutBtn').onclick = async () => { await db.auth.signOut(); await refreshSession(); $('#simpleDialog').close(); setStatus('Anda telah keluar'); }; };
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
function exportCsv() { const rows = [['Tanggal', 'Jenis', 'Kategori', 'Keterangan', 'Nominal'], ...transactions.map(t => [t.date, t.type, t.category, t.note, t.amount])]; const csv = rows.map(r => r.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })); a.download = 'laporan-kas-dermaga.csv'; a.click(); URL.revokeObjectURL(a.href); }
$('#todayLabel').textContent = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
(async function init() {
  try { await refreshSession(); await loadTransactions(); await loadComments(); db.auth.onAuthStateChange(() => { setTimeout(async () => { await refreshSession(); }, 0); }); }
  catch (err) { console.error(err); setStatus('Belum dapat terhubung', false); }
})();
