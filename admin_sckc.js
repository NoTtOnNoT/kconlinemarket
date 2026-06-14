// Realtime Database Configuration
const firebaseConfig = {
  apiKey: "AIzaSyBoV4p65uQ3ThpwN9Zw34GWEz7yElB2ymI",
  authDomain: "kc-onlinemarket.firebaseapp.com",
  databaseURL:
    "https://kc-onlinemarket-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "kc-onlinemarket",
  storageBucket: "kc-onlinemarket.firebasestorage.app",
  messagingSenderId: "321029641421",
  appId: "1:321029641421:web:7a007bd06159ffc309c584",
};

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

const loginModal = document.getElementById("login-modal");
const adminContent = document.getElementById("admin-content");
const sidebar = document.getElementById("sidebar");

// UI Date Display
const options = {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
};
document.getElementById("current-date").innerText =
  new Date().toLocaleDateString("th-TH", options);

// Security Routing
if (sessionStorage.getItem("admin_authenticated") === "true") {
  showAdminPanel(sessionStorage.getItem("admin_user"));
} else {
  showLoginModal();
}

function showAdminPanel(username) {
  if (loginModal) loginModal.classList.add("hidden");
  if (adminContent)
    adminContent.classList.remove("opacity-0", "pointer-events-none");

  const userDisplay = document.getElementById("admin-user-display");
  if (userDisplay) {
    userDisplay.innerHTML = `<span class="w-2 h-2 rounded-full bg-green-500"></span> ${username} (แอดมิน)`;
  }
  loadRealtimeData();
  setupSearchFilters();
  if (typeof lucide !== "undefined") lucide.createIcons();
}

function showLoginModal() {
  if (adminContent)
    adminContent.classList.add("opacity-0", "pointer-events-none");
  if (loginModal) loginModal.classList.remove("hidden");
  if (typeof lucide !== "undefined") lucide.createIcons();
}

// Login Submit
document.getElementById("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const inputUser = document.getElementById("login-username").value.trim();
  const inputPass = document.getElementById("login-password").value;

  database
    .ref("admin_config")
    .once("value")
    .then((snapshot) => {
      const config = snapshot.val();
      if (config) {
        if (inputUser === config.username && inputPass === config.password) {
          sessionStorage.setItem("admin_authenticated", "true");
          sessionStorage.setItem("admin_user", config.username);
          alert("🔓 เข้าสู่ระบบจัดการสภานักเรียนสำเร็จ!");
          showAdminPanel(config.username);
        } else {
          alert("❌ ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง!");
        }
      } else {
        alert("⚠️ ไม่พบโฟลเดอร์ข้อมูลบัญชีแอดมิน (admin_config) ในฐานข้อมูล");
      }
    })
    .catch((error) => {
      alert("เกิดข้อผิดพลาด: " + error.message);
    });
});

document.getElementById("logout-btn").addEventListener("click", () => {
  if (confirm("คุณต้องการออกจากระบบควบคุมใช่หรือไม่?")) {
    sessionStorage.removeItem("admin_authenticated");
    sessionStorage.removeItem("admin_user");
    window.location.reload();
  }
});

function toggleSidebar() {
  if (sidebar) sidebar.classList.toggle("hidden");
}

function switchTab(tabName) {
  document
    .querySelectorAll(".tab-content")
    .forEach((el) => el.classList.add("hidden"));
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("bg-slate-800", "text-white");
    btn.classList.add("hover:bg-slate-800", "hover:text-white");
  });

  const targetTab = document.getElementById(`tab-${tabName}`);
  if (targetTab) targetTab.classList.remove("hidden");

  const activeBtn = document.getElementById(`btn-${tabName}`);
  if (activeBtn) {
    activeBtn.classList.remove("hover:bg-slate-800", "hover:text-white");
    activeBtn.classList.add("bg-slate-800", "text-white");
  }

  if (window.innerWidth < 768 && sidebar) {
    sidebar.classList.add("hidden");
  }
}

