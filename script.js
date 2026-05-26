// Initialize Lucide Icons
lucide.createIcons();

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyBoV4p65uQ3ThpwN9Zw34GWEz7yElB2ymI",
    authDomain: "kc-onlinemarket.firebaseapp.com",
    databaseURL: "https://kc-onlinemarket-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "kc-onlinemarket",
    storageBucket: "kc-onlinemarket.firebasestorage.app",
    messagingSenderId: "321029641421",
    appId: "1:321029641421:web:7a007bd06159ffc309c584"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

const productsContainer = document.getElementById('products-container');
let localProducts = {};

// ตัวแปรควบคุมระบบรูปภาพและสไลด์
let currentProductPhotos = [];
let currentCarouselIndex = 0;
let currentFullscreenIndex = 0;

// Realtime listener for approved products
database.ref('products').on('value', (snapshot) => {
    productsContainer.innerHTML = '';
    let hasProducts = false;
    localProducts = {};

    snapshot.forEach((childSnapshot) => {
        const product = childSnapshot.val();

        if (product.status === 'approved') {
            hasProducts = true;
            localProducts[product.id] = product;

            const fallbackImage = 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500';
            const displayImage = product.image || fallbackImage;

            const productCard = `
                <div onclick="openModal('${product.id}')" class="bg-white rounded-xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between cursor-pointer group">
                    <div class="relative h-44 bg-slate-50 overflow-hidden shrink-0">
                        <img src="${displayImage}" alt="${product.name}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                        <div class="absolute inset-0 bg-slate-900/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                            <span class="bg-white/90 backdrop-blur-md text-slate-800 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg shadow-sm transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300 flex items-center gap-1">
                                ดูรายละเอียดชิ้นนี้
                            </span>
                        </div>
                    </div>
                    <div class="p-3.5 flex-1 flex flex-col justify-between space-y-2">
                        <div class="space-y-1">
                            <span class="text-[9px] bg-slate-100 text-slate-500 font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider">${product.category || 'ทั่วไป'}</span>
                            <h4 class="font-bold text-xs text-slate-800 line-clamp-1 group-hover:text-purple-700 transition-colors">${product.name}</h4>
                        </div>
                        <div class="flex justify-between items-center pt-1.5 border-t border-slate-50">
                            <span class="text-sm font-bold text-purple-700">฿${product.price}</span>
                            <span class="text-[10px] bg-purple-50 text-purple-700 font-medium px-1.5 py-0.5 rounded">ชั้น ม.${product.grade}</span>
                        </div>
                    </div>
                </div>
            `;
            productsContainer.insertAdjacentHTML('beforeend', productCard);
        }
    });

    if (!hasProducts) {
        productsContainer.innerHTML = `
            <div class="col-span-full text-center py-12 bg-white rounded-xl border border-dashed border-slate-200 p-6 text-slate-400">
                <i data-lucide="package-open" class="w-8 h-8 mx-auto mb-2 text-slate-300"></i>
                <p class="text-xs font-medium">ยังไม่มีสินค้าวางจำหน่ายในขณะนี้</p>
            </div>
        `;
    }
    lucide.createIcons();
});

