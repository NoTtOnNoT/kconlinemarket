// ============================================================
// GeoBelt Dashboard v2.7
// - New history layout: /history/<deviceId>/<YYYY-MM-DD>/<pushId>
// - Loads one day at a time (no 3,000-record global cap)
// - Legacy /esp32_telemetry can still be loaded page-by-page
// - Invalid/missing ESP32 clock falls back to Firebase push receive time for display.
// - Live view compares dated + unknown-date nodes so a clockless device is not hidden by old history.
// - Telegram alerts are queued to Firebase /alerts; bot token stays server-side in Cloud Functions.
// ============================================================

const FIREBASE_DB_BASE = "https://kcesp32-default-rtdb.asia-southeast1.firebasedatabase.app";
const HISTORY_ROOT = "history";
const LEGACY_ROOT = "esp32_telemetry";
const HOME_CONFIG_PATH = "home_config";
const HOME_PIN_PATH = "app_settings/home_edit_pin";

const LIVE_REFRESH_MS = 5000;
const STALE_WARNING_SECONDS = 90;
const OFFLINE_WARNING_SECONDS = 180;
const FUTURE_TIME_TOLERANCE_MS = 5 * 60 * 1000;
const MIN_VALID_TELEMETRY_MS = Date.UTC(2024, 0, 1);
const LIVE_DATE_CANDIDATE_LIMIT = 4;
const LEGACY_PAGE_SIZE = 1000;
const LOW_BATTERY_ALERT_PERCENT = 20;
const TELEGRAM_ALERTS_ENABLED = true;

const GOOGLE_SUBDOMAINS = ['mt0', 'mt1', 'mt2', 'mt3'];
const GOOGLE_ATTRIBUTION = '© Google Maps';

async function fetchFirebaseJson(url, options = undefined) {
    const response = await fetch(url, options);
    const text = await response.text();
    let data = null;
    if (text) {
        try { data = JSON.parse(text); }
        catch { data = text; }
    }
    if (!response.ok) {
        const detail = data && typeof data === 'object' && data.error ? data.error : String(data || response.statusText || 'Firebase request failed');
        throw new Error(`Firebase HTTP ${response.status}: ${detail}`);
    }
    return data;
}

// ---------------- Theme ----------------
const savedTheme = localStorage.getItem('theme') || 'dark';
if (savedTheme === 'light') {
    document.getElementById('html-root').classList.remove('dark');
}
updateThemeButton();

function updateThemeButton() {
    const dark = document.getElementById('html-root').classList.contains('dark');
    const icon = document.getElementById('theme-icon');
    const text = document.getElementById('theme-text');
    if (icon) icon.innerText = dark ? '☀️' : '🌙';
    if (text) text.innerText = dark ? 'โหมดสว่าง' : 'โหมดมืด';
}

function toggleTheme() {
    const root = document.getElementById('html-root');
    root.classList.toggle('dark');
    localStorage.setItem('theme', root.classList.contains('dark') ? 'dark' : 'light');
    updateThemeButton();
}

// ---------------- General state ----------------
let currentDeviceId = localStorage.getItem('geobelt_device') || '';
let lastDeviceCoords = null;
let latestRecord = null;
let followMode = true;
let latestRecordTimestampMs = 0;

let homeLat = 6.632795;
let homeLon = 100.421219;
let homeRadius = 100;
let isSettingHomeMode = false;
let lastZoneState = null;

let historyDates = [];
let currentSelectedDate = null;
let currentDayEntries = [];
let currentFilteredEntries = [];
let activeHistoryIndex = -1;
let historyRouteEnabled = false;

let legacyGrouped = {};
let legacyOldestKey = null;
let legacyFinished = false;

let historyInlineMap = null;
let historyInlineMarker = null;
let historyRouteLine = null;
let lastSosNotifiedIdentity = '';
let lastConnectivityState = null;
let lastLowBatteryState = false;


// ---------------- Time normalization ----------------
function normalizeEpochMs(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n > 1e12 ? n : n * 1000);
}

function parseIsoMs(value) {
    if (!value) return 0;
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? ms : 0;
}

// Number(null) === 0 in JavaScript, which can accidentally turn missing
// telemetry into a real-looking zero (for example battery 0% or satellites 0).
function nullableNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function isPlausibleTelemetryTime(ms, now = Date.now()) {
    return Number.isFinite(ms) &&
        ms >= MIN_VALID_TELEMETRY_MS &&
        ms <= now + FUTURE_TIME_TOLERANCE_MS;
}

function resolveRecordTime(raw, key = '') {
    const t = raw?.time && typeof raw.time === 'object' ? raw.time : {};
    const reportedValid = t.valid;

    const candidates = [
        normalizeEpochMs(raw?.timestamp),
        parseIsoMs(raw?.timestamp_iso),
        parseIsoMs(raw?.timestamp_bangkok)
    ].filter(Boolean);

    // If firmware explicitly says time.valid=false, never trust its timestamp.
    let deviceTimestampMs = 0;
    if (reportedValid !== false) {
        deviceTimestampMs = candidates.find(ms => isPlausibleTelemetryTime(ms)) || 0;
    }

    // Firebase push IDs contain the creation timestamp. This is our display/freshness
    // fallback when the ESP32 clock is still 1970/2070/unknown.
    const receivedAtMsRaw = decodePushIdTimestamp(key) || 0;
    const receivedAtMs = isPlausibleTelemetryTime(receivedAtMsRaw) ? receivedAtMsRaw : 0;

    const deviceTimeValid = !!deviceTimestampMs && reportedValid !== false;
    const timestampFallback = !deviceTimeValid && !!receivedAtMs;
    const timestampMs = deviceTimeValid ? deviceTimestampMs : receivedAtMs;

    let timestampSource = 'NONE';
    if (deviceTimeValid) timestampSource = String(t.source || 'DEVICE').toUpperCase();
    else if (receivedAtMs) timestampSource = 'FIREBASE_PUSH';

    return {
        timestampMs,
        deviceTimestampMs,
        receivedAtMs,
        deviceTimeValid,
        timestampFallback,
        timestampSource,
        reportedTimeSource: String(t.source || 'NONE').toUpperCase()
    };
}

function recordOrderTimeMs(rec) {
    // Push time represents when Firebase actually received/created the record and is
    // therefore the safest value for deciding which record is the newest.
    return rec?.receivedAtMs || rec?.timestampMs || decodePushIdTimestamp(rec?.key) || 0;
}

