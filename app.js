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
let transactions = [], comments = [], participants = [], dutySchedule = [], announcements = [], session = null, isAdmin = false, loading = false, sponsors = [], galleryItems = [];

function totals(rows) {
  rows = rows.filter(t => (t.fund_type || 'operational') === 'operational');
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
  const recent = transactions.filter(t => (t.fund_type || 'operational') === 'operational').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  $('#recentList').innerHTML = recent.length ? recent.map(t => txHtml(t)).join('') : '<div class="empty">Belum ada transaksi.</div>';
  $('#adminLabel').textContent = isAdmin ? 'ADMIN AKTIF' : 'PENGUNJUNG';
  document.querySelectorAll('[data-open]').forEach(b => { b.disabled = !isAdmin; b.title = isAdmin ? '' : 'Login admin untuk mencatat transaksi'; });
}
async function loadTransactions() {
  const { data, error } = await db.from('transactions').select('*').order('transaction_date', { ascending: false });
  if (error) { console.error(error); setStatus('Gagal memuat transaksi', false); return; }
  transactions = (data || []).map(r => ({ id: r.id, type: r.type, date: r.transaction_date, category: r.category, note: r.description, amount: Number(r.amount), fund_type: r.fund_type || 'operational' }));
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

function renderPolicy() {
 const body = `
 <p class="muted">Peraturan Tambangan Sampan Parit Haji Yakub. Ketentuan asuransi dan kompensasi musibah belum ditampilkan pada tahap ini dan akan dibahas terpisah.</p>
 <section class="policy-section"><h3>PASAL 1 — HAK KEIKUTSERTAAN PESERTA</h3>
 <p>Setiap warga yang telah menikah, telah membentuk keluarga sendiri, dan memiliki Kartu Keluarga (KK) tersendiri yang sah serta memenuhi ketentuan domisili Parit Haji Yakub, berhak didaftarkan sebagai peserta tambangan sampan masyarakat.</p>
 <p>Hak tersebut tetap berlaku meskipun yang bersangkutan masih tinggal serumah dengan orang tua, mertua, atau keluarga lainnya, serta belum memiliki rumah sendiri. Kepemilikan rumah bukan merupakan syarat keikutsertaan.</p>
 <p>Warga yang belum menikah dan hanya memisahkan KK tanpa membentuk keluarga sendiri tidak berhak menjadi peserta tersendiri, kecuali ditentukan lain melalui musyawarah masyarakat.</p></section>
 <section class="policy-section"><h3>PASAL 2 — WAKTU OPERASIONAL DAN KETEGASAN PENGELOLAAN</h3><ol>
 <li>Waktu operasional tambangan sampan masyarakat Parit Haji Yakub dimulai pukul <b>04.00 WIB</b> sampai dengan pukul <b>20.00 WIB</b>.</li>
 <li>Tepat pukul 20.00 WIB, hak operasional tambangan masyarakat berakhir dan operasional diserahkan kepada pengelola sampan sesuai kesepakatan yang berlaku.</li>
 <li>Seluruh peserta wajib menghentikan operasional tambangan masyarakat pada pukul 20.00 WIB dan tidak diperbolehkan melanjutkan atau mengambil alih operasional setelah waktu tersebut tanpa persetujuan pihak yang berwenang.</li>
 <li>Tidak seorang pun diperbolehkan mengubah jadwal, menguasai operasional, atau mengambil keputusan sepihak yang bertentangan dengan ketentuan ini.</li>
 <li>Setiap pelanggaran terhadap ketentuan waktu dan operasional akan dibahas melalui musyawarah masyarakat untuk menentukan tindakan atau sanksi sesuai kesepakatan bersama.</li>
 <li>Ketentuan ini berlaku sama bagi seluruh peserta tanpa pengecualian dan wajib dipatuhi bersama.</li></ol></section>
 <section class="policy-section"><h3>PASAL 3 — TUGAS BENDAHARA DAN KEUANGAN PERBAIKAN</h3><ol>
 <li>Bendahara bertanggung jawab menerima, menyimpan, mencatat, dan mengelola uang hasil tambangan sampan masyarakat secara tertib dan transparan.</li>
 <li>Uang hasil tambangan sampan wajib dicatat dalam pembukuan yang jelas, meliputi seluruh pemasukan, pengeluaran, dan saldo kas.</li>
 <li>Sebagian uang hasil tambangan sampan dialokasikan untuk dana perbaikan, perawatan, dan kebutuhan operasional sampan sesuai kesepakatan masyarakat.</li>
 <li>Setiap pengeluaran uang untuk perbaikan sampan wajib disertai keterangan tujuan penggunaan dan bukti pengeluaran apabila tersedia.</li>
 <li>Bendahara wajib menyampaikan laporan keuangan kepada masyarakat secara berkala atau apabila diminta dalam musyawarah.</li>
 <li>Bendahara dilarang menggunakan uang kas tambangan sampan untuk kepentingan pribadi atau mengeluarkan uang tanpa tujuan yang jelas dan dapat dipertanggungjawabkan.</li>
 <li>Penggunaan dana untuk perbaikan sampan harus dilakukan secara transparan dan sesuai kesepakatan masyarakat.</li>
 <li>Apabila ditemukan ketidaksesuaian dalam pencatatan atau penggunaan uang, bendahara wajib memberikan penjelasan dan menyelesaikannya melalui musyawarah masyarakat.</li></ol></section>
 <section class="policy-section"><h3>PASAL 5 — PENETAPAN ALOKASI, HAK GILIRAN, DAN KETEGASAN KEPUTUSAN</h3>
 <h4>Ayat (1) — Penetapan Alokasi Jatah Giliran</h4><p>Ditetapkan alokasi jatah giliran bagi fasilitas dan unsur kemasyarakatan dalam pengelolaan Tambangan Sampan Parit Haji Yakub sebagai berikut:</p><ol>
 <li>Masjid: 35 giliran.</li><li>Dermaga: 10 giliran.</li><li>Pemuda: 5 giliran.</li><li>Yasinan RT 02: 2 giliran.</li><li>Yasinan RT 01: 2 giliran.</li><li>Majelis: 2 giliran.</li><li>Sekolah RT 01: 2 giliran.</li><li>Sekolah RT 02: 2 giliran.</li><li>Kuburan: 2 giliran.</li><li>Papan wakaf: 2 giliran.</li></ol><p><b>Jumlah keseluruhan: 64 giliran.</b></p>
 <h4>Ayat (2) — Hak dan Perlindungan Alokasi</h4><p>Setiap fasilitas dan unsur kemasyarakatan berhak memperoleh jatah giliran sesuai jumlah yang telah ditetapkan dan disepakati bersama. Hak tersebut wajib dihormati, dilindungi, dan dilaksanakan secara tertib, adil, serta bertanggung jawab.</p>
 <h4>Ayat (3) — Larangan Perubahan dan Pengalihan Sepihak</h4><p>Dilarang mengurangi, mengambil, menghapus, memindahkan, atau mengalihkan jatah giliran yang telah ditetapkan tanpa melalui musyawarah dan persetujuan sesuai mekanisme yang disepakati. Tidak seorang pun diperbolehkan menggunakan jabatan, kedudukan, ataupun kepentingan pribadi untuk menguasai atau mengubah hak alokasi pihak lain secara sepihak.</p>
 <h4>Ayat (4) — Kewajiban Pengurus</h4><p>Pengurus wajib mencatat, mengatur, dan melaksanakan jadwal giliran secara transparan. Setiap alokasi harus dapat ditelusuri melalui pencatatan yang tertib dan dapat diperiksa oleh pihak-pihak yang berkepentingan.</p>
 <h4>Ayat (5) — Pertanggungjawaban dan Sanksi Pelanggaran</h4><p>Setiap pihak yang terbukti melanggar ketentuan alokasi wajib dimintai pertanggungjawaban. Penanganan pelanggaran dilakukan secara adil berdasarkan bukti, tingkat pelanggaran, dan hasil musyawarah. Sanksi dapat diberikan sesuai kesepakatan yang berlaku serta tidak boleh bertentangan dengan ketentuan hukum.</p>
 <h4>Ayat (6) — Ketegasan Keputusan</h4><p>Ketetapan alokasi jatah giliran yang telah disahkan melalui musyawarah merupakan keputusan yang mengikat bagi seluruh pihak yang menyetujuinya. Tidak seorang pun berhak membatalkan, mengurangi, mengubah, atau mengalihkan ketetapan tersebut secara sepihak.</p>
 <h4>Ayat (7) — Mekanisme Perubahan Ketetapan</h4><p>Perubahan terhadap alokasi hanya dapat dilakukan apabila terdapat alasan yang jelas, dibahas melalui musyawarah, disetujui oleh pihak-pihak yang berkepentingan sesuai mekanisme yang disepakati, dan dicatat secara tertulis.</p>
 <h4>Ayat (8) — Ketentuan Penutup</h4><p>Pasal ini menjadi pedoman resmi dalam pelaksanaan alokasi jatah giliran fasilitas dan unsur kemasyarakatan setelah disahkan oleh pihak yang berwenang berdasarkan kesepakatan bersama.</p>
 <p><b>Prinsip ketegasan:</b> Jatah giliran yang telah disahkan wajib dihormati dan dipenuhi. Tidak ada perubahan sepihak dan setiap pelaksanaan wajib dapat dipertanggungjawabkan.</p></section>
 <section class="policy-section"><h3>PASAL 6 — PELAYANAN DAN KELUHAN MASYARAKAT</h3><ol>
 <li>Bendahara wajib bersedia mendengarkan keluhan, saran, dan masukan dari masyarakat terkait pengelolaan uang kas tambangan sampan.</li>
 <li>Setiap keluhan atau permasalahan yang tidak dapat diselesaikan secara langsung dapat dibawa ke musyawarah masyarakat untuk mendapatkan penyelesaian bersama.</li>
 <li>Setiap keluhan masyarakat wajib diterima dengan baik, tanpa membeda-bedakan peserta.</li>
 <li>Bendahara wajib memberikan penjelasan yang jujur dan terbuka mengenai pemasukan, pengeluaran, saldo kas, serta penggunaan dana untuk perbaikan dan perawatan sampan.</li>
 <li>Bendahara wajib bersikap terbuka, bertanggung jawab, dan mengutamakan kepentingan bersama.</li></ol>
 <h4>Layanan Aspirasi Masyarakat</h4><p>Masyarakat dapat menyampaikan aspirasi, saran, kritik yang membangun, maupun keluhan terkait pelayanan dan pengelolaan Tambangan Sampan Parit Haji Yakub. Setiap aspirasi akan diterima dan menjadi bahan evaluasi untuk meningkatkan pelayanan. Masukan diharapkan disampaikan secara sopan, jelas, dan bertanggung jawab.</p></section>
 <p class="form-note">Kebijakan ini dapat dibaca masyarakat. Perubahan isi hanya dilakukan oleh admin yang berwenang.</p>`;
 show('Tata Tertib & Kebijakan', body);
}

async function loadAnnouncements() {
  const { data, error } = await db.from('announcements').select('*').eq('is_published', true).order('is_pinned', { ascending: false }).order('created_at', { ascending: false });
  if (error) { console.error('Pemberitahuan:', error); announcements = []; $('#noticePreview').innerHTML = '<div class="empty">Pemberitahuan belum dapat dimuat. Admin perlu menyiapkan tabel pemberitahuan.</div>'; return; }
  announcements = data || []; renderNoticePreview();
}
function renderNoticePreview() {
  const target = $('#noticePreview');
  const rows = announcements.slice(0, 2);
  target.innerHTML = rows.length ? rows.map(a => `<article class="notice-card"><div class="notice-symbol">${a.is_pinned ? '📌' : '📢'}</div><div class="notice-content"><b>${esc(a.title)}</b><p>${esc(a.message)}</p><small>${new Date(a.created_at).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'})}</small></div></article>`).join('') : '<div class="empty">Belum ada pemberitahuan dari pengelola.</div>';
}
async function renderAnnouncements() {
  const { data, error } = await db.from('announcements').select('*').order('is_pinned', { ascending: false }).order('created_at', { ascending: false });
  if (error) { show('Pemberitahuan', '<div class="empty">Tabel pemberitahuan belum disiapkan. Jalankan SQL pengaturan pemberitahuan terlebih dahulu.</div>'); return; }
  announcements = (data || []).filter(a => a.is_published || isAdmin);
  const form = isAdmin ? `<form id="announcementForm" class="inline-admin-form"><h3>Buat pemberitahuan</h3><label>Judul<input name="title" maxlength="120" required placeholder="Contoh: Informasi rapat peserta"></label><label>Isi pemberitahuan<textarea name="message" rows="4" maxlength="5000" required placeholder="Tuliskan informasi untuk warga..."></textarea></label><label class="check-label"><input type="checkbox" name="is_pinned"> Sematkan sebagai informasi penting</label><button class="submit-button">Terbitkan pemberitahuan</button><p class="form-note" id="announcementMessage"></p></form>` : '<p class="muted">Informasi resmi dari pengelola tambangan.</p>';
  const list = announcements.length ? announcements.map(a => `<article class="notice-card full-notice"><div class="notice-symbol">${a.is_pinned ? '📌' : '📢'}</div><div class="notice-content"><b>${esc(a.title)}</b><p>${esc(a.message).replace(/\\n/g,'<br>')}</p><small>${new Date(a.created_at).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'})}${a.is_pinned ? ' · Informasi penting' : ''}</small>${isAdmin ? `<div><button class="edit-link" data-notice-edit="${esc(a.id)}">Edit</button><button class="edit-link danger-link" data-notice-delete="${esc(a.id)}">Hapus</button>${a.is_published ? '' : '<span class="form-note"> · Draft</span>'}</div>` : ''}</div></article>`).join('') : '<div class="empty">Belum ada pemberitahuan.</div>';
  show('Pemberitahuan', `${form}<div class="notice-list">${list}</div>`);
  const f = $('#announcementForm');
  if (f) f.onsubmit = async e => { e.preventDefault(); const btn=f.querySelector('button'), msg=$('#announcementMessage'); btn.disabled=true; btn.textContent='Menerbitkan...'; const {error}=await db.from('announcements').insert({title:f.title.value.trim(),message:f.message.value.trim(),is_pinned:f.is_pinned.checked,is_published:true,created_by:session.user.id}); btn.disabled=false; btn.textContent='Terbitkan pemberitahuan'; if(error){msg.textContent='Gagal menerbitkan: '+error.message;return;} await loadAnnouncements(); await renderAnnouncements(); };
}

function openTx(type = 'Pemasukan', id = null) {
  if (!isAdmin) { showLogin(); return; }
  const f = $('#transactionForm'); f.reset(); f.elements.id.value = ''; f.elements.date.value = today();
  const old = id ? transactions.find(x => x.id === id) : null;
  f.elements.type.value = old ? old.type : type;
  f.elements.fund_type.value = old ? (old.fund_type || 'operational') : 'operational';
  if (old) { f.elements.id.value = old.id; f.elements.date.value = old.date; f.elements.category.value = old.category; f.elements.note.value = old.note; f.elements.amount.value = old.amount; }
  $('#dialogTitle').textContent = (old ? 'Edit ' : 'Tambah ') + f.elements.type.value;
  $('#transactionDialog').showModal();
}
document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openTx(b.dataset.open === 'expense' ? 'Pengeluaran' : 'Pemasukan')));
$('#closeDialog').onclick = () => $('#transactionDialog').close();
$('#transactionForm').addEventListener('submit', async e => {
  e.preventDefault(); if (!isAdmin) return showLogin();
  const f = e.currentTarget, id = f.elements.id.value;
  const row = { type: f.elements.type.value, transaction_date: f.elements.date.value, category: f.elements.category.value, description: f.elements.note.value.trim(), amount: Number(f.elements.amount.value), fund_type: f.elements.fund_type.value, created_by: session.user.id };
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
  if (tab === 'history') { const operational = transactions.filter(t => (t.fund_type || 'operational') === 'operational'); show('Riwayat Transaksi', operational.length ? [...operational].sort((a, b) => b.date.localeCompare(a.date)).map(t => txHtml(t, isAdmin)).join('') : '<p>Belum ada transaksi.</p>'); return; }
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

function renderInsurance() {
 const rows=transactions.filter(t=>(t.fund_type||'operational')==='insurance').sort((a,b)=>b.date.localeCompare(a.date));
 const x=rows.reduce((s,t)=>s+(t.type==='Pemasukan'?1:-1)*Number(t.amount),0);
 const form=isAdmin?`<form id="insuranceForm" class="inline-admin-form"><h3>Catat dana asuransi</h3><label>Jenis transaksi<select name="type"><option>Pemasukan</option><option>Pengeluaran</option></select></label><label>Tanggal<input name="date" type="date" value="${today()}" required></label><label>Keterangan<input name="note" maxlength="250" required></label><label>Jumlah (Rp)<input name="amount" type="number" min="1" required></label><button class="submit-button">Simpan dana asuransi</button><p class="form-note" id="insuranceMessage"></p></form>`:'';
 const list=rows.length?rows.map(t=>`<article class="transaction"><div class="tx-icon ${t.type==='Pemasukan'?'in':'out'}">${t.type==='Pemasukan'?'↙':'↗'}</div><div class="tx-info"><b>${esc(t.category)}</b><small>${fmtDate(t.date)} · ${esc(t.note)}</small></div><strong class="tx-amount ${t.type==='Pemasukan'?'in':'out'}">${t.type==='Pemasukan'?'+':'−'}${money(t.amount)}</strong></article>`).join(''):'<div class="empty">Belum ada riwayat dana asuransi.</div>';
 show('Dana Asuransi',`<div class="balance-card"><div class="balance-head"><span>Saldo Dana Asuransi</span><span>DANA KHUSUS</span></div><div class="balance">${money(x)}</div><div class="balance-foot"><span>Terpisah dari kas operasional</span></div></div>${form}<h3>Riwayat Dana Asuransi</h3>${list}`);
 const f=$('#insuranceForm'); if(f) f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button');b.disabled=true;const {error}=await db.from('transactions').insert({type:f.type.value,transaction_date:f.date.value,category:'Dana Asuransi',description:f.note.value.trim(),amount:Number(f.amount.value),fund_type:'insurance',created_by:session.user.id});b.disabled=false;if(error){$('#insuranceMessage').textContent='Gagal menyimpan: '+error.message;return;}await loadTransactions();renderInsurance();};
}
async function loadMedia(kind){const {data,error}=await db.from(kind).select('*').order('created_at',{ascending:false});if(error){console.error(error);return {data:[],error};}return {data:data||[],error:null};}
async function renderSponsors(){const r=await loadMedia('sponsors');sponsors=r.data;const form=isAdmin?`<form id="sponsorForm" class="inline-admin-form"><h3>Tambah sponsor / iklan</h3><label>Nama usaha<input name="title" maxlength="120" required></label><label>Keterangan<textarea name="description" rows="3" maxlength="1000" required></textarea></label><label>Kontak (opsional)<input name="contact" maxlength="100"></label><label>Gambar (opsional)<input name="image" type="file" accept="image/*"></label><button class="submit-button">Terbitkan iklan</button><p class="form-note" id="sponsorMessage"></p></form>`:'';const list=sponsors.filter(s=>s.is_active||isAdmin).map(s=>`<article class="media-card">${s.image_url?`<img src="${esc(s.image_url)}" alt="${esc(s.title)}">`:''}<div><b>${esc(s.title)}</b><p>${esc(s.description)}</p>${s.contact?`<small>${esc(s.contact)}</small>`:''}${isAdmin?`<button class="edit-link danger-link" data-sponsor-delete="${esc(s.id)}">Hapus</button>`:''}</div></article>`).join('')||'<div class="empty">Belum ada sponsor atau iklan.</div>';show('Sponsor & Iklan',`<p class="muted">Ruang promosi usaha warga. Pemasangan gratis pada tahap awal.</p>${form}${list}`);const f=$('#sponsorForm');if(f)f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button'),msg=$('#sponsorMessage');b.disabled=true;let image_url=null;const file=f.image.files[0];if(file){const path=`sponsors/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;const up=await db.storage.from('community-media').upload(path,file,{upsert:false});if(up.error){msg.textContent='Gagal mengunggah gambar: '+up.error.message;b.disabled=false;return;}image_url=db.storage.from('community-media').getPublicUrl(path).data.publicUrl;}const {error}=await db.from('sponsors').insert({title:f.title.value.trim(),description:f.description.value.trim(),contact:f.contact.value.trim()||null,image_url,is_active:true,created_by:session.user.id});b.disabled=false;if(error){msg.textContent='Gagal menyimpan: '+error.message;return;}renderSponsors();};}
async function renderGallery(){const r=await loadMedia('gallery');galleryItems=r.data;const form=isAdmin?`<form id="galleryForm" class="inline-admin-form"><h3>Tambah foto galeri</h3><label>Judul foto<input name="title" maxlength="120" required></label><label>Keterangan<input name="description" maxlength="500"></label><label>Pilih foto<input name="image" type="file" accept="image/*" required></label><button class="submit-button">Unggah foto</button><p class="form-note" id="galleryMessage"></p></form>`:'';const list=galleryItems.filter(g=>g.is_published||isAdmin).map(g=>`<article class="gallery-card"><img src="${esc(g.image_url)}" alt="${esc(g.title)}"><div><b>${esc(g.title)}</b><p>${esc(g.description||'')}</p>${isAdmin?`<button class="edit-link danger-link" data-gallery-delete="${esc(g.id)}">Hapus</button>`:''}</div></article>`).join('')||'<div class="empty">Belum ada foto di galeri.</div>';show('Galeri Foto',`${form}<div class="gallery-grid">${list}</div>`);const f=$('#galleryForm');if(f)f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button'),msg=$('#galleryMessage'),file=f.image.files[0];if(!file)return;b.disabled=true;const path=`gallery/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;const up=await db.storage.from('community-media').upload(path,file,{upsert:false});if(up.error){msg.textContent='Gagal mengunggah foto: '+up.error.message;b.disabled=false;return;}const image_url=db.storage.from('community-media').getPublicUrl(path).data.publicUrl;const {error}=await db.from('gallery').insert({title:f.title.value.trim(),description:f.description.value.trim()||null,image_url,storage_path:path,is_published:true,created_by:session.user.id});b.disabled=false;if(error){msg.textContent='Foto terunggah, tetapi gagal menyimpan data: '+error.message;return;}renderGallery();};}

document.querySelectorAll('[data-community]').forEach(b => b.addEventListener('click', async () => { const key=b.dataset.community; if(key==='announcements') return renderAnnouncements(); if(key==='insurance') return renderInsurance(); if(key==='gallery') return renderGallery(); if(key==='sponsors') return renderSponsors(); await loadCommunityData(); key === 'participants' ? renderParticipants() : key === 'schedule' ? renderSchedule() : renderPolicy(); }));
$('#allMenusBtn').onclick = () => { const grid=$('#shortcutGrid'); const expanded=grid.classList.toggle('expanded'); $('#allMenusBtn').textContent=expanded?'×':'⋮'; $('#allMenusBtn').setAttribute('aria-expanded',String(expanded)); };
$('#simpleBody').addEventListener('click', async e => {
  const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-delete]'), approve = e.target.closest('[data-approve]'), hide = e.target.closest('[data-hide]'), pd = e.target.closest('[data-participant-delete]'), sd = e.target.closest('[data-schedule-delete]'), nd = e.target.closest('[data-notice-delete]'), ne = e.target.closest('[data-notice-edit]'), gd=e.target.closest('[data-gallery-delete]'), spd=e.target.closest('[data-sponsor-delete]');
  if (ed) { $('#simpleDialog').close(); openTx('Pemasukan', ed.dataset.edit); }
  if (del && isAdmin && confirm('Hapus transaksi ini?')) { const { error } = await db.from('transactions').delete().eq('id', del.dataset.delete); if (error) alert('Gagal menghapus: ' + error.message); else { await loadTransactions(); showTab('history'); } }
  if (approve && isAdmin) { const { error } = await db.from('comments').update({ status: 'approved' }).eq('id', approve.dataset.approve); if (error) alert(error.message); else renderComments(); }
  if (hide && isAdmin) { const { error } = await db.from('comments').update({ status: 'hidden' }).eq('id', hide.dataset.hide); if (error) alert(error.message); else renderComments(); }
  if (pd && isAdmin && confirm('Hapus peserta ini? Jadwal terkait mungkin perlu diperiksa.')) { const {error}=await db.from('participants').delete().eq('id',pd.dataset.participantDelete); if(error) alert('Gagal menghapus peserta: '+error.message); else { await loadCommunityData(); renderParticipants(); } }
  if (sd && isAdmin && confirm('Hapus jadwal giliran ini?')) { const {error}=await db.from('duty_schedule').delete().eq('id',sd.dataset.scheduleDelete); if(error) alert('Gagal menghapus jadwal: '+error.message); else { await loadCommunityData(); renderSchedule(); } }
  if (nd && isAdmin && confirm('Hapus pemberitahuan ini?')) { const {error}=await db.from('announcements').delete().eq('id',nd.dataset.noticeDelete); if(error) alert(error.message); else renderAnnouncements(); }
  if (gd && isAdmin && confirm('Hapus foto ini?')) { const {error}=await db.from('gallery').delete().eq('id',gd.dataset.galleryDelete); if(error)alert(error.message); else renderGallery(); }
  if (spd && isAdmin && confirm('Hapus iklan ini?')) { const {error}=await db.from('sponsors').delete().eq('id',spd.dataset.sponsorDelete); if(error)alert(error.message); else renderSponsors(); }
  if (ne && isAdmin) { const a=announcements.find(x=>x.id===ne.dataset.noticeEdit); if(!a) return; show('Edit Pemberitahuan', `<form id="editAnnouncementForm"><label>Judul<input name="title" required maxlength="120" value="${esc(a.title)}"></label><label>Isi<textarea name="message" rows="5" required maxlength="5000">${esc(a.message)}</textarea></label><label class="check-label"><input type="checkbox" name="is_pinned" ${a.is_pinned?'checked':''}> Sematkan sebagai informasi penting</label><button class="submit-button">Simpan perubahan</button></form>`); $('#editAnnouncementForm').onsubmit=async ev=>{ev.preventDefault();const f=ev.currentTarget;const {error}=await db.from('announcements').update({title:f.title.value.trim(),message:f.message.value.trim(),is_pinned:f.is_pinned.checked}).eq('id',a.id);if(error)alert(error.message);else renderAnnouncements();}; } 
});
$('#closeSimple').onclick = () => $('#simpleDialog').close();
$('#profileBtn').onclick = async () => { if (!isAdmin) return showLogin(); show('Akun Admin', `<p>Login sebagai <b>${esc(session.user.email)}</b></p><button class="submit-button" id="logoutBtn">Keluar</button>`); $('#logoutBtn').onclick = async () => { await db.auth.signOut(); await refreshSession(); $('#simpleDialog').close(); setStatus('Anda telah keluar'); }; };
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
function exportCsv() { const rows = [['Tanggal', 'Jenis', 'Kategori', 'Keterangan', 'Nominal'], ...transactions.map(t => [t.date, t.type, t.category, t.note, t.amount])]; const csv = rows.map(r => r.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })); a.download = 'laporan-kas-dermaga.csv'; a.click(); URL.revokeObjectURL(a.href); }
$('#todayLabel').textContent = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
(async function init() {
  try { await refreshSession(); await loadTransactions(); await loadComments(); await loadAnnouncements(); db.auth.onAuthStateChange(() => { setTimeout(async () => { await refreshSession(); }, 0); }); }
  catch (err) { console.error(err); setStatus('Belum dapat terhubung', false); }
})();