// Update Product Status
function updateStatus(productId, newStatus) {
  if (newStatus === "deleted") {
    if (
      confirm("⚠️ คุณแน่ใจใช่ไหมที่จะปฏิเสธหรือลบสินค้านี้ออกจากระบบหน้าเว็บ?")
    ) {
      database
        .ref("products/" + productId)
        .remove()
        .then(() => alert("🗑️ ลบข้อมูลเรียบร้อยแล้ว"))
        .catch((err) => alert("เกิดข้อผิดพลาด: " + err.message));
    }
  } else if (newStatus === "approve_edit") {
    database
      .ref("products/" + productId)
      .once("value")
      .then((prodSnap) => {
        const currentProd = prodSnap.val();
        const editData = currentProd ? currentProd.edit_request : null;
        if (editData) {
          database
            .ref("products/" + productId)
            .update({
              name: editData.name,
              category: editData.category,
              price: editData.price,
              description: editData.description,
              image: editData.image || "",
              seller: currentProd.seller,
              seller_id: currentProd.seller_id,
              grade: currentProd.grade || "",
              status: "approved",
              edit_request: null,
            })
            .then(() => {
              alert(
                "🎯 อนุมัติการแก้ไขข้อมูลสินค้าสำเร็จ ข้อมูลบนเว็บได้รับการอัปเดตแล้ว!",
              );
            })
            .catch((err) => alert("เกิดข้อผิดพลาด: " + err.message));
        }
      });
  } else if (newStatus === "reject_edit") {
    if (
      confirm(
        "คุณต้องการปฏิเสธคำขอแก้ไขนี้ และใช้ข้อมูลเดิมของสินค้าใช่หรือไม่?",
      )
    ) {
      database
        .ref("products/" + productId)
        .update({
          status: "approved",
          edit_request: null,
        })
        .then(() => {
          alert(
            "❌ ปฏิเสธคำขอแก้ไขข้อมูลแล้ว (สินค้ายังคงแสดงผลด้วยข้อมูลเดิม)",
          );
        })
        .catch((err) => alert("เกิดข้อผิดพลาด: " + err.message));
    }
  } else {
    database
      .ref("products/" + productId)
      .update({
        status: newStatus,
      })
      .then(() => {
        alert("🎯 อนุมัติการแสดงผลเรียบร้อย!");
      })
      .catch((err) => alert("เกิดข้อผิดพลาด: " + err.message));
  }
}

// ฟังก์ชันจัดการคำขอแก้ไขข้อมูลส่วนตัว (เวอร์ชันปลอดภัย ไม่ทำรหัสผ่านและข้อมูลเดิมหาย)
function handleProfileRequest(requestId, studentId, action) {
    if (!studentId) {
        alert('⚠️ เกิดข้อผิดพลาด: ไม่พบรหัสประจำตัวของนักเรียนรายนี้');
        return;
    }

    if (action === 'approve') {
        // 1. ดึงข้อมูลปัจจุบันของนักเรียนคนนี้คนเดียว ออกมาจากตาราง users
        database.ref(`users/${studentId}`).once('value').then((userSnap) => {
            if (!userSnap.exists()) {
                alert('⚠️ ไม่พบข้อมูลผู้ใช้งานรหัสนี้ในระบบ');
                return;
            }

            const userData = userSnap.val();
            
            // เตรียมแยกคำว่า "ม.5/1" ออกเป็น "ม.5" กับ "1" เพื่อโชว์ในกล่องข้อความ
            let currentGradeOnly = "ม.5";
            let currentRoomOnly = "1";
            if (userData.grade && userData.grade.includes('/')) {
                const parts = userData.grade.split('/');
                currentGradeOnly = parts[0]; 
                currentRoomOnly = parts[1];  
            } else if (userData.grade) {
                currentGradeOnly = userData.grade;
            }

            // 2. แสดงกล่องข้อความให้แอดมินตรวจสอบและแก้ไขทีละฟิลด์
            const newFirstName = prompt("✏️ [แก้ไขชื่อจริง] ของนักเรียนรายนี้:", userData.firstName || "");
            if (newFirstName === null) return; // แอดมินกดยกเลิก

            const newLastName = prompt("✏️ [แก้ไขนามสกุล] ของนักเรียนรายนี้:", userData.lastName || "");
            if (newLastName === null) return;

            const newGradeOnly = prompt("✏️ [แก้ไขระดับชั้น] (เช่น ม.4, ม.5, ม.6):", currentGradeOnly);
            if (newGradeOnly === null) return;

            const newRoomOnly = prompt("✏️ [แก้ไขห้องเรียน] (ใส่เฉพาะตัวเลขห้อง เช่น 1, 2, 3):", currentRoomOnly);
            if (newRoomOnly === null) return;

            // 3. รวมระดับชั้นกับห้องกลับมาเป็นรูปแบบ "ม.X/Y"
            const finalGrade = `${newGradeOnly.trim()}/${newRoomOnly.trim()}`;
            const fullName = `${newFirstName.trim()} ${newLastName.trim()}`;

            // 🌟 สำคัญมาก: ใช้การเจาะจงระบุฟิลด์ที่จะอัปเดต เพื่อไม่ให้ฟิลด์อื่น เช่น password หรือ status หายไป
            const productUpdates = {};
            productUpdates[`users/${studentId}/firstName`] = newFirstName.trim();
            productUpdates[`users/${studentId}/lastName`] = newLastName.trim();
            productUpdates[`users/${studentId}/name`] = fullName;
            productUpdates[`users/${studentId}/grade`] = finalGrade;

            // 4. บันทึกคำสั่งลง Firebase ไปที่ users พร้อมกับลบคิวคำขอ
            return database.ref().update(productUpdates)
                .then(() => {
                    // ลบคำขอแก้ไขนี้ออกจากรายการคิวของแอดมิน
                    return database.ref(`profile_requests/${requestId}`).remove();
                });
        }).then(() => {
            alert(`✨ อนุมัติสำเร็จ! ระบบทำการแก้ไขข้อมูลเฉพาะส่วนของรหัสนักเรียน ${studentId} เรียบร้อยแล้ว (รหัสผ่านยังคงเดิม)`);
        }).catch(err => {
            alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล: ' + err.message);
        });

    } else if (action === 'reject') {
        if (confirm('❌ คุณต้องการ "ปฏิเสธ" และลบคำขอแก้ไขนี้ใช่หรือไม่? (ข้อมูลเดิมของนักเรียนจะไม่เปลี่ยนแปลง)')) {
            database.ref(`profile_requests/${requestId}`).remove()
                .then(() => alert('🗑️ ปฏิเสธคำขอและลบออกจากรายการเรียบร้อยแล้ว'))
                .catch(err => alert('เกิดข้อผิดพลาด: ' + err.message));
        }
    }
}

