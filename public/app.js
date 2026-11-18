/* Web app Ayam Geprek Ratna Barokah — pelanggan + dashboard admin (SPA, hash routing) */
const $app = document.getElementById('app');
const state = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  cartCount: 0,
  adminTab: 'pesanan',
};
const LEVELS = { 1: 'Tidak terlalu pedas', 2: 'Pedas', 3: 'Sangat pedas', 4: 'Extra pedas' };
const rp = (n) => 'Rp' + Math.round(n).toLocaleString('id-ID');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tgl = (iso) => new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

function toast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = 'toast'), 2600);
}

async function api(method, url, body) {
  const res = await fetch('/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { logout(false); location.hash = '#/login'; }
  if (!res.ok) throw new Error(data.error || 'Terjadi kesalahan');
  return data;
}
const act = async (fn) => { try { await fn(); } catch (e) { toast(e.message, true); } };

function logout(go = true) {
  state.token = null; state.user = null;
  localStorage.removeItem('token'); localStorage.removeItem('user');
  if (go) location.hash = '#/login';
}

/* ---------- Layout ---------- */
function topbar(title, { back = false, cart = true } = {}) {
  const u = state.user;
  return `<header class="topbar">
    ${back ? `<button class="iconbtn" data-back aria-label="Kembali">←</button>` : `<div class="avatar">${esc((u?.nama || '?')[0].toUpperCase())}</div>`}
    <h1>${esc(title || u?.nama)}</h1>
    ${cart && u?.role === 'pelanggan' ? `<button class="iconbtn" data-go="#/keranjang" aria-label="Keranjang">🛒${state.cartCount ? `<span class="badge">${state.cartCount}</span>` : ''}</button>` : ''}
    <button class="iconbtn" data-menu aria-label="Menu">⋮</button>
  </header>`;
}
function bindCommon(root) {
  root.querySelectorAll('[data-back]').forEach(b => b.onclick = () => history.back());
  root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => (location.hash = b.dataset.go));
  root.querySelectorAll('[data-menu]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    document.querySelector('.menu-pop')?.remove();
    const pop = document.createElement('div'); pop.className = 'menu-pop';
    const items = state.user.role === 'admin'
      ? [['Dashboard', '#/admin']]
      : [['Home', '#/home'], ['Pesanan Saya', '#/pesanan'], ['Profil', '#/profil']];
    pop.innerHTML = items.map(([l, h]) => `<button data-h="${h}">${l}</button>`).join('') + `<button data-out>Logout</button>`;
    pop.onclick = (ev) => {
      const t = ev.target;
      if (t.dataset.h) location.hash = t.dataset.h;
      if ('out' in t.dataset) logout();
      pop.remove();
    };
    $app.appendChild(pop);
  });
}
document.addEventListener('click', () => document.querySelector('.menu-pop')?.remove());

function render(html, { wide = false } = {}) {
  $app.className = 'app' + (wide ? ' wide' : '');
  $app.innerHTML = html;
  bindCommon($app);
}
async function refreshCartCount() {
  if (state.user?.role !== 'pelanggan') return;
  try { state.cartCount = (await api('GET', '/keranjang')).items.reduce((s, i) => s + i.jumlah, 0); } catch (_) { state.cartCount = 0; }
}

/* ---------- Auth pages ---------- */
function loginPage() {
  render(`<div class="hero"><div class="login-card">
    <div class="brand">GEPREK RATNA BAROKAH</div><p class="brand-sub">Pesan ayam geprek favoritmu 🍗🌶️</p>
    <form id="f">
      <label class="field"><span>Username / Email</span><input name="email" type="email" required autocomplete="username"></label>
      <label class="field"><span>Password</span><input name="password" type="password" required autocomplete="current-password"></label>
      <button class="btn">Login</button>
    </form>
    <p class="brand-sub mt">Belum punya akun? <button class="link" data-go="#/register">daftar</button></p>
    <p class="small muted" style="text-align:center">Demo: demo@geprek.com / demo123 · Admin: admin@geprek.com / admin123</p>
  </div></div>`);
  document.getElementById('f').onsubmit = (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    act(async () => {
      const r = await api('POST', '/auth/login', fd);
      state.token = r.token; state.user = r.user;
      localStorage.setItem('token', r.token); localStorage.setItem('user', JSON.stringify(r.user));
      location.hash = r.user.role === 'admin' ? '#/admin' : '#/home';
    });
  };
}
function registerPage() {
  render(`<div class="hero"><div class="login-card">
    <div class="brand">DAFTAR AKUN</div><p class="brand-sub">Isi data untuk mulai memesan</p>
    <form id="f">
      <label class="field"><span>Nama</span><input name="nama" required></label>
      <label class="field"><span>Email</span><input name="email" type="email" required></label>
      <label class="field"><span>Password (min. 6 karakter)</span><input name="password" type="password" minlength="6" required></label>
      <label class="field"><span>No. HP</span><input name="no_hp" inputmode="tel" required></label>
      <label class="field"><span>Alamat</span><textarea name="alamat" rows="2"></textarea></label>
      <button class="btn">Daftar</button>
    </form>
    <p class="brand-sub mt">Sudah punya akun? <button class="link" data-go="#/login">login</button></p>
  </div></div>`);
  document.getElementById('f').onsubmit = (e) => {
    e.preventDefault();
    act(async () => {
      await api('POST', '/auth/register', Object.fromEntries(new FormData(e.target)));
      toast('Akun dibuat, silakan login'); location.hash = '#/login';
    });
  };
}

