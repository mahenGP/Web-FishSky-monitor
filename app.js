
"use strict";

// =========================================================
// KONFIGURASI API
// =========================================================

const API_BASE = "/api";

const API = {
    realtime: `${API_BASE}/realtime`,
    history: `${API_BASE}/history`,
    mode: `${API_BASE}/control/mode`,
    pompaAsam: `${API_BASE}/control/pompa_asam`,
    pompaBasa: `${API_BASE}/control/pompa_basa`,
    kalibrasi: `${API_BASE}/control/kalibrasi`,
    kalibrasiStatus: `${API_BASE}/kalibrasi/status`
};

// =========================================================
// STATE
// =========================================================

let currentMode = "AUTO";

let pumpAcidState = "OFF";
let pumpBaseState = "OFF";

let historyData = [];

let phChart = null;
let tempChart = null;

const CONTROL_GRACE_MS = 65000;

let pendingMode = null;
let pendingPumpAcid = null;
let pendingPumpBase = null;

// =========================================================
// HELPER DOM
// =========================================================

function getElement(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const element = getElement(id);

    if (element) {
        element.textContent = value ?? "-";
    }
}

function normalize(value) {
    return String(value ?? "")
        .trim()
        .toUpperCase();
}

function isPumpOn(value) {
    return normalize(value) === "ON";
}

function clamp(value, min, max) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return min;
    }

    return Math.max(min, Math.min(max, number));
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// =========================================================
// FORMAT ANGKA
// =========================================================

function formatNumber(value, digits = 2) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "-";
    }

    return number.toLocaleString("id-ID", {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits
    });
}

// =========================================================
// FORMAT ESTIMASI WAKTU
// =========================================================

function formatEtaDuration(menit) {
    const value = Number(menit);

    if (!Number.isFinite(value) || value <= 0) {
        return "0 menit";
    }

    if (value < 1) {
        return `${Math.round(value * 60)} detik`;
    }

    if (value < 60) {
        return `${formatNumber(value, 1)} menit`;
    }

    const jam = Math.floor(value / 60);
    const sisaMenit = Math.round(value % 60);

    if (sisaMenit === 0) {
        return `${jam} jam`;
    }

    return `${jam} jam ${sisaMenit} menit`;
}

// =========================================================
// FORMAT DATETIME MYSQL
// =========================================================

function parseDateValue(value) {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    const text = String(value).trim();

    // Format MySQL:
    // YYYY-MM-DD HH:mm:ss
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(text)) {
        const date = new Date(text.replace(" ", "T"));

        return Number.isNaN(date.getTime())
            ? null
            : date;
    }

    const date = new Date(text);

    return Number.isNaN(date.getTime())
        ? null
        : date;
}

function formatDate(value) {
    const date = parseDateValue(value);

    if (!date) {
        return "-";
    }

    return date.toLocaleDateString("id-ID", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    });
}

function formatTime(value) {
    const date = parseDateValue(value);

    if (!date) {
        return "-";
    }

    return date.toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
}

// =========================================================
// PENDING CONTROL
// =========================================================

function resolvePendingValue(
    serverValue,
    pendingValue,
    pendingTime
) {
    if (
        pendingValue !== null &&
        pendingTime !== null &&
        Date.now() - pendingTime < CONTROL_GRACE_MS
    ) {
        return pendingValue;
    }

    return serverValue;
}

function clearExpiredPending() {
    const now = Date.now();

    if (
        pendingMode &&
        now - pendingMode.time >= CONTROL_GRACE_MS
    ) {
        pendingMode = null;
    }

    if (
        pendingPumpAcid &&
        now - pendingPumpAcid.time >= CONTROL_GRACE_MS
    ) {
        pendingPumpAcid = null;
    }

    if (
        pendingPumpBase &&
        now - pendingPumpBase.time >= CONTROL_GRACE_MS
    ) {
        pendingPumpBase = null;
    }
}

// =========================================================
// STATUS ESP32
// =========================================================

function updateESPStatus(
    online,
    lastSeenSeconds
) {
    const statusElement = getElement("esp-status");
    const dotElement = getElement("esp-dot");

    let text = online
        ? "ESP32 Online"
        : "ESP32 Offline";

    if (
        online &&
        Number.isFinite(Number(lastSeenSeconds))
    ) {
        const seconds = Number(lastSeenSeconds);

        if (seconds < 60) {
            text += ` • ${seconds} detik lalu`;
        } else {
            text += ` • ${Math.floor(seconds / 60)} menit lalu`;
        }
    }

    if (statusElement) {
        statusElement.textContent = text;
    }

    if (dotElement) {
        dotElement.classList.toggle(
            "online",
            Boolean(online)
        );

        dotElement.classList.toggle(
            "offline",
            !Boolean(online)
        );
    }

    setText(
        "esp-status-text",
        text
    );
}

// =========================================================
// BADGE SUHU
// =========================================================

function updateTemperatureBadge(suhu) {
    const value = Number(suhu);

    const badge =
        getElement("temp-badge") ||
        getElement("temp-status");

    if (!badge) {
        return;
    }

    badge.classList.remove(
        "normal",
        "low",
        "high",
        "baik",
        "cukup",
        "buruk"
    );

    if (!Number.isFinite(value)) {
        badge.textContent = "-";
        return;
    }

    if (value < 20) {
        badge.textContent = "Rendah";
        badge.classList.add("low");
    } else if (value > 30) {
        badge.textContent = "Tinggi";
        badge.classList.add("high");
    } else {
        badge.textContent = "Normal";
        badge.classList.add("normal");
    }
}

// =========================================================
// BADGE PH
// =========================================================