// Show Student Detail Modal
function showStudentDetail(studentId) {
  database
    .ref(`users/${studentId}`)
    .once("value")
    .then((snapshot) => {
      if (!snapshot.exists()) return;

      const data = snapshot.val();
      let modal = document.getElementById("studentDetailModal");

      if (!modal) {
        const modalHTML = `
            <div id="studentDetailModal" class="fixed inset-0 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center z-50 hidden opacity-0 transition-opacity duration-200" onclick="closeStudentModal()">
                <div class="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 overflow-hidden transform scale-95 transition-transform duration-200 flex flex-col max-h-[90vh]" onclick="event.stopPropagation()">
                    <div class="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                        <h3 class="font-bold text-slate-800 text-base flex items-center gap-2">
                            <i data-lucide="shield-alert" class="w-4 h-4 text-indigo-600"></i> รายละเอียดข้อมูลในระบบทั้งหมด
                        </h3>
                        <button onclick="closeStudentModal()" class="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-200/60 transition">
                            <i data-lucide="x" class="w-4 h-4"></i>
                        </button>
                    </div>
                    <div class="p-6 space-y-4 overflow-y-auto" id="modalContent"></div>
                    <div class="p-4 bg-slate-50 border-t border-slate-100 text-right shrink-0">
                        <button onclick="closeStudentModal()" class="bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-medium transition shadow-sm">
                            ปิดหน้าต่าง
                        </button>
                    </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML("beforeend", modalHTML);
        modal = document.getElementById("studentDetailModal");
      }

      const modalContent = document.getElementById("modalContent");

      let detailHTML = `
            <div class="bg-indigo-50/60 p-4 rounded-xl border border-indigo-100/80">
                <div class="text-[10px] text-indigo-500 font-bold uppercase tracking-wider">รหัสนักเรียน (Key UID)</div>
                <div class="text-lg font-mono font-bold text-indigo-700 mt-0.5">${studentId}</div>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div class="border border-slate-100 p-3 rounded-xl bg-slate-50/30">
                    <div class="text-xs text-slate-400 font-medium">ชื่อ-นามสกุล</div>
                    <div class="font-semibold text-slate-800 mt-0.5">${data.name || "ไม่ได้ระบุ"}</div>
                </div>
                <div class="border border-slate-100 p-3 rounded-xl bg-slate-50/30">
                    <div class="text-xs text-slate-400 font-medium">ระดับชั้น</div>
                    <div class="font-semibold text-slate-800 mt-0.5"> ม. ${data.grade || "ไม่ได้ระบุ"}</div>
                </div>
            </div>
            <div class="border border-slate-100 p-3 rounded-xl bg-slate-50/30">
                <div class="text-xs text-slate-400 font-medium">รหัสผ่านสำหรับเข้าสู่ระบบ (password)</div>
                <div class="font-mono text-sm text-slate-700 mt-1 bg-white border border-slate-200 p-2.5 rounded-lg select-all" title="ดับเบิ้ลคลิกเพื่อคัดลอก">${data.password || "------"}</div>
            </div>
        `;

      let additionalFields = "";
      Object.keys(data).forEach((key) => {
        if (!["name", "grade", "password", "status"].includes(key)) {
          additionalFields += `
                    <div class="border border-slate-100 p-3 rounded-xl bg-slate-50/30">
                        <div class="text-xs text-slate-400 font-medium capitalize">ฟิลด์ข้อมูล: ${key}</div>
                        <div class="font-mono text-sm font-semibold text-slate-700 mt-0.5">${data[key]}</div>
                    </div>`;
        }
      });

      if (additionalFields !== "") {
        detailHTML += `<div class="pt-2 border-t border-dashed border-slate-100 space-y-3">${additionalFields}</div>`;
      }

      modalContent.innerHTML = detailHTML;

      modal.classList.remove("hidden");
      setTimeout(() => {
        modal.classList.remove("opacity-0");
        modal.querySelector(".transform").classList.remove("scale-95");
      }, 10);

      if (typeof lucide !== "undefined") lucide.createIcons();
    });
}

function closeStudentModal() {
  const modal = document.getElementById("studentDetailModal");
  if (modal) {
    modal.classList.add("opacity-0");
    modal.querySelector(".transform").classList.add("scale-95");
    setTimeout(() => modal.classList.add("hidden"), 200);
  }
}

// Data Stream Listener
function loadRealtimeData() {
  let countPending = 0;
  let countEdits = 0;
  let countApproved = 0;
  let countUsers = 0;
  let countProfileReqs = 0;

  const pendingTable = document.getElementById("pending-table");
  const editsTable = document.getElementById("edits-table");
  const approvedTable = document.getElementById("approved-table");
  const usersTable = document.getElementById("users-table");
  const profileReqsTable = document.getElementById("profile-requests-table");

  const updateStatsUI = () => {
    if (document.getElementById("stat-pending"))
      document.getElementById("stat-pending").innerText = countPending;
    if (document.getElementById("stat-edits"))
      document.getElementById("stat-edits").innerText = countEdits;
    if (document.getElementById("stat-approved"))
      document.getElementById("stat-approved").innerText = countApproved;
    if (document.getElementById("stat-users"))
      document.getElementById("stat-users").innerText = countUsers;
    if (document.getElementById("stat-profile-reqs"))
      document.getElementById("stat-profile-reqs").innerText = countProfileReqs;

    const badgePending = document.getElementById("badge-pending");
    if (badgePending) {
      badgePending.innerText = countPending;
      badgePending.classList.toggle("hidden", countPending === 0);
    }

    const badgeEdits = document.getElementById("badge-edits");
    if (badgeEdits) {
      badgeEdits.innerText = countEdits;
      badgeEdits.classList.toggle("hidden", countEdits === 0);
    }
  };

  // 1. Fetch pending items
  database
    .ref("products")
    .orderByChild("status")
    .equalTo("pending")
    .on("value", (snapshot) => {
      if (!pendingTable) return;
      pendingTable.innerHTML = "";
      countPending = snapshot.numChildren();

      if (countPending === 0) {
        pendingTable.innerHTML = `<tr><td colspan="5" class="text-center py-12 text-slate-400 font-medium">🎉 ไม่มีสินค้ารอการตรวจสอบในขณะนี้</td></tr>`;
      } else {
        snapshot.forEach((childSnapshot) => {
          const product = childSnapshot.val();
          const productId = childSnapshot.key;

          // ในฟังก์ชัน loadRealtimeData() ข้อที่ 5. Real-time Stream Profile Requests ให้เปลี่ยนตรงตัวแปร row เป็นแบบนี้:
          const row = `
    <tr class="hover:bg-slate-50 transition border-b border-slate-100">
        <td class="py-3 px-4 font-mono font-bold text-slate-700">${reqData.studentId}</td>
        <td class="py-3 px-4 text-xs">
            <div class="font-semibold text-slate-800">${reqData.senderName}</div>
            <div class="text-[10px] text-slate-400">เวลา: ${dateStr}</div>
        </td>
        <td class="py-3 px-4 text-xs text-sky-600 font-medium">
            ขอเปลี่ยนรหัสผ่านเป็น: <span class="font-mono bg-sky-50 px-1.5 py-0.5 rounded border border-sky-100">${details.newPassword || "-"}</span>
        </td>
        <td class="py-3 px-4 text-center">
            <div class="flex gap-1 justify-center">
                <button onclick="handleProfileRequest('${reqId}', '${reqData.studentId}', 'approve')" class="bg-sky-600 hover:bg-sky-700 text-white px-2 py-1 rounded text-[11px] font-medium transition">อนุมัติ</button>
                <button onclick="handleProfileRequest('${reqId}', '${reqData.studentId}', 'reject')" class="bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-600 px-2 py-1 rounded text-[11px] font-medium transition">ปฏิเสธ</button>
            </div>
        </td>
    </tr>`;
          pendingTable.insertAdjacentHTML("beforeend", row);
        });
      }
      updateStatsUI();
      if (typeof lucide !== "undefined") lucide.createIcons();
    });

  // 2. Fetch edit request items
  database
    .ref("products")
    .orderByChild("status")
    .equalTo("pending_edit")
    .on("value", (snapshot) => {
      if (!editsTable) return;
      editsTable.innerHTML = "";
      countEdits = snapshot.numChildren();

      if (countEdits === 0) {
        editsTable.innerHTML = `<tr><td colspan="5" class="text-center py-12 text-slate-400 font-medium">✨ ไม่มีคำขอแก้ไขข้อมูลสินค้าในระบบในขณะนี้</td></tr>`;
      } else {
        snapshot.forEach((childSnapshot) => {
          const product = childSnapshot.val();
          const productId = childSnapshot.key;
          const req = product.edit_request || {};

          const nameChanged = req.name && req.name !== product.name;
          const catChanged = req.category && req.category !== product.category;
          const priceChanged =
            req.price && Number(req.price) !== Number(product.price);
          const descChanged =
            req.description && req.description !== product.description;
          const imgChanged = req.image && req.image !== product.image;

          const row = `
                    <tr class="hover:bg-slate-50 transition duration-150 border-b border-slate-100">
                        <td class="py-4 px-6 inline-block relative">
                            <img src="${req.image || product.image || "https://via.placeholder.com/150"}" class="w-16 h-16 object-cover rounded-xl border-2 ${imgChanged ? "border-sky-500 shadow-md" : "border-slate-100"}" loading="lazy">
                            ${imgChanged ? `<span class="absolute top-2 left-2 bg-sky-500 text-white text-[9px] px-1 rounded font-bold uppercase">รูปใหม่</span>` : ""}
                        </td>
                        <td class="py-4 px-6">
                            <div class="space-y-1">
                                <div class="text-xs text-slate-400">ชื่อสินค้า:</div>
                                <div class="font-bold ${nameChanged ? "text-sky-600 bg-sky-50 px-1.5 py-0.5 rounded inline-block" : "text-slate-800"} text-base">
                                    ${nameChanged ? `${req.name} <span class="text-xs text-slate-400 font-normal line-through block">เดิม: ${product.name}</span>` : product.name}
                                </div>
                                <div class="text-xs text-slate-400 mt-2">หมวดหมู่:</div>
                                <div class="text-xs ${catChanged ? "text-amber-700 bg-amber-50 border border-amber-200" : "text-indigo-600 bg-indigo-50"} px-2 py-0.5 rounded-full inline-block font-medium">
                                    ${catChanged ? `${req.category} (เดิม: ${product.category})` : product.category}
                                </div>
                                <div class="text-xs text-slate-400 mt-2">รายละเอียด:</div>
                                <p class="text-xs p-2 rounded max-w-xs ${descChanged ? "bg-sky-50/60 text-slate-700 border-l-2 border-sky-400" : "text-slate-500"}">
                                    ${descChanged ? `${req.description} <span class="block text-[10px] text-slate-400 italic mt-0.5 line-through">เดิม: ${product.description || "ไม่มี"}</span>` : product.description || "ไม่มีคำอธิบาย"}
                                </p>
                            </div>
                        </td>
                        <td class="py-4 px-6 font-bold">
                            <div class="text-xs text-slate-400 font-normal mb-1">ราคา:</div>
                            ${
                              priceChanged
                                ? `
                                <span class="text-sky-600 text-base block">฿${req.price}</span>
                                <span class="text-xs text-slate-400 line-through font-normal block">เดิม: ฿${product.price}</span>
                            `
                                : `<span class="text-slate-700 text-sm">฿${product.price}</span>`
                            }
                        </td>
                        <td class="py-4 px-6 text-xs text-slate-500 font-medium">
                            <div class="text-xs text-slate-400 font-normal mb-1">ผู้ลงขาย:</div>
                            <span class="text-slate-800 font-semibold">${product.seller || "ไม่ทราบชื่อ"}</span>
                            <span class="block text-[10px] text-slate-400 mt-1">ID สินค้า: <span class="font-mono bg-slate-100 px-1 rounded">${productId}</span></span>
                        </td>
                        <td class="py-4 px-6 text-center">
                            <div class="flex flex-col items-center justify-center gap-2">
                                <button onclick="updateStatus('${productId}', 'approve_edit')" class="w-full bg-sky-600 text-white px-3 py-2 rounded-xl font-semibold hover:bg-sky-700 shadow-sm transition text-xs flex items-center justify-center gap-1">
                                    <i data-lucide="check" class="w-3.5 h-3.5"></i> อัปเดตข้อมูลใหม่
                                </button>
                                <button onclick="updateStatus('${productId}', 'reject_edit')" class="w-full bg-slate-100 text-slate-600 px-3 py-2 rounded-xl font-semibold hover:bg-rose-50 hover:text-rose-600 transition text-xs flex items-center justify-center gap-1">
                                    <i data-lucide="x" class="w-3.5 h-3.5"></i> ใช้ข้อมูลเดิม
                                </button>
                            </div>
                        </td>
                    </tr>`;
          editsTable.insertAdjacentHTML("beforeend", row);
        });
      }
      updateStatsUI();
      if (typeof lucide !== "undefined") lucide.createIcons();
    });

  // 3. Fetch approved items
  database
    .ref("products")
    .orderByChild("status")
    .equalTo("approved")
    .limitToLast(100)
    .on("value", (snapshot) => {
      if (!approvedTable) return;
      approvedTable.innerHTML = "";
      countApproved = snapshot.numChildren();

      if (countApproved === 0) {
        approvedTable.innerHTML = `<tr><td colspan="5" class="text-center py-12 text-slate-400 font-medium">📭 ปัจจุบันไม่มีสินค้าที่กำลังออนไลน์อยู่</td></tr>`;
      } else {
        snapshot.forEach((childSnapshot) => {
          const product = childSnapshot.val();
          const productId = childSnapshot.key;

          const row = `
                    <tr class="hover:bg-slate-50 transition duration-150 data-row-approved">
                        <td class="py-4 px-6 font-semibold text-slate-800 search-target">${product.name}</td>
                        <td class="py-4 px-6 text-xs text-slate-500">${product.category}</td>
                        <td class="py-4 px-6 font-bold text-emerald-600">฿${product.price}</td>
                        <td class="py-4 px-6 text-xs text-slate-500 search-target">${product.seller}</td>
                        <td class="py-4 px-6 text-center">
                            <button onclick="updateStatus('${productId}', 'deleted')" class="text-rose-500 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1 mx-auto"><i data-lucide="eye-off" class="w-3.5 h-3.5"></i> ถอนการแสดงผล</button>
                        </td>
                    </tr>`;
          approvedTable.insertAdjacentHTML("beforeend", row);
        });
      }
      updateStatsUI();
      if (typeof lucide !== "undefined") lucide.createIcons();
    });

  // 4. Fetch users items
  database.ref("users").on("value", (snapshot) => {
    if (!usersTable) return;
    usersTable.innerHTML = "";
    countUsers = snapshot.numChildren();

    if (!snapshot.exists()) {
      usersTable.innerHTML = `<tr><td colspan="5" class="text-center py-12 text-slate-400 font-medium">📭 ยังไม่มีข้อมูลนักเรียนในระบบ</td></tr>`;
      updateStatsUI();
      return;
    }

    snapshot.forEach((childSnapshot) => {
      const studentId = childSnapshot.key;
      const userData = childSnapshot.val();

      const userName = userData.name || "ไม่ได้ระบุชื่อ";
      const userGrade = userData.grade || "ไม่ได้ระบุชั้นปี";
      const userStatus = userData.status || "normal";

      let statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                                <span class="w-1.5 h-1.5 rounded-full bg-green-500"></span> ปกติ
                               </span>`;
      let banButtonText = "แบนบัญชีนี้";
      let banButtonColor =
        "bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200";
      let banIcon = "ban";

      if (userStatus === "banned") {
        statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200 animate-pulse">
                                <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span> ระงับการใช้งาน
                               </span>`;
        banButtonText = "ปลดแบนบัญชี";
        banButtonColor =
          "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300";
        banIcon = "unlock";
      }

      const row = `
                <tr onclick="showStudentDetail('${studentId}')" class="hover:bg-indigo-50/40 cursor-pointer transition duration-150 border-b border-slate-100/80 data-row-user">
                    <td class="py-4 px-6 font-mono font-bold text-indigo-600 search-target">${studentId}</td>
                    <td class="py-4 px-6">
                        <div class="flex items-center gap-2.5">
                            <div class="w-8 h-8 rounded-full bg-slate-100 text-slate-600 border border-slate-200/60 flex items-center justify-center font-bold text-xs uppercase">
                                ${userName.charAt(0)}
                            </div>
                            <span class="font-semibold text-slate-800 search-target">${userName}</span>
                        </div>
                    </td>
                    <td class="py-4 px-6">
                        <span class="bg-slate-100 text-slate-600 text-xs px-2.5 py-1 rounded-md font-medium border border-slate-200/50">ม. ${userGrade}</span>
                    </td>
                    <td class="py-4 px-6">
                        ${statusBadge}
                    </td>
                    <td class="py-4 px-6 text-right">
                        <div class="flex items-center justify-end gap-2">
                            <button onclick="event.stopPropagation(); toggleBanUser('${studentId}', '${userStatus}')" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1 ${banButtonColor}">
                                <i data-lucide="${banIcon}" class="w-3.5 h-3.5"></i> ${banButtonText}
                            </button>
                            <span class="text-xs text-indigo-500 font-semibold bg-indigo-50/0 hover:bg-indigo-50 px-2 py-1.5 rounded-md transition inline-flex items-center gap-1">
                                ดูข้อมูลเพิ่ม <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
                            </span>
                        </div>
                    </td>
                </tr>`;
      usersTable.insertAdjacentHTML("beforeend", row);
    });

    updateStatsUI();
    if (typeof lucide !== "undefined") lucide.createIcons();
  });

  // 5. Real-time Stream Profile Requests (เวอร์ชันดึงค่าแสดงเพื่อเตรียมกดยอมรับและอัปเดตอัตโนมัติ)
  if (profileReqsTable) {
    database.ref("profile_requests").on("value", (snapshot) => {
      profileReqsTable.innerHTML = "";
      const countProfileReqs = snapshot.numChildren();

      if (countProfileReqs === 0) {
        profileReqsTable.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-slate-400 text-xs">🎉 ไม่มีคำขอแก้ไขข้อมูลส่วนตัวค้างอยู่</td></tr>`;
        if (typeof updateStatsUI === "function") updateStatsUI();
        return;
      }

      snapshot.forEach((childSnapshot) => {
        const reqId = childSnapshot.key;
        const reqData = childSnapshot.val();

        const requestText =
          reqData.requestDetails || "ไม่ได้ระบุรายละเอียดคำขอ";
        const currentClassText = reqData.currentClass || "ไม่ได้ระบุ";
        const dateStr = reqData.timestamp
          ? new Date(reqData.timestamp).toLocaleString("th-TH", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "-";
        const studentId = reqData.studentId || "";

        const row = `
                <tr id="req-row-${reqId}" class="hover:bg-slate-50 transition border-b border-slate-100">
                    <td class="py-4 px-4 font-mono font-bold text-indigo-600 align-top">${studentId}</td>
                    <td class="py-4 px-4 text-xs align-top">
                        <div class="font-bold text-slate-800 text-sm">${reqData.senderName || "ไม่ระบุชื่อ"}</div>
                        <div class="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                            <i data-lucide="clock" class="w-3 h-3"></i> ส่งคำขอเมื่อ: ${dateStr} น.
                        </div>
                    </td>
                    <td class="py-4 px-4 text-xs align-top">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200/60 max-w-xl">
                            
                            <div class="space-y-1.5 border-r border-slate-200/80 pr-2">
                                <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                    <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span> ชั้นเรียนเดิมตอนส่งคำขอ
                                </div>
                                <div class="p-2 bg-white rounded-lg border border-slate-100 font-medium text-slate-700">
                                    ชั้นเรียน: <span class="text-indigo-600 font-bold">${currentClassText}</span>
                                </div>
                            </div>

                            <div class="space-y-1.5 pl-1">
                                <div class="text-[10px] font-bold text-amber-600 uppercase tracking-wider flex items-center gap-1">
                                    <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span> รายละเอียดสิ่งที่ขอแก้ไข
                                </div>
                                <div class="p-2 bg-amber-50/70 border border-amber-200 text-amber-900 rounded-lg font-bold flex items-start gap-1">
                                    <span>✏️</span>
                                    <span class="leading-relaxed">${requestText}</span>
                                </div>
                            </div>

                        </div>
                    </td>
                    <td class="py-4 px-4 text-center align-top">
                        <div class="flex flex-col gap-2 justify-center items-center h-full pt-1">
                            <button onclick="handleProfileRequest('${reqId}', '${studentId}', 'approve')" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1 shadow-sm">
                                <i data-lucide="check-circle" class="w-3.5 h-3.5"></i> อนุญาตและอัปเดตข้อมูล
                            </button>
                            <button onclick="handleProfileRequest('${reqId}', '${studentId}', 'reject')" class="w-full bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1 border border-slate-200">
                                <i data-lucide="x-circle" class="w-3.5 h-3.5"></i> ปฏิเสธคำขอ
                            </button>
                        </div>
                    </td>
                </tr>`;

        profileReqsTable.insertAdjacentHTML("beforeend", row);
      });

      if (typeof updateStatsUI === "function") updateStatsUI();
      if (typeof lucide !== "undefined") lucide.createIcons();
    });
  }
}

function toggleBanUser(studentId, currentStatus) {
  const status =
    !currentStatus || currentStatus === "undefined" ? "normal" : currentStatus;

  if (status === "banned") {
    if (
      confirm(
        `🔓 คุณต้องการ "ปลดแบน" บัญชีรหัสนักเรียน ${studentId} ใช่หรือไม่?`,
      )
    ) {
      database
        .ref(`users/${studentId}`)
        .update({ status: "normal" })
        .then(() => alert("✨ ปลดแบนบัญชีเรียบร้อยแล้ว!"))
        .catch((err) => alert("เกิดข้อผิดพลาด: " + err.message));
    }
  } else {
    if (
      confirm(`⚠️ คุณแน่ใจใช่ไหมที่จะ "แบนบัญชี" รหัสนักเรียน ${studentId}?`)
    ) {
      database
        .ref(`users/${studentId}`)
        .update({ status: "banned" })
        .then(() => alert("🚫 ระงับการใช้งานบัญชีนี้เรียบร้อยแล้ว!"))
        .catch((err) => alert("เกิดข้อผิดพลาด: " + err.message));
    }
  }
}

function setupSearchFilters() {
  const searchUsersInput = document.getElementById("search-users");
  if (searchUsersInput) {
    searchUsersInput.addEventListener("input", (e) => {
      const keyword = e.target.value.toLowerCase().trim();
      document.querySelectorAll(".data-row-user").forEach((row) => {
        const text = row.textContent.toLowerCase();
        row.classList.toggle("hidden", !text.includes(keyword));
      });
    });
  }

  const searchApprovedInput = document.getElementById("search-approved");
  if (searchApprovedInput) {
    searchApprovedInput.addEventListener("input", (e) => {
      const keyword = e.target.value.toLowerCase().trim();
      document.querySelectorAll(".data-row-approved").forEach((row) => {
        const text = row.textContent.toLowerCase();
        row.classList.toggle("hidden", !text.includes(keyword));
      });
    });
  }
}