// ---------------- Exact ESP32 telemetry schema ----------------
// Board sends:
// device_id, sos, uptime_ms, history_date, timestamp, timestamp_iso,
// network.{wifi_connected,wifi_ssid,wifi_rssi_dbm,cellular_ready},
// battery.{modem_percent},
// location.{valid,source,stale,lat,lng,accuracy_m,age_ms,satellites},
// nearby_wifi:[{bssid,rssi}]
function exactBoardRecord(raw, key = '', dateKey = '') {
    if (!raw || typeof raw !== 'object') return null;

    const loc = raw.location && typeof raw.location === 'object' ? raw.location : {};
    const net = raw.network && typeof raw.network === 'object' ? raw.network : {};
    const bat = raw.battery && typeof raw.battery === 'object' ? raw.battery : {};

    const lat = nullableNumber(loc.lat);
    const lon = nullableNumber(loc.lng);
    // Prefer the board's explicit valid flag, but still accept coordinates from
    // partially populated v3 records where the flag is missing.
    const valid = lat !== null && lon !== null && loc.valid !== false;

    const timeInfo = resolveRecordTime(raw, key);

    return {
        key,
        dateKey: raw.history_date || dateKey || '',
        raw,
        deviceId: String(raw.device_id || ''),
        firmwareVersion: String(raw.firmware_version || ''),
        sos: raw.sos === true,
        uptimeMs: Number(raw.uptime_ms) || 0,
        timestampMs: timeInfo.timestampMs,
        deviceTimestampMs: timeInfo.deviceTimestampMs,
        receivedAtMs: timeInfo.receivedAtMs,
        deviceTimeValid: timeInfo.deviceTimeValid,
        timestampFallback: timeInfo.timestampFallback,
        timestampSource: timeInfo.timestampSource,
        reportedTimeSource: timeInfo.reportedTimeSource,

        // Firebase removes properties written as null. Therefore the whole
        // battery object can legitimately be absent when AT+CBC has no usable
        // percentage. Missing battery data must stay null, not become 0%.
        battery: nullableNumber(bat.modem_percent),

        wifiConnected: net.wifi_connected === true,
        wifiSsid: String(net.wifi_ssid || ''),
        wifiRssi: nullableNumber(net.wifi_rssi_dbm),
        cellularReady: net.cellular_ready === true,

        valid,
        lat: valid ? lat : null,
        lon: valid ? lon : null,
        source: String(loc.source || 'NONE'),
        stale: loc.stale === true,
        accuracy: nullableNumber(loc.accuracy_m),
        locationAgeMs: nullableNumber(loc.age_ms),
        satellites: nullableNumber(loc.satellites),

        nearbyWifi: Array.isArray(raw.nearby_wifi) ? raw.nearby_wifi : []
    };
}

function isNewBoardSchema(raw) {
    // Do NOT require battery/network objects here. Firebase Realtime Database
    // removes keys whose value is null, so battery can disappear completely when
    // modem_percent is unavailable. Requiring it made a perfectly valid v3 record
    // fall into the legacy parser, which caused Location source=NONE, No Fix,
    // Wi-Fi=offline and nearby Wi-Fi=0 even though raw.location contained data.
    return !!(raw && typeof raw === 'object' &&
        raw.location && typeof raw.location === 'object');
}

// ---------------- Map ----------------
const map = L.map('map', { maxZoom: 20, zoomControl: false })
    .setView([homeLat, homeLon], 17);

L.control.zoom({ position: 'bottomright' }).addTo(map);

const googleRoadmap = L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    maxZoom: 21, subdomains: GOOGLE_SUBDOMAINS, attribution: GOOGLE_ATTRIBUTION
});
const googleHybrid = L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 21, subdomains: GOOGLE_SUBDOMAINS, attribution: GOOGLE_ATTRIBUTION
});
const googleSatellite = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    maxZoom: 21, subdomains: GOOGLE_SUBDOMAINS, attribution: GOOGLE_ATTRIBUTION
});

googleHybrid.addTo(map);
L.control.layers({
    "🗺️ ถนน": googleRoadmap,
    "🛰️ Hybrid": googleHybrid,
    "🌍 Satellite": googleSatellite
}, null, { collapsed: true }).addTo(map);

let deviceMarker = null;
let accuracyCircle = null;
let homeMarker = null;
let homeCircle = null;

const homeIcon = L.divIcon({
    className: 'custom-home-icon',
    html: '<div style="background:#8b5cf6;width:34px;height:34px;border-radius:50%;border:3px solid white;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 6px 15px rgba(139,92,246,.5)">🏠</div>',
    iconSize: [34, 34], iconAnchor: [17, 17]
});

function createDeviceIcon(source, stale = false) {
    let bg = '#64748b', icon = '📍';
    const s = String(source || '').toUpperCase();
    if (s === 'GNSS' || s === 'GPS') { bg = '#10b981'; icon = '🛰️'; }
    else if (s.includes('GOOGLE')) { bg = '#3b82f6'; icon = '📍'; }
    else if (s === 'LAST_KNOWN') { bg = '#f59e0b'; icon = '🕘'; }
    else if (s === 'LBS') { bg = '#f97316'; icon = '📡'; }
    if (stale) bg = '#f59e0b';

    return L.divIcon({
        className: 'custom-device-icon',
        html: `<div style="background:${bg};width:38px;height:38px;border-radius:50%;border:3px solid white;display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 6px 16px rgba(0,0,0,.42)">${icon}</div>`,
        iconSize: [38, 38], iconAnchor: [19, 19]
    });
}

// ---------------- Logging / notifications ----------------
function addLog(message) {
    const el = document.getElementById('activity-log');
    if (!el) return;
    const row = document.createElement('div');
    row.innerHTML = `<span class="text-slate-500">[${new Date().toLocaleTimeString('th-TH')}]</span> ${message}`;
    el.prepend(row);
    while (el.children.length > 80) el.removeChild(el.lastChild);
}


function browserNotify(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
    }
}


async function createAlertEvent(type, payload = {}) {
    if (!currentDeviceId) return;

    const alertData = {
        type,
        deviceId: currentDeviceId,
        ...payload,
        created_at: Date.now()
    };

    // เก็บประวัติลง Firebase
    try {
        await fetchFirebaseJson(
            `${FIREBASE_DB_BASE}/alerts/${encodeURIComponent(currentDeviceId)}.json`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(alertData)
            }
        );
    } catch (e) {
        console.warn('Alert event write failed', e);
    }

    // ส่ง Telegram ผ่าน Vercel backend
    try {
        const response = await fetch('/api/telegram', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(alertData)
        });

        const result = await response.json();

        if (!response.ok || !result.ok) {
            throw new Error(result.error || 'Telegram failed');
        }

        addLog(`Telegram ส่งสำเร็จ: ${type}`);

    } catch (e) {
        console.error('Telegram:', e);
        addLog(`Telegram ส่งไม่สำเร็จ: ${type}`);
    }
}

async function testTelegramAlert() {
    const payload = {
        message: 'ทดสอบการแจ้งเตือนจาก GeoBelt Dashboard',
        timestamp_ms: Date.now()
    };

    if (lastDeviceCoords) {
        payload.lat = lastDeviceCoords.lat;
        payload.lng = lastDeviceCoords.lon;
        payload.location_source = lastDeviceCoords.source || 'UNKNOWN';
    }

    const id = await createAlertEvent('TEST', payload);
    if (id) {
        addLog('ส่งเหตุการณ์ทดสอบ Telegram แล้ว');
        alert('ส่งเหตุการณ์ทดสอบแล้ว หาก Cloud Function ตั้งค่าถูกต้อง Telegram จะได้รับข้อความ');
    } else {
        alert('ส่งเหตุการณ์ทดสอบไม่สำเร็จ');
    }
}

window.testTelegramAlert = testTelegramAlert;

// ---------------- PIN / home configuration ----------------
async function verifyHomeEditPin() {
    if (typeof db === 'undefined' || typeof hashPassword !== 'function') {
        alert('ไม่พบระบบ auth.js / Firebase db');
        return false;
    }
    try {
        const snap = await db.ref(HOME_PIN_PATH).get();
        if (!snap.exists()) return await setupHomeEditPin();

        const pinData = snap.val();
        const entered = prompt('🔒 กรุณาใส่ PIN เพื่อแก้ไขขอบเขตบ้าน:');
        if (entered === null) return false;

        const enteredHash = await hashPassword(entered.trim(), pinData.salt);
        if (enteredHash !== pinData.pinHash) {
            alert('PIN ไม่ถูกต้อง');
            return false;
        }
        return true;
    } catch (e) {
        console.error(e);
        alert('ตรวจสอบ PIN ไม่สำเร็จ');
        return false;
    }
}

