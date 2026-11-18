// Business Logic + REST API — Aplikasi Ayam Geprek Ratna Barokah
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { db, hashPassword, verifyPassword } = require('./db');

const PORT = process.env.PORT || 3000;
const ONGKIR = 5000; // SRS 2.6: ongkir tetap Rp5.000
const LEVEL_SAMBAL = { 1: 'Tidak terlalu pedas', 2: 'Pedas', 3: 'Sangat pedas', 4: 'Extra pedas' };
const STATUS_FLOW = ['Menunggu Pembayaran', 'Diproses', 'Siap Diantar/Diambil', 'Selesai'];
const METODE = ['Cash', 'Transfer', 'E-wallet'];

/* ---------- Token (HMAC, tanpa dependensi tambahan) ---------- */
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const f = path.join(__dirname, '.secret');
  try { return fs.readFileSync(f, 'utf8'); } catch (_) {
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(f, s, { mode: 0o600 });
    return s;
  }
}
const SECRET = loadSecret();
const b64 = (b) => Buffer.from(b).toString('base64url');
function signToken(payload, ttlSec = 60 * 60 * 24 * 7) {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch (_) { return null; }
}

/* ---------- Helper ---------- */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const wrap = (fn) => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };

function toInt(v, name) {
  const n = Number(v);
  if (!Number.isInteger(n)) throw bad(`${name} harus bilangan bulat`);
  return n;
}
function str(v, name, { required = true, max = 255 } = {}) {
  const s = (v ?? '').toString().trim();
  if (required && !s) throw bad(`${name} wajib diisi`);
  if (s.length > max) throw bad(`${name} maksimal ${max} karakter`);
  return s;
}
const publicUser = (u) => ({
  id_user: u.id_user, nama: u.nama, email: u.email, no_hp: u.no_hp, alamat: u.alamat, role: u.role,
});
const nomorPesanan = (id) => 'BR' + String(id).padStart(4, '0');
const nowIso = () => new Date().toISOString();

/* ---------- Auth middleware ---------- */
function auth(req, _res, next) {
  const h = req.headers.authorization || '';
  const p = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!p) return next(new HttpError(401, 'Silakan login terlebih dahulu'));
  const u = db.prepare('SELECT * FROM user WHERE id_user = ?').get(p.sub);
  if (!u) return next(new HttpError(401, 'Akun tidak ditemukan'));
  req.user = u;
  next();
}
const adminOnly = (req, _res, next) =>
  req.user.role === 'admin' ? next() : next(new HttpError(403, 'Hanya untuk admin'));
const customerOnly = (req, _res, next) =>
  req.user.role === 'pelanggan' ? next() : next(new HttpError(403, 'Hanya untuk pelanggan'));

/* ---------- Business logic ---------- */
function validasiStok(produk, jumlah = 1) {
  // IF stok > 0 produk dapat dipesan ELSE "Stok Habis"
  if (!produk || produk.stok <= 0) throw bad('Stok Habis');
  if (jumlah > produk.stok) throw bad(`Stok ${produk.nama_produk} hanya tersisa ${produk.stok}`);
}

function ambilKeranjang(idUser) {
  const items = db.prepare(`
    SELECT k.id_keranjang, k.id_produk, k.jumlah, k.level_sambal,
           p.nama_produk, p.harga, p.emoji, p.stok, p.punya_level,
           p.harga * k.jumlah AS subtotal
    FROM keranjang k JOIN produk p ON p.id_produk = k.id_produk
    WHERE k.id_user = ? ORDER BY k.id_keranjang`).all(idUser)
    .map(i => ({ ...i, level_label: i.punya_level ? LEVEL_SAMBAL[i.level_sambal] : null }));
  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const ongkir = items.length ? ONGKIR : 0;
  return { items, subtotal, ongkir, total: subtotal + ongkir };
}

function timeline(status, statusBayar) {
  const idx = STATUS_FLOW.indexOf(status);
  return [
    { label: 'Pesanan dibuat', done: true },
    { label: 'Pembayaran diterima', done: statusBayar === 'Berhasil' },
    { label: 'Sedang diproses', done: idx >= 1 },
    { label: 'Siap diantar', done: idx >= 2 },
    { label: 'Selesai', done: idx >= 3 },
  ];
}

