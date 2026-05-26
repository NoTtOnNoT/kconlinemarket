// ตั้งค่าเชื่อมต่อฐานข้อมูล Firebase ของโรงเรียนกรรณสูตศึกษาลัย
const firebaseConfig = {
    apiKey: "AIzaSyBoV4p65uQ3ThpwN9Zw34GWEz7yElB2ymI",
    authDomain: "kc-onlinemarket.firebaseapp.com",
    databaseURL: "https://kc-onlinemarket-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "kc-onlinemarket",
    storageBucket: "kc-onlinemarket.firebasestorage.app",
    messagingSenderId: "321029641421",
    appId: "1:321029641421:web:7a007bd06159ffc309c584"
};

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

let currentUser = null;
let base64ImageArray = []; 
let isEditingMode = false;

// ฟังก์ชันสลับกล่องล็อกอิน / สมัครสมาชิก
function toggleAuth(showLogin) {
    if (showLogin) {
        document.getElementById('login-box').classList.remove('hidden');
        document.getElementById('register-box').classList.add('hidden');
    } else {
        document.getElementById('login-box').classList.add('hidden');
        document.getElementById('register-box').classList.remove('hidden');
    }
}

// 1. ระบบสมัครสมาชิก
document.getElementById('register-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const studentId = document.getElementById('reg-student-id').value.trim();
    const password = document.getElementById('reg-password').value;
    const name = document.getElementById('reg-name').value.trim();
    const grade = document.getElementById('reg-grade').value.trim();

    database.ref('users/' + studentId).once('value', function(snapshot) {
        if (snapshot.exists()) {
            alert('⚠️ รหัสนักเรียนนี้เคยลงทะเบียนเป็นผู้ขายไว้แล้ว!');
        } else {
            database.ref('users/' + studentId).set({
                password: password,
                name: name,
                grade: grade
            }).then(() => {
                alert('🎉 สมัครสมาชิกผู้ขายสำเร็จ! ระบบจะนำคุณไปล็อกอิน');
                document.getElementById('register-form').reset();
                toggleAuth(true);
            });
        }
    });
});

// 2. ระบบเข้าสู่ระบบ
document.getElementById('login-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const studentId = document.getElementById('login-student-id').value.trim();
    const password = document.getElementById('login-password').value;

    database.ref('users/' + studentId).once('value', function(snapshot) {
        if (snapshot.exists() && snapshot.val().password === password) {
            currentUser = {
                studentId: studentId,
                name: snapshot.val().name,
                grade: snapshot.val().grade
            };
            alert('🔓 เข้าสู่ระบบสำเร็จ!');
            initializeDashboard();
        } else {
            alert('❌ รหัสนักเรียนหรือรหัสผ่านไม่ถูกต้อง');
        }
    });
});

function initializeDashboard() {
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    
    document.getElementById('user-display').innerText = `👤 ${currentUser.name} (${currentUser.studentId})`;
    document.getElementById('user-display').classList.remove('hidden');
    document.getElementById('btn-logout').classList.remove('hidden');

    document.getElementById('prof-name').value = currentUser.name;
    document.getElementById('prof-grade').value = currentUser.grade;

    loadMyProducts();
}

// 3. แก้ไขข้อมูลส่วนตัวตนเอง
document.getElementById('profile-form').addEventListener('submit', function(e) {
    e.preventDefault();
    if (!currentUser) return;

    const newName = document.getElementById('prof-name').value.trim();
    const newGrade = document.getElementById('prof-grade').value.trim();
    const newPassword = document.getElementById('prof-password').value;

    let updates = { name: newName, grade: newGrade };
    if (newPassword !== "") { updates.password = newPassword; }

    database.ref('users/' + currentUser.studentId).update(updates).then(() => {
        currentUser.name = newName;
        currentUser.grade = newGrade;
        document.getElementById('user-display').innerText = `👤 ${currentUser.name} (${currentUser.studentId})`;
        document.getElementById('prof-password').value = "";
        alert('💾 บันทึกการแก้ไขข้อมูลส่วนตัวของคุณเรียบร้อยแล้ว!');
    }).catch(err => alert('เกิดข้อผิดพลาด: ' + err.message));
});

function logout() {
    currentUser = null;
    base64ImageArray = [];
    resetProductForm();
    document.getElementById('auth-section').classList.remove('hidden');
    document.getElementById('dashboard-section').classList.add('hidden');
    document.getElementById('user-display').classList.add('hidden');
    document.getElementById('btn-logout').classList.add('hidden');
    document.getElementById('login-form').reset();
    database.ref('products').off();
}