async function setupHomeEditPin() {
    const p1 = prompt('🔑 ตั้ง PIN ใหม่อย่างน้อย 4 หลัก:');
    if (p1 === null || p1.trim().length < 4) return false;
    const p2 = prompt('🔑 ยืนยัน PIN อีกครั้ง:');
    if (p2 === null || p1.trim() !== p2.trim()) {
        alert('PIN ไม่ตรงกัน');
        return false;
    }
    const salt = generateSalt();
    const pinHash = await hashPassword(p1.trim(), salt);
    await db.ref(HOME_PIN_PATH).set({
        salt, pinHash, updatedAt: firebase.database.ServerValue.TIMESTAMP
    });
    return true;
}

async function changeHomeEditPin() {
    if (!await verifyHomeEditPin()) return;
    const p1 = prompt('🔑 PIN ใหม่อย่างน้อย 4 หลัก:');
    if (!p1 || p1.trim().length < 4) return;
    const p2 = prompt('🔑 ยืนยัน PIN ใหม่:');
    if (!p2 || p1.trim() !== p2.trim()) return alert('PIN ไม่ตรงกัน');

    const salt = generateSalt();
    const pinHash = await hashPassword(p1.trim(), salt);
    await db.ref(HOME_PIN_PATH).set({
        salt, pinHash, updatedAt: firebase.database.ServerValue.TIMESTAMP
    });
    alert('เปลี่ยน PIN สำเร็จ');
}

async function fetchHomeConfigFromFirebase() {
    try {
        const d = await fetchFirebaseJson(`${FIREBASE_DB_BASE}/${HOME_CONFIG_PATH}.json`);
        if (d && Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lon))) {
            homeLat = Number(d.lat);
            homeLon = Number(d.lon);
            homeRadius = Number(d.radius || 100);
        }
    } catch (e) {
        console.warn('home config:', e);
    }
    updateHomeOnMap();
}