function updatePHBadge(ph) {
    const value = Number(ph);

    const badge =
        getElement("ph-badge") ||
        getElement("ph-status");

    if (!badge) {
        return;
    }

    badge.classList.remove(
        "normal",
        "low",
        "high",
        "baik",
        "cukup",
        "buruk"
    );

    if (!Number.isFinite(value)) {
        badge.textContent = "-";
        return;
    }

    if (value < 6.5) {
        badge.textContent = "Rendah";
        badge.classList.add("low");
    } else if (value > 8.5) {
        badge.textContent = "Tinggi";
        badge.classList.add("high");
    } else {
        badge.textContent = "Normal";
        badge.classList.add("normal");
    }
}

// =========================================================
// STATUS KUALITAS AIR
// =========================================================
function updateWaterQuality(status) {

    const value = normalize(status);

    console.log("STATUS KUALITAS AIR:", status);
    console.log("STATUS SETELAH NORMALIZE:", value);

    // Sesuai dengan ID pada HTML
    const label = getElement("wq-label");
    const dot = getElement("wq-dot");

    if (!label) {
        console.warn("Elemen #wq-label tidak ditemukan!");
        return;
    }

    // Tampilkan status
    label.textContent = value || "--";

    // Hapus class lama
    label.classList.remove(
        "baik",
        "cukup",
        "buruk",
        "good",
        "warn",
        "bad"
    );

    if (dot) {
        dot.classList.remove(
            "baik",
            "cukup",
            "buruk",
            "good",
            "warn",
            "bad"
        );
    }

    // Status BAIK
    if (value === "BAIK") {

        label.classList.add("baik", "good");

        if (dot) {
            dot.classList.add("baik", "good");
        }
    }

    // Status CUKUP
    else if (value === "CUKUP") {

        label.classList.add("cukup", "warn");

        if (dot) {
            dot.classList.add("cukup", "warn");
        }
    }

    // Status BURUK
    else if (value === "BURUK") {

        label.classList.add("buruk", "bad");

        if (dot) {
            dot.classList.add("buruk", "bad");
        }
    }

    // Status tidak dikenal
    else {

        console.warn(
            "Status kualitas air tidak dikenali:",
            value
        );
    }
}


// =========================================================
// OUTPUT DISKRET
// =========================================================

function updateDiscreteOutput(output) {
    const value = Number(output);

    const text =
        Number.isFinite(value)
            ? formatNumber(value, 0)
            : "-";

    setText(
        "output-diskret",
        text
    );

    // Kompatibilitas dengan ID lama
    setText(
        "fz-crisp-big",
        text
    );
}

// =========================================================
// PWM
// =========================================================

function updatePWM(
    pwm,
    pwmPersen
) {
    const duty = clamp(
        pwm,
        0,
        255
    );

    const persen = clamp(
        pwmPersen,
        0,
        100
    );

    setText(
        "pwm-value",
        formatNumber(duty, 0)
    );

    setText(
        "pwm-persen",
        `${formatNumber(persen, 0)}%`
    );

    // ID alternatif
    setText(
        "pwm-val",
        formatNumber(duty, 0)
    );

    setText(
        "pwm-percent",
        `${formatNumber(persen, 0)}%`
    );
}

// =========================================================
// KECEPATAN
// =========================================================

function updateSpeed(kecepatan) {
    const value =
        String(
            kecepatan ?? "Mati"
        ).trim() || "Mati";

    setText(
        "pump-speed",
        value
    );

    setText(
        "kecepatan",
        value
    );

    setText(
        "speed-value",
        value
    );
}

// =========================================================
// ESTIMASI WAKTU
// =========================================================

function updateEstimation(estimasi) {
    const value = Number(estimasi);

    const text =
        Number.isFinite(value)
            ? formatEtaDuration(value)
            : "-";

    setText(
        "wq-eta-value",
        text
    );

    setText(
        "estimasi-value",
        text
    );

    setText(
        "estimasi-menit",
        Number.isFinite(value)
            ? formatNumber(value, 2)
            : "-"
    );
}

// =========================================================
// MODE UI
// =========================================================
    function updateModeUI(mode) {
    const value = normalize(mode) || "AUTO";

    currentMode = value;

    const autoButton = getElement("btn-auto");
    const manualButton = getElement("btn-manual");

    // ================================
    // RESET SEMUA CLASS MODE
    // ================================
    if (autoButton) {
        autoButton.classList.remove(
            "active",
            "active-auto",
            "active-manual"
        );

        autoButton.setAttribute(
            "aria-pressed",
            value === "AUTO" ? "true" : "false"
        );
    }

    if (manualButton) {
        manualButton.classList.remove(
            "active",
            "active-auto",
            "active-manual"
        );

        manualButton.setAttribute(
            "aria-pressed",
            value === "MANUAL" ? "true" : "false"
        );
    }

    // ================================
    // AKTIFKAN MODE
    // ================================
    if (value === "AUTO") {
        if (autoButton) {
            autoButton.classList.add("active");
        }
    }

    if (value === "MANUAL") {
        if (manualButton) {
            manualButton.classList.add("active");
        }
    }

    // ================================
    // TEXT MODE
    // ================================
    setText("mode-value", value);
    setText("mode-status", value);
    setText("current-mode", value);

    // ================================
    // ENABLE / DISABLE POMPA
    // ================================
    const acidToggle = getElement("pump1-tog");
    const baseToggle = getElement("pump2-tog");

    if (acidToggle) {
        acidToggle.disabled = value !== "MANUAL";
    }

    if (baseToggle) {
        baseToggle.disabled = value !== "MANUAL";
    }
}


// =========================================================
// POMPA UI
// =========================================================

function updatePumpUI(
    pumpNumber,
    state
) {
    const value =
        normalize(state) === "ON"
            ? "ON"
            : "OFF";

    const toggle =
        getElement(
            pumpNumber === 1
                ? "pump1-tog"
                : "pump2-tog"
        );

    const sub =
        getElement(
            pumpNumber === 1
                ? "p1-sub"
                : "p2-sub"
        );

    if (toggle) {
        if (toggle.type === "checkbox") {
            toggle.checked =
                value === "ON";
        }

        toggle.classList.toggle(
            "on",
            value === "ON"
        );

        toggle.classList.toggle(
            "off",
            value === "OFF"
        );

        toggle.setAttribute(
            "aria-pressed",
            value === "ON"
                ? "true"
                : "false"
        );
    }

    if (sub) {
        sub.textContent = value;
    }

    if (pumpNumber === 1) {
        setText(
            "pompa-asam-value",
            value
        );
    } else {
        setText(
            "pompa-basa-value",
            value
        );
    }
}

