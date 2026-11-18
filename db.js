// Data Layer: skema SQLite sesuai Class Diagram SRS
// (User, Produk, Keranjang, Pesanan, DetailPesanan, Pembayaran) + seed data awal.
const path = require('path');
const crypto = require('crypto');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'geprek.db');

// Driver: better-sqlite3 bila terpasang; jika tidak, SQLite bawaan Node (node:sqlite, Node >= 22.5).
function openDb(file) {
  if (!process.env.FORCE_NODE_SQLITE) {
    try {
      const Database = require('better-sqlite3');
      const d = new Database(file);
      d.pragma('journal_mode = WAL');
      d.pragma('foreign_keys = ON');
      return d;
    } catch (_) { /* jatuh ke node:sqlite */ }
  }
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch (_) {
    throw new Error('Tidak ada driver SQLite. Jalankan "npm install" (better-sqlite3) atau gunakan Node.js 22.5+.');
  }
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return {
    prepare: (sql) => raw.prepare(sql),
    exec: (sql) => raw.exec(sql),
    pragma: (p) => raw.exec(`PRAGMA ${p}`),
    transaction: (fn) => (...args) => {
      raw.exec('BEGIN');
      try { const r = fn(...args); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
}
const db = openDb(DB_FILE);

db.exec(`
CREATE TABLE IF NOT EXISTS user (
  id_user      INTEGER PRIMARY KEY AUTOINCREMENT,
  nama         TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password     TEXT NOT NULL,                       -- hash scrypt "salt:hash"
  no_hp        TEXT NOT NULL DEFAULT '',
  alamat       TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL DEFAULT 'pelanggan' CHECK (role IN ('pelanggan','admin'))
);

CREATE TABLE IF NOT EXISTS produk (
  id_produk    INTEGER PRIMARY KEY AUTOINCREMENT,
  nama_produk  TEXT NOT NULL,
  deskripsi    TEXT NOT NULL DEFAULT '',
  harga        REAL NOT NULL CHECK (harga >= 0),
  stok         INTEGER NOT NULL DEFAULT 0 CHECK (stok >= 0),
  kategori     TEXT NOT NULL DEFAULT 'Makanan',
  emoji        TEXT NOT NULL DEFAULT '🍗',
  favorit      INTEGER NOT NULL DEFAULT 0,
  punya_level  INTEGER NOT NULL DEFAULT 1           -- 1 = menu bisa dipilih level sambal
);

CREATE TABLE IF NOT EXISTS keranjang (
  id_keranjang INTEGER PRIMARY KEY AUTOINCREMENT,
  id_user      INTEGER NOT NULL REFERENCES user(id_user) ON DELETE CASCADE,
  id_produk    INTEGER NOT NULL REFERENCES produk(id_produk) ON DELETE CASCADE,
  jumlah       INTEGER NOT NULL CHECK (jumlah > 0),
  level_sambal INTEGER NOT NULL DEFAULT 1 CHECK (level_sambal BETWEEN 1 AND 4)
);

CREATE TABLE IF NOT EXISTS pesanan (
  id_pesanan        INTEGER PRIMARY KEY AUTOINCREMENT,
  id_user           INTEGER NOT NULL REFERENCES user(id_user),
  tanggal_pesan     TEXT NOT NULL,
  alamat_pengiriman TEXT NOT NULL,
  subtotal          REAL NOT NULL,
  ongkir            REAL NOT NULL,
  total             REAL NOT NULL,
  status            TEXT NOT NULL DEFAULT 'Menunggu Pembayaran'
    CHECK (status IN ('Menunggu Pembayaran','Diproses','Siap Diantar/Diambil','Selesai'))
);

CREATE TABLE IF NOT EXISTS detail_pesanan (
  id_detail    INTEGER PRIMARY KEY AUTOINCREMENT,
  id_pesanan   INTEGER NOT NULL REFERENCES pesanan(id_pesanan) ON DELETE CASCADE,
  id_produk    INTEGER REFERENCES produk(id_produk) ON DELETE SET NULL,
  nama_produk  TEXT NOT NULL,                       -- snapshot nama saat dipesan
  jumlah       INTEGER NOT NULL,
  level_sambal INTEGER NOT NULL,
  harga_satuan REAL NOT NULL,
  subtotal     REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS pembayaran (
  id_pembayaran     INTEGER PRIMARY KEY AUTOINCREMENT,
  id_pesanan        INTEGER NOT NULL UNIQUE REFERENCES pesanan(id_pesanan) ON DELETE CASCADE,
  metode_pembayaran TEXT NOT NULL CHECK (metode_pembayaran IN ('Cash','Transfer','E-wallet')),
  jumlah_bayar      REAL NOT NULL,
  status_pembayaran TEXT NOT NULL DEFAULT 'Belum Dibayar' CHECK (status_pembayaran IN ('Belum Dibayar','Berhasil')),
  tanggal_bayar     TEXT
);

CREATE INDEX IF NOT EXISTS idx_keranjang_user ON keranjang(id_user);
CREATE INDEX IF NOT EXISTS idx_pesanan_user ON pesanan(id_user);
CREATE INDEX IF NOT EXISTS idx_pesanan_status ON pesanan(status);
`);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const orig = Buffer.from(hash, 'hex');
  return orig.length === test.length && crypto.timingSafeEqual(orig, test);
}

function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM user').get().c === 0) {
    const ins = db.prepare('INSERT INTO user (nama,email,password,no_hp,alamat,role) VALUES (?,?,?,?,?,?)');
    ins.run('Admin Ratna', 'admin@geprek.com', hashPassword('admin123'), '081200000000', 'Bengkulu', 'admin');
    ins.run('Aidil Ibnu Ahmad', 'demo@geprek.com', hashPassword('demo123'), '081234567890', 'Jl. Contoh No. 1, Bengkulu', 'pelanggan');
  }
  if (db.prepare('SELECT COUNT(*) c FROM produk').get().c === 0) {
    const ins = db.prepare(
      'INSERT INTO produk (nama_produk,deskripsi,harga,stok,kategori,emoji,favorit,punya_level) VALUES (?,?,?,?,?,?,?,?)');
    const rows = [
      ['Ayam Geprek Original', 'Ayam krispi digeprek dengan sambal bawang segar, level pedas bisa dipilih.', 15000, 50, 'Makanan', '🍗', 1, 1],
      ['Es Teh', 'Teh manis dingin yang menyegarkan.', 5000, 100, 'Minuman', '🧋', 1, 0],
      ['Soto', 'Soto ayam hangat dengan kuah kaldu gurih.', 13000, 30, 'Makanan', '🍲', 1, 0],
      ['Nasi Goreng', 'Nasi goreng bumbu rempah dengan telur.', 14000, 30, 'Makanan', '🍛', 1, 0],
      ['Ayam Geprek Keju', 'Ayam geprek dengan lelehan keju mozzarella.', 20000, 25, 'Makanan', '🧀', 0, 1],
      ['Es Jeruk', 'Jeruk peras segar dengan es batu.', 7000, 60, 'Minuman', '🍊', 0, 0],
      ['Nasi Putih', 'Nasi putih pulen.', 4000, 200, 'Makanan', '🍚', 0, 0],
      ['Tahu Tempe Goreng', 'Tahu dan tempe goreng renyah.', 6000, 0, 'Makanan', '🍢', 0, 0],
    ];
    db.transaction(() => rows.forEach(r => ins.run(...r)))();
  }
}
seed();

module.exports = { db, hashPassword, verifyPassword };
