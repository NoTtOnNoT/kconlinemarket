// Initialize Lucide Icons
if (typeof lucide !== 'undefined') lucide.createIcons();

// Firebase Configuration (ดึงค่าอย่างปลอดภัยจาก Environment Variables ผ่าน Vite/Vercel)
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
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

// 🔥 Realtime listener for approved products (พร้อมระบบกรองบัญชีที่ถูกแบนแบบ Realtime)
database.ref('products').on('value', (snapshot) => {
    // 1. สร้าง Object สำหรับเก็บข้อมูล Listener ของผู้ใช้แต่ละคน เพื่อไม่ให้เกิดการผูก Listener ซ้ำซ้อน
    if (!window.activeUserListeners) {
        window.activeUserListeners = {};
    }
    
    localProducts = {};
    const currentContainer = document.getElementById('products-container');
    if (!currentContainer) return;

    // เคลียร์หน้าจอเตรียมวาดใหม่เมื่อโครงสร้างหลักตารางสินค้าขยับ
    currentContainer.innerHTML = '';

    const allProducts = [];
    snapshot.forEach((childSnapshot) => {
        const product = childSnapshot.val();
        const productKey = childSnapshot.key;
        if (product.status === 'approved' && product.studentId) {
            allProducts.push({ key: productKey, data: product });
        }
    });

    if (allProducts.length === 0) {
        showEmptyMarket();
        return;
    }

    // ฟังก์ชันจัดการอัปเดต UI หน้าจอสินค้าแบบแยกส่วน (Granular Update) ตามสถานะจริงของผู้ใช้
    function renderMarketplace() {
        currentContainer.innerHTML = '';
        let hasDisplayedProducts = false;

        allProducts.forEach((item) => {
            const product = item.data;
            const productKey = item.key;
            
            // ดึงสถานะผู้ใช้ล่าสุดที่เก็บไว้ใน Window Object มาเช็ค
            const userStatus = window.activeUserListeners[product.studentId]?.status;
            const isSellerBanned = userStatus === 'banned';

            if (!isSellerBanned) {
                hasDisplayedProducts = true;
                localProducts[productKey] = product; // เก็บลงคลังเพื่อไว้เปิดดู Modal

                const fallbackImage = 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500';
                const displayImage = product.image || fallbackImage;
                const totalImgs = product.images ? (Array.isArray(product.images) ? product.images.length : Object.keys(product.images).length) : 1;

                // สร้าง ID เฉพาะให้กับการ์ดสินค้าชิ้นนั้นๆ เพื่อจัดการง่ายขึ้น
                const productCard = `
                    <div id="card-${productKey}" onclick="openModal('${productKey}')" class="bg-white rounded-xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between cursor-pointer group animate-fade-in">
                        <div class="relative h-44 bg-slate-50 overflow-hidden shrink-0">
                            <img src="${displayImage}" alt="${product.name}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                            ${totalImgs > 1 ? `<span class="absolute bottom-2 right-2 bg-slate-900/70 text-white text-[10px] px-1.5 py-0.5 rounded-md backdrop-blur-xs font-semibold">+${totalImgs} รูป</span>` : ''}
                            <div class="absolute inset-0 bg-slate-900/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                                <span class="bg-white/90 backdrop-blur-md text-slate-800 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg shadow-sm transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300 flex items-center gap-1">
                                    ดูรายละเอียดชิ้นนี้
                                </span>
                            </div>
                        </div>
                        <div class="p-3.5 flex-1 flex flex-col justify-between space-y-2">
                            <div class="space-y-1">
                                <span class="text-[9px] bg-purple-50 text-purple-700 font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider">${product.category || 'ทั่วไป'}</span>
                                <h4 class="font-bold text-xs text-slate-800 line-clamp-1 group-hover:text-purple-700 transition-colors">${product.name}</h4>
                            </div>
                            <div class="flex justify-between items-center pt-1.5 border-t border-slate-50">
                                <span class="text-sm font-bold text-purple-700">฿${product.price}</span>
                                <span class="text-[10px] bg-slate-100 text-slate-600 font-medium px-1.5 py-0.5 rounded">ชั้น ${product.grade || '-'}</span>
                            </div>
                        </div>
                    </div>
                `;
                currentContainer.insertAdjacentHTML('beforeend', productCard);
            }
        });

        if (!hasDisplayedProducts) {
            showEmptyMarket();
        } else {
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }

    // 2. วนลูปผูกท่อดักฟังแบบ Realtime (.on) เข้ากับตาราง Users ทุกคนที่มีสินค้าวางขายอยู่
    allProducts.forEach((item) => {
        const studentId = item.data.studentId;

        // ถ้ายังไม่เคยเปิดท่อดักฟังผู้ใช้รหัสนี้ ให้เปิดท่อทันที
        if (!window.activeUserListeners[studentId]) {
            window.activeUserListeners[studentId] = { status: 'normal', ref: database.ref('users/' + studentId) };
            
            window.activeUserListeners[studentId].ref.on('value', (userSnapshot) => {
                const userData = userSnapshot.val();
                const currentStatus = userData ? userData.status : 'normal';
                
                // ตรวจสอบความเปลี่ยนแปลง: ถ้าสถานะเปลี่ยนไปจากเดิมให้ทำการ Render ตลาดใหม่ทันที
                if (window.activeUserListeners[studentId].status !== currentStatus) {
                    window.activeUserListeners[studentId].status = currentStatus;
                    renderMarketplace(); // ทำงานทันทีโดยไม่ต้องรีเฟรชหน้าจอ!
                }
            });
        }
    });

    // รันการแสดงผลครั้งแรกสุด
    renderMarketplace();
});

// ฟังก์ชันแสดงกรณีตลาดไม่มีสินค้าจำหน่าย
function showEmptyMarket() {
    const currentContainer = document.getElementById('products-container');
    if (!currentContainer) return;
    currentContainer.innerHTML = `
        <div class="col-span-full text-center py-12 bg-white rounded-xl border border-dashed border-slate-200 p-6 text-slate-400">
            <i data-lucide="package-open" class="w-8 h-8 mx-auto mb-2 text-slate-300"></i>
            <p class="text-xs font-medium">ยังไม่มีสินค้าวางจำหน่ายในขณะนี้</p>
        </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ฟังก์ชันสำหรับเปิด Pop-up สินค้า
window.openModal = function(id) {
    const product = localProducts[id];
    if (!product) return;

    currentProductPhotos = [];
    if (product.image) currentProductPhotos.push(product.image);

    if (Array.isArray(product.images)) {
        currentProductPhotos = currentProductPhotos.concat(product.images);
    } else if (typeof product.images === 'object' && product.images !== null) {
        currentProductPhotos = currentProductPhotos.concat(Object.values(product.images));
    }

    currentProductPhotos = [...new Set(currentProductPhotos)].filter(url => url);

    if (currentProductPhotos.length === 0) {
        currentProductPhotos.push('https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500');
    }

    currentCarouselIndex = 0;

    document.getElementById('modal-category').innerText = product.category || 'ทั่วไป';
    document.getElementById('modal-name').innerText = product.name;
    document.getElementById('modal-price').innerText = product.price;
    document.getElementById('modal-description').innerText = product.description || 'ไม่มีรายละเอียดสินค้า';
    document.getElementById('modal-seller').innerText = product.seller;
    document.getElementById('modal-grade').innerText = product.grade;

    // --- เริ่มต้นระบบวิเคราะห์ช่องทางติดต่อตามข้อมูลจริงจาก Firebase ---
    const contactContainer = document.getElementById('modal-contact-container');
    const contactType = (product.contactType || '').trim().toLowerCase();
    const contactInfo = (product.contact || '').trim();
    
    let contactLink = '#';
    let contactIcon = 'message-circle';
    let contactText = 'ติดต่อผู้ขาย';
    let btnColorClass = 'from-purple-700 to-indigo-600 hover:from-purple-800 hover:to-indigo-700 shadow-purple-200 focus:ring-purple-400';

    if (contactType === 'instagram' || contactType === 'ig') {
        const username = contactInfo.replace('@', '');
        contactLink = contactInfo.startsWith('http') ? contactInfo : `https://instagram.com/${username}`;
        contactIcon = 'instagram';
        contactText = `ติดต่อผ่าน Instagram (${username})`;
        btnColorClass = 'from-pink-600 via-red-500 to-amber-500 hover:from-pink-700 hover:via-red-600 hover:to-amber-600 shadow-pink-200 focus:ring-pink-400';
    } 
    else {
        contactLink = contactInfo.startsWith('http') ? contactInfo : `https://facebook.com/${contactInfo}`;
        contactIcon = 'facebook';
        contactText = 'ติดต่อผ่าน Facebook';
        btnColorClass = 'from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-blue-200 focus:ring-blue-400';
    }

    if (contactContainer) {
        contactContainer.innerHTML = `
            <a id="modal-order-btn" href="${contactLink}" target="_blank" class="w-full flex items-center justify-center gap-2 bg-gradient-to-r ${btnColorClass} text-white font-semibold py-2.5 px-4 rounded-xl transition shadow-md text-xs focus:ring-2">
                <i data-lucide="${contactIcon}" class="w-3.5 h-3.5"></i>
                ${contactText}
            </a>
        `;
    }

    setupCarousel();

    const modal = document.getElementById('product-modal');
    if (modal) {
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            const innerTransform = modal.querySelector('.transform');
            if (innerTransform) innerTransform.classList.remove('scale-95');
        }, 10);
    }
    
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

