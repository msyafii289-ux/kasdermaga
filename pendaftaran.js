/* Modul pendaftaran tambangan. Terpisah dari alur transaksi kas yang sudah ada. */
async function getRegistrationSettings() {
  const { data, error } = await db.from('registration_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  return data;
}
function registrationStatusLabel(status) {
  return ({ menunggu_verifikasi: 'Menunggu verifikasi', lunas: 'Lunas', ditolak: 'Ditolak', belum_bayar: 'Belum bayar' })[status] || status;
}
function registrationAdminSettingsHtml(settings) {
  const qrUrl = settings?.qris_image_path
    ? db.storage.from('registration-qris').getPublicUrl(settings.qris_image_path).data.publicUrl
    : '';
  return `<section class="registration-card"><h3>Pengaturan Pembayaran Admin</h3>
    <form id="registrationSettingsForm">
      <label>Nominal pembayaran (Rp)<input name="payment_amount" type="number" min="0" step="1000" required value="${esc(settings?.payment_amount ?? 0)}"></label>
      <label>Keterangan pembayaran<textarea name="payment_description" rows="2">${esc(settings?.payment_description || '')}</textarea></label>
      <label>Tujuan pembayaran<input name="payment_destination" maxlength="200" value="${esc(settings?.payment_destination || '')}" placeholder="Contoh: QRIS Kas Tambangan"></label>
      <label>Ganti gambar QRIS<input name="qris_file" type="file" accept="image/png,image/jpeg,image/webp"></label>
      ${qrUrl ? `<img class="registration-qr" src="${esc(qrUrl)}" alt="QRIS pembayaran saat ini">` : '<p class="registration-note">Belum ada gambar QRIS yang diunggah.</p>'}
      <div class="registration-toggle"><label class="check-label"><input type="checkbox" name="is_active" ${settings?.is_active !== false ? 'checked' : ''}> <b>Buka pendaftaran untuk warga</b></label><p class="registration-note">Jika centang dihilangkan, pendaftaran langsung ditutup. Warga tidak dapat mengirim formulir baru. Anda bisa membukanya kembali kapan saja dari menu ini.</p></div>
      <button class="submit-button" type="submit">Simpan Pengaturan</button><p class="form-note" id="registrationSettingsMessage"></p>
    </form></section>`;
}
async function renderRegistrationMenu() {
  try {
    const settings = await getRegistrationSettings();
    const amount = Number(settings?.payment_amount || 0);
    const qrUrl = settings?.qris_image_path ? db.storage.from('registration-qris').getPublicUrl(settings.qris_image_path).data.publicUrl : '';
    const publicHtml = `<section class="registration-card"><h3>Informasi Pembayaran</h3>
      ${settings?.is_active === false ? '<p class="registration-note">Pendaftaran sementara ditutup oleh admin.</p>' : `<p>Nominal pembayaran: <b>${money(amount)}</b></p>`}
      ${settings?.payment_description ? `<p>${esc(settings.payment_description)}</p>` : ''}
      ${settings?.payment_destination ? `<p>Tujuan: <b>${esc(settings.payment_destination)}</b></p>` : ''}
      ${qrUrl ? `<img class="registration-qr" src="${esc(qrUrl)}" alt="QRIS pembayaran tambangan">` : '<p class="registration-note">QRIS belum dipasang admin.</p>'}
    </section>
    ${settings?.is_active === false ? '' : `<section class="registration-card"><h3>Formulir Pendaftaran</h3>
      <form id="tambanganRegistrationForm">
        <label>Nama lengkap<input name="full_name" required minlength="2" maxlength="120" autocomplete="name"></label>
        <label>Alamat / RT<input name="address_rt" required maxlength="200" placeholder="Contoh: RT 02 Parit Haji Yakub"></label>
        <label>Nomor WhatsApp<input name="whatsapp" required maxlength="25" inputmode="tel" placeholder="08xxxxxxxxxx"></label>
        <label>Keterangan tambahan (opsional)<textarea name="notes" rows="3" maxlength="1000"></textarea></label>
        <label>Upload bukti pembayaran<input name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></label>
        <p class="registration-note">Format JPG, PNG, WEBP, atau PDF. Maksimal 5 MB.</p>
        <button class="submit-button" type="submit">Kirim Pendaftaran</button><p class="form-note" id="registrationSubmitMessage"></p>
      </form></section>`}`;
    const adminHtml = isAdmin ? registrationAdminSettingsHtml(settings) + `<section class="registration-card"><h3>Daftar Pendaftar</h3><div id="registrationAdminList">Memuat data pendaftar...</div></section>` : '';
    show('Pendaftaran Tambangan', `<div class="registration-wrap">${publicHtml}${adminHtml}</div>`);
    const form = document.getElementById('tambanganRegistrationForm');
    if (form) form.onsubmit = submitTambanganRegistration;
    const settingsForm = document.getElementById('registrationSettingsForm');
    if (settingsForm) settingsForm.onsubmit = saveRegistrationSettings;
    if (isAdmin) loadRegistrationAdminList();
  } catch (error) {
    show('Pendaftaran Tambangan', `<div class="registration-card"><p>Belum dapat memuat pengaturan pendaftaran dari database.</p><p class="registration-note">${esc(error.message || error)}</p><p>Pastikan SQL pendaftaran sudah berhasil dijalankan.</p></div>`);
  }
}
async function submitTambanganRegistration(event) {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector('button'), msg = document.getElementById('registrationSubmitMessage');
  const file = form.proof.files[0];
  if (!file) { msg.textContent = 'Pilih bukti pembayaran terlebih dahulu.'; return; }
  const allowed = ['image/jpeg','image/png','image/webp','application/pdf'];
  if (!allowed.includes(file.type) || file.size > 5 * 1024 * 1024) { msg.textContent = 'Format file tidak sesuai atau ukuran melebihi 5 MB.'; return; }
  button.disabled = true; msg.textContent = 'Mengirim pendaftaran...';
  let uploadedPath = null;
  try {
    const settings = await getRegistrationSettings();
    if (!settings || settings.is_active === false) throw new Error('Pendaftaran sedang ditutup oleh admin. Silakan coba lagi nanti.');
    const ext = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'') || 'bin';
    const registrationId = crypto.randomUUID();
    uploadedPath = `${registrationId}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await db.storage.from('registration-proofs').upload(uploadedPath, file, { upsert: false, contentType: file.type });
    if (uploadError) throw uploadError;
    const { error: insertError } = await db.from('tambangan_registrations').insert({
      id: registrationId,
      full_name: form.full_name.value.trim(),
      address_rt: form.address_rt.value.trim(),
      whatsapp: form.whatsapp.value.trim(),
      notes: form.notes.value.trim() || null,
      payment_amount: Number(settings.payment_amount || 0),
      proof_path: uploadedPath,
      payment_status: 'menunggu_verifikasi'
    });
    if (insertError) throw insertError;
    msg.textContent = 'Pendaftaran berhasil dikirim. Simpan informasi ini: ID pendaftaran ' + registrationId;
    form.reset();
  } catch (error) {
    if (uploadedPath) await db.storage.from('registration-proofs').remove([uploadedPath]);
    msg.textContent = 'Pendaftaran gagal: ' + (error.message || error);
  } finally { button.disabled = false; }
}
async function saveRegistrationSettings(event) {
  event.preventDefault();
  if (!isAdmin) return;
  const form = event.currentTarget, button = form.querySelector('button'), msg = document.getElementById('registrationSettingsMessage');
  button.disabled = true; msg.textContent = 'Menyimpan pengaturan...';
  try {
    let qrisPath = null;
    const { data: current, error: readError } = await db.from('registration_settings').select('qris_image_path').eq('id',1).maybeSingle();
    if (readError) throw readError;
    qrisPath = current?.qris_image_path || null;
    const file = form.qris_file.files[0];
    if (file) {
      if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5*1024*1024) throw new Error('QRIS harus JPG, PNG, atau WEBP maksimal 5 MB.');
      const ext = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'') || 'png';
      const newPath = `qris/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await db.storage.from('registration-qris').upload(newPath,file,{upsert:false,contentType:file.type});
      if (uploadError) throw uploadError;
      qrisPath = newPath;
    }
    const { error } = await db.from('registration_settings').update({
      payment_amount: Number(form.payment_amount.value),
      payment_description: form.payment_description.value.trim() || null,
      payment_destination: form.payment_destination.value.trim() || null,
      qris_image_path: qrisPath,
      is_active: form.is_active.checked,
      updated_at: new Date().toISOString()
    }).eq('id',1);
    if (error) throw error;
    msg.textContent = 'Pengaturan pembayaran berhasil disimpan.';
    await renderRegistrationMenu();
  } catch (error) { msg.textContent = 'Gagal menyimpan: ' + (error.message || error); }
  finally { button.disabled = false; }
}
async function loadRegistrationAdminList() {
  const target = document.getElementById('registrationAdminList'); if (!target || !isAdmin) return;
  const { data, error } = await db.from('tambangan_registrations').select('*').order('created_at',{ascending:false}).limit(100);
  if (error) { target.textContent = 'Gagal memuat pendaftar: ' + error.message; return; }
  if (!data?.length) { target.innerHTML = '<p class="registration-note">Belum ada pendaftar.</p>'; return; }
  target.innerHTML = data.map(row => `<article class="registration-row"><b>${esc(row.full_name)}</b><span>${esc(row.address_rt)} · ${esc(row.whatsapp)}</span><span>Nominal: ${money(row.payment_amount)} · <span class="registration-status">${esc(registrationStatusLabel(row.payment_status))}</span></span>${row.notes ? `<small>${esc(row.notes)}</small>` : ''}<div class="registration-actions"><button type="button" class="text-button" data-registration-proof="${esc(row.id)}">Lihat bukti</button>${row.payment_status !== 'lunas' ? `<button type="button" class="text-button" data-registration-approve="${esc(row.id)}">Setujui / Lunas</button>` : ''}<button type="button" class="text-button" data-registration-reject="${esc(row.id)}">Tolak</button></div></article>`).join('');
}
document.addEventListener('click', async event => {
  const proof = event.target.closest('[data-registration-proof]');
  if (proof && isAdmin) {
    const { data: row, error } = await db.from('tambangan_registrations').select('proof_path').eq('id',proof.dataset.registrationProof).single();
    if (error || !row?.proof_path) return alert('Bukti tidak ditemukan: ' + (error?.message || 'path kosong'));
    const { data, error: urlError } = await db.storage.from('registration-proofs').createSignedUrl(row.proof_path,300);
    if (urlError) return alert('Tidak dapat membuka bukti: ' + urlError.message);
    window.open(data.signedUrl,'_blank','noopener'); return;
  }
  const approve = event.target.closest('[data-registration-approve]');
  const reject = event.target.closest('[data-registration-reject]');
  const target = approve || reject;
  if (target && isAdmin) {
    const status = approve ? 'lunas' : 'ditolak';
    if (!confirm(approve ? 'Setujui pembayaran ini sebagai LUNAS?' : 'Tolak pendaftaran/pembayaran ini?')) return;
    const { error } = await db.from('tambangan_registrations').update({ payment_status:status, reviewed_at:new Date().toISOString(), reviewed_by:session.user.id }).eq('id',target.dataset[approve ? 'registrationApprove' : 'registrationReject']);
    if (error) alert('Gagal memperbarui status: ' + error.message); else loadRegistrationAdminList();
  }
});