// 4. ระบบอัปโหลดไฟล์รูปภาพแบบ "สะสมเพิ่มเข้าไปเรื่อย ๆ"
document.getElementById('p-image-file').addEventListener('change', function(e) {
    const files = e.target.files;
    if (files.length > 0) {
        let loadedCount = 0;
        const totalFiles = files.length;

        for (let i = 0; i < totalFiles; i++) {
            const file = files[i];
            
            if (file.size > 1.5 * 1024 * 1024) { 
                alert(`⚠️ ไฟล์ชื่อ "${file.name}" มีขนาดใหญ่เกินไป! ข้ามการอัปโหลดไฟล์นี้ (ไม่เกิน 1.5 MB)`);
                loadedCount++;
                if (loadedCount === totalFiles) { renderImagePreviews(); e.target.value = ""; }
                continue;
            }

            const reader = new FileReader();
            reader.onload = function(event) {
                const base64Str = event.target.result;
                
                if (!base64ImageArray.includes(base64Str)) {
                    base64ImageArray.push(base64Str); 
                }

                loadedCount++;
                if (loadedCount === totalFiles) {
                    renderImagePreviews();
                    e.target.value = ""; 
                }
            };
            reader.readAsDataURL(file);
        }
    }
});

// ฟังก์ชันวาดรูป Preview และสร้างปุ่มลบรูปภาพรายใบ
function renderImagePreviews() {
    const gridContainer = document.getElementById('image-preview-grid');
    gridContainer.innerHTML = ''; 

    if (base64ImageArray.length > 0) {
        base64ImageArray.forEach((imgStr, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = "relative group aspect-square bg-gray-100 rounded-lg overflow-hidden border border-purple-200 shadow-sm";

            wrapper.innerHTML = `
                <img src="${imgStr}" class="h-full w-full object-cover">
                <button type="button" onclick="removeImageFromList(${index})" class="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white font-bold text-[10px] w-5 h-5 rounded-full flex items-center justify-center shadow transition-opacity opacity-90 sm:opacity-0 group-hover:opacity-100">
                    ✕
                </button>
            `;
            gridContainer.appendChild(wrapper);
        });
        document.getElementById('image-preview-container').classList.remove('hidden');
    } else {
        document.getElementById('image-preview-container').classList.add('hidden');
    }
}

// ฟังก์ชันสำหรับกดลบรูปภาพเฉพาะบางรูปออกจากลิสต์สะสม
function removeImageFromList(index) {
    base64ImageArray.splice(index, 1); 
    renderImagePreviews(); 
}

// 5. ระบบบันทึกข้อมูลสินค้า
document.getElementById('product-form').addEventListener('submit', function(e) {
    e.preventDefault();
    if (!currentUser) return;

    const pId = document.getElementById('p-id').value;
    const pName = document.getElementById('p-name').value.trim();
    const pPrice = parseFloat(document.getElementById('p-price').value);
    const pCategory = document.getElementById('p-category').value;
    const pDesc = document.getElementById('p-desc').value.trim();
    const pContact = document.getElementById('p-contact').value.trim();

    if (base64ImageArray.length === 0) {
        alert('📸 กรุณาทำการอัปโหลดรูปภาพสินค้าอย่างน้อย 1 รูปก่อนส่งข้อมูล');
        return;
    }

    let productRef;
    if (isEditingMode && pId) {
        productRef = database.ref('products/' + pId);
    } else {
        productRef = database.ref('products').push();
    }

    const productData = {
        id: isEditingMode ? pId : productRef.key,
        name: pName,
        price: pPrice,
        category: pCategory,
        description: pDesc,
        image: base64ImageArray[0], 
        images: base64ImageArray,    
        seller: currentUser.name,
        studentId: currentUser.studentId,
        grade: currentUser.grade,
        contact: pContact,
        status: 'pending', 
        timestamp: Date.now()
    };

    productRef.set(productData).then(() => {
        if (isEditingMode) {
            alert('📝 แก้ไขข้อมูลสินค้าสำเร็จ! ระบบส่งกลับไปให้ทางสภานักเรียนรีวิวอนุมัติอีกครั้ง');
        } else {
            alert('🚀 ลงสินค้าใหม่สำเร็จ! กรุณารอสภานักเรียนตรวจสอบภายใน 24 ชั่วโมง');
        }
        resetProductForm();
    }).catch(err => alert('เกิดข้อผิดพลาดในการบันทึก: ' + err.message));
});

