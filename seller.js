// =================================================================
// 🌐 การตั้งค่าและเชื่อมต่อฐานข้อมูล Firebase ของโรงเรียนกรรณสูตศึกษาลัย
// =================================================================
const firebaseConfig = {
    apiKey: "AIzaSyBoV4p65uQ3ThpwN9Zw34GWEz7yElB2ymI",
    authDomain: "kc-onlinemarket.firebaseapp.com",
    databaseURL: "https://kc-onlinemarket-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "kc-onlinemarket",
    storageBucket: "kc-onlinemarket.firebasestorage.app",
    messagingSenderId: "321029641421",
    appId: "1:321029641421:web:7a007bd06159ffc309c584"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const database = firebase.database();

// โกลบอลสเตตัสสำหรับควบคุมการทำงานภายในระบบร้านค้า
let currentUser = null;
let base64ImageArray = []; 
let isEditingMode = false;
let currentEditingProductStatus = 'pending'; 

// 📦 [เพิ่มใหม่] โกลบอลสเตตัสสำหรับเก็บค่าเปรียบเทียบและสถานะปุ่มแก้ไขโปรไฟล์
let originalUserData = null;
let isProfileEditingMode = false;

// =================================================================
// 🔄 ระบบตรวจสอบสถานะการล็อกอินค้างไว้ (Auto Login) & ดักจับปุ่มพื้นฐาน
// =================================================================
document.addEventListener("DOMContentLoaded", function() {
    const savedUserId = localStorage.getItem('logged_student_id');
    if (savedUserId) {
        database.ref('users/' + savedUserId).once('value', function(snapshot) {
            if (snapshot.exists()) {
                const userData = snapshot.val();
                
                if (userData.status === 'banned') {
                    alert('🚫 บัญชีของคุณถูกระงับการใช้งานชั่วคราวโดยแอดมินสภานักเรียน');
                    localStorage.removeItem('logged_student_id');
                    return;
                }

                currentUser = {
                    studentId: savedUserId,
                    name: userData.name,
                    grade: userData.grade
                };
                initializeDashboard();
            } else {
                localStorage.removeItem('logged_student_id');
            }
        });
    }

    document.getElementById('reg-level')?.addEventListener('change', updateRoomOptions);
    document.getElementById('prof-level')?.addEventListener('change', updateProfileRoomOptions);
    document.getElementById('btn-cancel-edit')?.addEventListener('click', resetProductForm);
    document.getElementById('btn-logout')?.addEventListener('click', logout);
    
    // ผูก Event การกดส่งฟอร์มข้อมูลส่วนตัวใหม่
    document.getElementById('profile-form')?.addEventListener('submit', handleProfileSubmitAction);

    document.querySelectorAll('input[name="contact-type"]').forEach(radio => {
        radio.addEventListener('change', handleContactTypeChange);
    });
});

// =================================================================
// 🗂️ ฟังก์ชันจัดการสลับหน้าต่างและแท็บเมนู
// =================================================================
function switchTab(tabId) {
    // 1. ซ่อนคอนเทนต์ของทุกแท็บที่มีคลาส .tab-content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    
    // 2. เอาคลาส hidden ออกเฉพาะแท็บที่ถูกคลิกเลือก เพื่อเปิดแสดงผล
    const targetTab = document.getElementById(tabId);
    if (targetTab) {
        targetTab.classList.remove('hidden');
    }

    // 3. เปลี่ยนสีปุ่มเมนูให้กลับเป็นสถานะปกติ (สีขาว ตัวหนังสือม่วง)
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('bg-purple-900', 'text-white', 'shadow');
        btn.classList.add('bg-white', 'text-purple-900', 'border', 'border-purple-100');
    });
    
    // 4. ไฮไลท์ปุ่มที่กำลังเปิดใช้งานอยู่ให้เป็นสีม่วงเด่นชัด
    const activeBtn = document.getElementById(`btn-${tabId}`);
    if (activeBtn) {
        activeBtn.classList.remove('bg-white', 'text-purple-900', 'border', 'border-purple-100');
        activeBtn.classList.add('bg-purple-900', 'text-white', 'shadow');
    }
}

function toggleAuth(showLogin) {
    if (showLogin) {
        document.getElementById('login-box')?.classList.remove('hidden');
        document.getElementById('register-box')?.classList.add('hidden');
    } else {
        document.getElementById('login-box')?.classList.add('hidden');
        document.getElementById('register-box')?.classList.remove('hidden');
    }
}