/* ---------- Pelanggan ---------- */
function productCard(p) {
  return `<div class="card pcard" data-go="#/produk/${p.id_produk}">
    <div class="pimg">${esc(p.emoji)}</div>
    <div class="pinfo"><b>${esc(p.nama_produk)}</b><small>${rp(p.harga)}</small><br>
    ${p.stok > 0 ? '' : '<span class="tag">Stok Habis</span>'}</div></div>`;
}
async function homePage(listAll = false) {
  await refreshCartCount();
  render(topbar() + `<div class="page">
    <input class="search" id="q" type="search" placeholder="🔍 Search menu">
    <div id="list"></div></div>`);
  const list = document.getElementById('list');
  const load = (q) => act(async () => {
    const rows = await api('GET', '/produk' + (q ? `?q=${encodeURIComponent(q)}` : ''));
    const fav = rows.filter(r => r.favorit), lain = rows.filter(r => !r.favorit);
    const showFav = !q && !listAll;
    list.innerHTML = (showFav
      ? `<div class="section-h"><h2>MENU FAVORIT</h2><button class="link" id="more">Lainnya ›</button></div>
         <div class="grid">${fav.map(productCard).join('')}</div>`
      : `<div class="section-h"><h2>${q ? 'HASIL PENCARIAN' : 'DAFTAR MENU'}</h2></div>
         <div class="grid">${(q ? rows : [...fav, ...lain]).map(productCard).join('') || '<p class="empty">Menu tidak ditemukan</p>'}</div>`);
    bindCommon(list);
    const more = document.getElementById('more'); if (more) more.onclick = () => (location.hash = '#/menu');
  });
  let timer; document.getElementById('q').oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => load(e.target.value.trim()), 250); };
  load('');
}

async function detailPage(id) {
  await refreshCartCount();
  let p; try { p = await api('GET', `/produk/${id}`); } catch (e) { toast(e.message, true); return (location.hash = '#/home'); }
  let qty = 1;
  render(topbar('Detail Produk', { back: true }) + `<div class="page">
    <div class="card"><div class="pimg big">${esc(p.emoji)}</div></div>
    <h2 style="margin:14px 0 2px">${esc(p.nama_produk)}</h2>
    <div class="price" style="font-size:20px">${rp(p.harga)}</div>
    <p class="muted">${esc(p.deskripsi)}</p>
    ${p.stok > 0 ? `<span class="tag ok">Stok ${p.stok}</span>` : `<span class="tag">Stok Habis</span>`}
    ${p.punya_level ? `<h3>Level</h3><div class="levels">${[1, 2, 3, 4].map(l =>
      `<label><input type="radio" name="lv" value="${l}" ${l === 1 ? 'checked' : ''}> Level ${l}<small class="muted">· ${LEVELS[l]}</small></label>`).join('')}</div>` : ''}
    <div class="row between mt"><h3 style="margin:0">Jumlah</h3>
      <div class="qty"><button id="m">−</button><b id="n">1</b><button id="p">+</button></div></div>
  </div>
  <div class="sticky-bottom"><button class="btn" id="add" ${p.stok > 0 ? '' : 'disabled'}>${p.stok > 0 ? 'TAMBAH KE KERANJANG' : 'STOK HABIS'}</button></div>`);
  const n = document.getElementById('n');
  document.getElementById('m').onclick = () => { qty = Math.max(1, qty - 1); n.textContent = qty; };
  document.getElementById('p').onclick = () => { qty = Math.min(p.stok || 1, qty + 1); n.textContent = qty; };
  document.getElementById('add').onclick = () => act(async () => {
    const lv = document.querySelector('input[name=lv]:checked');
    await api('POST', '/keranjang', { id_produk: p.id_produk, jumlah: qty, level_sambal: lv ? Number(lv.value) : 1 });
    toast('Ditambahkan ke keranjang ✔');
    await refreshCartCount();
    if (confirm('Tambah menu lain?')) location.hash = '#/menu'; else location.hash = '#/keranjang';
  });
}