async function saveHomeConfigToFirebase() {
    await fetchFirebaseJson(`${FIREBASE_DB_BASE}/${HOME_CONFIG_PATH}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: homeLat, lon: homeLon, radius: homeRadius })
    });
}

function updateHomeOnMap() {
    if (!homeMarker) {
        homeMarker = L.marker([homeLat, homeLon], { icon: homeIcon }).addTo(map).bindPopup('<b>🏠 บ้าน</b>');
        homeCircle = L.circle([homeLat, homeLon], {
            radius: homeRadius, color: '#8b5cf6', fillColor: '#a78bfa',
            fillOpacity: .15, weight: 2
        }).addTo(map);
    } else {
        homeMarker.setLatLng([homeLat, homeLon]);
        homeCircle.setLatLng([homeLat, homeLon]).setRadius(homeRadius);
    }
    const input = document.getElementById('input-home-radius');
    if (input) input.value = homeRadius;
}

async function toggleMapSelectMode(forceState) {
    const next = forceState !== undefined ? forceState : !isSettingHomeMode;
    if (next && !isSettingHomeMode && !await verifyHomeEditPin()) return;

    isSettingHomeMode = next;
    document.getElementById('mode-instruction')?.classList.toggle('hidden', !next);
    document.getElementById('map')?.classList.toggle('map-selecting', next);
    const btn = document.getElementById('btn-map-mode');
    if (btn) btn.innerText = next ? '✕ ยกเลิก' : '🖱️ เลือกบนแผนที่';
}

map.on('click', async e => {
    if (!isSettingHomeMode) return;
    homeLat = e.latlng.lat;
    homeLon = e.latlng.lng;
    updateHomeOnMap();
    await saveHomeConfigToFirebase();
    toggleMapSelectMode(false);
    if (lastDeviceCoords) checkGeofence(lastDeviceCoords);
});

async function saveHomeSettings() {
    if (!await verifyHomeEditPin()) return;
    const radius = Number(document.getElementById('input-home-radius')?.value);
    if (!Number.isFinite(radius) || radius < 10) return alert('รัศมีต้องไม่น้อยกว่า 10 เมตร');
    homeRadius = radius;
    updateHomeOnMap();
    await saveHomeConfigToFirebase();
    if (lastDeviceCoords) checkGeofence(lastDeviceCoords);
    alert('บันทึกแล้ว');
}

async function useCurrentAsHome() {
    if (!await verifyHomeEditPin()) return;
    if (!navigator.geolocation) return alert('เบราว์เซอร์ไม่รองรับตำแหน่ง');

    navigator.geolocation.getCurrentPosition(async pos => {
        homeLat = pos.coords.latitude;
        homeLon = pos.coords.longitude;
        updateHomeOnMap();
        await saveHomeConfigToFirebase();
        map.setView([homeLat, homeLon], 18);
    }, () => alert('ไม่สามารถอ่านตำแหน่งปัจจุบันได้'), {
        enableHighAccuracy: true, timeout: 12000, maximumAge: 0
    });
}

// ---------------- Record normalization ----------------
// รองรับทั้ง schema ใหม่และข้อมูลเก่า
function normalizeRecord(raw, key = '', dateKey = '') {
    // Prefer the exact schema sent by GeoBeltTracker.ino.
    if (isNewBoardSchema(raw)) return exactBoardRecord(raw, key, dateKey);

    // Legacy fallback for old /esp32_telemetry records.
    if (!raw || typeof raw !== 'object') return null;

    let battery = raw.battery ?? raw.batt ?? raw.battery_percent ?? null;
    let lat = null, lon = null, source = 'NONE', valid = false;

    if (raw.gps) {
        const p = parseLegacyGPS(raw.gps);
        if (p) {
            lat = p.lat;
            lon = p.lon;
            source = p.source;
            valid = true;
        }
    } else if (raw.lat != null && raw.lng != null) {
        lat = Number(raw.lat);
        lon = Number(raw.lng);
        source = String(raw.location_source || 'UNKNOWN');
        valid = Number.isFinite(lat) && Number.isFinite(lon);
    }

    const receivedAtMsRaw = key ? decodePushIdTimestamp(key) : 0;
    const receivedAtMs = isPlausibleTelemetryTime(receivedAtMsRaw) ? receivedAtMsRaw : 0;
    return {
        key, dateKey, raw,
        deviceId: String(raw.device_id || ''),
        firmwareVersion: String(raw.firmware_version || ''),
        uptimeMs: Number(raw.uptime_ms) || 0,
        battery: Number.isFinite(Number(battery)) ? Number(battery) : null,
        lat, lon, source, accuracy: null, valid, stale: false,
        timestampMs: receivedAtMs,
        deviceTimestampMs: 0,
        receivedAtMs,
        deviceTimeValid: false,
        timestampFallback: !!receivedAtMs,
        timestampSource: receivedAtMs ? 'FIREBASE_PUSH' : 'NONE',
        reportedTimeSource: 'LEGACY',
        sos: !!raw.sos,
        wifiConnected: false, wifiSsid: '', wifiRssi: null,
        cellularReady: false,
        locationAgeMs: null, satellites: null, nearbyWifi: []
    };
}

function parseLegacyGPS(gps) {
    if (!gps || String(gps).includes('No Fix')) return null;
    let s = String(gps).trim();

    if (s.startsWith('GoogleAPI:')) {
        const p = s.slice(10).split(',');
        const lat = Number(p[0]), lon = Number(p[1]);
        return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, source: 'GOOGLE' } : null;
    }

    if (s.startsWith('LBS:')) {
        const p = s.slice(4).split(',');
        const lat = Number(p[1]), lon = Number(p[2]);
        return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, source: 'LBS' } : null;
    }

    s = s.replace('GPS:', '').replace('+CGNSSINFO:', '').trim();
    const p = s.split(',');
    for (let i = 0; i < p.length; i++) {
        if (p[i] === 'N' || p[i] === 'S') {
            const latRaw = Number(p[i - 1]);
            const ewIndex = p.findIndex((x, idx) => idx > i && (x === 'E' || x === 'W'));
            if (ewIndex > 0) {
                const lonRaw = Number(p[ewIndex - 1]);
                let lat = nmeaToDecimal(latRaw, false);
                let lon = nmeaToDecimal(lonRaw, true);
                if (p[i] === 'S') lat = -lat;
                if (p[ewIndex] === 'W') lon = -lon;
                if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, source: 'GNSS' };
            }
        }
    }
    return null;
}

function nmeaToDecimal(value, longitude = false) {
    if (!Number.isFinite(value)) return NaN;
    const degDigits = longitude ? 3 : 2;
    const str = String(Math.abs(value));
    const dot = str.indexOf('.');
    const integerLen = dot >= 0 ? dot : str.length;
    if (integerLen <= degDigits) return value;
    const degrees = Math.floor(value / 100);
    const minutes = Math.abs(value) - Math.abs(degrees) * 100;
    return degrees + minutes / 60;
}

// ---------------- Device discovery ----------------
async function discoverDevices() {
    const select = document.getElementById('device-select');
    try {
        const data = await fetchFirebaseJson(`${FIREBASE_DB_BASE}/${HISTORY_ROOT}.json?shallow=true`);
        const devices = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : [];

        select.innerHTML = '';

        if (!devices.length) {
            // Old firmware has no /history/<device>/ structure.
            // Keep the dashboard usable by exposing a legacy pseudo-device.
            select.innerHTML = '<option value="legacy">ข้อมูลเก่า esp32_telemetry</option>';
            currentDeviceId = 'legacy';
            setStatus('ยังไม่พบข้อมูลจาก firmware ใหม่', 'stale');
            await fetchLegacyLatest();
            return;
        }

        devices.sort().forEach(id => {
            const o = document.createElement('option');
            o.value = id;
            o.textContent = id;
            select.appendChild(o);
        });

        if (!currentDeviceId || !devices.includes(currentDeviceId)) currentDeviceId = devices[0];
        select.value = currentDeviceId;
        localStorage.setItem('geobelt_device', currentDeviceId);

        await refreshNow();
    } catch (e) {
        console.error(e);
        select.innerHTML = '<option value="">เชื่อมต่อ Firebase ไม่สำเร็จ</option>';
        setStatus('เชื่อมต่อ Firebase ไม่สำเร็จ', 'offline');
    }
}

async function changeDevice(id) {
    currentDeviceId = id;
    localStorage.setItem('geobelt_device', id);
    lastDeviceCoords = null;
    latestRecord = null;
    latestRecordTimestampMs = 0;
    lastZoneState = null;
    lastSosNotifiedIdentity = '';
    lastConnectivityState = null;
    lastLowBatteryState = false;
    if (deviceMarker) { deviceMarker.remove(); deviceMarker = null; }
    if (accuracyCircle) { accuracyCircle.remove(); accuracyCircle = null; }

    if (id === 'legacy') await fetchLegacyLatest();
    else await refreshNow();
}

// ---------------- Live data ----------------
function bangkokDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const obj = Object.fromEntries(parts.map(x => [x.type, x.value]));
    return `${obj.year}-${obj.month}-${obj.day}`;
}

async function fetchLastRecordForDate(dateKey) {
    if (!currentDeviceId) return null;
    const url = `${FIREBASE_DB_BASE}/${HISTORY_ROOT}/${encodeURIComponent(currentDeviceId)}/${dateKey}.json?orderBy=%22$key%22&limitToLast=1`;
    const data = await fetchFirebaseJson(url);
    if (!data || typeof data !== 'object') return null;
    const keys = Object.keys(data);
    if (!keys.length) return null;
    const key = keys[0];
    return normalizeRecord(data[key], key, dateKey);
}

async function getDeviceDateKeys() {
    if (!currentDeviceId || currentDeviceId === 'legacy') return [];
    try {
        const data = await fetchFirebaseJson(`${FIREBASE_DB_BASE}/${HISTORY_ROOT}/${encodeURIComponent(currentDeviceId)}.json?shallow=true`);
        if (!data || typeof data !== 'object') return [];
        return Object.keys(data).filter(k => k === 'unknown-date' || /^\d{4}-\d{2}-\d{2}$/.test(k));
    } catch (e) {
        console.error('date keys:', e);
        return [];
    }
}

function sortHistoryDateKeys(keys) {
    return keys.slice().sort((a, b) => {
        if (a === 'unknown-date') return 1;
        if (b === 'unknown-date') return -1;
        return b.localeCompare(a);
    });
}

async function fetchLatestRecord() {
    if (!currentDeviceId) return;
    if (currentDeviceId === 'legacy') return fetchLegacyLatest();

    const keys = sortHistoryDateKeys(await getDeviceDateKeys());
    if (!keys.length) {
        setStatus('ยังไม่พบข้อมูลจากอุปกรณ์', 'offline');
        return;
    }

    // Always inspect unknown-date as well as the newest dated nodes. A device whose
    // clock is not synchronized writes to unknown-date; ignoring it can make the
    // dashboard show an older record as if it were live.
    const datedKeys = keys.filter(k => k !== 'unknown-date').slice(0, LIVE_DATE_CANDIDATE_LIMIT);
    const candidateKeys = [...datedKeys];
    if (keys.includes('unknown-date')) candidateKeys.push('unknown-date');

    const candidates = [];
    for (const dateKey of candidateKeys) {
        try {
            const rec = await fetchLastRecordForDate(dateKey);
            if (rec) candidates.push(rec);
        } catch (e) {
            console.error(`latest record (${dateKey}):`, e);
        }
    }

    if (!candidates.length) {
        setStatus('พบอุปกรณ์แต่ยังไม่มี Telemetry', 'stale');
        return;
    }

    candidates.sort((a, b) => recordOrderTimeMs(b) - recordOrderTimeMs(a));
    const rec = candidates[0];

    latestRecord = rec;
    latestRecordTimestampMs = rec.timestampMs || rec.receivedAtMs || 0;
    updateLiveUI(rec);
}

async function fetchLegacyLatest() {
    try {
        const url = `${FIREBASE_DB_BASE}/${LEGACY_ROOT}.json?orderBy=%22$key%22&limitToLast=1`;
        const data = await fetchFirebaseJson(url);
        if (!data || typeof data !== 'object') {
            setStatus('ไม่พบข้อมูลเดิม', 'offline');
            return;
        }

        const [key, raw] = Object.entries(data)[0];
        const rec = normalizeRecord(raw, key, '');
        if (!rec) return;

        latestRecord = rec;
        latestRecordTimestampMs = rec.timestampMs || rec.receivedAtMs || 0;
        updateLiveUI(rec);
    } catch (e) {
        console.error(e);
        setStatus('โหลดข้อมูลเดิมไม่สำเร็จ', 'offline');
    }
}

function updateLiveUI(rec) {
    const now = Date.now();
    const displayTimestampMs = rec.timestampMs || rec.receivedAtMs || 0;
    const futureOffsetMs = displayTimestampMs ? displayTimestampMs - now : 0;
    const hasBadFutureTime = displayTimestampMs && futureOffsetMs > FUTURE_TIME_TOLERANCE_MS;
    const ageSec = displayTimestampMs && !hasBadFutureTime
        ? Math.max(0, Math.floor((now - displayTimestampMs) / 1000))
        : null;

    if (hasBadFutureTime) setStatus('เวลาอุปกรณ์ผิดปกติ', 'stale');
    else if (ageSec !== null && ageSec > OFFLINE_WARNING_SECONDS) setStatus('อุปกรณ์ออฟไลน์/ข้อมูลเก่า', 'offline');
    else if (ageSec !== null && ageSec > STALE_WARNING_SECONDS) setStatus('ข้อมูลเริ่มเก่า', 'stale');
    else if (rec.timestampFallback) setStatus('ออนไลน์ • ใช้เวลารับข้อมูล', 'live');
    else if (!displayTimestampMs) setStatus('ออนไลน์ • ยังไม่มีเวลาจริง', 'stale');
    else setStatus('ออนไลน์', 'live');

    // Telegram alert state transitions. These only fire when the state changes,
    // preventing the 5-second live refresh from spamming duplicate alerts.
    const connectivityState =
        ageSec !== null && ageSec > OFFLINE_WARNING_SECONDS ? 'OFFLINE' : 'ONLINE';

    if (lastConnectivityState && connectivityState !== lastConnectivityState) {
        if (connectivityState === 'OFFLINE') {
            createAlertEvent('DEVICE_OFFLINE', {
                last_seen_ms: displayTimestampMs || null,
                age_seconds: ageSec,
                lat: rec.valid ? rec.lat : null,
                lng: rec.valid ? rec.lon : null,
                location_source: rec.source || 'NONE'
            });
            addLog('📴 อุปกรณ์ออฟไลน์ • ส่งเข้าคิว Telegram');
        } else {
            createAlertEvent('DEVICE_ONLINE', {
                timestamp_ms: displayTimestampMs || Date.now(),
                lat: rec.valid ? rec.lat : null,
                lng: rec.valid ? rec.lon : null,
                location_source: rec.source || 'NONE'
            });
            addLog('🟢 อุปกรณ์กลับมาออนไลน์ • ส่งเข้าคิว Telegram');
        }
    }
    lastConnectivityState = connectivityState;

    const lowBatteryNow = rec.battery !== null &&
        Number.isFinite(Number(rec.battery)) &&
        Number(rec.battery) <= LOW_BATTERY_ALERT_PERCENT;

    if (lowBatteryNow && !lastLowBatteryState) {
        createAlertEvent('LOW_BATTERY', {
            battery_percent: Number(rec.battery),
            timestamp_ms: displayTimestampMs || Date.now(),
            lat: rec.valid ? rec.lat : null,
            lng: rec.valid ? rec.lon : null
        });
        addLog(`🔋 แบตเตอรี่ต่ำ ${Math.round(Number(rec.battery))}% • ส่งเข้าคิว Telegram`);
    }
    lastLowBatteryState = lowBatteryNow;

    const warning = document.getElementById('data-warning');
    if (warning) {
        const warnings = [];
        if (hasBadFutureTime) warnings.push(`เวลาอุปกรณ์เร็วกว่าเวลาจริงประมาณ ${Math.round(futureOffsetMs / 60000)} นาที`);
        if (rec.timestampFallback) warnings.push('อุปกรณ์ยังไม่มีเวลาจริง • แสดงเวลาที่ Firebase รับข้อมูลแทน');
        else if (!rec.deviceTimeValid || rec.dateKey === 'unknown-date') warnings.push('อุปกรณ์ยังไม่ได้เวลาจริงจาก NTP/GNSS/เครือข่าย');
        if (rec.stale) warnings.push('พิกัดนี้เป็น Last Known ไม่ใช่ Fix ปัจจุบัน');
        if (ageSec !== null && ageSec > STALE_WARNING_SECONDS) warnings.push(`ไม่ได้รับข้อมูลใหม่ประมาณ ${ageSec} วินาที`);
        if (rec.source === 'LBS') warnings.push('ตำแหน่งจากเสาสัญญาณมือถืออาจคลาดเคลื่อนมาก');
        warning.innerText = warnings.join(' • ');
        warning.classList.toggle('hidden', warnings.length === 0);
    }

    updateBattery(rec.battery);
    document.getElementById('location-source').innerText = sourceFriendly(rec.source);
    document.getElementById('accuracy-text').innerText =
        Number.isFinite(rec.accuracy) ? `ความแม่นยำโดยประมาณ ±${Math.round(rec.accuracy)} ม.` : 'ความแม่นยำ: ไม่ระบุ';

    document.getElementById('wifi-status').innerText =
        rec.wifiConnected ? `${rec.wifiSsid || 'เชื่อมต่อ'}${rec.wifiRssi != null ? ` (${rec.wifiRssi} dBm)` : ''}` : 'ไม่ได้เชื่อม';
    document.getElementById('cellular-status').innerText = rec.cellularReady ? 'พร้อม' : 'ไม่พร้อม';

    // สรุปคุณภาพพิกัดไว้ในการ์ด "ตำแหน่ง" เดียว
    const sourceUpper = String(rec.source || 'NONE').toUpperCase();
    const isGnss = sourceUpper === 'GNSS' || sourceUpper === 'GPS';

    const satEl = document.getElementById('satellite-count');
    if (satEl) {
        satEl.innerText = isGnss && rec.satellites != null ? rec.satellites : '--';
        satEl.parentElement?.classList.toggle('hidden', !isGnss || rec.satellites == null);
    }

    const fixAgeEl = document.getElementById('location-age');
    if (fixAgeEl) {
        fixAgeEl.innerText = rec.locationAgeMs == null
            ? '--'
            : rec.locationAgeMs < 1000
                ? '<1 วินาที'
                : `${Math.round(rec.locationAgeMs / 1000)} วินาที`;
        fixAgeEl.parentElement?.classList.toggle('hidden', rec.locationAgeMs == null);
    }

    const validityEl = document.getElementById('location-validity');
    if (validityEl) {
        if (!rec.valid) {
            validityEl.innerHTML = '<span class="text-rose-400">● ยังไม่มีพิกัด</span>';
        } else if (rec.stale) {
            validityEl.innerHTML = '<span class="text-amber-400">● ใช้พิกัดล่าสุดที่เคยได้รับ</span>';
        } else {
            validityEl.innerHTML = '<span class="text-emerald-400">● พิกัดพร้อมใช้งาน</span>';
        }
    }


    updateRawTelemetryPanel(rec);

    const displayTime = displayTimestampMs ? new Date(displayTimestampMs).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '-';
    const timeSuffix = rec.timestampFallback ? ' (เวลารับข้อมูล)' : '';
    document.getElementById('last-update').innerText = `อัปเดตล่าสุด: ${displayTime}${timeSuffix}`;
    document.getElementById('data-age').innerText = ageSec === null ? 'อายุข้อมูล: -' : `อายุข้อมูล: ${ageSec} วินาที`;

    const timeSourceEl = document.getElementById('time-source');
    if (timeSourceEl) timeSourceEl.innerText = rec.timestampFallback
        ? 'Firebase receive time'
        : (rec.timestampSource || rec.reportedTimeSource || 'NONE');

    if (rec.valid) {
        lastDeviceCoords = { lat: rec.lat, lon: rec.lon, source: rec.source, stale: rec.stale };
        document.getElementById('lat-lon-text').innerText =
            `${rec.lat.toFixed(6)}, ${rec.lon.toFixed(6)} • ${sourceFriendly(rec.source)}`;

        const icon = createDeviceIcon(rec.source, rec.stale);
        const popup = `<b>${sourceFriendly(rec.source)}</b><br>${rec.lat.toFixed(6)}, ${rec.lon.toFixed(6)}${Number.isFinite(rec.accuracy) ? `<br>±${Math.round(rec.accuracy)} m` : ''}`;

        if (!deviceMarker) {
            deviceMarker = L.marker([rec.lat, rec.lon], { icon }).addTo(map).bindPopup(popup);
        } else {
            deviceMarker.setLatLng([rec.lat, rec.lon]).setIcon(icon).bindPopup(popup);
        }

        if (accuracyCircle) {
            accuracyCircle.remove();
            accuracyCircle = null;
        }
        if (Number.isFinite(rec.accuracy) && rec.accuracy > 0 && rec.accuracy <= 5000) {
            accuracyCircle = L.circle([rec.lat, rec.lon], {
                radius: rec.accuracy, color: '#60a5fa', fillColor: '#60a5fa',
                fillOpacity: .07, weight: 1
            }).addTo(map);
        }

        if (followMode) map.setView([rec.lat, rec.lon], Math.max(map.getZoom(), 17));
        checkGeofence(lastDeviceCoords);
    } else {
        document.getElementById('lat-lon-text').innerText = 'ยังไม่มีพิกัดที่ใช้งานได้';
    }

    if (rec.sos) {
        const sosIdentity =
            `${rec.deviceId || currentDeviceId}|${rec.dateKey}|${rec.key || rec.timestampMs}`;

        if (sosIdentity !== lastSosNotifiedIdentity) {
            lastSosNotifiedIdentity = sosIdentity;

            browserNotify(
                'GeoBelt: SOS',
                'อุปกรณ์ส่งสัญญาณ SOS'
            );

            addLog('🚨 ได้รับ SOS จากอุปกรณ์');

            createAlertEvent('SOS', {
                lat: rec.lat,
                lng: rec.lon
            });
        }
    }
}

function updateRawTelemetryPanel(rec) {
    const summary = document.getElementById('telemetry-summary');
    const raw = document.getElementById('raw-json');

    if (summary) {
        summary.innerHTML = [
            `อุปกรณ์: <b>${escapeHtml(rec.deviceId || currentDeviceId || '-')}</b>`,
            `เฟิร์มแวร์: <b>${escapeHtml(rec.firmwareVersion || '-')}</b>`,
            `วันที่จัดเก็บ: <b>${escapeHtml(rec.dateKey || '-')}</b>`,
            `ทำงานต่อเนื่อง: <b>${formatDuration(rec.uptimeMs)}</b>`,
            `แหล่งเวลา: <b>${escapeHtml(rec.timestampSource || 'NONE')}</b>${rec.timestampFallback ? ' <span class="text-amber-400">(ใช้เวลาที่ Firebase รับข้อมูล)</span>' : ''}`,
            `SOS: <b class="${rec.sos ? 'text-rose-400' : 'text-emerald-400'}">${rec.sos ? 'มีการแจ้งเตือน' : 'ปกติ'}</b>`,
            `แหล่งพิกัด: <b>${escapeHtml(sourceFriendly(rec.source))}</b>`,
            `เครือข่าย: <b>${rec.wifiConnected ? 'Wi‑Fi' : (rec.cellularReady ? '4G พร้อม' : 'ออฟไลน์')}</b>`
        ].join('<br>');
    }

    if (raw) raw.textContent = JSON.stringify(rec.raw, null, 2);
}

function formatDuration(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return '-';
    const sec = Math.floor(n / 1000);
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${d ? d + 'd ' : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function escapeHtml(v) {
    return String(v ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function setStatus(text, state) {
    document.getElementById('status-text').innerText = text;
    const dot = document.getElementById('online-dot');
    dot.className = `status-dot ${state}`;
}

function updateBattery(v) {
    const value = nullableNumber(v);
    const el = document.getElementById('batt-val');
    const bar = document.getElementById('batt-bar');

    if (value === null) {
        el.innerText = '--';
        bar.style.width = '0%';
        bar.className = 'h-2 rounded-full bg-slate-500';
        return;
    }

    const p = Math.max(0, Math.min(100, value));
    el.innerText = Math.round(p);
    bar.style.width = `${p}%`;
    bar.className = `h-2 rounded-full transition-all duration-500 ${p > 50 ? 'bg-emerald-500' : p > 20 ? 'bg-amber-500' : 'bg-rose-500'}`;
}

function sourceFriendly(s) {
    s = String(s || 'NONE').toUpperCase();
    if (s === 'GNSS' || s === 'GPS') return '🛰️ ดาวเทียม GNSS';
    if (s.includes('GOOGLE')) return '📍 ตำแหน่งจากเครือข่าย';
    if (s === 'LAST_KNOWN') return '🕘 พิกัดล่าสุด';
    if (s === 'LBS') return '📡 เสาสัญญาณมือถือ';
    return '— ยังไม่มีพิกัด';
}

function sourceClass(s) {
    s = String(s || '').toUpperCase();
    if (s === 'GNSS' || s === 'GPS') return 'src-gnss';
    if (s.includes('GOOGLE')) return 'src-google';
    if (s === 'LAST_KNOWN') return 'src-last';
    if (s === 'LBS') return 'src-lbs';
    return 'src-none';
}

function checkGeofence(coords) {
    const distance = map.distance([coords.lat, coords.lon], [homeLat, homeLon]);
    document.getElementById('distance-text').innerText = `ห่างจากบ้าน ${distance.toFixed(1)} เมตร`;

    const state = distance <= homeRadius ? 'IN' : 'OUT';
    document.getElementById('home-zone-status').innerHTML =
        state === 'IN'
            ? '<span class="text-emerald-400">🏠 อยู่ในพื้นที่บ้าน</span>'
            : '<span class="text-amber-400">🚗 ออกนอกพื้นที่บ้าน</span>';

    if (lastZoneState && lastZoneState !== state) {
        if (state === 'OUT') {
            browserNotify('GeoBelt', `อุปกรณ์ออกนอกพื้นที่บ้าน ${distance.toFixed(0)} เมตร`);
            createAlertEvent('GEOFENCE_OUT', { distance_m: distance, lat: coords.lat, lng: coords.lon, location_source: coords.source || 'UNKNOWN', home_radius_m: homeRadius });
            addLog(`🚨 ออกจากขอบเขตบ้าน (${distance.toFixed(1)} ม.)`);
        } else {
            browserNotify('GeoBelt', 'อุปกรณ์กลับเข้าสู่พื้นที่บ้าน');
            createAlertEvent('GEOFENCE_IN', { distance_m: distance, lat: coords.lat, lng: coords.lon, location_source: coords.source || 'UNKNOWN', home_radius_m: homeRadius });
            addLog('🏠 กลับเข้าสู่ขอบเขตบ้าน');
        }
    }
    lastZoneState = state;
}

function toggleFollowMode() {
    followMode = !followMode;
    document.getElementById('follow-btn')?.classList.toggle('active', followMode);
    if (followMode) centerToDevice();
}

function centerToDevice() {
    if (!lastDeviceCoords) return alert('ยังไม่มีพิกัด');
    map.setView([lastDeviceCoords.lat, lastDeviceCoords.lon], 18);
}

async function copyCoordinates() {
    if (!lastDeviceCoords) return alert('ยังไม่มีพิกัด');
    const text = `${lastDeviceCoords.lat}, ${lastDeviceCoords.lon}`;
    try {
        await navigator.clipboard.writeText(text);
        addLog('คัดลอกพิกัดแล้ว');
    } catch {
        prompt('คัดลอกพิกัดนี้:', text);
    }
}

function openGoogleMaps() {
    if (!lastDeviceCoords) return alert('ยังไม่มีพิกัด');
    window.open(`https://www.google.com/maps?q=${lastDeviceCoords.lat},${lastDeviceCoords.lon}`, '_blank', 'noopener');
}


async function shareLocation() {
    if (!lastDeviceCoords) {
        alert('ยังไม่มีพิกัด');
        return;
    }

    const lat = lastDeviceCoords.lat.toFixed(6);
    const lon = lastDeviceCoords.lon.toFixed(6);
    const url = `https://www.google.com/maps?q=${lat},${lon}`;

    const shareData = {
        title: 'ตำแหน่ง GeoBelt',
        text: `ตำแหน่งอุปกรณ์: ${lat}, ${lon}`,
        url
    };

    try {
        if (navigator.share) {
            await navigator.share(shareData);
        } else {
            await navigator.clipboard.writeText(url);
            addLog('คัดลอกลิงก์ตำแหน่งแล้ว');
            alert('คัดลอกลิงก์ตำแหน่งแล้ว');
        }
    } catch (e) {
        if (e?.name !== 'AbortError') {
            console.warn('shareLocation:', e);
        }
    }
}

async function toggleMapFullscreen() {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    try {
        if (!document.fullscreenElement) {
            await mapEl.requestFullscreen();
        } else {
            await document.exitFullscreen();
        }

        setTimeout(() => map.invalidateSize(), 120);
    } catch (e) {
        console.warn('fullscreen:', e);
    }
}

document.addEventListener('fullscreenchange', () => {
    setTimeout(() => map.invalidateSize(), 120);
});

async function refreshNow() {
    if (!currentDeviceId) return;
    if (currentDeviceId === 'legacy') await fetchLegacyLatest();
    else await fetchLatestRecord();
}

// ---------------- History: new structure ----------------
async function fetchHistoryDates() {
    if (!currentDeviceId) return;
    const list = document.getElementById('history-date-list');
    list.innerHTML = '<div class="text-xs text-slate-400 text-center py-6">กำลังโหลด...</div>';

    try {
        const data = await fetchFirebaseJson(`${FIREBASE_DB_BASE}/${HISTORY_ROOT}/${encodeURIComponent(currentDeviceId)}.json?shallow=true`);
        historyDates = data && typeof data === 'object' ? sortHistoryDateKeys(Object.keys(data)) : [];
        renderHistoryDateList();
        if (historyDates.length) await selectHistoryDate(historyDates[0]);
    } catch (e) {
        console.error(e);
        list.innerHTML = '<div class="text-xs text-rose-400 text-center py-6">โหลดวันไม่สำเร็จ</div>';
    }
}

function renderHistoryDateList() {
    const list = document.getElementById('history-date-list');
    list.innerHTML = '';

    if (!historyDates.length && !Object.keys(legacyGrouped).length) {
        list.innerHTML = '<div class="text-xs text-slate-400 text-center py-6">ยังไม่มีข้อมูลรูปแบบใหม่<br>กด “ข้อมูลเดิม” เพื่ออ่านฐานข้อมูลเก่า</div>';
        return;
    }

    historyDates.forEach(dateKey => {
        const b = document.createElement('button');
        b.className = 'history-date-btn' + (currentSelectedDate === dateKey ? ' active' : '');
        b.dataset.date = dateKey;
        b.innerHTML = `📅 ${dateKey === 'unknown-date' ? 'ยังไม่มีเวลาจริง' : formatDateThai(dateKey)}<span class="block text-slate-400 font-normal mt-1">ข้อมูลจากบอร์ด</span>`;
        b.onclick = () => selectHistoryDate(dateKey);
        list.appendChild(b);
    });

    Object.keys(legacyGrouped).sort().reverse().forEach(dateKey => {
        const id = `legacy:${dateKey}`;
        const b = document.createElement('button');
        b.className = 'history-date-btn' + (currentSelectedDate === id ? ' active' : '');
        b.dataset.date = id;
        b.innerHTML = `🗃️ ${formatDateThai(dateKey)}<span class="block text-slate-400 font-normal mt-1">${legacyGrouped[dateKey].length} รายการเดิม</span>`;
        b.onclick = () => selectHistoryDate(id);
        list.appendChild(b);
    });
}

async function selectHistoryDate(dateKey) {
    currentSelectedDate = dateKey;
    activeHistoryIndex = -1;
    document.querySelectorAll('.history-date-btn').forEach(b => b.classList.toggle('active', b.dataset.date === dateKey));

    if (dateKey.startsWith('legacy:')) {
        currentDayEntries = legacyGrouped[dateKey.slice(7)] || [];
        renderHistory();
        return;
    }

    document.getElementById('history-table-body').innerHTML =
        '<tr><td colspan="4" class="text-center text-slate-400 py-8">กำลังโหลด...</td></tr>';

    try {
        const data = await fetchFirebaseJson(`${FIREBASE_DB_BASE}/${HISTORY_ROOT}/${encodeURIComponent(currentDeviceId)}/${encodeURIComponent(dateKey)}.json`);

        currentDayEntries = data && typeof data === 'object'
            ? Object.entries(data).map(([key, val]) => normalizeRecord(val, key, dateKey)).filter(Boolean)
            : [];

        currentDayEntries.sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0));
        renderHistory();
    } catch (e) {
        console.error(e);
        currentDayEntries = [];
        renderHistory();
    }
}