// =================================================================
// 📝 1. ระบบจัดการสมัครสมาชิก (Register System)
// =================================================================
document.getElementById('register-form')?.addEventListener('submit', function(e) {
    e.preventDefault();

    const studentId = document.getElementById('reg-student-id').value.trim();
    const citizenId = document.getElementById('reg-citizen-id').value.trim();
    const firstName = document.getElementById('reg-firstname').value.trim();
    const lastName = document.getElementById('reg-lastname').value.trim();
    const fullName = `${firstName} ${lastName}`; 

    const level = document.getElementById('reg-level').value;
    const room = document.getElementById('reg-room').value;
    const fullGrade = `${level}/${room}`; 

    const password = document.getElementById('reg-password').value;
    const confirmPassword = document.getElementById('reg-confirm-password').value;

    if (studentId.length !== 5) {
        alert('❌ รหัสนักเรียนต้องมีจำนวน 5 หลักเท่านั้น');
        return;
    }
    if (citizenId.length !== 13) {
        alert('❌ เลขประจำตัวประชาชนต้องมีจำนวน 13 หลักเท่านั้น');
        return;
    }
    if (password !== confirmPassword) {
        alert('❌ รหัสผ่านทั้งสองช่องไม่ตรงกัน');
        return;
    }

    database.ref('users/' + studentId).once('value', function(snapshot) {
        if (snapshot.exists()) {
            alert('⚠️ รหัสนักเรียนนี้เคยลงทะเบียนในระบบแล้ว');
        } else {
            database.ref('users/' + studentId).set({
                studentId: studentId,
                citizenId: citizenId,
                name: fullName,      
                firstName: firstName, 
                lastName: lastName,   
                grade: fullGrade,     
                password: password,   
                role: 'seller',        
                timestamp: Date.now()
            }).then(() => {
                alert('🎉 สมัครสมาชิกและเข้าสู่ระบบสำเร็จเรียบร้อยแล้ว!');
                localStorage.setItem('logged_student_id', studentId);
                
                currentUser = {
                    studentId: studentId,
                    name: fullName,
                    grade: fullGrade
                };

                document.getElementById('register-form').reset();
                const regRoom = document.getElementById('reg-room');
                if (regRoom) {
                    regRoom.innerHTML = '<option value="" disabled selected>กรุณาเลือกชั้นเรียนก่อน</option>';
                    regRoom.disabled = true;
                    regRoom.classList.add('bg-gray-50');
                }
                
                toggleAuth(true);
                initializeDashboard();
            }).catch(error => alert('เกิดข้อผิดพลาด: ' + error.message));
        }
    });
});

// =================================================================
// 🔓 2. ระบบเข้าสู่ระบบส่วนบุคคล (Login System)
// =================================================================
document.getElementById('login-form')?.addEventListener('submit', function(e) {
    e.preventDefault();
    const studentId = document.getElementById('login-student-id').value.trim();
    const password = document.getElementById('login-password').value;

    database.ref('users/' + studentId).once('value', function(snapshot) {
        if (snapshot.exists() && snapshot.val().password === password) {
            const userData = snapshot.val();

            if (userData.status === 'banned') {
                alert('🚫 ไม่สามารถเข้าสู่ระบบได้ เนื่องจากบัญชีนี้ถูกระงับการใช้งานโดยสภานักเรียน');
                return;
            }

            localStorage.setItem('logged_student_id', studentId);
            currentUser = {
                studentId: studentId,
                name: userData.name,
                grade: userData.grade
            };
            alert('🔓 เข้าสู่ระบบสำเร็จ!');
            initializeDashboard();
        } else {
            alert('❌ รหัสนักเรียนหรือรหัสผ่านไม่ถูกต้อง');
        }
    });
});

