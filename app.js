// ============================================================
// SCRIPT.JS FINAL
// IoT MONITORING KOLAM
//
// HTML  : index.html
// CSS   : style.css
// BACKEND: Node.js + Express
//
// API:
// GET  /api/realtime
// GET  /api/history
// POST /api/control/mode
// POST /api/control/pompa_asam
// POST /api/control/pompa_basa
// ============================================================


// ============================================================
// VARIABEL GLOBAL
// ============================================================

const API_BASE = "/api";

const API_REALTIME = `${API_BASE}/realtime`;
const API_HISTORY = `${API_BASE}/history`;

const API_MODE =
    `${API_BASE}/control/mode`;

const API_POMPA_ASAM =
    `${API_BASE}/control/pompa_asam`;

const API_POMPA_BASA =
    `${API_BASE}/control/pompa_basa`;


let currentMode = "AUTO";

let currentPompaAsam = "OFF";

let currentPompaBasa = "OFF";

let historyData = [];

let phChart = null;

let tempChart = null;


// ============================================================
// HELPER
// ============================================================

function getElement(id) {

    return document.getElementById(id);

}


function setText(id, value) {

    const element =
        getElement(id);

    if (element) {

        element.textContent =
            value ?? "-";

    }

}


// ============================================================
// FORMAT ESTIMASI (ETA) WAKTU MENUJU NORMAL
//
// Nilai `estimasi` dari ESP32 satuannya MENIT (desimal).
// Fungsi ini otomatis pilih satuan paling pas:
// - < 1 menit   -> tampil dalam detik
// - < 60 menit  -> tampil dalam menit
// - >= 60 menit -> tampil dalam jam (+ menit sisa)
// ============================================================

function formatEtaDuration(
    menit
) {

    if (
        !Number.isFinite(menit) ||
        menit < 0
    ) {

        return "-";

    }


    if (
        menit < 1
    ) {

        const detik =
            Math.round(
                menit * 60
            );

        return detik + " detik";

    }


    if (
        menit < 60
    ) {

        return (
            menit.toFixed(1) +
            " menit"
        );

    }


    const jam =
        Math.floor(
            menit / 60
        );

    const sisaMenit =
        Math.round(
            menit % 60
        );

    return (
        jam +
        " jam " +
        sisaMenit +
        " menit"
    );

}


// ============================================================
// MASA TENGGANG (GRACE PERIOD) UNTUK KONTROL MODE/POMPA
//
// Firmware ESP32 cuma publish ulang status (mode/pompa_asam/
// pompa_basa) sekali per ~60 detik. Kalau setelah user klik
// kontrol, polling realtime langsung menimpa currentMode/
// currentPompaAsam/currentPompaBasa dengan data LAMA dari
// database (karena ESP32 belum sempat publish ulang), tampilan
// jadi kelihatan "balik sendiri" padahal perintahnya sebenarnya
// sudah terkirim. Variabel di bawah ini menahan tampilan sesuai
// pilihan user selama maksimal 65 detik, sampai ESP32 benar-benar
// konfirmasi (atau waktu tenggang habis).
// ============================================================

const CONTROL_GRACE_MS = 65000;

let pendingMode = null;
let pendingModeAt = 0;

let pendingPompaAsam = null;
let pendingPompaAsamAt = 0;

let pendingPompaBasa = null;
let pendingPompaBasaAt = 0;


function resolvePendingValue(
    pendingValue,
    pendingAt,
    serverValue
) {

    if (
        pendingValue === null
    ) {

        return {
            value: serverValue,
            stillPending: false
        };

    }


    const expired =
        (Date.now() - pendingAt) >
        CONTROL_GRACE_MS;

    const confirmed =
        serverValue === pendingValue;


    if (
        expired ||
        confirmed
    ) {

        return {
            value: serverValue,
            stillPending: false
        };

    }


    // Server masih kirim data lama, tahan dulu
    // tampilan sesuai pilihan user.
    return {
        value: pendingValue,
        stillPending: true
    };

}


function normalize(value) {

    if (
        value === null ||
        value === undefined
    ) {

        return "";

    }

    return String(value)
        .trim()
        .toUpperCase();

}


function isPumpOn(value) {

    const normalized =
        normalize(value);

    return (
        normalized === "ON" ||
        normalized === "1" ||
        normalized === "TRUE"
    );

}