// =========================================================
// LAST UPDATE
// =========================================================

function updateLastUpdate(value) {
    const date = formatDate(value);
    const time = formatTime(value);

    if (date === "-" && time === "-") {
        setText(
            "tb-last",
            "-"
        );

        setText(
            "last-update",
            "-"
        );

        return;
    }

    const text = `${date} ${time}`;

    setText(
        "tb-last",
        text
    );

    setText(
        "last-update",
        text
    );
}

// =========================================================
// FETCH JSON
// =========================================================

async function fetchJSON(
    url,
    options = {}
) {
    const response =
        await fetch(
            url,
            {
                cache: "no-store",
                ...options,
                headers: {
                    "Content-Type":
                        "application/json",

                    ...(options.headers || {})
                }
            }
        );

    let result;

    try {
        result =
            await response.json();
    } catch {
        throw new Error(
            `Server mengembalikan respons bukan JSON (${response.status})`
        );
    }

    if (!response.ok) {
        throw new Error(
            result?.message ||
            `Request gagal (${response.status})`
        );
    }

    return result;
}

// =========================================================
// LOAD REALTIME
// =========================================================

async function loadRealtime() {
    try {
        clearExpiredPending();

        const result =
            await fetchJSON(
                API.realtime
            );

        if (
            result.status !==
            "success"
        ) {
            throw new Error(
                result.message ||
                "Gagal mengambil data realtime"
            );
        }

        updateESPStatus(
            result.esp_online,
            result.last_seen_seconds
        );

        // Tidak ada data
        if (!result.data) {
            setText(
                "temp-val",
                "-"
            );

            setText(
                "ph-val",
                "-"
            );

            setText(
                "output-diskret",
                "-"
            );

            setText(
                "pwm-value",
                "-"
            );

            setText(
                "pwm-persen",
                "-"
            );

            setText(
                "pump-speed",
                "-"
            );

            setText(
                "wq-eta-value",
                "-"
            );

            return;
        }

        const data =
            result.data;

        // =====================================================
        // SENSOR SUHU
        // =====================================================

        const suhu =
            Number(data.suhu);

        setText(
            "temp-val",
            Number.isFinite(suhu)
                ? `${formatNumber(suhu, 2)} °C`
                : "-"
        );

        updateTemperatureBadge(
            suhu
        );

        // =====================================================
        // SENSOR PH
        // =====================================================

        const ph =
            Number(data.ph);

        setText(
            "ph-val",
            Number.isFinite(ph)
                ? formatNumber(ph, 2)
                : "-"
        );

        updatePHBadge(
            ph
        );

        // =====================================================
        // METODE DISKRET
        // =====================================================

        updateWaterQuality(
            data.status
        );

        updateDiscreteOutput(
            data.output_diskret
        );

        // =====================================================
        // PWM
        // =====================================================

        updatePWM(
            data.pwm,
            data.pwm_persen
        );

        // =====================================================
        // KECEPATAN
        // =====================================================

        updateSpeed(
            data.kecepatan
        );

        // =====================================================
        // ESTIMASI
        // =====================================================

        updateEstimation(
            data.estimasi_menit
        );

        // =====================================================
        // MODE
        // =====================================================

        const mode =
            resolvePendingValue(
                normalize(data.mode) ||
                    "AUTO",

                pendingMode?.value ??
                    null,

                pendingMode?.time ??
                    null
            );

        updateModeUI(
            mode
        );

        // =====================================================
        // POMPA ASAM
        // =====================================================

        const acid =
            resolvePendingValue(
                normalize(data.pompa_asam) ||
                    "OFF",

                pendingPumpAcid?.value ??
                    null,

                pendingPumpAcid?.time ??
                    null
            );

        pumpAcidState =
            acid;

        updatePumpUI(
            1,
            acid
        );

        // =====================================================
        // POMPA BASA
        // =====================================================

        const base =
            resolvePendingValue(
                normalize(data.pompa_basa) ||
                    "OFF",

                pendingPumpBase?.value ??
                    null,

                pendingPumpBase?.time ??
                    null
            );

        pumpBaseState =
            base;

        updatePumpUI(
            2,
            base
        );

        // =====================================================
        // WAKTU
        // =====================================================

        updateLastUpdate(
            data.waktu ||
            result.last_seen
        );

    } catch (error) {
        console.error(
            "Gagal load realtime:",
            error
        );

        updateESPStatus(
            false,
            null
        );
    }
}

// =========================================================
// SET MODE
// =========================================================

async function setMode(mode) {
    const value =
        normalize(mode);

    if (
        value !== "AUTO" &&
        value !== "MANUAL"
    ) {
        console.error(
            "Mode tidak valid:",
            mode
        );

        return;
    }

    try {
        pendingMode = {
            value: value,
            time: Date.now()
        };

        updateModeUI(
            value
        );

        const result =
            await fetchJSON(
                API.mode,
                {
                    method: "POST",

                    body: JSON.stringify({
                        mode: value
                    })
                }
            );

        if (!result.success) {
            throw new Error(
                result.message ||
                "Gagal mengubah mode"
            );
        }

        console.log(
            "Mode berhasil dikirim:",
            value
        );

        setTimeout(
            loadRealtime,
            800
        );

    } catch (error) {
        console.error(
            "Gagal mengubah mode:",
            error
        );

        pendingMode = null;

        await loadRealtime();

        alert(
            `Gagal mengubah mode: ${error.message}`
        );
    }
}

// =========================================================
// TOGGLE POMPA
// =========================================================

