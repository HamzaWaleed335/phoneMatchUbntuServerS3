import mysql from 'mysql2/promise';


export const pool = mysql.createPool({
host: process.env.DB_HOST || 'localhost',
user: process.env.DB_USER || 'root',
password: process.env.DB_PASS || '',
database: process.env.DB_NAME || 'phone_matcher',
port: Number(process.env.DB_PORT || 3306),
waitForConnections: true,
connectionLimit: 10,
queueLimit: 0,
namedPlaceholders: true
});


export async function withConn(fn) {
const conn = await pool.getConnection();
try {
return await fn(conn);
} finally {
conn.release();
}
}