async function cartPage() {
  const c = await api('GET', '/keranjang');
  state.cartCount = c.items.reduce((s, i) => s + i.jumlah, 0);
  render(topbar('Keranjang', { back: true, cart: false }) + `<div class="page">
    ${c.items.length ? c.items.map(i => `<div class="card cart-item" style="margin-bottom:10px">
      <div class="pimg">${esc(i.emoji)}</div>
      <div class="grow"><b>${esc(i.nama_produk)}</b>
        ${i.level_label ? `<div class="small muted">Level ${i.level_sambal} · ${esc(i.level_label)}</div>` : ''}
        <div class="price">${rp(i.harga)}</div></div>
      <div class="qty"><button data-d="${i.id_keranjang}" data-q="${i.jumlah - 1}">−</button><b>${i.jumlah}</b>
        <button data-d="${i.id_keranjang}" data-q="${i.jumlah + 1}">+</button></div></div>`).join('')
      + `<div class="card summary"><div><span>Subtotal</span><span>${rp(c.subtotal)}</span></div>
         <div><span>Ongkir</span><span>${rp(c.ongkir)}</span></div>
         <div class="total"><span>Total</span><span>${rp(c.total)}</span></div></div>`
      : '<p class="empty">Keranjang masih kosong 🛒</p>'}
  </div>
  <div class="sticky-bottom">${c.items.length
    ? '<button class="btn" data-go="#/checkout">Checkout</button>'
    : '<button class="btn" data-go="#/menu">Lihat Menu</button>'}</div>`);
  $app.querySelectorAll('[data-d]').forEach(b => b.onclick = () => act(async () => {
    const id = b.dataset.d, q = Number(b.dataset.q);
    if (q < 1) await api('DELETE', `/keranjang/${id}`); else await api('PUT', `/keranjang/${id}`, { jumlah: q });
    cartPage();
  }));
}

async function checkoutPage() {
  const c = await api('GET', '/keranjang');
  if (!c.items.length) return (location.hash = '#/keranjang');
  const me = await api('GET', '/profil');
  render(topbar('Checkout', { back: true, cart: false }) + `<div class="page"><form id="f">
    <label class="field"><span>📍 Alamat Pengiriman</span><textarea name="alamat_pengiriman" rows="3" required>${esc(me.alamat)}</textarea></label>
    <h3>Metode Pembayaran</h3>
    ${['Cash', 'Transfer', 'E-wallet'].map((m, i) => `<label class="pay-opt"><input type="radio" name="metode_pembayaran" value="${m}" ${i ? '' : 'checked'}> ${m}</label>`).join('')}
    <label class="pay-opt" id="paynow"><input type="checkbox" name="bayar_sekarang"> Saya sudah membayar (konfirmasi pembayaran)</label>
    <div class="card summary"><div><span>Subtotal</span><span>${rp(c.subtotal)}</span></div>
      <div><span>Ongkir</span><span>${rp(c.ongkir)}</span></div>
      <div class="total"><span>Total Pembayaran</span><span>${rp(c.total)}</span></div></div>
    <p class="small muted">Cash dibayar saat pesanan diterima dan diverifikasi restoran. Transfer/E-wallet: centang konfirmasi jika sudah membayar, atau konfirmasi nanti di halaman pesanan.</p>
    <div class="sticky-bottom"><button class="btn">BUAT PESANAN</button></div></form></div>`);
  const sync = () => { document.getElementById('paynow').style.display = document.querySelector('input[name=metode_pembayaran]:checked').value === 'Cash' ? 'none' : 'flex'; };
  document.querySelectorAll('input[name=metode_pembayaran]').forEach(r => r.onchange = sync); sync();
  document.getElementById('f').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    act(async () => {
      const r = await api('POST', '/pesanan', {
        alamat_pengiriman: fd.get('alamat_pengiriman'), metode_pembayaran: fd.get('metode_pembayaran'), bayar_sekarang: fd.get('bayar_sekarang') === 'on',
      });
      toast('Pesanan dibuat'); location.hash = `#/pesanan/${r.id_pesanan}`;
    });
  };
}