async function togglePump(
    pumpNumber
) {
    if (
        currentMode !==
        "MANUAL"
    ) {
        alert(
            "Pompa hanya dapat dikontrol pada mode MANUAL."
        );

        return;
    }

    let currentState;
    let endpoint;

    if (pumpNumber === 1) {
        currentState =
            pumpAcidState;

        endpoint =
            API.pompaAsam;

    } else if (pumpNumber === 2) {
        currentState =
            pumpBaseState;

        endpoint =
            API.pompaBasa;

    } else {
        console.error(
            "Nomor pompa tidak valid:",
            pumpNumber
        );

        return;
    }

    const newState =
        isPumpOn(currentState)
            ? "OFF"
            : "ON";

    try {
        if (pumpNumber === 1) {
            pendingPumpAcid = {
                value: newState,
                time: Date.now()
            };
        } else {
            pendingPumpBase = {
                value: newState,
                time: Date.now()
            };
        }

        updatePumpUI(
            pumpNumber,
            newState
        );

        // Server.js menerima:
        // { status: "ON" }
        // atau
        // { value: "ON" }

        const result =
            await fetchJSON(
                endpoint,
                {
                    method: "POST",

                    body: JSON.stringify({
                        status: newState
                    })
                }
            );

        if (!result.success) {
            throw new Error(
                result.message ||
                "Perintah pompa gagal"
            );
        }

        console.log(
            `Pompa ${
                pumpNumber === 1
                    ? "asam"
                    : "basa"
            }: ${newState}`
        );

        setTimeout(
            loadRealtime,
            800
        );

    } catch (error) {
        console.error(
            "Gagal mengontrol pompa:",
            error
        );

        if (pumpNumber === 1) {
            pendingPumpAcid =
                null;
        } else {
            pendingPumpBase =
                null;
        }

        await loadRealtime();

        alert(
            `Gagal mengontrol pompa: ${error.message}`
        );
    }
}

// =========================================================
// EXPORT KE HTML
// =========================================================

window.setMode =
    setMode;

window.togglePump =
    togglePump;

// =========================================================
// LOAD HISTORY
// =========================================================

async function loadHistory() {
    try {
        const result =
            await fetchJSON(
                API.history
            );

        if (
            result.status !==
            "success"
        ) {
            throw new Error(
                result.message ||
                "Gagal mengambil history"
            );
        }

        historyData =
            Array.isArray(result.data)
                ? result.data
                : [];

        updateHistoryTable();

        updateCharts();

    } catch (error) {
        console.error(
            "Gagal load history:",
            error
        );

        historyData = [];

        updateHistoryTable();
    }
}

// =========================================================
// OUTPUT DISKRET CLIENT
// FALLBACK UNTUK DATA LAMA
// =========================================================

function getDiscreteOutputClient(
    status
) {
    const value =
        normalize(status);

    if (value === "BURUK") {
        return 25;
    }

    if (value === "CUKUP") {
        return 55;
    }

    if (value === "BAIK") {
        return 85;
    }

    return 0;
}

// =========================================================
// HISTORY TABLE
// =========================================================