function initializeDashboard() {
    if (!currentUser) return;
    
    document.getElementById('auth-section')?.classList.add('hidden');
    document.getElementById('dashboard-section')?.classList.remove('hidden');
    
    const userDisplay = document.getElementById('user-display');
    if (userDisplay) {
        userDisplay.innerText = `👤 ${currentUser.name} (${currentUser.studentId})`;
        userDisplay.classList.remove('hidden');
    }
    document.getElementById('btn-logout')?.classList.remove('hidden');

    const userRef = database.ref('users/' + currentUser.studentId);
    userRef.off();

    userRef.on('value', function(snapshot) {
        if (snapshot.exists()) {
            const userData = snapshot.val();
            
            if (userData.status === 'banned') {
                alert('🚫 บัญชีของคุณถูกระงับการใช้งานโดยสภานักเรียน ระบบจะนำคุณออกจากระบบชั่วคราว');
                userRef.off();
                database.ref('products').off();
                localStorage.removeItem('logged_student_id');
                currentUser = null;
                base64ImageArray = [];
                
                resetProductForm();
                document.getElementById('auth-section')?.classList.remove('hidden');
                document.getElementById('dashboard-section')?.classList.add('hidden');
                document.getElementById('user-display')?.classList.add('hidden');
                document.getElementById('btn-logout')?.classList.add('hidden');
                document.getElementById('login-form')?.reset();
                return; 
            }

            // 💾 [อัปเดตใหม่] บันทึกข้อมูลตั้งต้นลงตัวแปรโกลบอลเพื่อใช้คำนวณเปรียบเทียบ Diff
            originalUserData = {
                firstName: userData.firstName || '',
                lastName: userData.lastName || '',
                grade: userData.grade || ''
            };

            // อัปเดตข้อมูลขึ้นจอแสดงผล (หากเปิดโหมดแก้ไขอยู่จะไม่ทับข้อมูลที่กำลังพิมพ์)
            if (!isProfileEditingMode) {
                const profStudentId = document.getElementById('prof-studentid');
                const profCitizenId = document.getElementById('prof-citizenid');
                const profFirstName = document.getElementById('prof-firstname');
                const profLastName = document.getElementById('prof-lastname');

                if (profStudentId) profStudentId.value = userData.studentId || '';
                if (profCitizenId) profCitizenId.value = userData.citizenId || '';
                if (profFirstName) profFirstName.value = userData.firstName || '';
                if (profLastName) profLastName.value = userData.lastName || '';

                if (userData.grade && userData.grade.includes('/')) {
                    const parts = userData.grade.split('/');
                    const levelPart = parts[0];
                    const roomPart = parts[1];

                    const profLevel = document.getElementById('prof-level');
                    if (profLevel) {
                        profLevel.value = levelPart;
                        updateProfileRoomOptions();
                    }
                    const profRoom = document.getElementById('prof-room');
                    if (profRoom) {
                        profRoom.value = roomPart;
                    }
                }
                toggleProfileFieldsLock(true); // ล็อกช่องอินพุตไว้เริ่มต้น
            }
        }
    });

    switchTab('product-form-tab');
    loadMyProducts();
}

// =================================================================
// ⚙️ 3. [ปรับปรุงใหม่หมด] ระบบแก้ไขโปรไฟล์ & ส่งคำขอเปรียบเทียบค่าอัตโนมัติ
// =================================================================

// ฟังก์ชันควบคุมเปิด-ปิด การล็อกกล่องป้อนข้อมูลบนจอตามโหมดใช้งาน
function toggleProfileFieldsLock(isLocked) {
    const fields = ['prof-firstname', 'prof-lastname', 'prof-level', 'prof-room'];
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = isLocked;
    });
    
    const btnTrigger = document.getElementById('btn-trigger-edit');
    const btnSubmit = document.getElementById('btn-submit-profile');
    
    if (isLocked) {
        if (btnTrigger) {
            btnTrigger.innerText = "✏️ กดเพื่อขอแก้ไขข้อมูลส่วนตัว";
            btnTrigger.className = "w-full bg-amber-500 hover:bg-amber-600 text-purple-950 font-bold py-2 px-4 rounded-lg transition shadow text-sm mb-3";
        }
        if (btnSubmit) btnSubmit.innerText = "💾 บันทึกเปลี่ยนรหัสผ่านใหม่";
        isProfileEditingMode = false;
    } else {
        if (btnTrigger) {
            btnTrigger.innerText = "❌ ยกเลิกการแก้ไขข้อมูลส่วนตัว";
            btnTrigger.className = "w-full bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition shadow text-sm mb-3";
        }
        if (btnSubmit) btnSubmit.innerText = "🚀 ส่งคำขออัปเดตข้อมูลส่วนตัวถึงแอดมิน";
        isProfileEditingMode = true;
    }
}