// 🎞️ ระบบสร้างกล่องสไลด์รูปภาพ (Carousel) ด้านล่าง
function setupCarousel() {
    const container = document.getElementById('modal-gallery-container');
    const wrapper = document.getElementById('modal-carousel-wrapper');
    const dotsContainer = document.getElementById('carousel-dots');
    const countSpan = document.getElementById('gallery-count');

    if (!wrapper || !dotsContainer || !countSpan || !container) return;

    wrapper.innerHTML = '';
    dotsContainer.innerHTML = '';
    countSpan.innerText = currentProductPhotos.length;

    container.classList.remove('hidden');

    currentProductPhotos.forEach((imgUrl, index) => {
        const slide = document.createElement('div');
        slide.className = 'w-full h-full flex-shrink-0 cursor-pointer overflow-hidden';
        slide.onclick = () => openFullscreenGallery(index);
        
        const img = document.createElement('img');
        img.src = imgUrl;
        img.className = 'w-full h-full object-cover';
        img.alt = `Product slide ${index + 1}`;
        
        slide.appendChild(img);
        wrapper.appendChild(slide);

        const dot = document.createElement('button');
        dot.className = `w-1.5 h-1.5 rounded-full transition-all duration-300 ${index === 0 ? 'bg-purple-700 w-3.5' : 'bg-slate-300'}`;
        dot.onclick = (e) => {
            e.stopPropagation();
            jumpToSlide(index);
        };
        dotsContainer.appendChild(dot);
    });

    updateCarouselView();
}