function updateHistoryTable() {
    const tbody =
        getElement("history-body") ||
        getElement("history-tbody") ||
        document.querySelector(
            "#history-table tbody"
        );

    if (!tbody) {
        return;
    }

    if (
        historyData.length === 0
    ) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11"
                    style="text-align:center;">
                    Belum ada data history
                </td>
            </tr>
        `;

        return;
    }

    const rows =
        [...historyData].sort(
            (a, b) => {
                const dateA =
                    parseDateValue(
                        a.waktu
                    )?.getTime() || 0;

                const dateB =
                    parseDateValue(
                        b.waktu
                    )?.getTime() || 0;

                return dateB - dateA;
            }
        );

    tbody.innerHTML =
        rows.map(item => {

            const suhu =
                Number(item.suhu);

            const ph =
                Number(item.ph);

            const pwm =
                Number(item.pwm);

            const pwmPersen =
                Number(item.pwm_persen);

            const estimasi =
                Number(
                    item.estimasi_menit
                );

            const output =
                Number.isFinite(
                    Number(
                        item.output_diskret
                    )
                )
                    ? Number(
                        item.output_diskret
                    )
                    : getDiscreteOutputClient(
                        item.status
                    );

            return `
                <tr>

                    <td>
                        ${escapeHtml(
                            formatDate(
                                item.waktu
                            )
                        )}
                    </td>

                    <td>
                        ${escapeHtml(
                            formatTime(
                                item.waktu
                            )
                        )}
                    </td>

                    <td>
                        ${
                            Number.isFinite(ph)
                                ? escapeHtml(
                                    formatNumber(
                                        ph,
                                        2
                                    )
                                )
                                : "-"
                        }
                    </td>

                    <td>
                        ${
                            Number.isFinite(suhu)
                                ? escapeHtml(
                                    formatNumber(
                                        suhu,
                                        2
                                    )
                                ) + " °C"
                                : "-"
                        }
                    </td>

                    <td>
                        ${escapeHtml(
                            formatNumber(
                                output,
                                0
                            )
                        )}
                    </td>

                    <td>
                        ${
                            Number.isFinite(pwm)
                                ? escapeHtml(
                                    formatNumber(
                                        pwm,
                                        0
                                    )
                                )
                                : "-"
                        }
                    </td>

                    <td>
                        ${
                            Number.isFinite(
                                pwmPersen
                            )
                                ? escapeHtml(
                                    formatNumber(
                                        pwmPersen,
                                        0
                                    )
                                ) + "%"
                                : "-"
                        }
                    </td>

                    <td>
                        ${escapeHtml(
                            item.kecepatan ||
                            "Mati"
                        )}
                    </td>

                    <td>
                        ${
                            Number.isFinite(
                                estimasi
                            )
                                ? escapeHtml(
                                    formatEtaDuration(
                                        estimasi
                                    )
                                )
                                : "-"
                        }
                    </td>

                    <td>
                        ${escapeHtml(
                            item.status ||
                            "-"
                        )}
                    </td>

                    <td>
                        ${escapeHtml(
                            item.mode ||
                            "-"
                        )}
                    </td>

                </tr>
            `;

        }).join("");
}

// =========================================================
// UPDATE CHART
// =========================================================

function updateCharts() {
    if (typeof Chart === "undefined") {
        console.warn("Chart.js belum tersedia.");
        return;
    }

    // =====================================================
    // AMBIL 20 DATA TERAKHIR
    // =====================================================

    const chartData = [...historyData]
        .sort((a, b) => {
            const dateA =
                parseDateValue(a.waktu)?.getTime() || 0;

            const dateB =
                parseDateValue(b.waktu)?.getTime() || 0;

            return dateA - dateB;
        })
        .slice(-20);

    // =====================================================
    // LABEL WAKTU
    // =====================================================

    const labels = chartData.map(item => {
        const date = parseDateValue(item.waktu);

        return date
            ? date.toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit"
            })
            : "-";
    });

    // =====================================================
    // DATA PH
    // =====================================================

    const phValues = chartData.map(item => {
        const value = Number(item.ph);
        return Number.isFinite(value) ? value : null;
    });

    // =====================================================
    // DATA SUHU
    // =====================================================

    const tempValues = chartData.map(item => {
        const value = Number(item.suhu);
        return Number.isFinite(value) ? value : null;
    });

    // =====================================================
    // GRAFIK PH
    // =====================================================

    const phCanvas =
        getElement("chart-ph") ||
        getElement("phChart") ||
        getElement("ph-chart");

    if (phCanvas) {

        if (phChart) {
            phChart.destroy();
        }

        phChart = new Chart(phCanvas, {
            type: "line",

            data: {
                labels: labels,

                datasets: [
                    {
                        label: "pH",

                        data: phValues,

                        borderWidth: 2,

                        borderColor: "#4ade80",

                        backgroundColor: "#4ade80",

                        tension: 0.45,

                        fill: false,

                        pointRadius: 2,

                        pointHoverRadius: 5,

                        spanGaps: true
                    },
                ]
            },

            options: {
                responsive: true,

                maintainAspectRatio: false,

                interaction: {
                    mode: "index",
                    intersect: false
                },

                plugins: {

                    legend: {
                        display: true,

                        labels: {
                            color: "#ffffff",

                            usePointStyle: true,

                            padding: 15
                        }
                    },

                    tooltip: {
                        enabled: true,

                        callbacks: {
                            title: function(context) {
                                return `Waktu: ${context[0].label}`;
                            },

                            label: function(context) {

                                const value =
                                    context.parsed.y;

                                if (
                                    context.datasetIndex === 0
                                ) {
                                    return ` pH: ${formatNumber(value, 2)}`;
                                }

                                return ` ${context.dataset.label}`;
                            }
                        }
                    }
                },

                scales: {

                    x: {
                        ticks: {
                            color: "#ffffff",

                            maxRotation: 0,

                            autoSkip: true,

                            maxTicksLimit: 10
                        },

                        grid: {
                            display: false
                        }
                    },

                    y: {
                        min: 5,

                        max: 9,

                        ticks: {
                            color: "#ffffff",

                            stepSize: 0.5,

                            callback: function(value) {
                                return value.toLocaleString(
                                    "id-ID",
                                    {
                                        minimumFractionDigits: 1,
                                        maximumFractionDigits: 1
                                    }
                                );
                            }
                        },

                        grid: {
                            display: false
                        },

                        title: {
                            display: true,

                            text: "Nilai pH",

                            color: "#ffffff"
                        }
                    }
                }
            }
        });
    }

    // =====================================================
    // GRAFIK SUHU
    // =====================================================

    const tempCanvas =
        getElement("chart-temp") ||
        getElement("tempChart") ||
        getElement("temp-chart");

    if (tempCanvas) {

        if (tempChart) {
            tempChart.destroy();
        }

        tempChart = new Chart(tempCanvas, {
            type: "line",

            data: {
                labels: labels,

                datasets: [
                    {
                        label: "Suhu (°C)",

                        data: tempValues,

                        backgroundColor: "#fb923c",

                        borderColor: "#fb923c",

                        borderWidth: 2,

                        tension: 0.45,

                        fill: false,

                        pointRadius: 2,

                        pointHoverRadius: 5,

                        spanGaps: true
                    }
                ]
            },

            options: {
                responsive: true,

                maintainAspectRatio: false,

                interaction: {
                    mode: "index",
                    intersect: false
                },

                plugins: {

                    legend: {
                        display: true,

                        labels: {
                            color: "#ffffff",

                            usePointStyle: true,

                            padding: 15
                        }
                    },

                    tooltip: {
                        enabled: true,

                        callbacks: {
                            title: function(context) {
                                return `Waktu: ${context[0].label}`;
                            },

                            label: function(context) {

                                const value =
                                    context.parsed.y;

                                return ` Suhu: ${formatNumber(value, 2)} °C`;
                            }
                        }
                    }
                },

                scales: {

                    x: {
                        ticks: {
                            color: "#ffffff",

                            maxRotation: 0,

                            autoSkip: true,

                            maxTicksLimit: 10
                        },

                        grid: {
                           display: false
                        }
                    },

                    y: {
                        min: 15,

                        max: 35,

                        ticks: {
                            color: "#ffffff",

                            stepSize: 2
                        },

                        grid: {
                            display: false
                        },

                        title: {
                            display: true,

                            text: "Suhu (°C)",

                            color: "#ffffff"
                        }
                    }
                }
            }
        });
    }
}

// =========================================================
// CLOCK
// =========================================================

function updateClock() {
    const now =
        new Date();

    setText(
        "tb-date",
        now.toLocaleDateString(
            "id-ID",
            {
                weekday: "long",
                day: "2-digit",
                month: "long",
                year: "numeric"
            }
        )
    );

    setText(
        "tb-time",
        now.toLocaleTimeString(
            "id-ID",
            {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            }
        )
    );
}

// =========================================================
// NAVIGASI
// =========================================================

function initNavigation() {
    const navItems =
        document.querySelectorAll(
            ".nav-item"
        );

    navItems.forEach(
        item => {

            item.addEventListener(
                "click",
                () => {

                    const page =
                        item.dataset.page;

                    if (!page) {
                        return;
                    }

                    navItems.forEach(
                        nav => {
                            nav.classList.remove(
                                "active"
                            );
                        }
                    );

                    item.classList.add(
                        "active"
                    );

                    document
                        .querySelectorAll(
                            ".page"
                        )
                        .forEach(
                            section => {
                                section.classList.remove(
                                    "active"
                                );
                            }
                        );

                    const target =
                        getElement(
                            `page-${page}`
                        ) ||
                        document.querySelector(
                            `[data-page-content="${page}"]`
                        );

                    if (target) {
                        target.classList.add(
                            "active"
                        );
                    }

                    if (
                        page === "data" ||
                        page === "history"
                    ) {
                        loadHistory();
                    }
                }
            );

        }
    );
}

// =========================================================
// REFRESH BUTTON
// =========================================================

function initRefreshButton() {
    const button =
        getElement(
            "refresh-btn"
        );

    if (!button) {
        return;
    }

    button.addEventListener(
        "click",
        async () => {

            button.disabled =
                true;

            try {

                await Promise.all([
                    loadRealtime(),
                    loadHistory()
                ]);

            } finally {

                button.disabled =
                    false;
            }
        }
    );
}

// =========================================================
// RESET HISTORY
// =========================================================

function initResetButton() {
    const button =
        getElement(
            "reset-btn"
        );

    if (!button) {
        return;
    }

    button.addEventListener(
        "click",
        async () => {

            const confirmed =
                confirm(
                    "Yakin ingin menghapus seluruh data history?"
                );

            if (!confirmed) {
                return;
            }

            try {

                const result =
                    await fetchJSON(
                        API.history,
                        {
                            method:
                                "DELETE"
                        }
                    );

                if (
                    !result.success
                ) {
                    throw new Error(
                        result.message ||
                        "Gagal menghapus history"
                    );
                }

                historyData = [];

                updateHistoryTable();

                updateCharts();

                alert(
                    "History berhasil dihapus."
                );

            } catch (error) {

                console.error(
                    "Gagal reset history:",
                    error
                );

                alert(
                    `Gagal menghapus history: ${error.message}`
                );
            }
        }
    );
}


// =========================================================
// EXPORT EXCEL
// =========================================================

function initExportButton() {

    const button = document.getElementById("export-btn");

    if (!button) {
        console.warn("Tombol export tidak ditemukan.");
        return;
    }

    // Mencegah event listener terpasang dua kali
    if (button.dataset.exportReady === "true") {
        return;
    }

    button.dataset.exportReady = "true";

    button.addEventListener("click", async function () {

        try {

            // =================================================
            // CEK LIBRARY XLSX
            // =================================================

            if (typeof XLSX === "undefined") {

                throw new Error(
                    "Library SheetJS (XLSX) belum tersedia."
                );
            }

            console.log("Memulai export Excel...");

            // =================================================
            // AMBIL DATA HISTORY
            // =================================================

            const response = await fetch(
                API.history,
                {
                    cache: "no-store"
                }
            );

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}`
                );
            }

            const result = await response.json();

            if (
                result.status !== "success" ||
                !Array.isArray(result.data)
            ) {

                throw new Error(
                    result.message ||
                    "Data history tidak valid."
                );
            }

            if (result.data.length === 0) {

                alert(
                    "Tidak ada data history untuk diekspor."
                );

                return;
            }

            const data = result.data;

            console.log(
                "Data history:",
                data.length
            );

            // =================================================
            // KONVERSI DATA UNTUK EXCEL
            // =================================================

            const exportData = data.map(
                (item, index) => {

                    const ph =
                        Number(item.ph);

                    const suhu =
                        Number(item.suhu);

                    const output =
                        Number(item.output_diskret);

                    const pwm =
                        Number(item.pwm);

                    const pwmPersen =
                        Number(item.pwm_persen);

                    const estimasi =
                        Number(item.estimasi_menit);

                    return {

                        "No":
                            index + 1,

                        "Tanggal":
                            item.waktu
                                ? formatDate(item.waktu)
                                : "-",

                        "Waktu":
                            item.waktu
                                ? formatTime(item.waktu)
                                : "-",

                        "pH":
                            Number.isFinite(ph)
                                ? ph
                                : 0,

                        "Suhu (°C)":
                            Number.isFinite(suhu)
                                ? suhu
                                : 0,

                        "Output Diskret":
                            Number.isFinite(output)
                                ? output
                                : getDiscreteOutputClient(
                                    item.status
                                ),

                        "PWM":
                            Number.isFinite(pwm)
                                ? pwm
                                : 0,

                        "PWM (%)":
                            Number.isFinite(pwmPersen)
                                ? pwmPersen
                                : 0,

                        "Kecepatan":
                            item.kecepatan ||
                            "-",

                        "Estimasi (menit)":
                            Number.isFinite(estimasi)
                                ? estimasi
                                : 0,

                        "Pompa Asam":
                            item.pompa_asam ||
                            "OFF",

                        "Pompa Basa":
                            item.pompa_basa ||
                            "OFF",

                        "Mode":
                            item.mode ||
                            "AUTO",

                        "Status":
                            item.status ||
                            "-"
                    };
                }
            );

            // =================================================
            // BUAT WORKBOOK BARU
            // =================================================

            const workbook =
                XLSX.utils.book_new();

            console.log(
                "Workbook dibuat:",
                workbook.SheetNames
            );

            // =================================================
            // SHEET DATA HISTORY
            // =================================================

            const historySheet =
                XLSX.utils.json_to_sheet(
                    exportData
                );

            historySheet["!cols"] = [

                { wch: 5 },   // No
                { wch: 14 },  // Tanggal
                { wch: 12 },  // Waktu
                { wch: 10 },  // pH
                { wch: 12 },  // Suhu
                { wch: 18 },  // Output
                { wch: 10 },  // PWM
                { wch: 10 },  // PWM %
                { wch: 15 },  // Kecepatan
                { wch: 20 },  // Estimasi
                { wch: 15 },  // Pompa Asam
                { wch: 15 },  // Pompa Basa
                { wch: 10 },  // Mode
                { wch: 12 }   // Status

            ];

            // =================================================
            // TAMBAHKAN SHEET DATA
            // =================================================

            XLSX.utils.book_append_sheet(
                workbook,
                historySheet,
                "Data History"
            );

            console.log(
                "Sheet Data History berhasil dibuat."
            );

            // =================================================
            // HITUNG RINGKASAN
            // =================================================

            const countStatus = status => {

                return exportData.filter(
                    item =>
                        normalize(item.Status) ===
                        normalize(status)
                ).length;
            };

            const average = key => {

                const values =
                    exportData
                        .map(
                            item =>
                                Number(item[key])
                        )
                        .filter(
                            value =>
                                Number.isFinite(value)
                        );

                if (values.length === 0) {
                    return 0;
                }

                const total =
                    values.reduce(
                        (sum, value) =>
                            sum + value,
                        0
                    );

                return Number(
                    (
                        total /
                        values.length
                    ).toFixed(2)
                );
            };

            // =================================================
            // DATA RINGKASAN
            // =================================================

            const summary = [

                {
                    "Keterangan":
                        "Metode",

                    "Nilai":
                        "Diskret"
                },

                {
                    "Keterangan":
                        "Total Data",

                    "Nilai":
                        exportData.length
                },

                {
                    "Keterangan":
                        "Status BAIK",

                    "Nilai":
                        countStatus("BAIK")
                },

                {
                    "Keterangan":
                        "Status CUKUP",

                    "Nilai":
                        countStatus("CUKUP")
                },

                {
                    "Keterangan":
                        "Status BURUK",

                    "Nilai":
                        countStatus("BURUK")
                },

                {
                    "Keterangan":
                        "Rata-rata Suhu (°C)",

                    "Nilai":
                        average("Suhu (°C)")
                },

                {
                    "Keterangan":
                        "Rata-rata pH",

                    "Nilai":
                        average("pH")
                },

                {
                    "Keterangan":
                        "Rata-rata PWM",

                    "Nilai":
                        average("PWM")
                },

                {
                    "Keterangan":
                        "Rata-rata Estimasi (menit)",

                    "Nilai":
                        average(
                            "Estimasi (menit)"
                        )
                }

            ];

            // =================================================
            // SHEET RINGKASAN
            // =================================================

            const summarySheet =
                XLSX.utils.json_to_sheet(
                    summary
                );

            summarySheet["!cols"] = [
                {
                    wch: 35
                },
                {
                    wch: 20
                }
            ];

            XLSX.utils.book_append_sheet(
                workbook,
                summarySheet,
                "Ringkasan"
            );

            console.log(
                "Sheet Ringkasan berhasil dibuat."
            );

            // =================================================
            // CEK SHEET
            // =================================================

            console.log(
                "Sheet yang akan diekspor:",
                workbook.SheetNames
            );

            // Hasil yang diharapkan:
            // ["Data History", "Ringkasan"]

            // =================================================
            // NAMA FILE
            // =================================================

            const tanggal =
                new Date()
                    .toISOString()
                    .slice(0, 10);

            const filename =
                `history-monitoring-kolam-${tanggal}.xlsx`;

            // =================================================
            // DOWNLOAD EXCEL
            // =================================================

            XLSX.writeFile(
                workbook,
                filename
            );

            console.log(
                "Export berhasil:",
                filename
            );

            alert(
                `Export berhasil!\n\n` +
                `Jumlah data: ${exportData.length}\n` +
                `File: ${filename}`
            );

        } catch (error) {

            console.error(
                "EXPORT ERROR:",
                error
            );

            alert(
                "Gagal export data Excel.\n\n" +
                error.message
            );
        }
    });
}