// จุดคัดกรองคำสั่งการ Submit ฟอร์มข้อมูลส่วนบุคคล
function handleProfileSubmitAction(e) {
    e.preventDefault();
    if (!currentUser) return;

    const newPassword = document.getElementById('prof-password')?.value || "";

    // กรณีที่ 1: กำลังพิมพ์แก้อยู่บนอินพุต (สแกนหาจุดต่างเพื่อแพ็กส่งแอดมิน)
    if (isProfileEditingMode) {
        processProfileChangeRequest(newPassword);
    } 
    // กรณีที่ 2: ช่องป้อนข้อมูลถูกล็อกอยู่ปกติ (ทำการอัปเดตรหัสผ่านธรรมดาโดยไม่กวนแอดมิน)
    else {
        if (newPassword.trim() === "") {
            alert('⚠️ ไม่มีข้อมูลถูกเปลี่ยน! หากต้องการแก้ไข ชื่อ-นามสกุล หรือ ชั้นเรียน กรุณากดปุ่ม "ขอแก้ไขข้อมูลส่วนตัว" ด้านบนก่อนครับ');
            return;
        }
        updateOnlyPassword(newPassword);
    }
}

function updateOnlyPassword(newPassword) {
    database.ref('users/' + currentUser.studentId).update({ password: newPassword }).then(() => {
        const passInput = document.getElementById('prof-password');
        if (passInput) passInput.value = ""; 
        alert('💾 บันทึกการเปลี่ยนรหัสผ่านใหม่ของคุณเรียบร้อยแล้ว!');
    }).catch(err => alert('เกิดข้อผิดพลาด: ' + err.message));
}

function processProfileChangeRequest(newPassword) {
    if (!originalUserData) {
        alert('⚠️ ระบบฐานข้อมูลผิดพลาดชั่วคราว ไม่สามารถเปรียบเทียบข้อมูลเดิมได้');
        return;
    }

    const inputFirstname = document.getElementById('prof-firstname')?.value.trim() || "";
    const inputLastname = document.getElementById('prof-lastname')?.value.trim() || "";
    const inputLevel = document.getElementById('prof-level')?.value || "";
    const inputRoom = document.getElementById('prof-room')?.value || "";
    const inputGrade = `${inputLevel}/${inputRoom}`;

    let changeLogs = [];
    let updatedFields = {};

    // ลูปตรวจสอบหาจุดต่าง (Diff Check) เพื่อสร้างรายงานส่งไปหลังบ้านอัตโนมัติ
    if (inputFirstname !== originalUserData.firstName) {
        changeLogs.push(`เปลี่ยนชื่อจริงจาก [${originalUserData.firstName}] เป็น [${inputFirstname}]`);
        updatedFields.firstName = inputFirstname;
    }
    if (inputLastname !== originalUserData.lastName) {
        changeLogs.push(`เปลี่ยนนามสกุลจาก [${originalUserData.lastName}] เป็น [${inputLastname}]`);
        updatedFields.lastName = inputLastname;
    }
    if (inputGrade !== originalUserData.grade) {
        changeLogs.push(`เปลี่ยนชั้นเรียนจาก [${originalUserData.grade}] เป็น [${inputGrade}]`);
        updatedFields.grade = inputGrade;
    }

    // หากช่องข้อมูลเดิมทุกช่องไม่มีการแตะต้องแก้เลย แต่ดันกรอกรหัสผ่านใหม่พ่วงมา
    if (changeLogs.length === 0) {
        if (newPassword.trim() !== "") {
            updateOnlyPassword(newPassword);
            toggleProfileFieldsLock(true);
            return;
        }
        alert('⚠️ คุณยังไม่ได้ทำการคลิกหรือเปลี่ยนข้อมูลใดๆ บนช่องป้อนข้อความเลยครับ');
        return;
    }

    const finalReasonText = changeLogs.join(" | ");

    const requestData = {
        studentId: currentUser.studentId,
        senderName: `${originalUserData.firstName} ${originalUserData.lastName}`,
        currentClass: originalUserData.grade,
        requestDetails: finalReasonText, 
        requestedData: {
            ...updatedFields,
            name: `${inputFirstname} ${inputLastname}`.trim()
        },
        status: 'pending',
        timestamp: firebase.database.ServerValue.TIMESTAMP
    };

    database.ref('profile_requests').push(requestData).then(() => {
        alert('🚀 ส่งคำขอแก้ไขข้อมูลเรียบร้อยแล้ว! ข้อมูลบนจอจะคืนค่าเดิมชั่วคราว เพื่อรอแอดมินสภานักเรียนอนุมัติความถูกต้อง');
        
        if (newPassword.trim() !== "") {
            database.ref('users/' + currentUser.studentId).update({ password: newPassword });
            const passInput = document.getElementById('prof-password');
            if (passInput) passInput.value = "";
        }

        toggleProfileFieldsLock(true);
        // สั่งดึงข้อมูลล่าสุดมาทับจอเพื่อเคลียร์ค่าฟอร์มที่พิมพ์ค้างไว้ให้สะอาด
        database.ref('users/' + currentUser.studentId).once('value', function() {});
    }).catch(err => alert('เกิดข้อผิดพลาดในการส่งคำขอ: ' + err.message));
}