function bentukPesanan(row, { withUser = false } = {}) {
  const items = db.prepare(`SELECT d.*, COALESCE(p.punya_level,0) AS punya_level FROM detail_pesanan d
    LEFT JOIN produk p ON p.id_produk = d.id_produk WHERE d.id_pesanan = ? ORDER BY d.id_detail`).all(row.id_pesanan)
    .map(d => ({ ...d, level_label: d.punya_level ? LEVEL_SAMBAL[d.level_sambal] : null }));
  const bayar = db.prepare('SELECT * FROM pembayaran WHERE id_pesanan = ?').get(row.id_pesanan);
  const out = {
    id_pesanan: row.id_pesanan,
    nomor: nomorPesanan(row.id_pesanan),
    tanggal_pesan: row.tanggal_pesan,
    alamat_pengiriman: row.alamat_pengiriman,
    subtotal: row.subtotal, ongkir: row.ongkir, total: row.total,
    status: row.status,
    pembayaran: bayar,
    items,
    timeline: timeline(row.status, bayar && bayar.status_pembayaran),
  };
  if (withUser) {
    const u = db.prepare('SELECT nama, no_hp FROM user WHERE id_user = ?').get(row.id_user);
    out.pelanggan = u || null;
  }
  return out;
}

function prosesPemesanan(user, { alamat_pengiriman, metode_pembayaran, bayar_sekarang }) {
  const alamat = str(alamat_pengiriman, 'Alamat pengiriman', { max: 500 });
  if (!METODE.includes(metode_pembayaran)) throw bad('Metode pembayaran harus Cash, Transfer, atau E-wallet');

  return db.transaction(() => {
    const k = ambilKeranjang(user.id_user);
    if (!k.items.length) throw bad('Keranjang masih kosong');

    // validasi stok ulang + kurangi stok (atomik)
    const kurangi = db.prepare('UPDATE produk SET stok = stok - ? WHERE id_produk = ? AND stok >= ?');
    for (const i of k.items) {
      if (i.stok <= 0) throw bad(`Stok Habis: ${i.nama_produk}`);
      if (kurangi.run(i.jumlah, i.id_produk, i.jumlah).changes === 0)
        throw bad(`Stok ${i.nama_produk} tidak mencukupi`);
    }

    // Pembayaran: hanya Transfer/E-wallet yang bisa langsung terkonfirmasi dari aplikasi
    const berhasil = !!bayar_sekarang && metode_pembayaran !== 'Cash';
    const status = berhasil ? 'Diproses' : 'Menunggu Pembayaran';

    const idPesanan = db.prepare(`INSERT INTO pesanan
      (id_user,tanggal_pesan,alamat_pengiriman,subtotal,ongkir,total,status) VALUES (?,?,?,?,?,?,?)`)
      .run(user.id_user, nowIso(), alamat, k.subtotal, k.ongkir, k.total, status).lastInsertRowid;

    const insD = db.prepare(`INSERT INTO detail_pesanan
      (id_pesanan,id_produk,nama_produk,jumlah,level_sambal,harga_satuan,subtotal) VALUES (?,?,?,?,?,?,?)`);
    k.items.forEach(i => insD.run(idPesanan, i.id_produk, i.nama_produk, i.jumlah, i.level_sambal, i.harga, i.subtotal));

    db.prepare(`INSERT INTO pembayaran
      (id_pesanan,metode_pembayaran,jumlah_bayar,status_pembayaran,tanggal_bayar) VALUES (?,?,?,?,?)`)
      .run(idPesanan, metode_pembayaran, k.total, berhasil ? 'Berhasil' : 'Belum Dibayar', berhasil ? nowIso() : null);

    db.prepare('DELETE FROM keranjang WHERE id_user = ?').run(user.id_user);
    return db.prepare('SELECT * FROM pesanan WHERE id_pesanan = ?').get(idPesanan);
  })();
}

function setPembayaranBerhasil(idPesanan) {
  db.transaction(() => {
    db.prepare(`UPDATE pembayaran SET status_pembayaran='Berhasil', tanggal_bayar=? WHERE id_pesanan=?`)
      .run(nowIso(), idPesanan);
    db.prepare(`UPDATE pesanan SET status='Diproses' WHERE id_pesanan=? AND status='Menunggu Pembayaran'`)
      .run(idPesanan);
  })();
}

