const test = require('node:test');
const assert = require('node:assert');
const os = require('os'), path = require('path');
process.env.DB_FILE = path.join(os.tmpdir(), `geprek-test-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-secret';
const app = require('../server');

let base, server;
test.before(() => new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api`; r(); }); }));
test.after(() => server.close());

async function call(method, url, body, token) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json() };
}
const login = async (email, password) => (await call('POST', '/auth/login', { email, password })).data.token;

test('alur lengkap SRS', async () => {
  // FR-03 login gagal
  let r = await call('POST', '/auth/login', { email: 'demo@geprek.com', password: 'salah' });
  assert.equal(r.status, 401); assert.equal(r.data.error, 'Login Gagal');

  // FR-01 register
  r = await call('POST', '/auth/register', { nama: 'Budi', email: 'budi@x.com', password: 'rahasia1', no_hp: '0812', alamat: 'Jl. A' });
  assert.equal(r.status, 201);
  assert.equal((await call('POST', '/auth/register', { nama: 'Budi', email: 'BUDI@x.com', password: 'rahasia1', no_hp: '0812' })).status, 409);

  const t = await login('budi@x.com', 'rahasia1');
  const admin = await login('admin@geprek.com', 'admin123');
  assert.equal((await call('GET', '/produk')).status, 401);

  const produk = (await call('GET', '/produk', null, t)).data;
  const geprek = produk.find(p => p.nama_produk === 'Ayam Geprek Original');
  const esTeh = produk.find(p => p.nama_produk === 'Es Teh');
  const habis = produk.find(p => p.stok === 0);

  // FR-07 stok habis
  r = await call('POST', '/keranjang', { id_produk: habis.id_produk, jumlah: 1 }, t);
  assert.equal(r.status, 400); assert.equal(r.data.error, 'Stok Habis');
  // level sambal harus 1-4
  assert.equal((await call('POST', '/keranjang', { id_produk: geprek.id_produk, jumlah: 1, level_sambal: 5 }, t)).status, 400);

  // contoh bisnis SRS: 2 geprek + 2 es teh => subtotal 40.000, total 45.000
  await call('POST', '/keranjang', { id_produk: geprek.id_produk, jumlah: 2, level_sambal: 3 }, t);
  r = await call('POST', '/keranjang', { id_produk: esTeh.id_produk, jumlah: 2 }, t);
  assert.equal(r.data.subtotal, 40000); assert.equal(r.data.ongkir, 5000); assert.equal(r.data.total, 45000);
  // admin tidak bisa pakai keranjang
  assert.equal((await call('GET', '/keranjang', null, admin)).status, 403);

  // FR-11 ubah jumlah & hapus
  const item = r.data.items[0];
  r = await call('PUT', `/keranjang/${item.id_keranjang}`, { jumlah: 1 }, t);
  assert.equal(r.data.subtotal, 25000);
  r = await call('PUT', `/keranjang/${item.id_keranjang}`, { jumlah: 2 }, t);
  assert.equal(r.data.total, 45000);

  // checkout: validasi
  assert.equal((await call('POST', '/pesanan', { alamat_pengiriman: '', metode_pembayaran: 'Cash' }, t)).status, 400);
  assert.equal((await call('POST', '/pesanan', { alamat_pengiriman: 'Jl A', metode_pembayaran: 'Kartu' }, t)).status, 400);

  // pembayaran Transfer belum berhasil => Menunggu Pembayaran
  r = await call('POST', '/pesanan', { alamat_pengiriman: 'Jl. A', metode_pembayaran: 'Transfer', bayar_sekarang: false }, t);
  assert.equal(r.status, 201);
  const p1 = r.data;
  assert.equal(p1.status, 'Menunggu Pembayaran'); assert.equal(p1.total, 45000); assert.match(p1.nomor, /^BR\d{4}$/);
  // stok berkurang, keranjang kosong
  assert.equal((await call('GET', `/produk/${geprek.id_produk}`, null, t)).data.stok, geprek.stok - 2);
  assert.equal((await call('GET', '/keranjang', null, t)).data.items.length, 0);
  assert.equal((await call('POST', '/pesanan', { alamat_pengiriman: 'Jl A', metode_pembayaran: 'Cash' }, t)).data.error, 'Keranjang masih kosong');

  // admin tidak bisa lompat ke Diproses sebelum bayar
  r = await call('PATCH', `/admin/pesanan/${p1.id_pesanan}/status`, { status: 'Diproses' }, admin);
  assert.equal(r.status, 400);
  // FR-15 konfirmasi ulang oleh pelanggan
  r = await call('POST', `/pesanan/${p1.id_pesanan}/konfirmasi-pembayaran`, null, t);
  assert.equal(r.data.status, 'Diproses'); assert.equal(r.data.pembayaran.status_pembayaran, 'Berhasil');

  // alur berurutan
  assert.equal((await call('PATCH', `/admin/pesanan/${p1.id_pesanan}/status`, { status: 'Selesai' }, admin)).status, 400);
  r = await call('PATCH', `/admin/pesanan/${p1.id_pesanan}/status`, { status: 'Siap Diantar/Diambil' }, admin);
  assert.equal(r.data.status, 'Siap Diantar/Diambil');
  r = await call('PATCH', `/admin/pesanan/${p1.id_pesanan}/status`, { status: 'Selesai' }, admin);
  assert.ok(r.data.timeline.every(s => s.done));
  assert.equal((await call('PATCH', `/admin/pesanan/${p1.id_pesanan}/status`, { status: 'Selesai' }, admin)).status, 400);

  // Cash: tidak bisa self-confirm; admin verifikasi
  await call('POST', '/keranjang', { id_produk: esTeh.id_produk, jumlah: 1 }, t);
  r = await call('POST', '/pesanan', { alamat_pengiriman: 'Jl. B', metode_pembayaran: 'Cash', bayar_sekarang: true }, t);
  assert.equal(r.data.status, 'Menunggu Pembayaran');
  assert.equal((await call('POST', `/pesanan/${r.data.id_pesanan}/konfirmasi-pembayaran`, null, t)).status, 400);
  r = await call('POST', `/admin/pesanan/${r.data.id_pesanan}/verifikasi-pembayaran`, null, admin);
  assert.equal(r.data.status, 'Diproses'); assert.equal(r.data.pelanggan.nama, 'Budi');

  // pesanan hanya milik sendiri
  const t2 = await login('demo@geprek.com', 'demo123');
  assert.equal((await call('GET', `/pesanan/${p1.id_pesanan}`, null, t2)).status, 404);
  assert.equal((await call('GET', '/pesanan', null, t)).data.length, 2);

  // admin ringkasan + antrean
  const rs = (await call('GET', '/admin/ringkasan', null, admin)).data;
  assert.equal(rs.pendapatan_selesai, 45000);
  assert.equal((await call('GET', '/admin/pesanan?status=Diproses', null, admin)).data.length, 1);
});