// ============================================================
// REALTIME
// ============================================================
        async function loadRealtime() {

    try {

        const response = await fetch(
            API_REALTIME,
            {
                method: "GET",
                cache: "no-store"
            }
        );

        if (!response.ok) {
            throw new Error(
                "HTTP " + response.status
            );
        }

        const result = await response.json();

        console.log(
            "Realtime API:",
            result
        );
        
        updateESPStatus(
            result.esp_online,
            result.last_seen_seconds
        );


        if (!result.success) {
            console.warn(
                "API realtime gagal",
                result
            );
            return;
        }
        
        
        // ==========================================
        // STATUS ESP32 ONLINE / OFFLINE
        // ==========================================
        
        if (result.esp_online === true) {
        
            updateESPStatus(true);
        
        } else {
        
            updateESPStatus(false);
        
        }

        const data =
            result.data;
            
        // ==========================================
        // UPDATE STATUS ESP32
        // ==========================================
        
        // ========================================================
        // STATUS ESP32 ONLINE / OFFLINE
        // ========================================================
        
        const espOnline = result.esp_online === true;
        
        const espDot = document.getElementById("esp-dot");
        const espStatus = document.getElementById("esp-status");
        
        if (espStatus) {
            espStatus.textContent = espOnline
                ? "Online"
                : "Offline";
        }
        
        if (espDot) {
            espDot.classList.remove("online", "offline");
        
            espDot.classList.add(
                espOnline
                    ? "online"
                    : "offline"
            );
        }
        
        // ========================================================
        // UPDATE STATUS ESP32
        // ========================================================
        function updateESPStatus(isOnline, lastSeenSeconds) {
        
            const espStatus = getElement("esp-status");
            const espDot = getElement("esp-dot");
        
            const online = isOnline === true;
        
            if (online) {
        
                // =========================
                // ESP32 ONLINE
                // =========================
        
                if (espStatus) {
                    espStatus.textContent = "Online";
                }
        
                if (espDot) {
        
                    espDot.classList.remove(
                        "offline"
                    );
        
                    espDot.classList.add(
                        "online"
                    );
        
                }
        
            } else {
        
                // =========================
                // ESP32 OFFLINE
                // =========================
        
                if (espStatus) {
        
                    if (
                        typeof lastSeenSeconds === "number"
                    ) {
        
                        espStatus.textContent =
                            "Offline";
        
                    } else {
        
                        espStatus.textContent =
                            "Offline";
        
                    }
        
                }
        
                if (espDot) {
        
                    espDot.classList.remove(
                        "online"
                    );
        
                    espDot.classList.add(
                        "offline"
                    );
        
                }
        
            }
        
        }


        // ====================================================
        // SUHU
        // ====================================================

        const suhu =
            Number(data.suhu);


        if (
            Number.isFinite(suhu)
        ) {

            setText(
                "temp-val",
                suhu.toFixed(2)
            );

            updateTemperatureBadge(
                suhu
            );

        }


        // ====================================================
        // pH
        // ====================================================

        const ph =
            Number(data.ph);


        if (
            Number.isFinite(ph)
        ) {

            setText(
                "ph-val",
                ph.toFixed(2)
            );

            updatePHBadge(
                ph
            );

        }


        // ====================================================
        // FUZZY
        // ====================================================

        const fuzzy =
            Number(data.fuzzy);


        if (
            Number.isFinite(fuzzy)
        ) {

            setText(
                "fz-crisp-big",
                fuzzy.toFixed(2)
            );

        }


        // ====================================================
        // STATUS KUALITAS AIR
        // ====================================================

        updateWaterQuality(
            data.status
        );


        // ====================================================
        // ESTIMASI
        // ====================================================

        const estimasi =
            Number(data.estimasi);


        if (
            Number.isFinite(estimasi)
        ) {

            setText(
                "wq-eta-value",
                formatEtaDuration(
                    estimasi
                )
            );

        }
        else {

            setText(
                "wq-eta-value",
                "-"
            );

        }


        // ====================================================
        // MODE
        // ====================================================

        if (
            data.mode !== null &&
            data.mode !== undefined
        ) {

            const serverMode =
                normalize(
                    data.mode
                );

            const resolvedMode =
                resolvePendingValue(
                    pendingMode,
                    pendingModeAt,
                    serverMode
                );

            currentMode =
                resolvedMode.value;

            if (
                !resolvedMode.stillPending
            ) {

                pendingMode = null;

            }

        }


        updateModeUI();


        // ====================================================
        // POMPA ASAM
        // ====================================================

        {

            const serverPompaAsam =
                isPumpOn(
                    data.pompa_asam
                )
                    ? "ON"
                    : "OFF";

            const resolvedPompaAsam =
                resolvePendingValue(
                    pendingPompaAsam,
                    pendingPompaAsamAt,
                    serverPompaAsam
                );

            currentPompaAsam =
                resolvedPompaAsam.value;

            if (
                !resolvedPompaAsam.stillPending
            ) {

                pendingPompaAsam = null;

            }

        }


        updatePompaAsamUI();


        // ====================================================
        // POMPA BASA
        // ====================================================

        {

            const serverPompaBasa =
                isPumpOn(
                    data.pompa_basa
                )
                    ? "ON"
                    : "OFF";

            const resolvedPompaBasa =
                resolvePendingValue(
                    pendingPompaBasa,
                    pendingPompaBasaAt,
                    serverPompaBasa
                );

            currentPompaBasa =
                resolvedPompaBasa.value;

            if (
                !resolvedPompaBasa.stillPending
            ) {

                pendingPompaBasa = null;

            }

        }


        updatePompaBasaUI();


        // ====================================================
        // WAKTU
        // ====================================================

        updateLastUpdate(
            data.waktu
        );


    }
    catch (error) {

        console.error(
            "Gagal mengambil realtime:",
            error
        );

        setText(
            "esp-status",
            "Offline"
        );

        const espDot =
            getElement("esp-dot");

        if (espDot) {

            espDot.classList.remove(
                "online"
            );

            espDot.classList.add(
                "offline"
            );

        }

    }

}