// =========================================================
// KALIBRASI PH (2 TITIK) — LIVE VIA MQTT (ESP32 <-> BACKEND)
// =========================================================
//
// Backend Express diharapkan menyediakan:
//   POST API.kalibrasi        { action: "start" | "confirm" | "retry" | "cancel" }
//        -> publish MQTT ke ESP32 (lihat topic di firmware)
//   GET  API.kalibrasiStatus  -> JSON status terakhir dari ESP32
//        (backend cache pesan MQTT topic monitoring-kolam/kalibrasi/status)
//
// Bentuk JSON status (field sama seperti yang dipublish ESP32):
// {
//   state: "IDLE"|"SAMPLING_PH4"|"STABIL_PH4"|"SAMPLING_PH7"|"STABIL_PH7"|"SELESAI"|"GAGAL",
//   titik, target_ph, adc, adc_min, adc_max, selisih,
//   progress, total_sample, stabil, pesan,
//   m, c, adc_ph4, adc_ph7, voltage_ph4, voltage_ph7
// }

let calibPollTimer = null;
const CALIB_POLL_INTERVAL_MS = 1000;

function openCalibrationModal() {
    const overlay = getElement("calib-modal-overlay");

    if (!overlay) {
        return;
    }

    overlay.classList.add("open");

    showCalibPanel("idle");

    pollCalibrationStatus();

    calibPollTimer = setInterval(
        pollCalibrationStatus,
        CALIB_POLL_INTERVAL_MS
    );
}