function timelineHtml(tl) {
  return `<ul class="timeline">${tl.map(s => `<li class="${s.done ? 'done' : ''}"><span class="dot">${s.done ? '✓' : ''}</span>${esc(s.label)}</li>`).join('')}</ul>`;
}
function itemsHtml(items) {
  return items.map(i => `<div class="row between small" style="padding:3px 0"><span>${i.jumlah}× ${esc(i.nama_produk)}${i.punya_level ? ` <span class="muted">(Level ${i.level_sambal})</span>` : ''}</span><span>${rp(i.subtotal)}</span></div>`).join('');
}
async function orderDetailPage(id) {
  const o = await api('GET', `/pesanan/${id}`);
  const unpaid = o.pembayaran.status_pembayaran !== 'Berhasil';
  render(topbar('Pesanan Saya', { back: true, cart: false }) + `<div class="page">
    <div class="card order-card"><div class="row between"><h2 style="margin:0">Pesanan #${o.nomor}</h2><span class="tag ${o.status === 'Selesai' ? 'ok' : o.status === 'Menunggu Pembayaran' ? 'warn' : ''}">${esc(o.status)}</span></div>
      <div class="small muted">${tgl(o.tanggal_pesan)}</div>${timelineHtml(o.timeline)}
      <hr style="border:0;border-top:1px dashed var(--line)">${itemsHtml(o.items)}
      <div class="row between small" style="padding:3px 0"><span>Ongkir</span><span>${rp(o.ongkir)}</span></div>
      <div class="row between mt"><b>Total</b><b class="price">${rp(o.total)}</b></div>
      <div class="small muted mt">Bayar: ${esc(o.pembayaran.metode_pembayaran)} · ${esc(o.pembayaran.status_pembayaran)}<br>Alamat: ${esc(o.alamat_pengiriman)}</div></div>
    ${unpaid && o.pembayaran.metode_pembayaran !== 'Cash' ? '<button class="btn mt" id="pay">Konfirmasi Pembayaran</button>' : ''}
    <button class="btn ghost mt" id="re">Segarkan Status</button></div>`);
  document.getElementById('re').onclick = () => orderDetailPage(id);
  const pay = document.getElementById('pay');
  if (pay) pay.onclick = () => act(async () => { await api('POST', `/pesanan/${id}/konfirmasi-pembayaran`); toast('Pembayaran dikonfirmasi'); orderDetailPage(id); });
}
async function ordersPage() {
  const rows = await api('GET', '/pesanan');
  render(topbar('Pesanan Saya', { back: true, cart: false }) + `<div class="page">${rows.length ? rows.map(o => `
    <div class="card order-card pcard" style="text-align:left" data-go="#/pesanan/${o.id_pesanan}">
      <div class="row between"><b>#${o.nomor}</b><span class="tag">${esc(o.status)}</span></div>
      <div class="small muted">${tgl(o.tanggal_pesan)} · ${o.items.length} menu</div><div class="price">${rp(o.total)}</div></div>`).join('')
    : '<p class="empty">Belum ada pesanan</p>'}</div>`);
}
async function profilePage() {
  const me = await api('GET', '/profil');
  render(topbar('Profil', { back: true, cart: false }) + `<div class="page"><form id="f">
    <label class="field"><span>Email</span><input value="${esc(me.email)}" disabled></label>
    <label class="field"><span>Nama</span><input name="nama" value="${esc(me.nama)}" required></label>
    <label class="field"><span>No. HP</span><input name="no_hp" value="${esc(me.no_hp)}" required></label>
    <label class="field"><span>Alamat</span><textarea name="alamat" rows="3">${esc(me.alamat)}</textarea></label>
    <button class="btn">Simpan</button></form></div>`);
  document.getElementById('f').onsubmit = (e) => {
    e.preventDefault();
    act(async () => {
      state.user = await api('PUT', '/profil', Object.fromEntries(new FormData(e.target)));
      localStorage.setItem('user', JSON.stringify(state.user)); toast('Profil disimpan');
    });
  };
}