// ============================================================
// UPDATE BADGE pH
// ============================================================

function updatePHBadge(ph) {

    const badge =
        getElement("ph-badge");


    if (!badge) {

        return;

    }


    badge.classList.remove(
        "badge-good",
        "badge-warn",
        "badge-danger"
    );


    if (
        ph >= 6.5 &&
        ph <= 8.5
    ) {

        badge.textContent =
            "Normal";

        badge.classList.add(
            "badge-good"
        );

    }

    else if (
        ph < 6.5
    ) {

        badge.textContent =
            "Rendah";

        badge.classList.add(
            "badge-warn"
        );

    }

    else {

        badge.textContent =
            "Tinggi";

        badge.classList.add(
            "badge-danger"
        );

    }

}


// ============================================================
// UPDATE BADGE SUHU
// ============================================================

function updateTemperatureBadge(
    suhu
) {

    const badge =
        getElement("temp-badge");


    if (!badge) {

        return;

    }


    badge.classList.remove(
        "badge-good",
        "badge-warn",
        "badge-danger"
    );


    if (
        suhu >= 20 &&
        suhu <= 30
    ) {

        badge.textContent =
            "Normal";

        badge.classList.add(
            "badge-good"
        );

    }

    else if (
        suhu < 20
    ) {

        badge.textContent =
            "Rendah";

        badge.classList.add(
            "badge-warn"
        );

    }

    else {

        badge.textContent =
            "Tinggi";

        badge.classList.add(
            "badge-danger"
        );

    }

}


// ============================================================
// STATUS KUALITAS AIR
// ============================================================

function updateWaterQuality(
    status
) {

    const statusValue =
        normalize(status);


    const label =
        getElement("wq-label");


    const dot =
        getElement("wq-dot");


    if (label) {

        label.textContent =
            statusValue || "-";

        label.classList.remove(
            "good",
            "warn",
            "bad"
        );


        if (
            statusValue === "BAIK"
        ) {

            label.classList.add(
                "good"
            );

        }

        else if (
            statusValue === "CUKUP"
        ) {

            label.classList.add(
                "warn"
            );

        }

        else if (
            statusValue === "BURUK"
        ) {

            label.classList.add(
                "bad"
            );

        }

    }


    if (dot) {

        dot.classList.remove(
            "good",
            "warn",
            "bad"
        );


        if (
            statusValue === "BAIK"
        ) {

            dot.classList.add(
                "good"
            );

        }

        else if (
            statusValue === "CUKUP"
        ) {

            dot.classList.add(
                "warn"
            );

        }

        else if (
            statusValue === "BURUK"
        ) {

            dot.classList.add(
                "bad"
            );

        }

    }

}


// ============================================================
// MODE UI
// ============================================================

function updateModeUI() {

    const autoButton =
        getElement("btn-auto");

    const manualButton =
        getElement("btn-manual");

    const pump1 =
        getElement("pump1-tog");

    const pump2 =
        getElement("pump2-tog");


    const isAuto =
        currentMode === "AUTO";


    if (autoButton) {

        autoButton.classList.toggle(
            "active-auto",
            isAuto
        );

    }


    if (manualButton) {

        manualButton.classList.toggle(
            "active-manual",
            !isAuto
        );

    }


    // Pompa hanya bisa dikontrol
    // ketika mode MANUAL

    if (pump1) {

        pump1.disabled =
            isAuto;

    }


    if (pump2) {

        pump2.disabled =
            isAuto;

    }

}


// ============================================================
// POMPA ASAM UI
// ============================================================

function updatePompaAsamUI() {

    const toggle =
        getElement("pump1-tog");

    const subtitle =
        getElement("p1-sub");


    const isOn =
        currentPompaAsam === "ON";


    if (toggle) {

        toggle.checked =
            isOn;

    }


    if (subtitle) {

        subtitle.textContent =
            isOn
                ? "ON"
                : "OFF";

    }

}


// ============================================================
// POMPA BASA UI
// ============================================================