test('CRUD produk admin', async () => {
  const admin = await login('admin@geprek.com', 'admin123');
  const t = await login('demo@geprek.com', 'demo123');
  const baru = { nama_produk: 'Ayam Geprek Pedas Gila', deskripsi: 'Uji', harga: 18000, stok: 10, kategori: 'Makanan', emoji: '🌶️', punya_level: true };
  assert.equal((await call('POST', '/produk', baru, t)).status, 403);
  assert.equal((await call('POST', '/produk', { ...baru, harga: -1 }, admin)).status, 400);
  let r = await call('POST', '/produk', baru, admin);
  assert.equal(r.status, 201); const id = r.data.id_produk;
  r = await call('PUT', `/produk/${id}`, { nama_produk: 'Geprek Edit', harga: 19000 }, admin);
  assert.equal(r.data.nama_produk, 'Geprek Edit'); assert.equal(r.data.stok, 10);
  r = await call('PATCH', `/produk/${id}/harga-stok`, { harga: 21000, stok: 0 }, admin);
  assert.equal(r.data.harga, 21000); assert.equal(r.data.stok, 0);
  assert.equal((await call('DELETE', `/produk/${id}`, null, admin)).status, 200);
  assert.equal((await call('GET', `/produk/${id}`, null, admin)).status, 404);
});