/* ---------- Admin ---------- */
const STATUS = ['Menunggu Pembayaran', 'Diproses', 'Siap Diantar/Diambil', 'Selesai'];
async function adminPage() {
  render(topbar('Dashboard Admin') + `<div class="page">
    <div class="tabs">${[['pesanan', 'Pesanan Masuk'], ['menu', 'Kelola Menu'], ['ringkasan', 'Ringkasan']].map(([k, l]) =>
      `<button data-tab="${k}" class="${state.adminTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="tab"></div></div>`, { wide: true });
  $app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.adminTab = b.dataset.tab; adminPage(); });
  const box = document.getElementById('tab');
  await act(async () => {
    if (state.adminTab === 'pesanan') await adminOrders(box);
    else if (state.adminTab === 'menu') await adminMenu(box);
    else await adminSummary(box);
  });
}
async function adminSummary(box) {
  const s = await api('GET', '/admin/ringkasan');
  box.innerHTML = `<div class="stats">
    ${STATUS.map(k => `<div class="card stat"><b>${s.pesanan_per_status[k]}</b><small>${k}</small></div>`).join('')}
    <div class="card stat"><b>${rp(s.pendapatan_selesai)}</b><small>Pendapatan (selesai)</small></div>
    <div class="card stat"><b>${s.total_produk}</b><small>Menu</small></div>
    <div class="card stat"><b>${s.total_pelanggan}</b><small>Pelanggan</small></div></div>`;
}
async function adminOrders(box, filter = '') {
  const rows = await api('GET', '/admin/pesanan' + (filter ? `?status=${encodeURIComponent(filter)}` : ''));
  box.innerHTML = `<div class="row" style="margin-bottom:12px"><select id="flt" style="max-width:240px"><option value="">Semua status</option>
      ${STATUS.map(s => `<option ${s === filter ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <button class="btn sm ghost" id="rl">↻ Muat ulang</button></div>
    ${rows.length ? rows.map(o => {
      const idx = STATUS.indexOf(o.status), next = STATUS[idx + 1];
      const unpaid = o.pembayaran.status_pembayaran !== 'Berhasil';
      return `<div class="card order-card">
        <div class="row between"><b>#${o.nomor} · ${esc(o.pelanggan?.nama)}</b><span class="tag ${unpaid ? 'warn' : 'ok'}">${esc(o.status)}</span></div>
        <div class="small muted">${tgl(o.tanggal_pesan)} · ${esc(o.pelanggan?.no_hp)} · ${esc(o.alamat_pengiriman)}</div>
        <div class="mt">${itemsHtml(o.items)}</div>
        <div class="row between mt"><span class="small muted">${esc(o.pembayaran.metode_pembayaran)} · ${esc(o.pembayaran.status_pembayaran)}</span><b class="price">${rp(o.total)}</b></div>
        <div class="row mt">
          ${unpaid ? `<button class="btn sm ok" data-v="${o.id_pesanan}">Verifikasi pembayaran</button>` : ''}
          ${next && !(next === 'Diproses' && unpaid) ? `<button class="btn sm" data-s="${o.id_pesanan}" data-n="${next}">→ ${next}</button>` : ''}
        </div></div>`;
    }).join('') : '<p class="empty">Menunggu Pesanan Baru…</p>'}`;
  document.getElementById('flt').onchange = (e) => adminOrders(box, e.target.value);
  document.getElementById('rl').onclick = () => adminOrders(box, filter);
  box.querySelectorAll('[data-v]').forEach(b => b.onclick = () => act(async () => { await api('POST', `/admin/pesanan/${b.dataset.v}/verifikasi-pembayaran`); toast('Pembayaran diverifikasi'); adminOrders(box, filter); }));
  box.querySelectorAll('[data-s]').forEach(b => b.onclick = () => act(async () => { await api('PATCH', `/admin/pesanan/${b.dataset.s}/status`, { status: b.dataset.n }); toast('Status diperbarui'); adminOrders(box, filter); }));
}
async function adminMenu(box) {
  const rows = await api('GET', '/produk');
  box.innerHTML = `<div class="row between" style="margin-bottom:12px"><b>${rows.length} menu</b><button class="btn sm" id="add">+ Tambah menu</button></div>
    <table><thead><tr><th></th><th>Nama</th><th>Harga</th><th>Stok</th><th>Kategori</th><th></th></tr></thead><tbody>
    ${rows.map(p => `<tr><td style="font-size:26px">${esc(p.emoji)}</td><td><b>${esc(p.nama_produk)}</b>${p.favorit ? ' <span class="tag">favorit</span>' : ''}</td>
      <td>${rp(p.harga)}</td><td>${p.stok > 0 ? p.stok : '<span class="tag">Habis</span>'}</td><td>${esc(p.kategori)}</td>
      <td style="white-space:nowrap"><button class="btn sm ghost" data-e="${p.id_produk}">Ubah</button> <button class="btn sm danger" data-x="${p.id_produk}">Hapus</button></td></tr>`).join('')}
    </tbody></table>`;
  document.getElementById('add').onclick = () => produkModal(null, () => adminMenu(box));
  box.querySelectorAll('[data-e]').forEach(b => b.onclick = () => produkModal(rows.find(r => r.id_produk == b.dataset.e), () => adminMenu(box)));
  box.querySelectorAll('[data-x]').forEach(b => b.onclick = () => {
    const p = rows.find(r => r.id_produk == b.dataset.x);
    if (confirm(`Hapus menu "${p.nama_produk}"?`)) act(async () => { await api('DELETE', `/produk/${p.id_produk}`); toast('Menu dihapus'); adminMenu(box); });
  });
}
function produkModal(p, done) {
  const m = document.createElement('div'); m.className = 'modal-bg';
  m.innerHTML = `<form class="modal"><h3>${p ? 'Ubah' : 'Tambah'} Menu</h3>
    <label class="field"><span>Nama menu</span><input name="nama_produk" value="${esc(p?.nama_produk)}" required></label>
    <label class="field"><span>Deskripsi</span><textarea name="deskripsi" rows="2">${esc(p?.deskripsi)}</textarea></label>
    <div class="row"><label class="field" style="flex:1"><span>Harga (Rp)</span><input name="harga" type="number" min="0" step="500" value="${p?.harga ?? ''}" required></label>
    <label class="field" style="flex:1"><span>Stok</span><input name="stok" type="number" min="0" step="1" value="${p?.stok ?? 0}" required></label></div>
    <div class="row"><label class="field" style="flex:1"><span>Kategori</span><select name="kategori">${['Makanan', 'Minuman'].map(k => `<option ${p?.kategori === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
    <label class="field" style="flex:1"><span>Emoji</span><input name="emoji" value="${esc(p?.emoji || '🍗')}" maxlength="4"></label></div>
    <label class="pay-opt"><input type="checkbox" name="favorit" ${p?.favorit ? 'checked' : ''}> Menu favorit (tampil di Home)</label>
    <label class="pay-opt"><input type="checkbox" name="punya_level" ${p?.punya_level ? 'checked' : ''}> Bisa pilih level sambal (1–4)</label>
    <div class="row mt"><button type="button" class="btn ghost" data-c>Batal</button><button class="btn">Simpan</button></div></form>`;
  document.body.appendChild(m);
  m.querySelector('[data-c]').onclick = () => m.remove();
  m.querySelector('form').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd);
    body.harga = Number(body.harga); body.stok = Number(body.stok);
    body.favorit = fd.get('favorit') === 'on'; body.punya_level = fd.get('punya_level') === 'on';
    act(async () => {
      if (p) await api('PUT', `/produk/${p.id_produk}`, body); else await api('POST', '/produk', body);
      m.remove(); toast('Menu disimpan'); done();
    });
  };
}

/* ---------- Router ---------- */
async function route() {
  document.querySelector('.menu-pop')?.remove();
  const h = location.hash.replace(/^#/, '') || '/login';
  const [, page, arg] = h.split('/');
  const open = ['login', 'register'];
  if (!state.token && !open.includes(page)) return (location.hash = '#/login');
  if (state.token && open.includes(page)) return (location.hash = state.user.role === 'admin' ? '#/admin' : '#/home');
  if (state.user?.role === 'admin' && page !== 'admin') return (location.hash = '#/admin');
  if (state.user?.role === 'pelanggan' && page === 'admin') return (location.hash = '#/home');
  try {
    switch (page) {
      case 'login': return loginPage();
      case 'register': return registerPage();
      case 'home': return await homePage(false);
      case 'menu': return await homePage(true);
      case 'produk': return await detailPage(arg);
      case 'keranjang': return await cartPage();
      case 'checkout': return await checkoutPage();
      case 'pesanan': return arg ? await orderDetailPage(arg) : await ordersPage();
      case 'profil': return await profilePage();
      case 'admin': return await adminPage();
      default: location.hash = '#/home';
    }
  } catch (e) { toast(e.message, true); }
}
window.addEventListener('hashchange', route);
route();
