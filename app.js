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
let lastAnimatedBalanceText = null;
function renderBalanceWithDrop(value) {
  const el = $('#balance');
  const formatted = money(value);
  if (!el) return;

  // Jangan mengulang animasi pada setiap render kecil; ulangi hanya jika saldo berubah.
  if (formatted === lastAnimatedBalanceText) return;
  lastAnimatedBalanceText = formatted;
  el.setAttribute('aria-label', formatted);

  let digitOrder = 0;
  el.innerHTML = Array.from(formatted).map(ch => {
    if (/[0-9]/.test(ch)) {
      const delay = digitOrder * 1100;
      digitOrder += 1;
      return `<span class="balance-digit" style="--drop-delay:${delay}ms">${ch}</span>`;
    }
    return ch === ' ' ? '&nbsp;' : esc(ch);
  }).join('');
}

function render() {
  const all = totals(transactions), m = totals(transactions.filter(t => t.date.startsWith(monthKey)));
  renderBalanceWithDrop(all.in - all.out);
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
  announcements = data || []; renderNoticePreview(); renderPinnedAdminMessage();
}
document.addEventListener('click', e => {
  const toggle = e.target.closest('#pinnedAdminToggle');
  if (!toggle) return;
  const content = document.querySelector('#pinnedAdminContent');
  if (!content) return;
  const collapsed = content.classList.toggle('is-collapsed');
  toggle.textContent = collapsed ? 'Lihat pesan +' : 'Perkecil −';
  toggle.setAttribute('aria-expanded', String(!collapsed));
});