function updatePompaBasaUI() {

    const toggle =
        getElement("pump2-tog");

    const subtitle =
        getElement("p2-sub");


    const isOn =
        currentPompaBasa === "ON";


    if (toggle) {

        toggle.checked =
            isOn;

    }


    if (subtitle) {

        subtitle.textContent =
            isOn
                ? "ON"
                : "OFF";

    }

}


// ============================================================
// MODE CONTROL
//
// HTML Anda memanggil:
//
// setMode('auto')
// setMode('manual')
//
// Karena itu fungsi harus GLOBAL.
// ============================================================

async function setMode(mode) {

    const normalizedMode =
        normalize(mode);


    if (
        normalizedMode !== "AUTO" &&
        normalizedMode !== "MANUAL"
    ) {

        return;

    }


    try {

        console.log(
            "Mengirim mode:",
            normalizedMode
        );


        const response =
            await fetch(
                API_MODE,
                {

                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            mode:
                                normalizedMode
                        })

                }
            );


        const result =
            await response.json();


        console.log(
            "Response mode:",
            result
        );


        if (
            !response.ok ||
            !result.success
        ) {

            throw new Error(
                result.message ||
                "Gagal mengubah mode"
            );

        }


        currentMode =
            normalizedMode;

        pendingMode =
            normalizedMode;

        pendingModeAt =
            Date.now();


        updateModeUI();


        // Ambil status terbaru
        setTimeout(
            loadRealtime,
            800
        );


    }
    catch (error) {

        console.error(
            "Gagal mengubah mode:",
            error
        );


        alert(
            "Gagal mengubah mode:\n" +
            error.message
        );

    }

}


// ============================================================
// MAKE GLOBAL
// Agar onclick HTML bisa menemukan fungsi
// ============================================================

window.setMode =
    setMode;


// ============================================================
// KONTROL POMPA
//
// HTML Anda memanggil:
//
// togglePump(1)
// togglePump(2)
//
// ============================================================

async function togglePump(
    pumpNumber
) {

    // ========================================================
    // CEK MODE
    // ========================================================

    if (
        currentMode !== "MANUAL"
    ) {

        alert(
            "Ubah mode ke MANUAL terlebih dahulu"
        );


        // Kembalikan posisi toggle

        if (
            pumpNumber === 1
        ) {

            updatePompaAsamUI();

        }

        else if (
            pumpNumber === 2
        ) {

            updatePompaBasaUI();

        }


        return;

    }


    let toggle;

    let apiUrl;

    let pumpName;


    // ========================================================
    // POMPA ASAM
    // ========================================================

    if (
        pumpNumber === 1
    ) {

        toggle =
            getElement(
                "pump1-tog"
            );

        apiUrl =
            API_POMPA_ASAM;

        pumpName =
            "Pompa Asam";

    }


    // ========================================================
    // POMPA BASA
    // ========================================================

    else if (
        pumpNumber === 2
    ) {

        toggle =
            getElement(
                "pump2-tog"
            );

        apiUrl =
            API_POMPA_BASA;

        pumpName =
            "Pompa Basa";

    }

    else {

        return;

    }


    if (!toggle) {

        return;

    }


    const status =
        toggle.checked
            ? "ON"
            : "OFF";


    try {

        console.log(
            pumpName,
            status
        );


        const response =
            await fetch(
                apiUrl,
                {

                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            status:
                                status
                        })

                }
            );


        const result =
            await response.json();


        console.log(
            "Response pompa:",
            result
        );


        if (
            !response.ok ||
            !result.success
        ) {

            throw new Error(
                result.message ||
                `Gagal mengontrol ${pumpName}`
            );

        }


        // ====================================================
        // SIMPAN STATUS
        // ====================================================

        if (
            pumpNumber === 1
        ) {

            currentPompaAsam =
                status;

            pendingPompaAsam =
                status;

            pendingPompaAsamAt =
                Date.now();


            updatePompaAsamUI();

        }


        if (
            pumpNumber === 2
        ) {

            currentPompaBasa =
                status;

            pendingPompaBasa =
                status;

            pendingPompaBasaAt =
                Date.now();


            updatePompaBasaUI();

        }


        // Ambil data ESP32 terbaru

        setTimeout(
            loadRealtime,
            800
        );


    }
    catch (error) {

        console.error(
            `Gagal ${pumpName}:`,
            error
        );


        alert(
            `Gagal mengontrol ${pumpName}:\n` +
            error.message
        );


        // Kembalikan toggle

        if (
            pumpNumber === 1
        ) {

            updatePompaAsamUI();

        }

        else {

            updatePompaBasaUI();

        }

    }

}


// ============================================================
// MAKE GLOBAL
// ============================================================

window.togglePump =
    togglePump;


// ============================================================
// LOAD HISTORY
// ============================================================