function closeCalibrationModal() {
    const overlay = getElement("calib-modal-overlay");

    if (overlay) {
        overlay.classList.remove("open");
    }

    if (calibPollTimer) {
        clearInterval(calibPollTimer);
        calibPollTimer = null;
    }
}

function showCalibPanel(name) {
    const panels = ["idle", "running", "selesai", "gagal"];
    const footers = ["idle", "running", "selesai", "gagal"];

    panels.forEach(p => {
        const el = getElement(`calib-panel-${p}`);
        if (el) el.style.display = (p === name) ? "block" : "none";
    });

    footers.forEach(f => {
        const el = getElement(`calib-footer-${f}`);
        if (el) el.style.display = (f === name) ? "flex" : "none";
    });
}

function updateCalibSteps(titik, state) {
    const step1 = getElement("calib-step-1");
    const step2 = getElement("calib-step-2");
    const step3 = getElement("calib-step-3");

    [step1, step2, step3].forEach(el => {
        if (el) el.classList.remove("active", "done");
    });

    if (state === "SELESAI") {
        if (step1) step1.classList.add("done");
        if (step2) step2.classList.add("done");
        if (step3) step3.classList.add("done");
        return;
    }

    if (titik === 1) {
        if (step1) step1.classList.add("active");
    } else if (titik === 2) {
        if (step1) step1.classList.add("done");
        if (step2) step2.classList.add("active");
    }
}

