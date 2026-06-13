// api/get-products.js
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get } from 'firebase/database';

// คีย์ทั้งหมดจะถูกเรียกใช้บน Server ของ Vercel เท่านั้น ไม่มีวันหลุดไปที่หน้าเว็บ
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    // ... ใส่ให้ครบตัวแปรระบบของ Node.js จะใช้ process.env
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

export default async function handler(req, res) {
    try {
        const snapshot = await get(ref(database, 'products'));
        if (snapshot.exists()) {
            res.status(200).json(snapshot.val());
        } else {
            res.status(200).json({});
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}