function logout() {
    if (confirm('คุณต้องการออกจากระบบใช่หรือไม่?')) {
        if (currentUser) {
            database.ref('users/' + currentUser.studentId).off();
        }
        database.ref('products').off();

        localStorage.removeItem('logged_student_id');
        currentUser = null;
        base64ImageArray = [];
        resetProductForm();
        
        document.getElementById('auth-section')?.classList.remove('hidden');
        document.getElementById('dashboard-section')?.classList.add('hidden');
        document.getElementById('user-display')?.classList.add('hidden');
        document.getElementById('btn-logout')?.classList.add('hidden');
        document.getElementById('login-form')?.reset();
        
        alert('🔒 ออกจากระบบเรียบร้อยแล้ว');
    }
}

// =================================================================
// 📸 4. ระบบจัดการอัปโหลดภาพสินค้าแปลงเป็นคลาส Base64
// =================================================================
document.getElementById('p-image-file')?.addEventListener('change', function(e) {
    const files = e.target.files;
    if (files && files.length > 0) {
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

function renderImagePreviews() {
    const gridContainer = document.getElementById('image-preview-grid');
    if (!gridContainer) return;
    gridContainer.innerHTML = ''; 

    if (base64ImageArray.length > 0) {
        base64ImageArray.forEach((imgStr, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = "relative group aspect-square bg-gray-100 rounded-lg overflow-hidden border border-purple-200 shadow-sm";
            wrapper.innerHTML = `
                <img src="${imgStr}" class="h-full w-full object-cover" alt="preview">
                <button type="button" onclick="removeImageFromList(${index})" class="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white font-bold text-[10px] w-5 h-5 rounded-full flex items-center justify-center shadow transition-opacity opacity-90 sm:opacity-0 group-hover:opacity-100">
                    ✕
                </button>
            `;
            gridContainer.appendChild(wrapper);
        });
        document.getElementById('image-preview-container')?.classList.remove('hidden');
    } else {
        document.getElementById('image-preview-container')?.classList.add('hidden');
    }
}

function removeImageFromList(index) {
    base64ImageArray.splice(index, 1); 
    renderImagePreviews(); 
}

// =================================================================
// 🛍️ 5. ระบบบันทึกข้อมูล และจัดการคำขอขายสินค้า (Products Management)
// =================================================================
document.getElementById('product-form')?.addEventListener('submit', function(e) {
    e.preventDefault();
    if (!currentUser) return;

    const pId = document.getElementById('p-id').value;
    const pName = document.getElementById('p-name').value.trim();
    const pPrice = parseFloat(document.getElementById('p-price').value);
    const pCategory = document.getElementById('p-category').value;
    const pDesc = document.getElementById('p-desc').value.trim();
    
    const contactRadio = document.querySelector('input[name="contact-type"]:checked');
    const pContactType = contactRadio ? contactRadio.value : 'Facebook';
    const pContactValue = document.getElementById('p-contact').value.trim();

    if (base64ImageArray.length === 0) {
        alert('📸 กรุณาทำการอัปโหลดรูปภาพสินค้าอย่างน้อย 1 รูปก่อนส่งข้อมูล');
        return;
    }

    let productRef;
    let finalUpdateData = {};

    if (isEditingMode && pId && (currentEditingProductStatus === 'approved' || currentEditingProductStatus === 'pending_edit')) {
        productRef = database.ref('products/' + pId);
        
        finalUpdateData = {
            status: 'approved', 
            is_editing: true, 
            edit_request: {
                id: pId,
                name: pName,
                price: pPrice,
                category: pCategory,
                description: pDesc,
                image: base64ImageArray[0],
                images: base64ImageArray,
                contactType: pContactType,
                contact: pContactValue,
                seller_id: currentUser.studentId,
                status: 'pending_edit',
                timestamp: Date.now()
            }
        };

        productRef.update(finalUpdateData).then(() => {
            alert('📝 ส่งคำขอแก้ไขข้อมูลสินค้าแล้ว! โพสต์เดิมจะยังโชว์บนหน้าตลาดหลัก และค้างในตารางหน้าร้านเพื่อรอแอดมินอนุมัติครับ');
            resetProductForm();
            switchTab('product-list-tab');
        }).catch(err => alert('เกิดข้อผิดพลาดในการบันทึก: ' + err.message));

    } else {
        if (isEditingMode && pId) {
            productRef = database.ref('products/' + pId);
        } else {
            productRef = database.ref('products').push();
        }

        finalUpdateData = {
            id: isEditingMode ? pId : productRef.key,
            name: pName,
            price: pPrice,
            category: pCategory,
            description: pDesc,
            image: base64ImageArray[0], 
            images: base64ImageArray,    
            seller: currentUser.name,
            seller_id: currentUser.studentId, 
            studentId: currentUser.studentId, 
            grade: currentUser.grade,
            contactType: pContactType,
            contact: pContactValue,
            status: 'pending', 
            is_editing: false,
            edit_request: null, 
            timestamp: Date.now()
        };

        const actionTask = isEditingMode ? productRef.update(finalUpdateData) : productRef.set(finalUpdateData);

        actionTask.then(() => {
            if (isEditingMode) {
                alert('📝 บันทึกแก้ไขข้อมูลสำเร็จ! ระบบส่งกลับไปเข้าคิวรอตรวจสอบใหม่อีกครั้ง');
            } else {
                alert('🚀 ลงสินค้าใหม่สำเร็จ! กรุณารอสภานักเรียนตรวจสอบภายใน 24 ชั่วโมง');
            }
            resetProductForm();
            switchTab('product-list-tab');
        }).catch(err => alert('เกิดข้อผิดพลาดในการบันทึก: ' + err.message));
    }
});

function loadMyProducts() {
    const tableBody = document.getElementById('my-products-list');
    if (!tableBody || !currentUser) return;

    database.ref('products').off();

    database.ref('users/' + currentUser.studentId).on('value', function(userSnapshot) {
        const userData = userSnapshot.val();
        const isBanned = userData && userData.status === 'banned';

        if (isBanned) return; 

        database.ref('products').on('value', function(snapshot) {
            tableBody.innerHTML = '';
            let count = 0;

            snapshot.forEach(childSnapshot => {
                const product = childSnapshot.val();
                
                if (product.studentId === currentUser.studentId || product.seller_id === currentUser.studentId) {
                    count++;
                    
                    let statusBadge = '';
                    if (product.is_editing || product.status === 'pending_edit') {
                        statusBadge = `<span class="bg-sky-100 text-sky-800 text-xs px-2.5 py-1 rounded-full font-bold border border-sky-200">⏳ กำลังขอตรวจแก้</span>`;
                    } else if (product.status === 'approved') {
                        statusBadge = `<span class="bg-emerald-100 text-emerald-800 text-xs px-2.5 py-1 rounded-full font-bold border border-emerald-200">✅ ผ่านการอนุมัติ</span>`;
                    } else if (product.status === 'rejected') {
                        statusBadge = `<span class="bg-red-100 text-red-800 text-xs px-2.5 py-1 rounded-full font-bold border border-red-200">❌ ถูกปฏิเสธ</span>`;
                    } else {
                        statusBadge = `<span class="bg-amber-100 text-amber-800 text-xs px-2.5 py-1 rounded-full font-bold border border-amber-200">⏳ รอตรวจสอบ</span>`;
                    }

                    const totalImgs = product.images ? product.images.length : 1;
                    let actionButtons = `
                        <button onclick="prepareEditProduct('${product.id}')" class="bg-purple-100 hover:bg-purple-200 text-purple-950 text-xs font-bold px-2.5 py-1.5 rounded-md transition border border-purple-200">แก้ไข</button>
                        <button onclick="deleteProduct('${product.id}')" class="bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold px-2.5 py-1.5 rounded-md transition border border-red-100">ลบ</button>
                    `;

                    const tr = `
                        <tr class="hover:bg-gray-50/80 transition">
                            <td class="py-3 px-6 relative">
                                <img src="${product.image}" class="w-12 h-12 object-cover rounded-lg border shadow-sm" alt="product">
                                <span class="absolute bottom-2 right-4 bg-purple-900 text-white text-[10px] px-1 rounded font-bold">+${totalImgs}</span>
                            </td>
                            <td class="py-3 px-6 font-semibold text-gray-800">${product.name}</td>
                            <td class="py-3 px-6 font-bold text-purple-950">฿${product.price}</td>
                            <td class="py-3 px-6 text-gray-500 text-xs">${product.category}</td>
                            <td class="py-3 px-6 text-center">${statusBadge}</td>
                            <td class="py-3 px-6 text-center space-x-1 flex items-center justify-center h-16">
                                ${actionButtons}
                            </td>
                        </tr>
                    `;
                    tableBody.insertAdjacentHTML('beforeend', tr);
                }
            });

            const countDisplay = document.getElementById('product-count');
            if (countDisplay) countDisplay.innerText = `${count} รายการ`;

            if (count === 0) {
                tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-gray-400">คุณยังไม่เคยลงขายสินค้าชิ้นใดในระบบ</td></tr>`;
            }
        });
    });
}

function prepareEditProduct(id) {
    database.ref('products/' + id).once('value', function(snapshot) {
        const product = snapshot.val();
        if (!product) return;

        isEditingMode = true;
        currentEditingProductStatus = product.status || 'pending'; 
        switchTab('product-form-tab');

        const formTitle = document.getElementById('form-title');
        const btnSubmit = document.getElementById('btn-submit-product');

        if (currentEditingProductStatus === 'approved' || product.is_editing) {
            if (formTitle) formTitle.innerHTML = `<span>📝</span> ยื่นขอแก้ไขข้อมูล [${product.name}]`;
            if (btnSubmit) {
                btnSubmit.innerText = `💾 ส่งรายละเอียดคำขอเปลี่ยนข้อมูล`;
                btnSubmit.className = "w-full bg-sky-600 text-white font-bold py-2 rounded-lg hover:bg-sky-700 transition shadow text-xs border-b-2 border-sky-800";
            }
        } else {
            if (formTitle) formTitle.innerHTML = `<span>📝</span> กำลังแก้ไขข้อมูลสินค้า [${product.name}]`;
            if (btnSubmit) {
                btnSubmit.innerText = `💾 บันทึกและส่งรีวิวอนุมัติใหม่`;
                btnSubmit.className = "w-full bg-amber-500 text-purple-950 font-bold py-2 rounded-lg hover:bg-amber-600 transition shadow text-xs border-b-2 border-amber-700";
            }
        }
        
        document.getElementById('btn-cancel-edit')?.classList.remove('hidden');

        const displaySource = product.edit_request ? product.edit_request : product;

        document.getElementById('p-id').value = product.id;
        document.getElementById('p-name').value = displaySource.name;
        document.getElementById('p-price').value = displaySource.price;
        document.getElementById('p-category').value = displaySource.category;
        document.getElementById('p-desc').value = displaySource.description || '';
        
        const savedType = displaySource.contactType || 'Facebook';
        const radioToSelect = document.querySelector(`input[name="contact-type"][value="${savedType}"]`);
        if (radioToSelect) {
            radioToSelect.checked = true;
            handleContactTypeChange(); 
        }
        document.getElementById('p-contact').value = displaySource.contact || '';

        base64ImageArray = displaySource.images ? [...displaySource.images] : (displaySource.image ? [displaySource.image] : []);
        renderImagePreviews();

        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

function deleteProduct(id) {
    if (confirm('🚨 คุณแน่ใจหรือไม่ที่จะลบรายการสินค้าชิ้นนี้ออกจากระบบแบบถาวร?')) {
        database.ref('products/' + id).remove().then(() => {
            alert('🗑️ ลบรายการสินค้าเรียบร้อยแล้ว!');
            if (document.getElementById('p-id').value === id) {
                resetProductForm();
            }
        }).catch(err => alert('เกิดข้อผิดพลาดในการลบ: ' + err.message));
    }
}

function resetProductForm() {
    isEditingMode = false;
    currentEditingProductStatus = 'pending'; 
    const form = document.getElementById('product-form');
    if (form) form.reset();
    
    const pId = document.getElementById('p-id');
    if (pId) pId.value = '';
    base64ImageArray = [];
    
    const formTitle = document.getElementById('form-title');
    if (formTitle) formTitle.innerHTML = `<span>➕</span> ลงทะเบียนขายสินค้าใหม่`;
    
    document.getElementById('btn-cancel-edit')?.classList.add('hidden');
    
    const btnSubmit = document.getElementById('btn-submit-product');
    if (btnSubmit) {
        btnSubmit.innerText = `🚀 ส่งข้อมูลให้สภานักเรียนตรวจสอบ`;
        btnSubmit.className = "w-full bg-purple-900 text-white font-bold py-2 rounded-lg hover:bg-purple-800 transition shadow text-xs border-b-2 border-purple-950";
    }
    
    const grid = document.getElementById('image-preview-grid');
    if (grid) grid.innerHTML = '';
    document.getElementById('image-preview-container')?.classList.add('hidden');
}

function handleContactTypeChange() {
    const contactRadio = document.querySelector('input[name="contact-type"]:checked');
    if (!contactRadio) return;
    
    const contactType = contactRadio.value;
    const label = document.getElementById('contact-label');
    const input = document.getElementById('p-contact');

    if (!label || !input) return;

    if (contactType === 'Facebook') {
        label.innerText = 'ลิงก์โปรไฟล์ Facebook หรือชื่อเฟส';
        input.placeholder = 'เช่น m.me/your.profile หรือ ชื่อ-นามสกุลเฟส';
    } else if (contactType === 'Instagram') {
        label.innerText = 'ชื่อผู้ใช้ Instagram (IG)';
        input.placeholder = 'เช่น @kc_market (ใส่ชื่อผู้ใช้ที่มี @)';
    }
}

// =================================================================
// 🏫 6. ฟังก์ชันจัดการคำนวณและแจกแจงจำนวนห้องเรียน
// =================================================================
function generateRoomOptions(totalRooms, roomSelect) {
    for (let i = 1; i <= totalRooms; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.text = `ห้อง ${i}`;
        roomSelect.appendChild(option);
    }
}

function updateRoomOptions() {
    const levelSelect = document.getElementById('reg-level');
    const roomSelect = document.getElementById('reg-room');
    if (!levelSelect || !roomSelect) return;
    
    const selectedLevel = levelSelect.value;
    roomSelect.innerHTML = '<option value="" disabled selected>เลือกห้อง</option>';
    let totalRooms = 0;

    if (['ม.1', 'ม.2', 'ม.3'].includes(selectedLevel)) {
        totalRooms = 12; 
    } else if (selectedLevel === 'ม.4') {
        totalRooms = 8;  
    } else if (['ม.5', 'ม.6'].includes(selectedLevel)) {
        totalRooms = 7;  
    } else if (['ปวช.1', 'ปวช.2', 'ปวช.3'].includes(selectedLevel)) {
        totalRooms = 2;  
    }

    if (totalRooms > 0) {
        roomSelect.disabled = false;
        roomSelect.classList.remove('bg-gray-50'); 
        generateRoomOptions(totalRooms, roomSelect);
    } else {
        roomSelect.disabled = true;
        roomSelect.classList.add('bg-gray-50');
    }
}

function updateProfileRoomOptions() {
    const levelSelect = document.getElementById('prof-level');
    const roomSelect = document.getElementById('prof-room');
    if (!levelSelect || !roomSelect) return;

    const selectedLevel = levelSelect.value;
    roomSelect.innerHTML = '';
    let totalRooms = 0;

    if (['ม.1', 'ม.2', 'ม.3'].includes(selectedLevel)) {
        totalRooms = 12; 
    } else if (selectedLevel === 'ม.4') {
        totalRooms = 8;  
    } else if (['ม.5', 'ม.6'].includes(selectedLevel)) {
        totalRooms = 7;  
    } else if (['ปวช.1', 'ปวช.2', 'ปวช.3'].includes(selectedLevel)) {
        totalRooms = 2;  
    }

    generateRoomOptions(totalRooms, roomSelect);
}