async function loadHistory() {

    try {

        const response =
            await fetch(
                API_HISTORY,
                {
                    method: "GET",
                    cache: "no-store"
                }
            );


        if (!response.ok) {

            throw new Error(
                `HTTP ${response.status}`
            );

        }


        const result =
            await response.json();


        console.log(
            "History API:",
            result
        );


        // ====================================================
        // VALIDASI
        // ====================================================

        if (
            !result.success ||
            !Array.isArray(
                result.data
            )
        ) {

            throw new Error(
                "Format response history tidak valid"
            );

        }


        // ====================================================
        // SIMPAN DATA ASLI
        // ====================================================

        historyData =
            result.data;


        // ====================================================
        // DATA UNTUK CHART
        // ====================================================

        // API mengirim data urut lama -> baru (ASC).
        // Untuk chart, batasi maksimal 10 titik waktu terakhir saja
        // (data history sudah otomatis berjarak sekitar 5 menit sekali
        // sesuai logika dedup di services/saveData.js).

        const MAX_CHART_POINTS = 10;

        const history =
            result.data
                .slice(-MAX_CHART_POINTS);


        const labels = [];

        const phData = [];

        const suhuData = [];


        // ====================================================
        // PROSES HISTORY
        // ====================================================

        history.forEach(
            function (item) {

                // -------------------------------
                // WAKTU
                // -------------------------------

                let waktu =
                    "";


                if (
                    item.waktu
                ) {

                    const date =
                        new Date(
                            item.waktu
                        );


                    if (
                        !Number.isNaN(
                            date.getTime()
                        )
                    ) {

                        waktu =
                            date.toLocaleTimeString(
                                "id-ID",
                                {
                                    hour:
                                        "2-digit",

                                    minute:
                                        "2-digit"
                                }
                            );

                    }

                }


                labels.push(
                    waktu
                );


                // -------------------------------
                // pH
                // -------------------------------

                const nilaiPh =
                    Number(
                        item.ph
                    );


                phData.push(
                    Number.isFinite(
                        nilaiPh
                    )
                        ? nilaiPh
                        : null
                );


                // -------------------------------
                // SUHU
                // -------------------------------

                const nilaiSuhu =
                    Number(
                        item.suhu
                    );


                suhuData.push(
                    Number.isFinite(
                        nilaiSuhu
                    )
                        ? nilaiSuhu
                        : null
                );

            }
        );


        console.log(
            "History jumlah:",
            history.length
        );

        console.log(
            "Chart labels:",
            labels
        );

        console.log(
            "Chart pH:",
            phData
        );

        console.log(
            "Chart suhu:",
            suhuData
        );


        // ====================================================
        // UPDATE CHART
        // ====================================================

        updateCharts(
            labels,
            phData,
            suhuData
        );


        // ====================================================
        // UPDATE TABEL
        // ====================================================

        updateHistoryTable(
            result.data
        );


    }
    catch (error) {

        console.error(
            "Gagal mengambil history:",
            error
        );

    }

}


// ============================================================
// UPDATE CHART
// ============================================================