// ฟังก์ชันสำหรับเปิด Pop-up สินค้า (ลบส่วนแสดงภาพด้านบนออก และสร้างชุดอาเรย์ภาพสำหรับสไลด์ด้านล่าง)
function openModal(id) {
    const product = localProducts[id];
    if (!product) return;

    // เคลียร์และสร้างอาร์เรย์เก็บรูปภาพทั้งหมดที่มี
    currentProductPhotos = [];
    if (product.image) currentProductPhotos.push(product.image);

    // ดึงรูปภาพเพิ่มเติมจาก Firebase (รองรับทั้งแบบ Array และ Object)
    if (Array.isArray(product.images)) {
        currentProductPhotos = currentProductPhotos.concat(product.images);
    } else if (typeof product.images === 'object' && product.images !== null) {
        currentProductPhotos = currentProductPhotos.concat(Object.values(product.images));
    }

    // ลบรูปภาพที่ซ้ำออก และลบค่าที่ว่างเปล่า (ถ้ามี)
    currentProductPhotos = [...new Set(currentProductPhotos)].filter(url => url);

    // กรณีสินค้าไม่มีรูปภาพเลย ให้ใช้ภาพทดแทน (Fallback)
    if (currentProductPhotos.length === 0) {
        currentProductPhotos.push('https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500');
    }

    // รีเซ็ตตำแหน่งสไลด์แรกสุด
    currentCarouselIndex = 0;

    // ผูกข้อมูลข้อความเข้าสู่ HTML Element ในป๊อปอัพ
    document.getElementById('modal-category').innerText = product.category || 'ทั่วไป';
    document.getElementById('modal-name').innerText = product.name;
    document.getElementById('modal-price').innerText = product.price;
    document.getElementById('modal-description').innerText = product.description || 'ไม่มีรายละเอียดสินค้า';
    document.getElementById('modal-seller').innerText = product.seller;
    document.getElementById('modal-grade').innerText = product.grade;
    document.getElementById('modal-order-btn').href = `https://line.me/R/ti/p/~${product.contact}`;

    // เรียกฟังก์ชันเตรียมสไลด์รูปภาพด้านล่าง
    setupCarousel();

    // เปิดการแสดงผลแอนิเมชัน Pop-up หลัก
    const modal = document.getElementById('product-modal');
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('.transform').classList.remove('scale-95');
    }, 10);
    
    lucide.createIcons();
}

// 🎞️ ระบบสร้างกล่องสไลด์รูปภาพ (Carousel) ด้านล่าง
function setupCarousel() {
    const container = document.getElementById('modal-gallery-container');
    const wrapper = document.getElementById('modal-carousel-wrapper');
    const dotsContainer = document.getElementById('carousel-dots');
    const countSpan = document.getElementById('gallery-count');

    wrapper.innerHTML = '';
    dotsContainer.innerHTML = '';
    countSpan.innerText = currentProductPhotos.length;

    // เปิดแสดงแผงแกลเลอรี
    container.classList.remove('hidden');

    // วนลูปสร้างรูปแต่ละสไลด์
    currentProductPhotos.forEach((imgUrl, index) => {
        const slide = document.createElement('div');
        slide.className = 'w-full h-full flex-shrink-0 cursor-pointer overflow-hidden';
        // คลิกที่ตัวรูปสไลด์เพื่อเข้าไปดูแกลเลอรีภาพขนาดใหญ่เต็มจอได้ทันที
        slide.onclick = () => openFullscreenGallery(index);
        
        const img = document.createElement('img');
        img.src = imgUrl;
        img.className = 'w-full h-full object-cover';
        img.alt = `Product slide ${index + 1}`;
        
        slide.appendChild(img);
        wrapper.appendChild(slide);

        // สร้างจุดกลมบอกตำแหน่งใต้รูปสไลด์
        const dot = document.createElement('button');
        dot.className = `w-1.5 h-1.5 rounded-full transition-all duration-300 ${index === 0 ? 'bg-purple-700 w-3.5' : 'bg-slate-300'}`;
        dot.onclick = (e) => {
            e.stopPropagation(); // ไม่ให้ทับซ้อนกับการคลิกเปิดรูปแบบเต็มหน้าจอ
            jumpToSlide(index);
        };
        dotsContainer.appendChild(dot);
    });

    updateCarouselView();
}

// ฟังก์ชันควบคุมการขยับสไลด์ ซ้าย-ขวา
function moveCarousel(direction) {
    currentCarouselIndex += direction;
    if (currentCarouselIndex >= currentProductPhotos.length) currentCarouselIndex = 0;
    if (currentCarouselIndex < 0) currentCarouselIndex = currentProductPhotos.length - 1;
    updateCarouselView();
}

// ฟังก์ชันกดกระโดดไปสไลด์ที่เลือกจากปุ่มจุดกลมด้านล่าง
function jumpToSlide(index) {
    currentCarouselIndex = index;
    updateCarouselView();
}