/* ---------- App ---------- */
const app = express();
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => { // CORS sederhana untuk Flutter web / dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const api = express.Router();
app.use('/api', api);

api.get('/health', (_req, res) => res.json({ ok: true }));
api.get('/meta', (_req, res) => res.json({ ongkir: ONGKIR, level_sambal: LEVEL_SAMBAL, metode_pembayaran: METODE, status: STATUS_FLOW }));

/* --- Auth (UC-01, UC-02, UC-13, FR-18) --- */
api.post('/auth/register', wrap((req, res) => {
  const b = req.body || {};
  const nama = str(b.nama, 'Nama', { max: 100 });
  const email = str(b.email, 'Email', { max: 150 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Format email tidak valid');
  const password = str(b.password, 'Password', { max: 100 });
  if (password.length < 6) throw bad('Password minimal 6 karakter');
  const no_hp = str(b.no_hp, 'No. HP', { max: 20 });
  const alamat = str(b.alamat, 'Alamat', { required: false, max: 500 });
  if (db.prepare('SELECT 1 FROM user WHERE email = ?').get(email)) throw new HttpError(409, 'Email sudah terdaftar');
  const id = db.prepare('INSERT INTO user (nama,email,password,no_hp,alamat,role) VALUES (?,?,?,?,?,?)')
    .run(nama, email, hashPassword(password), no_hp, alamat, 'pelanggan').lastInsertRowid;
  res.status(201).json(publicUser(db.prepare('SELECT * FROM user WHERE id_user = ?').get(id)));
}));

api.post('/auth/login', wrap((req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM user WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!u || !verifyPassword(String(password || ''), u.password)) throw new HttpError(401, 'Login Gagal');
  res.json({ token: signToken({ sub: u.id_user, role: u.role }), user: publicUser(u) });
}));

/* --- Profil --- */
api.get('/profil', auth, (req, res) => res.json(publicUser(req.user)));
api.put('/profil', auth, wrap((req, res) => {
  const b = req.body || {};
  const nama = str(b.nama, 'Nama', { max: 100 });
  const no_hp = str(b.no_hp, 'No. HP', { max: 20 });
  const alamat = str(b.alamat, 'Alamat', { required: false, max: 500 });
  db.prepare('UPDATE user SET nama=?, no_hp=?, alamat=? WHERE id_user=?').run(nama, no_hp, alamat, req.user.id_user);
  res.json(publicUser(db.prepare('SELECT * FROM user WHERE id_user = ?').get(req.user.id_user)));
}));

/* --- Produk: baca (UC-03/04/05), CRUD admin (FR-19/20) --- */
api.get('/produk', auth, wrap((req, res) => {
  const q = String(req.query.q || '').trim();
  const where = [], params = [];
  if (q) { where.push('(nama_produk LIKE ? OR deskripsi LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (req.query.favorit === '1') where.push('favorit = 1');
  if (req.query.kategori) { where.push('kategori = ?'); params.push(String(req.query.kategori)); }
  const rows = db.prepare(`SELECT * FROM produk ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY favorit DESC, nama_produk`).all(...params);
  res.json(rows);
}));
api.get('/produk/:id', auth, wrap((req, res) => {
  const p = db.prepare('SELECT * FROM produk WHERE id_produk = ?').get(toInt(req.params.id, 'id'));
  if (!p) throw new HttpError(404, 'Produk tidak ditemukan');
  res.json({ ...p, tersedia: p.stok > 0 });
}));

function bacaProduk(b, parsial = false, lama = {}) {
  const pick = (k, d) => (b[k] !== undefined ? b[k] : (parsial ? lama[k] : d));
  const nama = str(pick('nama_produk'), 'Nama produk', { max: 100 });
  const harga = Number(pick('harga'));
  if (!Number.isFinite(harga) || harga < 0) throw bad('Harga harus angka ≥ 0');
  const stok = Number(pick('stok', 0));
  if (!Number.isInteger(stok) || stok < 0) throw bad('Stok harus bilangan bulat ≥ 0');
  return {
    nama_produk: nama,
    deskripsi: str(pick('deskripsi', ''), 'Deskripsi', { required: false, max: 500 }),
    harga, stok,
    kategori: str(pick('kategori', 'Makanan'), 'Kategori', { max: 50 }),
    emoji: str(pick('emoji', '🍗'), 'Emoji', { required: false, max: 8 }) || '🍗',
    favorit: pick('favorit', 0) ? 1 : 0,
    punya_level: pick('punya_level', 0) ? 1 : 0,
  };
}
api.post('/produk', auth, adminOnly, wrap((req, res) => {
  const p = bacaProduk(req.body || {});
  const id = db.prepare(`INSERT INTO produk (nama_produk,deskripsi,harga,stok,kategori,emoji,favorit,punya_level)
    VALUES (@nama_produk,@deskripsi,@harga,@stok,@kategori,@emoji,@favorit,@punya_level)`).run(p).lastInsertRowid;
  res.status(201).json(db.prepare('SELECT * FROM produk WHERE id_produk = ?').get(id));
}));
api.put('/produk/:id', auth, adminOnly, wrap((req, res) => {
  const id = toInt(req.params.id, 'id');
  const lama = db.prepare('SELECT * FROM produk WHERE id_produk = ?').get(id);
  if (!lama) throw new HttpError(404, 'Produk tidak ditemukan');
  const p = bacaProduk(req.body || {}, true, lama);
  db.prepare(`UPDATE produk SET nama_produk=@nama_produk, deskripsi=@deskripsi, harga=@harga, stok=@stok,
    kategori=@kategori, emoji=@emoji, favorit=@favorit, punya_level=@punya_level WHERE id_produk=@id`).run({ ...p, id });
  res.json(db.prepare('SELECT * FROM produk WHERE id_produk = ?').get(id));
}));
api.patch('/produk/:id/harga-stok', auth, adminOnly, wrap((req, res) => {  // FR-20
  const id = toInt(req.params.id, 'id');
  const lama = db.prepare('SELECT * FROM produk WHERE id_produk = ?').get(id);
  if (!lama) throw new HttpError(404, 'Produk tidak ditemukan');
  const harga = req.body.harga !== undefined ? Number(req.body.harga) : lama.harga;
  const stok = req.body.stok !== undefined ? Number(req.body.stok) : lama.stok;
  if (!Number.isFinite(harga) || harga < 0) throw bad('Harga harus angka ≥ 0');
  if (!Number.isInteger(stok) || stok < 0) throw bad('Stok harus bilangan bulat ≥ 0');
  db.prepare('UPDATE produk SET harga=?, stok=? WHERE id_produk=?').run(harga, stok, id);
  res.json(db.prepare('SELECT * FROM produk WHERE id_produk = ?').get(id));
}));
api.delete('/produk/:id', auth, adminOnly, wrap((req, res) => {
  const r = db.prepare('DELETE FROM produk WHERE id_produk = ?').run(toInt(req.params.id, 'id'));
  if (!r.changes) throw new HttpError(404, 'Produk tidak ditemukan');
  res.json({ ok: true });
}));

/* --- Keranjang (UC-06, FR-07..FR-12) --- */
api.get('/keranjang', auth, customerOnly, wrap((req, res) => res.json(ambilKeranjang(req.user.id_user))));
api.post('/keranjang', auth, customerOnly, wrap((req, res) => {
  const idProduk = toInt(req.body.id_produk, 'id_produk');
  const jumlah = toInt(req.body.jumlah ?? 1, 'jumlah');
  if (jumlah < 1) throw bad('Jumlah minimal 1');
  const produk = db.prepare('SELECT * FROM produk WHERE id_produk = ?').get(idProduk);
  if (!produk) throw new HttpError(404, 'Produk tidak ditemukan');
  let level = 1;
  if (produk.punya_level) {
    level = toInt(req.body.level_sambal ?? 1, 'level_sambal');
    if (level < 1 || level > 4) throw bad('Level sambal harus 1–4');
  }
  const ada = db.prepare('SELECT * FROM keranjang WHERE id_user=? AND id_produk=? AND level_sambal=?')
    .get(req.user.id_user, idProduk, level);
  validasiStok(produk, (ada ? ada.jumlah : 0) + jumlah);
  if (ada) db.prepare('UPDATE keranjang SET jumlah = jumlah + ? WHERE id_keranjang=?').run(jumlah, ada.id_keranjang);
  else db.prepare('INSERT INTO keranjang (id_user,id_produk,jumlah,level_sambal) VALUES (?,?,?,?)')
    .run(req.user.id_user, idProduk, jumlah, level);
  res.status(201).json(ambilKeranjang(req.user.id_user));
}));
api.put('/keranjang/:id', auth, customerOnly, wrap((req, res) => {
  const id = toInt(req.params.id, 'id');
  const row = db.prepare('SELECT k.*, p.stok, p.nama_produk, p.punya_level FROM keranjang k JOIN produk p USING(id_produk) WHERE id_keranjang=? AND id_user=?')
    .get(id, req.user.id_user);
  if (!row) throw new HttpError(404, 'Item keranjang tidak ditemukan');
  const jumlah = req.body.jumlah !== undefined ? toInt(req.body.jumlah, 'jumlah') : row.jumlah;
  if (jumlah < 1) throw bad('Jumlah minimal 1 (gunakan DELETE untuk menghapus)');
  let level = row.level_sambal;
  if (req.body.level_sambal !== undefined && row.punya_level) {
    level = toInt(req.body.level_sambal, 'level_sambal');
    if (level < 1 || level > 4) throw bad('Level sambal harus 1–4');
  }
  validasiStok(row, jumlah);
  db.prepare('UPDATE keranjang SET jumlah=?, level_sambal=? WHERE id_keranjang=?').run(jumlah, level, id);
  res.json(ambilKeranjang(req.user.id_user));
}));
api.delete('/keranjang/:id', auth, customerOnly, wrap((req, res) => {
  const r = db.prepare('DELETE FROM keranjang WHERE id_keranjang=? AND id_user=?').run(toInt(req.params.id, 'id'), req.user.id_user);
  if (!r.changes) throw new HttpError(404, 'Item keranjang tidak ditemukan');
  res.json(ambilKeranjang(req.user.id_user));
}));

/* --- Pesanan pelanggan (UC-07, UC-08) --- */
api.post('/pesanan', auth, customerOnly, wrap((req, res) => {
  const row = prosesPemesanan(req.user, req.body || {});
  res.status(201).json(bentukPesanan(row));
}));
api.get('/pesanan', auth, customerOnly, wrap((req, res) => {
  const rows = db.prepare('SELECT * FROM pesanan WHERE id_user=? ORDER BY id_pesanan DESC').all(req.user.id_user);
  res.json(rows.map(r => bentukPesanan(r)));
}));
api.get('/pesanan/:id', auth, wrap((req, res) => {
  const row = db.prepare('SELECT * FROM pesanan WHERE id_pesanan=?').get(toInt(req.params.id, 'id'));
  if (!row || (req.user.role !== 'admin' && row.id_user !== req.user.id_user)) throw new HttpError(404, 'Pesanan tidak ditemukan');
  res.json(bentukPesanan(row, { withUser: req.user.role === 'admin' }));
}));
api.post('/pesanan/:id/konfirmasi-pembayaran', auth, customerOnly, wrap((req, res) => {  // UC-19
  const row = db.prepare('SELECT * FROM pesanan WHERE id_pesanan=? AND id_user=?').get(toInt(req.params.id, 'id'), req.user.id_user);
  if (!row) throw new HttpError(404, 'Pesanan tidak ditemukan');
  const bayar = db.prepare('SELECT * FROM pembayaran WHERE id_pesanan=?').get(row.id_pesanan);
  if (bayar.status_pembayaran === 'Berhasil') throw bad('Pembayaran sudah dikonfirmasi');
  if (bayar.metode_pembayaran === 'Cash') throw bad('Pembayaran Cash diverifikasi oleh restoran saat pesanan diterima');
  setPembayaranBerhasil(row.id_pesanan);
  res.json(bentukPesanan(db.prepare('SELECT * FROM pesanan WHERE id_pesanan=?').get(row.id_pesanan)));
}));

/* --- Restoran / Admin (FR-21..FR-26) --- */
api.get('/admin/pesanan', auth, adminOnly, wrap((req, res) => {
  const st = req.query.status;
  if (st && !STATUS_FLOW.includes(st)) throw bad('Status tidak dikenal');
  const rows = st
    ? db.prepare('SELECT * FROM pesanan WHERE status=? ORDER BY id_pesanan DESC').all(st)
    : db.prepare('SELECT * FROM pesanan ORDER BY id_pesanan DESC').all();
  res.json(rows.map(r => bentukPesanan(r, { withUser: true })));
}));
api.get('/admin/ringkasan', auth, adminOnly, wrap((_req, res) => {
  const per = Object.fromEntries(STATUS_FLOW.map(s => [s, 0]));
  db.prepare('SELECT status, COUNT(*) c FROM pesanan GROUP BY status').all().forEach(r => { per[r.status] = r.c; });
  const pendapatan = db.prepare("SELECT COALESCE(SUM(total),0) t FROM pesanan WHERE status='Selesai'").get().t;
  res.json({ pesanan_per_status: per, pendapatan_selesai: pendapatan,
    total_produk: db.prepare('SELECT COUNT(*) c FROM produk').get().c,
    total_pelanggan: db.prepare("SELECT COUNT(*) c FROM user WHERE role='pelanggan'").get().c });
}));
api.post('/admin/pesanan/:id/verifikasi-pembayaran', auth, adminOnly, wrap((req, res) => { // FR-23
  const row = db.prepare('SELECT * FROM pesanan WHERE id_pesanan=?').get(toInt(req.params.id, 'id'));
  if (!row) throw new HttpError(404, 'Pesanan tidak ditemukan');
  const bayar = db.prepare('SELECT * FROM pembayaran WHERE id_pesanan=?').get(row.id_pesanan);
  if (bayar.status_pembayaran === 'Berhasil') throw bad('Pembayaran sudah berhasil');
  setPembayaranBerhasil(row.id_pesanan);
  res.json(bentukPesanan(db.prepare('SELECT * FROM pesanan WHERE id_pesanan=?').get(row.id_pesanan), { withUser: true }));
}));
api.patch('/admin/pesanan/:id/status', auth, adminOnly, wrap((req, res) => { // FR-24..26
  const row = db.prepare('SELECT * FROM pesanan WHERE id_pesanan=?').get(toInt(req.params.id, 'id'));
  if (!row) throw new HttpError(404, 'Pesanan tidak ditemukan');
  const baru = req.body.status;
  const iLama = STATUS_FLOW.indexOf(row.status), iBaru = STATUS_FLOW.indexOf(baru);
  if (iBaru < 0) throw bad('Status tidak dikenal');
  if (iBaru !== iLama + 1) throw bad(`Status harus berurutan: ${row.status} → ${STATUS_FLOW[iLama + 1] || '(sudah final)'}`);
  const bayar = db.prepare('SELECT * FROM pembayaran WHERE id_pesanan=?').get(row.id_pesanan);
  if (baru === 'Diproses' && bayar.status_pembayaran !== 'Berhasil')
    throw bad('Pembayaran belum berhasil — status tetap "Menunggu Pembayaran"');
  db.prepare('UPDATE pesanan SET status=? WHERE id_pesanan=?').run(baru, row.id_pesanan);
  res.json(bentukPesanan(db.prepare('SELECT * FROM pesanan WHERE id_pesanan=?').get(row.id_pesanan), { withUser: true }));
}));
api.get('/admin/pelanggan', auth, adminOnly, wrap((_req, res) => {
  res.json(db.prepare("SELECT id_user,nama,email,no_hp,alamat,role FROM user WHERE role='pelanggan' ORDER BY id_user").all());
}));

/* ---------- Error handling ---------- */
api.use((_req, _res, next) => next(new HttpError(404, 'Endpoint tidak ditemukan')));
app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && err.status === 400) return res.status(400).json({ error: 'JSON tidak valid' });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan pada server' });
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ayam Geprek Ratna Barokah berjalan di http://localhost:${PORT}`);
    console.log('Akun demo -> admin: admin@geprek.com / admin123 | pelanggan: demo@geprek.com / demo123');
  });
}
module.exports = app;