function updateCharts(
    labels,
    phData,
    suhuData
) {

    // ========================================================
    // CEK CHART.JS
    // ========================================================

    if (
        typeof Chart ===
        "undefined"
    ) {

        console.error(
            "Chart.js belum dimuat"
        );

        return;

    }


    // ========================================================
    // WARNA TEKS CHART (putih, biar kebaca di background gelap)
    // ========================================================

    Chart.defaults.color =
        "#ffffff";

    Chart.defaults.borderColor =
        "rgba(255, 255, 255, 0.15)";


    // ========================================================
    // CHART pH
    // ========================================================

    const phCanvas =
        getElement(
            "chart-ph"
        );


    if (!phCanvas) {

        console.error(
            "Canvas #chart-ph tidak ditemukan"
        );

    }
    else {

        if (
            phChart
        ) {

            phChart.destroy();

        }


        phChart =
            new Chart(
                phCanvas,
                {

                    type: "line",

                    data: {

                        labels:
                            labels,

                        datasets: [

                            {

                                label:
                                    "pH",

                                data:
                                    phData,

                                borderColor:
                                    "#22c55e",

                                backgroundColor:
                                    "rgba(34, 197, 94, 0.2)",

                                pointBackgroundColor:
                                    "#22c55e",

                                pointBorderColor:
                                    "#22c55e",

                                borderWidth:
                                    2,

                                pointRadius:
                                    3,

                                tension:
                                    0.35,

                                fill:
                                    true

                            }

                        ]

                    },

                    options: {

                        responsive:
                            true,

                        maintainAspectRatio:
                            false,

                        animation:
                            false,

                        plugins: {

                            legend: {

                                display:
                                    false

                            }

                        },

                        scales: {

                            y: {

                                beginAtZero:
                                    false,

                                grid: {

                                    display:
                                        false

                                },

                                title: {

                                    display:
                                        true,

                                    text:
                                        "Nilai pH"

                                }

                            },

                            x: {

                                grid: {

                                    display:
                                        false

                                },

                                title: {

                                    display:
                                        true,

                                    text:
                                        "Waktu"

                                }

                            }

                        }

                    }

                }
            );

    }


    // ========================================================
    // CHART SUHU
    // ========================================================

    const tempCanvas =
        getElement(
            "chart-temp"
        );


    if (!tempCanvas) {

        console.error(
            "Canvas #chart-temp tidak ditemukan"
        );

    }
    else {

        if (
            tempChart
        ) {

            tempChart.destroy();

        }


        tempChart =
            new Chart(
                tempCanvas,
                {

                    type: "line",

                    data: {

                        labels:
                            labels,

                        datasets: [

                            {

                                label:
                                    "Temperature (��C)",

                                data:
                                    suhuData,

                                borderColor:
                                    "#f97316",

                                backgroundColor:
                                    "rgba(249, 115, 22, 0.2)",

                                pointBackgroundColor:
                                    "#f97316",

                                pointBorderColor:
                                    "#f97316",

                                borderWidth:
                                    2,

                                pointRadius:
                                    3,

                                tension:
                                    0.35,

                                fill:
                                    true

                            }

                        ]

                    },

                    options: {

                        responsive:
                            true,

                        maintainAspectRatio:
                            false,

                        animation:
                            false,

                        plugins: {

                            legend: {

                                display:
                                    false

                            }

                        },

                        scales: {

                            y: {

                                beginAtZero:
                                    false,

                                grid: {

                                    display:
                                        false

                                },

                                title: {

                                    display:
                                        true,

                                    text:
                                        "Suhu (��C)"

                                }

                            },

                            x: {

                                grid: {

                                    display:
                                        false

                                },

                                title: {

                                    display:
                                        true,

                                    text:
                                        "Waktu"

                                }

                            }

                        }

                    }

                }

            );

    }

}


// ============================================================
// UPDATE HISTORY TABLE
// ============================================================

function updateHistoryTable(
    data
) {

    const tbody =
        getElement(
            "data-tbody"
        );


    if (!tbody) {

        return;

    }


    if (
        !Array.isArray(data) ||
        data.length === 0
    ) {

        tbody.innerHTML = `

            <tr>

                <td
                    colspan="9"
                    class="empty-cell"
                >
                    Belum ada data
                </td>

            </tr>

        `;

        return;

    }


    // API terbaru �� terlama

    tbody.innerHTML =
        [...data]
            .reverse()
            .map(
            function (item) {

                let tanggal =
                    "-";

                let jam =
                    "-";


                if (
                    item.waktu
                ) {

                    const date =
                        new Date(
                            item.waktu
                        );


                    if (
                        !Number.isNaN(
                            date.getTime()
                        )
                    ) {

                        tanggal =
                            date.toLocaleDateString(
                                "id-ID"
                            );


                        jam =
                            date.toLocaleTimeString(
                                "id-ID",
                                {
                                    hour:
                                        "2-digit",

                                    minute:
                                        "2-digit"
                                }
                            );

                    }

                }


                const ph =
                    item.ph ??
                    "-";


                const suhu =
                    item.suhu ??
                    "-";


                const fuzzy =
                    item.fuzzy ??
                    "-";


                const pwm =
                    item.pwm ??
                    "-";


                const kecepatan =
                    item.kecepatan ??
                    "-";


                const estimasi =
                    item.estimasi !== null &&
                    item.estimasi !== undefined
                        ? formatEtaDuration(
                              Number(item.estimasi)
                          )
                        : "-";


                const status =
                    item.status ??
                    "-";


                return `

                    <tr>

                        <td>
                            ${tanggal}
                        </td>

                        <td>
                            ${jam}
                        </td>

                        <td>
                            ${ph}
                        </td>

                        <td>
                            ${suhu}
                        </td>

                        <td>
                            ${fuzzy}
                        </td>

                        <td>
                            ${pwm}
                        </td>

                        <td>
                            ${kecepatan}
                        </td>

                        <td>
                            ${estimasi}
                        </td>

                        <td>
                            ${status}
                        </td>

                    </tr>

                `;

            }
        )
        .join("");

}


// ============================================================
// UPDATE LAST UPDATE
// ============================================================

function updateLastUpdate(
    waktu
) {

    if (!waktu) {

        return;

    }


    const date =
        new Date(
            waktu
        );


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return;

    }


    setText(
        "tb-last",
        date.toLocaleTimeString(
            "id-ID",
            {
                hour:
                    "2-digit",

                minute:
                    "2-digit"
            }
        )
    );

}