// ฟังก์ชันอัปเดตตำแหน่งและการเลื่อนบนหน้าจอ (อนิเมชันสไลด์)
function updateCarouselView() {
    const wrapper = document.getElementById('modal-carousel-wrapper');
    wrapper.style.transform = `translateX(-${currentCarouselIndex * 100}%)`;

    // เปลี่ยนสีของจุดบอกพิกัดใต้สไลด์
    const dots = document.getElementById('carousel-dots').children;
    for (let i = 0; i < dots.length; i++) {
        if (i === currentCarouselIndex) {
            dots[i].className = 'w-1.5 h-1.5 rounded-full bg-purple-700 w-3.5 transition-all duration-300';
        } else {
            dots[i].className = 'w-1.5 h-1.5 rounded-full bg-slate-300 transition-all duration-300';
        }
    }
}

// 🌌 ระบบเปิดดูรูปทั้งหมดแบบขยายเต็มหน้าจอ (Fullscreen Gallery)
function openFullscreenGallery(startIndex = 0) {
    currentFullscreenIndex = startIndex;
    
    const fsModal = document.getElementById('fullscreen-gallery-modal');
    fsModal.classList.remove('hidden');
    setTimeout(() => fsModal.classList.remove('opacity-0'), 10);

    setupFullscreenThumbnails();
    updateFullscreenView();
    lucide.createIcons();
}

// อัปเดตรูปหลักและจำนวนตัวเลขในหน้าดูรูปเต็มจอ
function updateFullscreenView() {
    document.getElementById('fullscreen-image').src = currentProductPhotos[currentFullscreenIndex];
    document.getElementById('fullscreen-counter').innerText = `รูปที่ ${currentFullscreenIndex + 1}/${currentProductPhotos.length}`;
    
    // จัดตำแหน่งไฮไลต์เส้นขอบให้กับแถบรูปย่อยด้านล่างให้ตรงกัน
    const thumbs = document.getElementById('fullscreen-thumbnails').children;
    for (let i = 0; i < thumbs.length; i++) {
        if (i === currentFullscreenIndex) {
            thumbs[i].className = 'w-12 h-12 object-cover rounded-lg border-2 border-purple-500 ring-2 ring-purple-500/30 cursor-pointer transition shrink-0';
        } else {
            thumbs[i].className = 'w-12 h-12 object-cover rounded-lg border-2 border-transparent hover:opacity-80 cursor-pointer transition shrink-0';
        }
    }
}

// เลื่อนสไลด์ซ้าย-ขวา ขณะแสดงโหมดรูปเต็มจอ
function moveFullscreen(direction) {
    currentFullscreenIndex += direction;
    if (currentFullscreenIndex >= currentProductPhotos.length) currentFullscreenIndex = 0;
    if (currentFullscreenIndex < 0) currentFullscreenIndex = currentProductPhotos.length - 1;
    updateFullscreenView();
}

// สร้างแถบพรีวิวรูปเล็ก (Thumbnails) ด้านล่างสุดของจอเต็มหน้าจอ
function setupFullscreenThumbnails() {
    const thumbContainer = document.getElementById('fullscreen-thumbnails');
    thumbContainer.innerHTML = '';

    currentProductPhotos.forEach((imgUrl, index) => {
        const thumb = document.createElement('img');
        thumb.src = imgUrl;
        thumb.className = 'w-12 h-12 object-cover rounded-lg border-2 border-transparent cursor-pointer hover:opacity-80 transition shrink-0';
        thumb.onclick = () => {
            currentFullscreenIndex = index;
            updateFullscreenView();
        };
        thumbContainer.appendChild(thumb);
    });
}

// ปิดโหมดขยายรูปภาพเต็มจอ
function closeFullscreenGallery() {
    const fsModal = document.getElementById('fullscreen-gallery-modal');
    fsModal.classList.add('opacity-0');
    setTimeout(() => fsModal.classList.add('hidden'), 300);
}

// ปิดหน้าต่าง Pop-up ข้อมูลหลัก
function closeModal() {
    const modal = document.getElementById('product-modal');
    modal.classList.add('opacity-0');
    modal.querySelector('.transform').classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
}

// ปิด Pop-up อัตโนมัติเมื่อกดพื้นที่สีดำรอบๆ นอกกรอบโมดอล
window.onclick = function(event) {
    const modal = document.getElementById('product-modal');
    const fsModal = document.getElementById('fullscreen-gallery-modal');
    
    if (event.target == modal) {
        closeModal();
    }
    if (event.target == fsModal) {
        closeFullscreenGallery();
    }
}