window.moveCarousel = function(direction) {
    currentCarouselIndex += direction;
    if (currentCarouselIndex >= currentProductPhotos.length) currentCarouselIndex = 0;
    if (currentCarouselIndex < 0) currentCarouselIndex = currentProductPhotos.length - 1;
    updateCarouselView();
};

function jumpToSlide(index) {
    currentCarouselIndex = index;
    updateCarouselView();
}

function updateCarouselView() {
    const wrapper = document.getElementById('modal-carousel-wrapper');
    const dotsContainer = document.getElementById('carousel-dots');
    if (!wrapper || !dotsContainer) return;
    wrapper.style.transform = `translateX(-${currentCarouselIndex * 100}%)`;

    const dots = dotsContainer.children;
    for (let i = 0; i < dots.length; i++) {
        if (i === currentCarouselIndex) {
            dots[i].className = 'w-1.5 h-1.5 rounded-full bg-purple-700 w-3.5 transition-all duration-300';
        } else {
            dots[i].className = 'w-1.5 h-1.5 rounded-full bg-slate-300 transition-all duration-300';
        }
    }
}

// 🌌 ระบบเปิดดูรูปทั้งหมดแบบขยายเต็มหน้าจอ (Fullscreen Gallery)
window.openFullscreenGallery = function(startIndex = 0) {
    currentFullscreenIndex = startIndex;
    
    const fsModal = document.getElementById('fullscreen-gallery-modal');
    if (!fsModal) return;
    fsModal.classList.remove('hidden');
    setTimeout(() => fsModal.classList.remove('opacity-0'), 10);

    setupFullscreenThumbnails();
    updateFullscreenView();
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

function updateFullscreenView() {
    const fsImage = document.getElementById('fullscreen-image');
    const fsCounter = document.getElementById('fullscreen-counter');
    const fsThumbs = document.getElementById('fullscreen-thumbnails');
    
    if (fsImage) fsImage.src = currentProductPhotos[currentFullscreenIndex];
    if (fsCounter) fsCounter.innerText = `รูปที่ ${currentFullscreenIndex + 1}/${currentProductPhotos.length}`;
    
    if (fsThumbs) {
        const thumbs = fsThumbs.children;
        for (let i = 0; i < thumbs.length; i++) {
            if (i === currentFullscreenIndex) {
                thumbs[i].className = 'w-12 h-12 object-cover rounded-lg border-2 border-purple-500 ring-2 ring-purple-500/30 cursor-pointer transition shrink-0';
            } else {
                thumbs[i].className = 'w-12 h-12 object-cover rounded-lg border-2 border-transparent hover:opacity-80 cursor-pointer transition shrink-0';
            }
        }
    }
}

window.moveFullscreen = function(direction) {
    currentFullscreenIndex += direction;
    if (currentFullscreenIndex >= currentProductPhotos.length) currentFullscreenIndex = 0;
    if (currentFullscreenIndex < 0) currentFullscreenIndex = currentProductPhotos.length - 1;
    updateFullscreenView();
};

function setupFullscreenThumbnails() {
    const thumbContainer = document.getElementById('fullscreen-thumbnails');
    if (!thumbContainer) return;
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

window.closeFullscreenGallery = function() {
    const fsModal = document.getElementById('fullscreen-gallery-modal');
    if (!fsModal) return;
    fsModal.classList.add('opacity-0');
    setTimeout(() => fsModal.add ? fsModal.add('hidden') : fsModal.classList.add('hidden'), 300);
};

window.closeModal = function() {
    const modal = document.getElementById('product-modal');
    if (!modal) return;
    modal.classList.add('opacity-0');
    const innerTransform = modal.querySelector('.transform');
    if (innerTransform) innerTransform.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
};

window.onclick = function(event) {
    const modal = document.getElementById('product-modal');
    const fsModal = document.getElementById('fullscreen-gallery-modal');
    
    if (event.target === modal) {
        window.closeModal();
    }
    if (event.target === fsModal) {
        window.closeFullscreenGallery();
    }
};