// ดึงข้อมูลสินค้าเฉพาะของตัวเอง
function loadMyProducts() {
    const tableBody = document.getElementById('my-products-list');
    
    database.ref('products').on('value', function(snapshot) {
        tableBody.innerHTML = '';
        let count = 0;

        snapshot.forEach(childSnapshot => {
            const product = childSnapshot.val();
            
            if (product.studentId === currentUser.studentId) {
                count++;
                
                let statusBadge = '';
                if (product.status === 'approved') {
                    statusBadge = `<span class="bg-emerald-100 text-emerald-800 text-xs px-2.5 py-1 rounded-full font-bold border border-emerald-200">✅ ผ่านการอนุมัติ</span>`;
                } else if (product.status === 'rejected') {
                    statusBadge = `<span class="bg-red-100 text-red-800 text-xs px-2.5 py-1 rounded-full font-bold border border-red-200">❌ ถูกปฏิเสธ</span>`;
                } else {
                    statusBadge = `<span class="bg-amber-100 text-amber-800 text-xs px-2.5 py-1 rounded-full font-bold border border-amber-200">⏳ รอตรวจสอบ</span>`;
                }

                const totalImgs = product.images ? product.images.length : 1;

                const tr = `
                    <tr class="hover:bg-gray-50/80 transition">
                        <td class="py-3 px-6 relative">
                            <img src="${product.image}" class="w-12 h-12 object-cover rounded-lg border shadow-sm">
                            <span class="absolute bottom-2 right-4 bg-purple-900 text-white text-[10px] px-1 rounded font-bold">+${totalImgs}</span>
                        </td>
                        <td class="py-3 px-6 font-semibold text-gray-800">${product.name}</td>
                        <td class="py-3 px-6 font-bold text-purple-950">฿${product.price}</td>
                        <td class="py-3 px-6 text-gray-500 text-xs">${product.category}</td>
                        <td class="py-3 px-6 text-center">${statusBadge}</td>
                        <td class="py-3 px-6 text-center space-x-1 flex items-center justify-center h-16">
                            <button onclick="prepareEditProduct('${product.id}')" class="bg-purple-100 hover:bg-purple-200 text-purple-950 text-xs font-bold px-2.5 py-1.5 rounded-md transition border border-purple-200">แก้ไข</button>
                            <button onclick="deleteProduct('${product.id}')" class="bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold px-2.5 py-1.5 rounded-md transition border border-red-100">ลบ</button>
                        </td>
                    </tr>
                `;
                tableBody.insertAdjacentHTML('beforeend', tr);
            }
        });

        document.getElementById('product-count').innerText = `${count} รายการ`;
        if (count === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-gray-400">คุณยังไม่เคยลงขายสินค้าชิ้นใดในระบบ</td></tr>`;
        }
    });
}

// ดึงค่าสินค้าเดิมมาแก้ไข (แก้ไขบั๊กอักษรแหว่งหายเรียบร้อย)
function prepareEditProduct(id) {
    database.ref('products/' + id).once('value', function(snapshot) {
        const product = snapshot.val();
        if (!product) return;

        isEditingMode = true;
        
        document.getElementById('form-title').innerHTML = `<span>📝</span> กำลังแก้ไขข้อมูลสินค้า [${product.name}]`;
        document.getElementById('btn-cancel-edit').classList.remove('hidden');
        document.getElementById('btn-submit-product').innerText = `💾 บันทึกและส่งรีวิวอนุมัติใหม่`;
        document.getElementById('btn-submit-product').classList.replace('bg-purple-900', 'bg-amber-500');
        document.getElementById('btn-submit-product').classList.add('text-purple-950');

        document.getElementById('p-id').value = product.id;
        document.getElementById('p-name').value = product.name;
        document.getElementById('p-price').value = product.price;
        document.getElementById('p-category').value = product.category;
        document.getElementById('p-desc').value = product.description;
        document.getElementById('p-contact').value = product.contact;

        base64ImageArray = product.images ? [...product.images] : [product.image];
        renderImagePreviews();

        window.scrollTo({ top: 400, behavior: 'smooth' });
    });
}

// ฟังก์ชันลบสินค้า
function deleteProduct(id) {
    if (confirm('🚨 คุณแน่ใจหรือไม่ที่จะลบรายการสินค้าชิ้นนี้ออกจากระบบแบบถาวร?')) {
        database.ref('products/' + id).remove().then(() => {
            alert('🗑️ ลบรายการสินค้าเรียบร้อยแล้ว!');
            if (document.getElementById('p-id').value === id) {
                resetProductForm();
            }
        });
    }
}

// ล้างค่าสถานะฟอร์ม
function resetProductForm() {
    isEditingMode = false;
    document.getElementById('product-form').reset();
    document.getElementById('p-id').value = '';
    base64ImageArray = [];
    
    document.getElementById('form-title').innerHTML = `<span>➕</span> ลงทะเบียนขายสินค้าใหม่`;
    document.getElementById('btn-cancel-edit').classList.add('hidden');
    document.getElementById('btn-submit-product').innerText = `🚀 ส่งข้อมูลให้สภานักเรียนตรวจสอบ`;
    document.getElementById('btn-submit-product').className = "w-full bg-purple-900 text-white font-bold py-2 rounded-lg hover:bg-purple-800 transition shadow text-xs border-b-2 border-purple-950";
    
    document.getElementById('image-preview-grid').innerHTML = '';
    document.getElementById('image-preview-container').classList.add('hidden');
}