async function startCalibration() {
    await calibrationAction("start");
}

async function cancelCalibration() {
    await calibrationAction("cancel");
    closeCalibrationModal();
}

async function calibrationAction(action) {
    try {
        const result = await fetchJSON(
            API.kalibrasi,
            {
                method: "POST",
                body: JSON.stringify({ action })
            }
        );

        if (!result.success) {
            throw new Error(result.message || "Perintah kalibrasi gagal");
        }

        // Langsung poll sekali supaya UI update cepat tanpa nunggu interval
        pollCalibrationStatus();

    } catch (error) {
        console.error("Gagal mengirim perintah kalibrasi:", error);
        alert(`Gagal mengirim perintah kalibrasi: ${error.message}`);
    }
}

async function pollCalibrationStatus() {
    try {
        const status = await fetchJSON(API.kalibrasiStatus);

        renderCalibrationStatus(status);

    } catch (error) {
        console.error("Gagal ambil status kalibrasi:", error);
    }
}

function renderCalibrationStatus(status) {
    if (!status) {
        return;
    }

    const state = normalize(status.state);

    updateCalibSteps(Number(status.titik) || 1, state);

    if (state === "IDLE") {
        showCalibPanel("idle");
        return;
    }

    if (state === "SELESAI") {
        setText("calib-hasil-m", formatNumber(status.m, 6));
        setText("calib-hasil-c", formatNumber(status.c, 6));
        setText("calib-hasil-adc4", formatNumber(status.adc_ph4, 0));
        setText("calib-hasil-adc7", formatNumber(status.adc_ph7, 0));

        setText("calib-status-m", formatNumber(status.m, 4));
        setText("calib-status-c", formatNumber(status.c, 4));

        showCalibPanel("selesai");

        if (calibPollTimer) {
            clearInterval(calibPollTimer);
            calibPollTimer = null;
        }

        return;
    }

    if (state === "GAGAL") {
        setText("calib-gagal-pesan", `✕ ${status.pesan || "Kalibrasi gagal"}`);
        showCalibPanel("gagal");

        if (calibPollTimer) {
            clearInterval(calibPollTimer);
            calibPollTimer = null;
        }

        return;
    }

    // SAMPLING_PH4 / STABIL_PH4 / SAMPLING_PH7 / STABIL_PH7
    showCalibPanel("running");

    const targetPH = Number(status.target_ph) || (status.titik === 2 ? 7 : 4);
    setText("calib-live-title", `Buffer pH ${formatNumber(targetPH, 1)}`);
    setText("calib-live-msg", status.pesan || "-");
    setText("calib-live-adc", formatNumber(status.adc, 0));
    setText("calib-live-selisih", formatNumber(status.selisih, 0));

    const progress = Number(status.progress) || 0;
    const total = Number(status.total_sample) || 10;
    const percent = clamp((progress / total) * 100, 0, 100);

    const fill = getElement("calib-progress-fill");
    if (fill) fill.style.width = `${percent}%`;

    setText("calib-progress-text", `${progress} / ${total} sampel`);

    const stabil = Boolean(status.stabil);
    const stabilBadge = getElement("calib-stabil-badge");
    const confirmBtn = getElement("calib-btn-confirm");

    if (stabilBadge) stabilBadge.style.display = stabil ? "block" : "none";
    if (confirmBtn) confirmBtn.disabled = !stabil;
}

function initCalibrationForm() {
    const overlay = getElement("calib-modal-overlay");

    // Klik di luar modal-box menutup modal
    if (overlay) {
        overlay.addEventListener("click", event => {
            if (event.target === overlay) {
                closeCalibrationModal();
            }
        });
    }

    // Tampilkan slope/offset kalibrasi terakhir di kartu Settings
    // dengan sekali polling status (tanpa interval, cukup saat load).
    pollCalibrationStatus();
}

// =========================================================
// INITIALIZATION
// =========================================================

document.addEventListener(
    "DOMContentLoaded",
    () => {

        // Jam
        updateClock();

        setInterval(
            updateClock,
            1000
        );

        // Navigasi
        initNavigation();

        // Tombol
        initRefreshButton();

        initResetButton();

        initExportButton();

        initCalibrationForm();

        // Data awal
        loadRealtime();

        loadHistory();

        // Realtime setiap 5 detik
        setInterval(
            loadRealtime,
            5000
        );

        // History setiap 5 menit
        setInterval(
            loadHistory,
            300000
        );
    }
);

// =========================================================
// ERROR GLOBAL
// =========================================================

window.addEventListener(
    "unhandledrejection",
    event => {

        console.error(
            "Unhandled Promise Rejection:",
            event.reason
        );
    }
);