function renderPinnedAdminMessage() {
  const section = $('#pinnedAdminSection');
  const target = $('#pinnedAdminContent');
  if (!section || !target) return;
  const pinned = announcements.find(a => a.is_pinned && a.is_published);
  if (!pinned) { section.hidden = true; target.innerHTML = ''; return; }
  section.hidden = false;
  const date = new Date(pinned.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  target.innerHTML = `<div class="pinned-admin-body"><span class="pinned-admin-icon">📢</span><div class="pinned-admin-text"><b>${esc(pinned.title)}</b><p>${esc(pinned.message).replace(/\\n/g, '<br>')}</p></div></div><div class="pinned-admin-meta"><span>♙ Admin Dermaga</span><span>▦ ${date}</span>${isAdmin ? `<button type="button" class="edit-link" data-pinned-edit="${esc(pinned.id)}">Edit Pesan</button>` : ''}</div>`;
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
  const form = isAdmin ? `<form id="announcementForm" class="inline-admin-form"><h3>Buat pemberitahuan</h3><label>Judul<input name="title" maxlength="120" required placeholder="Contoh: Informasi rapat peserta"></label><label>Isi pemberitahuan<textarea name="message" rows="4" maxlength="5000" required placeholder="Tuliskan informasi untuk warga..."></textarea></label><label class="check-label"><input type="checkbox" name="is_pinned"> Sematkan di menu utama</label><label class="check-label"><input type="checkbox" name="is_published" checked> Publikasikan agar dapat dibaca warga</label><button class="submit-button">Terbitkan pemberitahuan</button><p class="form-note" id="announcementMessage"></p></form>` : '<p class="muted">Informasi resmi dari pengelola tambangan.</p>';
  const list = announcements.length ? announcements.map(a => `<article class="notice-card full-notice"><div class="notice-symbol">${a.is_pinned ? '📌' : '📢'}</div><div class="notice-content"><b>${esc(a.title)}</b><p>${esc(a.message).replace(/\\n/g,'<br>')}</p><small>${new Date(a.created_at).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'})}${a.is_pinned ? ' · Informasi penting' : ''}</small>${isAdmin ? `<div><button class="edit-link" data-notice-edit="${esc(a.id)}">Edit</button><button class="edit-link danger-link" data-notice-delete="${esc(a.id)}">Hapus</button>${a.is_published ? '' : '<span class="form-note"> · Draft</span>'}</div>` : ''}</div></article>`).join('') : '<div class="empty">Belum ada pemberitahuan.</div>';
  show('Pemberitahuan', `${form}<div class="notice-list">${list}</div>`);
  const f = $('#announcementForm');
  if (f) f.onsubmit = async e => { e.preventDefault(); const btn=f.querySelector('button'), msg=$('#announcementMessage'); btn.disabled=true; btn.textContent='Menerbitkan...'; const {error}=await db.from('announcements').insert({title:f.title.value.trim(),message:f.message.value.trim(),is_pinned:f.is_pinned.checked,is_published:f.is_published.checked,created_by:session.user.id}); btn.disabled=false; btn.textContent='Terbitkan pemberitahuan'; if(error){msg.textContent='Gagal menerbitkan: '+error.message;return;} await loadAnnouncements(); await renderAnnouncements(); };
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


// Forum Warga Dermaga — nama bebas tanpa akun
function forumVisitorKey(){let k=localStorage.getItem('kas_forum_visitor_v1');if(!k){k=(crypto.randomUUID?crypto.randomUUID():`v${Date.now()}${Math.random().toString(36).slice(2)}`);localStorage.setItem('kas_forum_visitor_v1',k);}return k;}
async function compressForumImage(file){if(!file)return null;if(!file.type.startsWith('image/'))throw new Error('Pilih file gambar.');if(file.size>8*1024*1024)throw new Error('Ukuran foto asli maksimal 8 MB.');const img=await new Promise((resolve,reject)=>{const u=URL.createObjectURL(file),i=new Image();i.onload=()=>{URL.revokeObjectURL(u);resolve(i)};i.onerror=()=>{URL.revokeObjectURL(u);reject(new Error('Foto tidak dapat dibaca.'))};i.src=u;});const scale=Math.min(1,1280/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.78));if(!blob)throw new Error('Gagal memproses foto.');if(blob.size>1024*1024)throw new Error('Foto masih lebih dari 1 MB. Pilih foto lain.');return new File([blob],`forum-${Date.now()}.jpg`,{type:'image/jpeg'});}
async function uploadForumImage(file){if(!file)return null;const compressed=await compressForumImage(file);const path=`forum/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;const {error}=await db.storage.from('community-media').upload(path,compressed,{contentType:'image/jpeg',upsert:false});if(error)throw error;return db.storage.from('community-media').getPublicUrl(path).data.publicUrl;}
async function renderForum(){
 show('Forum Warga Dermaga','<div class="empty">Memuat diskusi warga...</div>');
 const [pr,rr,lr]=await Promise.all([
  db.from('forum_posts').select('*').order('created_at',{ascending:false}).limit(40),
  db.from('forum_replies').select('*').order('created_at',{ascending:true}).limit(200),
  db.from('forum_likes').select('post_id,visitor_key')
 ]);
 if(pr.error||rr.error||lr.error){show('Forum Warga Dermaga',`<div class="empty">Gagal memuat forum: ${esc((pr.error||rr.error||lr.error).message)}</div>`);return;}
 const posts=pr.data||[], replies=rr.data||[], likes=lr.data||[], key=forumVisitorKey();
 const replyHtml=(r)=>`<div class="forum-reply"><div class="forum-avatar">${esc((r.display_name||'W').trim().charAt(0).toUpperCase())}</div><div class="forum-reply-main"><b>${esc(r.display_name)}</b><small>${new Date(r.created_at).toLocaleString('id-ID')}</small><p>${esc(r.content)}</p>${r.image_url?`<img class="forum-photo reply-photo" src="${esc(r.image_url)}" alt="Foto balasan" loading="lazy">`:''}${isAdmin?`<button class="edit-link danger-link" data-forum-delete-reply="${r.id}">Hapus</button>`:''}</div></div>`;
 const cards=posts.map(post=>{const rs=replies.filter(r=>r.post_id===post.id),count=likes.filter(l=>l.post_id===post.id).length,liked=likes.some(l=>l.post_id===post.id&&l.visitor_key===key);return `<article class="forum-post"><div class="forum-post-head"><div class="forum-avatar">${esc((post.display_name||'W').trim().charAt(0).toUpperCase())}</div><div class="forum-author"><b>${esc(post.display_name)}</b><small>${new Date(post.created_at).toLocaleString('id-ID')}</small></div>${isAdmin?`<button class="edit-link danger-link" data-forum-delete-post="${post.id}">Hapus</button>`:`<button class="edit-link" data-forum-report="${post.id}">Laporkan</button>`}</div>${post.content?`<p class="forum-content">${esc(post.content)}</p>`:''}${post.image_url?`<img class="forum-photo" src="${esc(post.image_url)}" alt="Foto kiriman warga" loading="lazy">`:''}<div class="forum-actions"><button class="forum-action ${liked?'liked':''}" data-forum-like="${post.id}">👍 Suka (${count})</button><span>💬 ${rs.length} balasan</span></div><div class="forum-replies">${rs.map(replyHtml).join('')}</div><form class="forum-reply-form" data-forum-reply-form="${post.id}"><input name="name" maxlength="40" minlength="2" required placeholder="Nama Anda"><input name="content" maxlength="1000" required placeholder="Tulis balasan..."><button class="forum-send">Balas</button></form></article>`;}).join('')||'<div class="empty">Belum ada diskusi. Jadilah warga pertama yang berbagi informasi.</div>';
 show('Forum Warga Dermaga',`<p class="muted">Ruang diskusi warga Parit Haji Yakub. Tidak perlu membuat akun. Gunakan nama yang sopan.</p><form id="forumPostForm" class="forum-compose"><label>Nama Anda<input name="name" minlength="2" maxlength="40" required placeholder="Masukkan nama"></label><label>Pesan warga<textarea name="content" maxlength="2000" rows="3" placeholder="Tulis informasi, saran, atau pertanyaan..."></textarea></label><label>Foto (opsional, otomatis diperkecil)<input name="image" type="file" accept="image/*"></label><small class="form-note">Maksimal 1 MB setelah diperkecil. Jangan unggah data pribadi.</small><button class="submit-button">Terbitkan postingan</button><p class="form-note" id="forumPostMessage"></p></form><div class="forum-feed">${cards}</div>`);
 const form=$('#forumPostForm');form.onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('button'),msg=$('#forumPostMessage'),name=f.name.value.trim(),content=f.content.value.trim(),file=f.image.files[0];if(!content&&!file){msg.textContent='Isi pesan atau pilih foto terlebih dahulu.';return;}const last=Number(sessionStorage.getItem('kas_forum_last_post')||0);if(Date.now()-last<30000){msg.textContent='Tunggu 30 detik sebelum mengirim postingan berikutnya.';return;}b.disabled=true;msg.textContent='Mengirim...';try{const image_url=await uploadForumImage(file);const {error}=await db.from('forum_posts').insert({display_name:name,content,image_url});if(error)throw error;sessionStorage.setItem('kas_forum_last_post',String(Date.now()));await renderForum();}catch(err){msg.textContent='Gagal mengirim: '+err.message;b.disabled=false;}};
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

async function renderPurchases(){
 const {data,error}=await db.from('purchases').select('*').order('purchase_date',{ascending:false}).order('created_at',{ascending:false});
 if(error){show('Daftar Pembelian',`<p class="form-note">Gagal memuat daftar pembelian: ${esc(error.message)}</p>`);return;}
 const rows=data||[];
 const sum=rows.reduce((n,r)=>n+Number(r.total_amount||Number(r.quantity)*Number(r.unit_price)),0);
 const form=isAdmin?`<form id="purchaseForm" class="inline-admin-form">
 <h3 id="purchaseFormTitle">Tambah pembelian</h3>
 <label>Nama barang<input name="item_name" maxlength="160" required placeholder="Contoh: Paku, cat, kayu"></label>
 <div class="form-grid-two"><label>Jumlah<input name="quantity" type="number" min="0.01" step="0.01" required value="1"></label><label>Satuan<input name="unit" maxlength="30" placeholder="buah, kg, meter"></label></div>
 <label>Harga satuan (Rp)<input name="unit_price" type="number" min="0" step="1" required value="0"></label>
 <label>Tanggal pembelian<input name="purchase_date" type="date" required value="${today()}"></label>
 <label>Toko / pemasok<input name="vendor" maxlength="160" placeholder="Nama toko"></label>
 <label>Keterangan<textarea name="notes" rows="2" maxlength="1000" placeholder="Tujuan atau keterangan pembelian"></textarea></label>
 <label>Foto nota (opsional)<input name="receipt" type="file" accept="image/*"></label>
 <button class="submit-button">Simpan pembelian</button><button type="button" class="edit-link" id="purchaseCancel" hidden>Batal edit</button><p class="form-note" id="purchaseMessage"></p>
 </form>`:'<p class="muted">Daftar pembelian perlengkapan dan kebutuhan tambangan.</p>';
 const list=rows.length?rows.map(r=>`<article class="purchase-row"><div class="purchase-info"><b>${esc(r.item_name)}</b><small>${fmtDate(r.purchase_date)}${r.vendor?' · '+esc(r.vendor):''}</small><small>${esc(r.quantity)} ${esc(r.unit||'')}${r.notes?' · '+esc(r.notes):''}</small>${r.receipt_url?`<a href="${esc(r.receipt_url)}" target="_blank" rel="noopener">Lihat nota</a>`:''}</div><div class="purchase-side"><strong>${money(r.total_amount||Number(r.quantity)*Number(r.unit_price))}</strong><small>${money(r.unit_price)} / satuan</small>${isAdmin?`<button class="edit-link" data-purchase-edit="${esc(r.id)}">Edit</button> <button class="edit-link danger-link" data-purchase-delete="${esc(r.id)}">Hapus</button>`:''}</div></article>`).join(''):'<div class="empty">Belum ada daftar pembelian.</div>';
 show('Daftar Pembelian',`<div class="balance-card"><div class="balance-head"><span>Total pembelian tercatat</span><span>${rows.length} ITEM</span></div><div class="balance">${money(sum)}</div></div>${form}<h3>Riwayat Pembelian</h3><div class="purchase-list">${list}</div>`);
 const f=$('#purchaseForm'); if(!f)return;
 let editingId=null, oldReceipt=null;
 const cancel=()=>{editingId=null;oldReceipt=null;f.reset();f.purchase_date.value=today();$('#purchaseFormTitle').textContent='Tambah pembelian';f.querySelector('button[type=submit],button:not([type])').textContent='Simpan pembelian';$('#purchaseCancel').hidden=true;};
 $('#purchaseCancel').onclick=cancel;
 f.onsubmit=async e=>{
  e.preventDefault();const b=f.querySelector('.submit-button'),msg=$('#purchaseMessage');b.disabled=true;msg.textContent='Menyimpan...';
  const qty=Number(f.quantity.value),price=Number(f.unit_price.value);let receipt_url=oldReceipt?.url||null,storage_path=oldReceipt?.path||null;
  const file=f.receipt.files[0];
  if(file){const path=`purchases/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;const up=await db.storage.from('community-media').upload(path,file,{upsert:false});if(up.error){msg.textContent='Gagal mengunggah nota: '+up.error.message;b.disabled=false;return;}storage_path=path;receipt_url=db.storage.from('community-media').getPublicUrl(path).data.publicUrl;}
  const payload={item_name:f.item_name.value.trim(),quantity:qty,unit:f.unit.value.trim()||null,unit_price:price,total_amount:qty*price,purchase_date:f.purchase_date.value,vendor:f.vendor.value.trim()||null,notes:f.notes.value.trim()||null,receipt_url,storage_path};
  let result;
  if(editingId) result=await db.from('purchases').update(payload).eq('id',editingId);
  else result=await db.from('purchases').insert({...payload,created_by:session?.user?.id||null});
  b.disabled=false;
  if(result.error){msg.textContent='Gagal menyimpan: '+result.error.message;return;}
  await renderPurchases();
 };
 document.querySelectorAll('[data-purchase-edit]').forEach(btn=>btn.onclick=()=>{const r=rows.find(x=>x.id===btn.dataset.purchaseEdit);if(!r)return;editingId=r.id;oldReceipt={url:r.receipt_url,path:r.storage_path};f.item_name.value=r.item_name;f.quantity.value=r.quantity;f.unit.value=r.unit||'';f.unit_price.value=r.unit_price;f.purchase_date.value=r.purchase_date;f.vendor.value=r.vendor||'';f.notes.value=r.notes||'';$('#purchaseFormTitle').textContent='Edit pembelian';f.querySelector('.submit-button').textContent='Simpan perubahan';$('#purchaseCancel').hidden=false;f.scrollIntoView({behavior:'smooth',block:'start'});});
}