function renderHistory() {
    const body = document.getElementById('history-table-body');
    const t1 = document.getElementById('filter-time-start')?.value || '';
    const t2 = document.getElementById('filter-time-end')?.value || '';
    const sourceFilter = document.getElementById('filter-source')?.value || '';

    currentFilteredEntries = currentDayEntries.filter(rec => {
        const time = recordTimeString(rec).slice(0, 5);
        if (t1 && time < t1) return false;
        if (t2 && time > t2) return false;

        if (sourceFilter) {
            const s = String(rec.source || 'NONE').toUpperCase();
            if (sourceFilter === 'GOOGLE' && !s.includes('GOOGLE')) return false;
            else if (sourceFilter !== 'GOOGLE' && s !== sourceFilter) return false;
        }
        return true;
    });

    document.getElementById('history-count').innerText =
        `${currentFilteredEntries.length.toLocaleString()} / ${currentDayEntries.length.toLocaleString()} รายการ`;

    if (!currentFilteredEntries.length) {
        body.innerHTML = '<tr><td colspan="4" class="text-center text-slate-400 py-10">ไม่พบข้อมูล</td></tr>';
        updateHistoryRoute();
        return;
    }

    body.innerHTML = currentFilteredEntries.map((rec, idx) => {
        const coordText = rec.valid ? `${rec.lat.toFixed(6)}, ${rec.lon.toFixed(6)}` : 'No Fix';
        const batt = Number.isFinite(Number(rec.battery)) ? `${Math.round(Number(rec.battery))}%` : '-';
        return `<tr class="history-row ${rec.valid ? 'valid' : 'invalid'} ${idx === activeHistoryIndex ? 'selected' : ''}" ${rec.valid ? `onclick="selectHistoryRow(${idx})"` : ''}>
            <td class="font-mono whitespace-nowrap">🕒 ${recordTimeString(rec)}</td>
            <td class="text-emerald-400 font-bold">${batt}</td>
            <td><span class="source-badge ${sourceClass(rec.source)}">${sourceFriendly(rec.source)}</span></td>
            <td class="max-w-[210px] truncate">${coordText}${rec.stale ? ' • เก่า' : ''}</td>
        </tr>`;
    }).join('');

    if (activeHistoryIndex < 0) {
        const first = currentFilteredEntries.findIndex(x => x.valid);
        if (first >= 0) selectHistoryRow(first);
    } else {
        updateHistoryRoute();
    }
}