// ============================================================
// JAM DAN TANGGAL
// ============================================================

function updateClock() {

    const now =
        new Date();


    const dateText =
        now.toLocaleDateString(
            "id-ID",
            {
                weekday:
                    "long",

                day:
                    "2-digit",

                month:
                    "long",

                year:
                    "numeric"
            }
        );


    const timeText =
        now.toLocaleTimeString(
            "id-ID",
            {
                hour:
                    "2-digit",

                minute:
                    "2-digit",

                second:
                    "2-digit"
            }
        );


    setText(
        "tb-date",
        dateText
    );


    setText(
        "tb-time",
        timeText
    );

}


// ============================================================
// NAVIGASI
// ============================================================

function initNavigation() {

    const navItems =
        document.querySelectorAll(
            ".nav-item"
        );


    navItems.forEach(
        function (button) {

            button.addEventListener(
                "click",
                function () {

                    const page =
                        button.dataset.page;


                    if (!page) {

                        return;

                    }


                    // Semua nav nonaktif

                    document
                        .querySelectorAll(
                            ".nav-item"
                        )
                        .forEach(
                            function (item) {

                                item.classList.remove(
                                    "active"
                                );

                            }
                        );


                    // Nav yang diklik aktif

                    document
                        .querySelectorAll(
                            `.nav-item[data-page="${page}"]`
                        )
                        .forEach(
                            function (item) {

                                item.classList.add(
                                    "active"
                                );

                            }
                        );


                    // Semua halaman sembunyikan

                    document
                        .querySelectorAll(
                            ".page"
                        )
                        .forEach(
                            function (item) {

                                item.classList.remove(
                                    "active"
                                );

                            }
                        );


                    // Halaman aktif

                    const activePage =
                        getElement(
                            `page-${page}`
                        );


                    if (
                        activePage
                    ) {

                        activePage.classList.add(
                            "active"
                        );

                    }


                    // Jika masuk Data,
                    // refresh history

                    if (
                        page === "data"
                    ) {

                        loadHistory();

                    }

                }
            );

        }
    );

}


// ============================================================
// REFRESH BUTTON
// ============================================================

function initRefresh() {

    const button =
        getElement(
            "refresh-btn"
        );


    if (!button) {

        return;

    }


    button.addEventListener(
        "click",
        async function () {

            await loadRealtime();

            await loadHistory();

        }
    );

}


// ============================================================
// RESET DATA (HAPUS HISTORY)
// ============================================================

function initReset() {

    const button =
        getElement(
            "reset-btn"
        );


    if (!button) {

        return;

    }


    button.addEventListener(
        "click",
        async function () {

            const konfirmasi =
                confirm(
                    "Yakin ingin menghapus SEMUA data history? " +
                    "Tindakan ini tidak bisa dibatalkan."
                );


            if (!konfirmasi) {

                return;

            }


            button.disabled = true;

            button.textContent =
                "Menghapus...";


            try {

                const response =
                    await fetch(
                        API_HISTORY,
                        {
                            method: "DELETE"
                        }
                    );

                const result =
                    await response.json();


                if (!result.success) {

                    throw new Error(
                        result.message ||
                        "Gagal menghapus data"
                    );

                }


                alert(
                    "Data history berhasil dihapus."
                );

                await loadHistory();

            } catch (error) {

                console.error(
                    "Gagal reset history:",
                    error
                );

                alert(
                    "Gagal menghapus data: " +
                    error.message
                );

            } finally {

                button.disabled = false;

                button.textContent =
                    "🗑 Reset Data";

            }

        }
    );

}


// ============================================================
// EXPORT EXCEL
// ============================================================