function openGalleryPhoto(src,title){
  const old=document.getElementById('galleryLightbox'); if(old) old.remove();
  const layer=document.createElement('div'); layer.id='galleryLightbox'; layer.className='gallery-lightbox';
  layer.innerHTML=`<div class="gallery-lightbox-top"><strong>${esc(title||'Foto Galeri')}</strong><button type="button" class="gallery-lightbox-close" aria-label="Tutup">×</button></div><div class="gallery-lightbox-stage"><img class="gallery-lightbox-image" src="${esc(src)}" alt="${esc(title||'Foto galeri')}"></div><div class="gallery-lightbox-controls"><button type="button" data-zoom="out" aria-label="Perkecil">−</button><button type="button" data-zoom="reset">100%</button><button type="button" data-zoom="in" aria-label="Perbesar">＋</button><button type="button" class="gallery-download">⬇ Unduh</button></div>`;
  document.body.appendChild(layer);
  const img=layer.querySelector('img'), reset=layer.querySelector('[data-zoom="reset"]'); let scale=1;
  const apply=()=>{img.style.transform=`scale(${scale})`;reset.textContent=Math.round(scale*100)+'%';};
  layer.querySelector('[data-zoom="in"]').onclick=()=>{scale=Math.min(4,scale+0.25);apply();};
  layer.querySelector('[data-zoom="out"]').onclick=()=>{scale=Math.max(0.5,scale-0.25);apply();};
  reset.onclick=()=>{scale=1;apply();};
  layer.querySelector('.gallery-lightbox-close').onclick=()=>layer.remove();
  layer.addEventListener('click',e=>{if(e.target===layer)layer.remove();});
  layer.querySelector('.gallery-download').onclick=async e=>{
    const btn=e.currentTarget, oldText=btn.textContent; btn.disabled=true; btn.textContent='Mengunduh...';
    try { const response=await fetch(src); if(!response.ok) throw new Error('Unduhan tidak berhasil'); const blob=await response.blob(); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=(title||'foto-galeri').replace(/[^a-z0-9_-]/gi,'_')+'.jpg'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1500); }
    catch(err){window.open(src,'_blank','noopener'); alert('Foto dibuka di tab baru. Jika belum tersimpan, pilih Simpan gambar.');}
    finally{btn.disabled=false;btn.textContent=oldText;}
  };
  const onKey=e=>{if(e.key==='Escape'){layer.remove();document.removeEventListener('keydown',onKey);}};
  document.addEventListener('keydown',onKey);
}
async function renderGallery(){const r=await loadMedia('gallery');galleryItems=r.data;const form=isAdmin?`<form id="galleryForm" class="inline-admin-form"><h3>Tambah foto galeri</h3><label>Judul foto<input name="title" maxlength="120" required></label><label>Keterangan<input name="description" maxlength="500"></label><label>Pilih foto<input name="image" type="file" accept="image/*" required></label><button class="submit-button">Unggah foto</button><p class="form-note" id="galleryMessage"></p></form>`:'';const list=galleryItems.filter(g=>g.is_published||isAdmin).map(g=>`<article class="gallery-card"><img src="${esc(g.image_url)}" alt="${esc(g.title)}" data-gallery-open data-gallery-src="${esc(g.image_url)}" data-gallery-title="${esc(g.title)}" role="button" tabindex="0" title="Klik untuk melihat foto besar"><div><b>${esc(g.title)}</b><p>${esc(g.description||'')}</p>${isAdmin?`<button class="edit-link danger-link" data-gallery-delete="${esc(g.id)}">Hapus</button>`:''}</div></article>`).join('')||'<div class="empty">Belum ada foto di galeri.</div>';show('Galeri Foto',`${form}<div class="gallery-grid">${list}</div>`);const f=$('#galleryForm');if(f)f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button'),msg=$('#galleryMessage'),file=f.image.files[0];if(!file)return;b.disabled=true;const path=`gallery/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;const up=await db.storage.from('community-media').upload(path,file,{upsert:false});if(up.error){msg.textContent='Gagal mengunggah foto: '+up.error.message;b.disabled=false;return;}const image_url=db.storage.from('community-media').getPublicUrl(path).data.publicUrl;const {error}=await db.from('gallery').insert({title:f.title.value.trim(),description:f.description.value.trim()||null,image_url,storage_path:path,is_published:true,created_by:session.user.id});b.disabled=false;if(error){msg.textContent='Foto terunggah, tetapi gagal menyimpan data: '+error.message;return;}renderGallery();};}


// INFAK & WAKAF MASJID BAITURRAHMAN
async function renderMosqueFunds() {
  const [d, h, q] = await Promise.all([
    db.from('mosque_donations').select('*').order('donation_date', { ascending: false }).order('created_at', { ascending: false }),
    db.from('mosque_handover').select('*').order('handover_date', { ascending: false }).order('created_at', { ascending: false }),
    db.from('mosque_qris_settings').select('qris_image_url').eq('id', 1).maybeSingle()
  ]);
  if (d.error || h.error || q.error) {
    const err = d.error || h.error || q.error;
    show('Infak & Wakaf Masjid', `<p class="form-note">Belum dapat memuat data: ${esc(err.message)}. Pastikan SQL tambahan pengaturan QRIS sudah dijalankan.</p>`);
    return;
  }
  const donations = d.data || [], handovers = h.data || [];
  const total = donations.reduce((s, r) => s + Number(r.amount || 0), 0);
  const handed = handovers.reduce((s, r) => s + Number(r.amount || 0), 0);
  const remaining = total - handed;
  const qrisUrl = q.data?.qris_image_url || '';
  const qrisAdmin = isAdmin ? `<form id="mosqueQrisForm" class="inline-admin-form"><h3>Pengaturan QRIS</h3><label>Unggah gambar QRIS<input name="qris_image" type="file" accept="image/*"></label><label>Atau alamat gambar QRIS<input name="qris_image_url" type="url" value="${esc(qrisUrl)}" placeholder="Tempel URL gambar QRIS"></label><button class="submit-button">Simpan QRIS</button><p class="form-note" id="mosqueQrisMessage">Admin dapat mengganti QRIS kapan saja dengan mengunggah gambar baru.</p></form>` : '';
  const donationForm = isAdmin ? `<form id="mosqueDonationForm" class="inline-admin-form"><h3>Catat penerimaan</h3><label>Jenis dana<select name="donation_type"><option>Infak</option><option>Wakaf</option></select></label><label>Nominal diterima (Rp)<input name="amount" type="number" min="1" step="1" required></label><label>Tanggal diterima<input name="donation_date" type="date" value="${today()}" required></label><label>Keterangan (opsional)<textarea name="notes" rows="2" maxlength="1000"></textarea></label><button class="submit-button">Simpan penerimaan</button></form>` : '';
  const handoverForm = isAdmin ? `<form id="mosqueHandoverForm" class="inline-admin-form"><h3>Catat penyerahan kepada Ketua Masjid</h3><label>Nominal diserahkan (Rp)<input name="amount" type="number" min="1" max="${Math.max(0, remaining)}" step="1" required></label><label>Tanggal penyerahan<input name="handover_date" type="date" value="${today()}" required></label><label>Nama penerima<input name="recipient" required maxlength="160" value="Ketua Masjid"></label><label>Link foto bukti / tanda terima (opsional)<input name="receipt_url" type="url" placeholder="https://..."></label><label>Keterangan (opsional)<textarea name="notes" rows="2" maxlength="1000"></textarea></label><button class="submit-button" ${remaining <= 0 ? 'disabled' : ''}>Simpan penyerahan</button></form>` : '';
  const donationRows = donations.map(r => `<article class="transaction"><div class="tx-icon in">＋</div><div class="tx-info"><b>${esc(r.donation_type)}</b><small>${fmtDate(r.donation_date)}${r.notes ? ' · '+esc(r.notes) : ''}</small></div><div class="tx-side"><strong class="tx-amount in">${money(r.amount)}</strong></div></article>`).join('') || '<div class="empty">Belum ada penerimaan yang dicatat.</div>';
  const handoverRows = handovers.map(r => `<article class="transaction"><div class="tx-icon out">↗</div><div class="tx-info"><b>Diserahkan kepada ${esc(r.recipient)}</b><small>${fmtDate(r.handover_date)}${r.notes ? ' · '+esc(r.notes) : ''}${r.receipt_url ? ` · <a href="${esc(r.receipt_url)}" target="_blank" rel="noopener">Lihat bukti</a>` : ''}</small></div><div class="tx-side"><strong class="tx-amount out">${money(r.amount)}</strong></div></article>`).join('') || '<div class="empty">Belum ada penyerahan yang dicatat.</div>';
  show('Infak & Wakaf Masjid', `
    <div class="mosque-fund-hero"><div class="eyebrow">MASJID BAITURRAHMAN</div><h3>Infak & Wakaf</h3><p>Salurkan kebaikan untuk kemakmuran masjid.</p>${qrisUrl ? `<a href="${esc(qrisUrl)}" target="_blank" rel="noopener"><img class="mosque-qris-image" src="${esc(qrisUrl)}" alt="QRIS Masjid Baiturrahman"></a><small>Pindai QRIS untuk melakukan pembayaran</small>` : '<div class="empty">QRIS belum dipasang oleh admin.</div>'}</div>
    <div class="mosque-fund-stats"><div><small>Total penerimaan</small><b>${money(total)}</b></div><div><small>Sudah diserahkan</small><b>${money(handed)}</b></div><div><small>Sisa belum diserahkan</small><b>${money(remaining)}</b></div></div>
    ${qrisAdmin}${donationForm}${handoverForm}
    <h3>Riwayat penerimaan</h3><div class="transaction-list">${donationRows}</div>
    <h3>Riwayat penyerahan</h3><div class="transaction-list">${handoverRows}</div>
    <p class="form-note">Pembayaran QRIS tidak terbaca otomatis oleh website. Admin mencatat penerimaan setelah memeriksa transaksi, lalu mencatat penyerahan setelah dana diterima Ketua Masjid.</p>
  `);
  const qf = $('#mosqueQrisForm');
  if (qf) qf.onsubmit = async e => {
    e.preventDefault(); const btn=qf.querySelector('button'); btn.disabled=true;
    let url=qf.qris_image_url.value.trim();
    const file=qf.qris_image.files && qf.qris_image.files[0];
    if(file){
      const path=`mosque/qris-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
      const upload=await db.storage.from('community-media').upload(path,file,{upsert:true});
      if(upload.error){btn.disabled=false;$('#mosqueQrisMessage').textContent='Gagal mengunggah QRIS: '+upload.error.message;return;}
      url=db.storage.from('community-media').getPublicUrl(path).data.publicUrl;
    }
    const {error}=await db.from('mosque_qris_settings').upsert({id:1,qris_image_url:url || null,updated_at:new Date().toISOString()},{onConflict:'id'});
    btn.disabled=false;
    if(error){$('#mosqueQrisMessage').textContent='Gagal menyimpan QRIS: '+error.message;return;}
    renderMosqueFunds();
  };
  const df = $('#mosqueDonationForm');
  if (df) df.onsubmit = async e => {
    e.preventDefault(); const f=df, btn=f.querySelector('button'); btn.disabled=true;
    const {error}=await db.from('mosque_donations').insert({donation_type:f.donation_type.value,amount:Number(f.amount.value),donation_date:f.donation_date.value,notes:f.notes.value.trim()||null});
    btn.disabled=false; if(error){alert('Gagal menyimpan penerimaan: '+error.message);return;} renderMosqueFunds();
  };
  const hf = $('#mosqueHandoverForm');
  if (hf) hf.onsubmit = async e => {
    e.preventDefault(); const f=hf, btn=f.querySelector('button'); btn.disabled=true;
    const {error}=await db.from('mosque_handover').insert({amount:Number(f.amount.value),handover_date:f.handover_date.value,recipient:f.recipient.value.trim(),receipt_url:f.receipt_url.value.trim()||null,notes:f.notes.value.trim()||null});
    btn.disabled=false; if(error){alert('Gagal menyimpan penyerahan: '+error.message);return;} renderMosqueFunds();
  };
}

document.addEventListener('keydown',e=>{const photo=e.target.closest&&e.target.closest('[data-gallery-open]');if(photo&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openGalleryPhoto(photo.dataset.gallerySrc,photo.dataset.galleryTitle);}});
document.querySelectorAll('[data-community]').forEach(b => b.addEventListener('click', async () => {
  const key = b.dataset.community;
  if (key === 'announcements') return renderAnnouncements();
  if (key === 'insurance') return renderInsurance();
  if (key === 'gallery') return renderGallery();
  if (key === 'sponsors') return renderSponsors();
  if (key === 'purchases') return renderPurchases();
  if (key === 'mosque') return renderMosqueFunds();
  if (key === 'forum') return renderForum();
  if (key === 'policy') return renderPolicy();
  if (key === 'participants' || key === 'schedule') {
    await loadCommunityData();
    return key === 'participants' ? renderParticipants() : renderSchedule();
  }
  console.warn('Menu KAS DERMAGA tidak dikenal:', key);
}));
$('#allMenusBtn').onclick = () => { const grid=$('#shortcutGrid'); const expanded=grid.classList.toggle('expanded'); $('#allMenusBtn').textContent=expanded?'×':'⋮'; $('#allMenusBtn').setAttribute('aria-expanded',String(expanded)); };
$('#simpleBody').addEventListener('click', async e => {
  const photo = e.target.closest('[data-gallery-open]'); if(photo){openGalleryPhoto(photo.dataset.gallerySrc,photo.dataset.galleryTitle);return;}
  const like=e.target.closest('[data-forum-like]'), delPost=e.target.closest('[data-forum-delete-post]'), delReply=e.target.closest('[data-forum-delete-reply]'), report=e.target.closest('[data-forum-report]');
  if(like){const postId=Number(like.dataset.forumLike),visitor_key=forumVisitorKey();const {data:existing}=await db.from('forum_likes').select('id').eq('post_id',postId).eq('visitor_key',visitor_key).maybeSingle();if(!existing){const {error}=await db.from('forum_likes').insert({post_id:postId,visitor_key});if(error&&error.code!=='23505')alert('Gagal memberi suka: '+error.message);}renderForum();return;}
  if(delPost&&isAdmin&&confirm('Hapus postingan ini beserta balasannya?')){const {error}=await db.from('forum_posts').delete().eq('id',delPost.dataset.forumDeletePost);if(error)alert(error.message);else renderForum();return;}
  if(delReply&&isAdmin&&confirm('Hapus balasan ini?')){const {error}=await db.from('forum_replies').delete().eq('id',delReply.dataset.forumDeleteReply);if(error)alert(error.message);else renderForum();return;}
  if(report){const reason=prompt('Alasan melaporkan postingan ini:');if(reason&&reason.trim().length>=3){const {error}=await db.from('forum_reports').insert({post_id:Number(report.dataset.forumReport),reason:reason.trim().slice(0,500)});alert(error?'Laporan gagal dikirim: '+error.message:'Laporan sudah dikirim ke admin.');}return;}
  const replyForm=e.target.closest('[data-forum-reply-form]');if(replyForm){return;}

  const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-delete]'), approve = e.target.closest('[data-approve]'), hide = e.target.closest('[data-hide]'), pd = e.target.closest('[data-participant-delete]'), sd = e.target.closest('[data-schedule-delete]'), nd = e.target.closest('[data-notice-delete]'), ne = e.target.closest('[data-notice-edit]'), gd=e.target.closest('[data-gallery-delete]'), spd=e.target.closest('[data-sponsor-delete]'), pdel=e.target.closest('[data-purchase-delete]');
  const pinnedEdit = e.target.closest('[data-pinned-edit]');
  if (pinnedEdit && isAdmin) {
    const a = announcements.find(x => String(x.id) === String(pinnedEdit.dataset.pinnedEdit));
    if (a) {
      show('Edit Pesan Penting Admin', `<form id="editPinnedAnnouncementForm"><label>Judul<input name="title" required maxlength="120" value="${esc(a.title)}"></label><label>Isi pesan<textarea name="message" rows="5" required maxlength="5000">${esc(a.message)}</textarea></label><label class="check-label"><input type="checkbox" name="is_pinned" ${a.is_pinned?'checked':''}> Sematkan pesan ini</label><button class="submit-button">Simpan perubahan</button></form>`);
      $('#editPinnedAnnouncementForm').onsubmit = async ev => {
        ev.preventDefault();
        const f = ev.currentTarget;
        const { error } = await db.from('announcements').update({title:f.title.value.trim(), message:f.message.value.trim(), is_pinned:f.is_pinned.checked}).eq('id',a.id);
        if (error) alert('Gagal menyimpan: '+error.message);
        else { await loadAnnouncements(); show('Berhasil','Pesan penting admin berhasil diperbarui.'); }
      };
    }
  }
  if (ed) { $('#simpleDialog').close(); openTx('Pemasukan', ed.dataset.edit); }
  if (del && isAdmin && confirm('Hapus transaksi ini?')) { const { error } = await db.from('transactions').delete().eq('id', del.dataset.delete); if (error) alert('Gagal menghapus: ' + error.message); else { await loadTransactions(); showTab('history'); } }
  if (approve && isAdmin) { const { error } = await db.from('comments').update({ status: 'approved' }).eq('id', approve.dataset.approve); if (error) alert(error.message); else renderComments(); }
  if (hide && isAdmin) { const { error } = await db.from('comments').update({ status: 'hidden' }).eq('id', hide.dataset.hide); if (error) alert(error.message); else renderComments(); }
  if (pd && isAdmin && confirm('Hapus peserta ini? Jadwal terkait mungkin perlu diperiksa.')) { const {error}=await db.from('participants').delete().eq('id',pd.dataset.participantDelete); if(error) alert('Gagal menghapus peserta: '+error.message); else { await loadCommunityData(); renderParticipants(); } }
  if (sd && isAdmin && confirm('Hapus jadwal giliran ini?')) { const {error}=await db.from('duty_schedule').delete().eq('id',sd.dataset.scheduleDelete); if(error) alert('Gagal menghapus jadwal: '+error.message); else { await loadCommunityData(); renderSchedule(); } }
  if (nd && isAdmin && confirm('Hapus pemberitahuan ini?')) { const {error}=await db.from('announcements').delete().eq('id',nd.dataset.noticeDelete); if(error) alert(error.message); else renderAnnouncements(); }
  if (gd && isAdmin && confirm('Hapus foto ini?')) { const {error}=await db.from('gallery').delete().eq('id',gd.dataset.galleryDelete); if(error)alert(error.message); else renderGallery(); }
  if (pdel && isAdmin && confirm('Hapus catatan pembelian ini?')) { const {error}=await db.from('purchases').delete().eq('id',pdel.dataset.purchaseDelete); if(error)alert('Gagal menghapus: '+error.message); else renderPurchases(); }
  if (spd && isAdmin && confirm('Hapus iklan ini?')) { const {error}=await db.from('sponsors').delete().eq('id',spd.dataset.sponsorDelete); if(error)alert(error.message); else renderSponsors(); }
  if (ne && isAdmin) { const a=announcements.find(x=>x.id===ne.dataset.noticeEdit); if(!a) return; show('Edit Pemberitahuan', `<form id="editAnnouncementForm"><label>Judul<input name="title" required maxlength="120" value="${esc(a.title)}"></label><label>Isi<textarea name="message" rows="5" required maxlength="5000">${esc(a.message)}</textarea></label><label class="check-label"><input type="checkbox" name="is_pinned" ${a.is_pinned?'checked':''}> Sematkan sebagai informasi penting</label><button class="submit-button">Simpan perubahan</button></form>`); $('#editAnnouncementForm').onsubmit=async ev=>{ev.preventDefault();const f=ev.currentTarget;const {error}=await db.from('announcements').update({title:f.title.value.trim(),message:f.message.value.trim(),is_pinned:f.is_pinned.checked}).eq('id',a.id);if(error)alert(error.message);else renderAnnouncements();}; } 
});
$('#simpleBody').addEventListener('submit',async e=>{const f=e.target.closest('[data-forum-reply-form]');if(!f)return;e.preventDefault();const b=f.querySelector('button');b.disabled=true;const {error}=await db.from('forum_replies').insert({post_id:Number(f.dataset.forumReplyForm),display_name:f.name.value.trim(),content:f.content.value.trim()});if(error){alert('Balasan gagal dikirim: '+error.message);b.disabled=false;}else renderForum();});
$('#closeSimple').onclick = () => $('#simpleDialog').close();
$('#profileBtn').onclick = async () => { if (!isAdmin) return showLogin(); show('Akun Admin', `<p>Login sebagai <b>${esc(session.user.email)}</b></p><button class="submit-button" id="logoutBtn">Keluar</button>`); $('#logoutBtn').onclick = async () => { await db.auth.signOut(); await refreshSession(); $('#simpleDialog').close(); setStatus('Anda telah keluar'); }; };
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
function exportCsv() { const rows = [['Tanggal', 'Jenis', 'Kategori', 'Keterangan', 'Nominal'], ...transactions.map(t => [t.date, t.type, t.category, t.note, t.amount])]; const csv = rows.map(r => r.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })); a.download = 'laporan-kas-dermaga.csv'; a.click(); URL.revokeObjectURL(a.href); }
$('#todayLabel').textContent = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

// Penghitung pengunjung unik per browser/perangkat
async function updateVisitorCounter() {
  const display = document.getElementById('visitorCount');
  if (!display) return;
  try {
    const storageKey = 'kas_dermaga_visitor_key_v1';
    let visitorKey = localStorage.getItem(storageKey);
    if (!visitorKey) {
      visitorKey = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem(storageKey, visitorKey);
    }
    const { error: insertError } = await db
      .from('website_visitors')
      .upsert({ visitor_key: visitorKey }, { onConflict: 'visitor_key', ignoreDuplicates: true });
    if (insertError) throw insertError;
    const { count, error: countError } = await db
      .from('website_visitors')
      .select('id', { count: 'exact', head: true });
    if (countError) throw countError;
    display.textContent = Number(count || 0).toLocaleString('id-ID') + ' orang';
  } catch (error) {
    console.error('Penghitung pengunjung:', error);
    display.textContent = 'Belum tersedia';
  }
}

(async function init() {
  try { await updateVisitorCounter(); await refreshSession(); await loadTransactions(); await loadComments(); await loadAnnouncements(); db.auth.onAuthStateChange(() => { setTimeout(async () => { await refreshSession(); }, 0); }); }
  catch (err) { console.error('Koneksi awal KAS DERMAGA:', err); setStatus('Koneksi gagal: ' + (err?.message || String(err)).slice(0, 90), false); }
})();