function clearHistoryFilters() {
    document.getElementById('filter-time-start').value = '';
    document.getElementById('filter-time-end').value = '';
    document.getElementById('filter-source').value = '';
    renderHistory();
}

function selectHistoryRow(index) {
    activeHistoryIndex = index;
    const rec = currentFilteredEntries[index];
    if (!rec || !rec.valid) return;

    document.querySelectorAll('#history-table-body tr').forEach((r, i) => r.classList.toggle('selected', i === index));

    document.getElementById('side-map-time-label').innerText = recordTimeString(rec);
    document.getElementById('inline-history-info').innerHTML = `
        <div>📅 ${currentSelectedDate?.replace('legacy:', '') || '-'}</div>
        <div class="mt-1">🕒 ${recordTimeString(rec)} • ${escapeHtml(rec.timestampSource || 'NONE')}${rec.timestampFallback ? ' (เวลารับข้อมูล)' : ''}</div>
        <div class="mt-1">📍 ${rec.lat.toFixed(6)}, ${rec.lon.toFixed(6)}</div>
        <div class="mt-1">${sourceFriendly(rec.source)} ${Number.isFinite(rec.accuracy) ? `• ±${Math.round(rec.accuracy)} ม.` : ''}</div>
        <div class="mt-1">🛰️ ดาวเทียม: ${rec.satellites ?? '-'} • อายุ Fix: ${rec.locationAgeMs == null ? '-' : (rec.locationAgeMs / 1000).toFixed(1) + ' s'}</div>
        <div class="mt-1">📶 Wi‑Fi: ${rec.wifiConnected ? escapeHtml(rec.wifiSsid || 'เชื่อมต่อ') : 'ไม่เชื่อม'} • 4G: ${rec.cellularReady ? 'พร้อม' : 'ไม่พร้อม'}</div>
        <div class="mt-1">🔋 ${Number.isFinite(Number(rec.battery)) ? Math.round(Number(rec.battery)) + '%' : '-'}</div>
    `;

    setTimeout(() => {
        if (!historyInlineMap) {
            historyInlineMap = L.map('inline-history-map', { zoomControl: true });
            L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
                maxZoom: 21, subdomains: GOOGLE_SUBDOMAINS, attribution: GOOGLE_ATTRIBUTION
            }).addTo(historyInlineMap);
        }
        historyInlineMap.invalidateSize();
        historyInlineMap.setView([rec.lat, rec.lon], 18);

        const icon = createDeviceIcon(rec.source, rec.stale);
        if (!historyInlineMarker) historyInlineMarker = L.marker([rec.lat, rec.lon], { icon }).addTo(historyInlineMap);
        else historyInlineMarker.setLatLng([rec.lat, rec.lon]).setIcon(icon);

        updateHistoryRoute();
    }, 80);
}

