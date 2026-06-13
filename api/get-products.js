// api/get-products.js
export default async function handler(req, res) {
    // กำหนดค่า Firebase Config จาก Environment Variables ของ Node.js (จะใช้ process.env)
    const firebaseConfig = {
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        databaseURL: process.env.FIREBASE_DATABASE_URL,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID
    };

    // ดึงข้อมูลตาราง products และ users จาก Realtime Database ผ่าน REST API ของ Firebase
    try {
        // ดึงข้อมูลสินค้า
        const productsRes = await fetch(`${firebaseConfig.databaseURL}/products.json`);
        const productsData = await productsRes.json();

        // ดึงข้อมูลผู้ใช้เพื่อเอามาเช็คสถานะโดนแบน
        const usersRes = await fetch(`${firebaseConfig.databaseURL}/users.json`);
        const usersData = await usersRes.json();

        // ส่งข้อมูลทั้งสองตารางกลับไปให้หน้าเว็บ (Frontend)
        return res.status(200).json({
            products: productsData || {},
            users: usersData || {}
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}