function initExport() {

    const button =
        getElement(
            "export-btn"
        );


    if (!button) {

        return;

    }


    button.addEventListener(
        "click",
        function () {

            try {

            if (
                typeof XLSX ===
                "undefined"
            ) {

                alert(
                    "Library Excel belum tersedia"
                );

                return;

            }


            if (
                !historyData.length
            ) {

                alert(
                    "Belum ada data history"
                );

                return;

            }


            const exportData =
                historyData.map(
                    function (item) {

                        const waktuDate =
                            item.waktu
                                ? new Date(item.waktu)
                                : null;

                        const tanggalStr =
                            waktuDate &&
                            !isNaN(waktuDate)
                                ? waktuDate.toLocaleDateString(
                                      "id-ID"
                                  )
                                : "";

                        const jamStr =
                            waktuDate &&
                            !isNaN(waktuDate)
                                ? waktuDate.toLocaleTimeString(
                                      "id-ID",
                                      {
                                          hour:
                                              "2-digit",

                                          minute:
                                              "2-digit",

                                          second:
                                              "2-digit"
                                      }
                                  )
                                : "";

                        return {

                            Tanggal:
                                tanggalStr,

                            Jam:
                                jamStr,

                            "Suhu (°C)":
                                item.suhu ??
                                "",

                            pH:
                                item.ph ??
                                "",

                            "Nilai Fuzzy":
                                item.fuzzy ??
                                "",

                            PWM:
                                item.pwm ??
                                "",

                            Kecepatan:
                                item.kecepatan ??
                                "",

                            "Estimasi Waktu (menit)":
                                item.estimasi ??
                                "",

                            "Pompa Asam":
                                item.pompa_asam ??
                                "",

                            "Pompa Basa":
                                item.pompa_basa ??
                                "",

                            Mode:
                                item.mode ??
                                "",

                            Status:
                                item.status ??
                                ""

                        };

                    }
                );


            const worksheet =
                XLSX.utils.json_to_sheet(
                    exportData
                );


            worksheet["!cols"] = [
                { wch: 12 },
                { wch: 8 },
                { wch: 10 },
                { wch: 8 },
                { wch: 12 },
                { wch: 8 },
                { wch: 14 },
                { wch: 18 },
                { wch: 12 },
                { wch: 12 },
                { wch: 10 },
                { wch: 10 }
            ];


            // ================================================
            // SHEET RINGKASAN
            // ================================================

            const totalData =
                historyData.length;

            const jumlahBaik =
                historyData.filter(
                    function (x) {
                        return (
                            (x.status || "")
                                .toUpperCase() ===
                            "BAIK"
                        );
                    }
                ).length;

            const jumlahBuruk =
                historyData.filter(
                    function (x) {
                        return (
                            (x.status || "")
                                .toUpperCase() ===
                            "BURUK"
                        );
                    }
                ).length;

            const rataSuhu =
                historyData.reduce(
                    function (a, b) {
                        return (
                            a +
                            parseFloat(
                                b.suhu || 0
                            )
                        );
                    },
                    0
                ) / totalData;

            const rataPh =
                historyData.reduce(
                    function (a, b) {
                        return (
                            a +
                            parseFloat(
                                b.ph || 0
                            )
                        );
                    },
                    0
                ) / totalData;

            const rataFuzzy =
                historyData.reduce(
                    function (a, b) {
                        return (
                            a +
                            parseFloat(
                                b.fuzzy || 0
                            )
                        );
                    },
                    0
                ) / totalData;

            const worksheetRingkasan =
                XLSX.utils.aoa_to_sheet([
                    ["LAPORAN MONITORING KUALITAS AIR"],
                    [""],
                    [
                        "Tanggal Export",
                        new Date().toLocaleString("id-ID")
                    ],
                    ["Total Data", totalData],
                    ["Jumlah BAIK", jumlahBaik],
                    ["Jumlah BURUK", jumlahBuruk],
                    [""],
                    ["Rata-rata Suhu", rataSuhu.toFixed(2)],
                    ["Rata-rata pH", rataPh.toFixed(2)],
                    ["Rata-rata Fuzzy", rataFuzzy.toFixed(2)]
                ]);


            const workbook =
                XLSX.utils.book_new();


            XLSX.utils.book_append_sheet(
                workbook,
                worksheet,
                "Data"
            );

            XLSX.utils.book_append_sheet(
                workbook,
                worksheetRingkasan,
                "Ringkasan"
            );


            const tanggalFile =
                new Date()
                    .toLocaleDateString("id-ID")
                    .replace(/\//g, "-");


            XLSX.writeFile(
                workbook,
                "history-monitoring-kolam-" +
                    tanggalFile +
                    ".xlsx"
            );

            } catch (error) {

                console.error(
                    "Gagal export Excel:",
                    error
                );

                alert(
                    "Gagal export Excel: " +
                    error.message
                );

            }

        }
    );

}


// ============================================================
// INISIALISASI
// ============================================================

document.addEventListener(
    "DOMContentLoaded",
    async function () {

        console.log(
            "================================"
        );

        console.log(
            "Dashboard Node.js dimuat"
        );

        console.log(
            "================================"
        );


        // Jam

        updateClock();


        setInterval(
            updateClock,
            1000
        );


        // Navigasi

        initNavigation();


        // Reset Data

        initReset();


        // Export

        initExport();


        // Data awal

        await loadRealtime();

        await loadHistory();


        // ====================================================
        // AUTO REFRESH REALTIME
        // ====================================================

        setInterval(
            loadRealtime,
            5000
        );


        // ====================================================
        // AUTO REFRESH HISTORY + CHART
        // Disamakan dengan jadwal simpan history di backend
        // (services/saveData.js: maksimal 1x insert per 5 menit),
        // jadi tidak perlu refresh lebih sering dari itu.
        // ====================================================

        setInterval(
            loadHistory,
            300000
        );


        console.log(
            "Dashboard siap digunakan"
        );

    }
);