function toggleHistoryRoute() {
    historyRouteEnabled = !historyRouteEnabled;
    document.getElementById('route-btn')?.classList.toggle('active', historyRouteEnabled);
    updateHistoryRoute();
}

function updateHistoryRoute() {
    if (!historyInlineMap) return;
    if (historyRouteLine) {
        historyRouteLine.remove();
        historyRouteLine = null;
    }
    if (!historyRouteEnabled) return;

    const pts = currentFilteredEntries.filter(r => r.valid && r.source !== 'LBS').map(r => [r.lat, r.lon]);
    if (pts.length >= 2) {
        historyRouteLine = L.polyline(pts, { weight: 3, opacity: .75 }).addTo(historyInlineMap);
        historyInlineMap.fitBounds(historyRouteLine.getBounds(), { padding: [25, 25] });
    }
}

function jumpToPickedDate() {
    const date = document.getElementById('history-date-picker').value;
    if (!date) return;
    if (historyDates.includes(date)) return selectHistoryDate(date);
    if (legacyGrouped[date]) return selectHistoryDate(`legacy:${date}`);
    alert('ยังไม่มีข้อมูลของวันที่เลือก');
}

function exportCurrentDayCSV() {
    if (!currentFilteredEntries.length) return alert('ไม่มีข้อมูลให้ส่งออก');
    const rows = [['timestamp', 'time', 'time_source', 'device_time_valid', 'received_at', 'battery', 'source', 'lat', 'lng', 'accuracy_m', 'stale', 'sos']];
    currentFilteredEntries.forEach(r => rows.push([
        r.timestampMs ? new Date(r.timestampMs).toISOString() : '',
        recordTimeString(r),
        r.timestampSource || '',
        !!r.deviceTimeValid,
        r.receivedAtMs ? new Date(r.receivedAtMs).toISOString() : '',
        r.battery ?? '',
        r.source,
        r.valid ? r.lat : '',
        r.valid ? r.lon : '',
        Number.isFinite(r.accuracy) ? r.accuracy : '',
        r.stale,
        r.sos
    ]));

    const csv = rows.map(row => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `GeoBelt_${currentDeviceId}_${(currentSelectedDate || 'history').replace(':', '_')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

function csvEscape(v) {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function formatDateThai(dateKey) {
    const d = new Date(`${dateKey}T12:00:00+07:00`);
    return Number.isNaN(d.getTime()) ? dateKey : d.toLocaleDateString('th-TH', {
        timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric'
    });
}

function recordTimeString(rec) {
    const ms = rec.timestampMs || decodePushIdTimestamp(rec.key);
    if (!ms) return '--:--:--';
    return new Date(ms).toLocaleTimeString('th-TH', {
        timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
}

// ---------------- Legacy pagination ----------------
const PUSH_ID_CHARS = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";

function decodePushIdTimestamp(pushId) {
    if (!pushId || pushId.length < 8) return 0;
    let ms = 0;
    for (let i = 0; i < 8; i++) {
        const n = PUSH_ID_CHARS.indexOf(pushId[i]);
        if (n < 0) return 0;
        ms = ms * 64 + n;
    }
    return ms;
}

async function loadLegacyPage() {
    if (legacyFinished) return alert('โหลดข้อมูลเดิมครบแล้ว');
    let query = `orderBy=%22$key%22&limitToLast=${LEGACY_PAGE_SIZE + (legacyOldestKey ? 1 : 0)}`;
    if (legacyOldestKey) query += `&endAt=%22${encodeURIComponent(legacyOldestKey)}%22`;

    try {
        const data = await fetchFirebaseJson(`${FIREBASE_DB_BASE}/${LEGACY_ROOT}.json?${query}`);
        if (!data || typeof data !== 'object') {
            legacyFinished = true;
            return;
        }

        let entries = Object.entries(data).sort(([a], [b]) => a.localeCompare(b));
        if (legacyOldestKey) entries = entries.filter(([k]) => k !== legacyOldestKey);
        if (!entries.length) {
            legacyFinished = true;
            return;
        }

        legacyOldestKey = entries[0][0];

        entries.forEach(([key, val]) => {
            const ms = decodePushIdTimestamp(key);
            if (!ms) return;
            const dateKey = bangkokDateKey(new Date(ms));
            if (!legacyGrouped[dateKey]) legacyGrouped[dateKey] = [];
            const rec = normalizeRecord(val, key, dateKey);
            if (rec && !legacyGrouped[dateKey].some(x => x.key === key)) legacyGrouped[dateKey].push(rec);
        });

        Object.values(legacyGrouped).forEach(arr => arr.sort((a, b) => a.timestampMs - b.timestampMs));
        renderHistoryDateList();
        document.getElementById('legacy-load-more').classList.remove('hidden');

        if (entries.length < LEGACY_PAGE_SIZE) legacyFinished = true;
        addLog(`โหลดข้อมูลเดิมเพิ่ม ${entries.length} รายการ`);
    } catch (e) {
        console.error(e);
        alert('โหลดข้อมูลเดิมไม่สำเร็จ');
    }
}

// ---------------- Modal ----------------
async function openHistoryModal() {
    const modal = document.getElementById('history-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    await fetchHistoryDates();
}

function closeHistoryModal() {
    const modal = document.getElementById('history-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');

    if (historyInlineMap) {
        historyInlineMap.remove();
        historyInlineMap = null;
    }
    historyInlineMarker = null;
    historyRouteLine = null;
}

document.getElementById('history-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeHistoryModal();
});

// ---------------- Startup ----------------
async function init() {
    await fetchHomeConfigFromFirebase();
    await discoverDevices();

    setInterval(() => currentDeviceId === 'legacy' ? fetchLegacyLatest() : fetchLatestRecord(), LIVE_REFRESH_MS);
    setInterval(fetchHomeConfigFromFirebase, 30000);

    addLog('Dashboard v2.7 พร้อมใช้งาน');
}

init();