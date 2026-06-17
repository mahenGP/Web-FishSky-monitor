// ======================================
// NAVIGATION
// ======================================

const titles = {
    dashboard: "Dashboard",
    data: "Data Sensor",
    settings: "Settings"
};

function navigate(page) {

    document
        .querySelectorAll(".page")
        .forEach(p => p.classList.remove("active"));

    document
        .querySelectorAll(".nav-item")
        .forEach(n => {
            n.classList.toggle(
                "active",
                n.dataset.page === page
            );
        });

    const el =
        document.getElementById(
            "page-" + page
        );

    if (el)
        el.classList.add("active");

    document.getElementById(
        "topbar-page-title"
    ).textContent =
        titles[page] || page;
}

document
.querySelectorAll(".nav-item[data-page]")
.forEach(btn => {

    btn.addEventListener(
        "click",
        () => navigate(btn.dataset.page)
    );

});


// ======================================
// CHART DEFAULTS
// ======================================

const chartDefaults = {

    responsive: true,

    maintainAspectRatio: false,

    plugins: {
        legend: {
            display: false
        }
    },

    scales: {

        x: {
            grid: {
                color:
                "rgba(255,255,255,0.04)"
            },
            ticks: {
                color: "#90b4e8",
                font: {
                    size: 10
                }
            }
        },

        y: {
            grid: {
                color:
                "rgba(255,255,255,0.04)"
            },
            ticks: {
                color: "#90b4e8",
                font: {
                    size: 10
                }
            }
        }

    }

};


// ======================================
// CREATE CHART
// ======================================

function makeChart(
    id,
    color,
    data,
    labels
) {

    return new Chart(
        document.getElementById(id),
        {

            type: "line",

            data: {

                labels: labels,

                datasets: [
                    {
                        data: data,

                        borderColor: color,

                        borderWidth: 2,

                        pointRadius: 3,

                        pointBackgroundColor:
                            color,

                        fill: true,

                        backgroundColor:
                            color
                            .replace(")", ",0.08)")
                            .replace(
                                "rgb",
                                "rgba"
                            ),

                        tension: 0.4
                    }
                ]

            },

            options: {
                ...chartDefaults
            }

        }
    );

}


// ======================================
// DEMO DATA
// ======================================

const demoLabels = [
    "10:27",
    "10:28",
    "10:29",
    "10:30",
    "10:31",
    "10:32",
    "10:33",
    "10:34",
    "10:35",
    "10:36"
];

const demoPH = [
    11,12,10,13,9,
    8,11,10,12,11
];

const demoTemp = [
    42,44,40,48,36,
    38,40,45,43,42
];

let chartPH =
    makeChart(
        "chart-ph",
        "rgb(74,222,128)",
        demoPH,
        demoLabels
    );

let chartTemp =
    makeChart(
        "chart-temp",
        "rgb(251,146,60)",
        demoTemp,
        demoLabels
    );
    // ======================================
// FUZZY MEMBERSHIP FUNCTION
// ======================================

function trimf(x, a, b, c) {

    if (x <= a || x >= c)
        return 0;

    if (x < b)
        return (x - a) / (b - a);

    return (c - x) / (c - b);
}

function trapmf(x, a, b, c, d) {

    if (x <= a || x >= d)
        return 0;

    if (x >= b && x <= c)
        return 1;

    if (x < b)
        return (x - a) / (b - a);

    return (d - x) / (d - c);
}


// ======================================
// FUZZY CALCULATION
// ======================================

function computeFuzzy(ph, temp) {

    // pH Membership
    const phLow =
        trapmf(ph, 0, 0, 6.0, 6.8);

    const phNormal =
        trimf(ph, 6.5, 7.5, 8.5);

    const phHigh =
        trapmf(ph, 8.0, 8.5, 14, 14);

    // Temperature Membership
    const tCold =
        trapmf(temp, 0, 0, 24, 28);

    const tNormal =
        trimf(temp, 25, 30, 35);

    const tHot =
        trapmf(temp, 32, 36, 60, 60);

    // Rule Base
    const rules = [

        {
            weight:
                Math.min(
                    phNormal,
                    tNormal
                ),
            center: 0.8
        },

        {
            weight:
                Math.min(
                    phLow,
                    tNormal
                ),
            center: 0.45
        },

        {
            weight:
                Math.min(
                    phHigh,
                    tNormal
                ),
            center: 0.45
        },

        {
            weight:
                Math.min(
                    phNormal,
                    tHot
                ),
            center: 0.5
        },

        {
            weight:
                Math.min(
                    phNormal,
                    tCold
                ),
            center: 0.6
        },

        {
            weight:
                Math.min(
                    phLow,
                    tHot
                ),
            center: 0.2
        },

        {
            weight:
                Math.min(
                    phHigh,
                    tCold
                ),
            center: 0.3
        }

    ];

    const num =
        rules.reduce(
            (s, r) =>
                s + r.weight * r.center,
            0
        );

    const den =
        rules.reduce(
            (s, r) =>
                s + r.weight,
            0
        ) || 1;

    const crisp = num / den;

    return {

        phLow,
        phNormal,
        phHigh,

        tCold,
        tNormal,
        tHot,

        crisp

    };
}


// ======================================
// WATER QUALITY STATUS
// ======================================

function getWaterQuality(crisp) {

    if (crisp >= 0.75) {

        return {
            label: "Sangat Baik",
            fit: "Layak Konsumsi",
            color: "#4ade80",
            bar: crisp * 100,
            rec: "Pertahankan kondisi"
        };

    }

    if (crisp >= 0.55) {

        return {
            label: "Baik",
            fit: "Layak Budidaya",
            color: "#22d3ee",
            bar: crisp * 100,
            rec: "Pantau berkala"
        };

    }

    if (crisp >= 0.35) {

        return {
            label: "Sedang",
            fit: "Perlu Perhatian",
            color: "#facc15",
            bar: crisp * 100,
            rec: "Aktifkan aerasi"
        };

    }

    return {

        label: "Buruk",
        fit: "Tidak Layak",
        color: "#f87171",
        bar: crisp * 100,
        rec: "Segera tangani!"

    };
}


// ======================================
// PUMP SETTINGS
// ======================================

function getPumpSettings(
    ph,
    temp,
    crisp
) {

    const aerRPM =
        Math.round(
            800 + (1 - crisp) * 1200
        );

    const circRPM =
        Math.round(
            500 + (1 - crisp) * 700
        );

    const phDose =
        ph < 6.5
        ? Math.round((6.8 - ph) * 20)
        : ph > 8.5
        ? Math.round((ph - 8.2) * 15)
        : 0;

    const power =
        Math.round(
            aerRPM * 0.04 +
            circRPM * 0.03 +
            phDose * 0.5
        );

    const eff =
        Math.round(
            70 + crisp * 28
        );

    return {

        aerRPM,
        circRPM,
        phDose,

        aerOn:
            crisp < 0.75,

        circOn: true,

        phOn:
            phDose > 0,

        power,
        eff

    };
}


// ======================================
// TOGGLE PUMP
// ======================================

function togglePump(n) {

    const cb =
        document.getElementById(
            "pump" + n + "-tog"
        );

    const sub =
        document.getElementById(
            "p" + n + "-sub"
        );

    const status =
        cb.checked
        ? "ON"
        : "OFF";

    sub.textContent =
        status;

    sub.style.color =
        cb.checked
        ? "#4ade80"
        : "#90CAF9";

    const pompa =
        n === 1
        ? "pompa_asam"
        : "pompa_basa";

    sendPumpControl(
        pompa,
        status
    );
}
// ======================================
// UPDATE FUZZY UI
// ======================================

function updateFuzzyUI(ph, temp) {

    const fz =
        computeFuzzy(ph, temp);

    const wq =
        getWaterQuality(
            fz.crisp
        );

    const pm =
        getPumpSettings(
            ph,
            temp,
            fz.crisp
        );

    // Membership Value
    document.getElementById(
        "fz-ph-low"
    ).textContent =
        fz.phLow.toFixed(3);

    document.getElementById(
        "fz-ph-normal"
    ).textContent =
        fz.phNormal.toFixed(3);

    document.getElementById(
        "fz-ph-high"
    ).textContent =
        fz.phHigh.toFixed(3);

    document.getElementById(
        "fz-temp-cold"
    ).textContent =
        fz.tCold.toFixed(3);

    document.getElementById(
        "fz-temp-normal"
    ).textContent =
        fz.tNormal.toFixed(3);

    document.getElementById(
        "fz-temp-hot"
    ).textContent =
        fz.tHot.toFixed(3);

    // Nilai Fuzzy
    document.getElementById(
        "fz-crisp-big"
    ).textContent =
        fz.crisp.toFixed(2);

    // Status Air
    document.getElementById(
        "wq-label"
    ).textContent =
        wq.label;

    const dot =
        document.getElementById(
            "wq-dot"
        );

    if (
        wq.label === "Sangat Baik" ||
        wq.label === "Baik"
    ) {

        dot.className =
            "wq-dot";

    }
    else if (
        wq.label === "Sedang"
    ) {

        dot.className =
            "wq-dot warn";

    }
    else {

        dot.className =
            "wq-dot bad";

    }

    document.getElementById(
        "wq-index"
    ).textContent =
        (fz.crisp * 100)
        .toFixed(2);

    document.getElementById(
        "wq-fit"
    ).textContent =
        wq.fit;

    document.getElementById(
        "wq-fit"
    ).style.color =
        wq.color;

    document.getElementById(
        "wq-rec"
    ).textContent =
        wq.rec;

    // Pump Info
    document.getElementById(
        "pump-aer-spd"
    ).textContent =
        pm.aerRPM + " RPM";

    document.getElementById(
        "pump-circ-spd"
    ).textContent =
        pm.circRPM + " RPM";

    document.getElementById(
        "pump-eff"
    ).textContent =
        pm.eff + " %";

    // Auto Toggle
    const tog1 =
        document.getElementById(
            "pump1-tog"
        );

    const tog2 =
        document.getElementById(
            "pump2-tog"
        );

    if (!tog1._manual) {

        tog1.checked =
            pm.aerOn;

        togglePump(1);

    }

    if (!tog2._manual) {

        tog2.checked =
            pm.circOn;

        togglePump(2);

    }
}


// ======================================
// CLOCK
// ======================================

function updateClock() {

    const now =
        new Date();

    document.getElementById(
        "tb-time"
    ).textContent =
        now.toLocaleTimeString(
            "id-ID",
            {
                hour12: false
            }
        );

    document.getElementById(
        "tb-date"
    ).textContent =
        now.toLocaleDateString(
            "id-ID",
            {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric"
            }
        );
}

setInterval(
    updateClock,
    1000
);

updateClock();


// ======================================
// LOAD LATEST DATA
// ======================================

async function loadLatest() {

    try {

        const res =
            await fetch(
                "http://localhost/iot/latest.php"
            );

        const d =
            await res.json();

        document.getElementById(
            "ph-val"
        ).textContent =
            parseFloat(
                d.ph
            ).toFixed(2);

        document.getElementById(
            "temp-val"
        ).textContent =
            parseFloat(
                d.suhu
            ).toFixed(2);

        const ph =
            parseFloat(d.ph);

        const phBadge =
            document.getElementById(
                "ph-badge"
            );

        if (ph < 6.5) {

            phBadge.className =
                "sensor-badge badge-warn";

            phBadge.textContent =
                "Rendah";

        }
        else if (ph > 8.5) {

            phBadge.className =
                "sensor-badge badge-danger";

            phBadge.textContent =
                "Tinggi";

        }
        else {

            phBadge.className =
                "sensor-badge badge-good";

            phBadge.textContent =
                "Normal";

        }

        const temp =
            parseFloat(
                d.suhu
            );

        const tempBadge =
            document.getElementById(
                "temp-badge"
            );

        if (temp > 35) {

            tempBadge.className =
                "sensor-badge badge-danger";

            tempBadge.textContent =
                "Tinggi";

        }
        else {

            tempBadge.className =
                "sensor-badge badge-good";

            tempBadge.textContent =
                "Normal";

        }

        document.getElementById(
            "esp-status"
        ).textContent =
            "Online";

        document.getElementById(
            "mqtt-status"
        ).textContent =
            "Connected";

        document.getElementById(
            "fz-crisp-big"
        ).textContent =
            d.fuzzy || "--";

        document.getElementById(
            "wq-label"
        ).textContent =
            d.status || "--";

        const dot =
            document.getElementById(
                "wq-dot"
            );

        if (
            (d.status || "")
            .toUpperCase() ===
            "BAIK"
        ) {

            dot.className =
                "wq-dot";

        }
        else if (
            (d.status || "")
            .toUpperCase() ===
            "SEDANG"
        ) {

            dot.className =
                "wq-dot warn";

        }
        else {

            dot.className =
                "wq-dot bad";

        }

    }
    catch (e) {

        document.getElementById(
            "ph-val"
        ).textContent =
            "11.43";

        document.getElementById(
            "temp-val"
        ).textContent =
            "42.80";
    }

    const now =
        new Date();

    document.getElementById(
        "tb-last"
    ).textContent =
        now.toLocaleTimeString(
            "id-ID",
            {
                hour12: false
            }
        );
}
// ======================================
// LOAD HISTORY DATA
// ======================================

async function loadHistory() {

    try {

        const res = await fetch(
            "history.php"
        );

        const data = await res.json();

        if (!Array.isArray(data))
            return;

        updateTable(data);
        updateCharts(data);

    }
    catch (err) {

        console.error(
            "History Error:",
            err
        );

    }

}


// ======================================
// UPDATE TABLE
// ======================================

function updateTable(data) {

    const tbody =
        document.getElementById(
            "data-tbody"
        );

    tbody.innerHTML = "";

    if (data.length === 0) {

        tbody.innerHTML = `
        <tr>
            <td colspan="6"
                class="empty-cell">
                Tidak ada data
            </td>
        </tr>`;

        return;
    }

    data.forEach(row => {

        const tr =
            document.createElement("tr");

        let tanggal = "-";
        let jam = "-";

        if (row.waktu) {

            const dt =
                new Date(row.waktu);

            tanggal =
                dt.toLocaleDateString(
                    "id-ID"
                );

            jam =
                dt.toLocaleTimeString(
                    "id-ID",
                    {
                        hour12:false
                    }
                );

        }

        tr.innerHTML = `
            <td>${tanggal}</td>
            <td>${jam}</td>
            <td>${row.ph}</td>
            <td>${row.suhu}</td>
            <td>${row.fuzzy}</td>
            <td>${row.status}</td>
        `;

        tbody.appendChild(tr);

    });

}


// ======================================
// UPDATE CHART
// ======================================

function updateCharts(data) {

    const lastData =
        data.slice(-20);

    const labels =
        lastData.map(item => {

            if (!item.waktu)
                return "";

            return new Date(
                item.waktu
            ).toLocaleTimeString(
                "id-ID",
                {
                    hour: "2-digit",
                    minute: "2-digit"
                }
            );

        });

    const phData =
        lastData.map(
            item => Number(item.ph)
        );

    const tempData =
        lastData.map(
            item => Number(item.suhu)
        );

    chartPH.data.labels =
        labels;

    chartPH.data.datasets[0].data =
        phData;

    chartPH.update();

    chartTemp.data.labels =
        labels;

    chartTemp.data.datasets[0].data =
        tempData;

    chartTemp.update();

}


// ======================================
// REFRESH BUTTON
// ======================================

document
.getElementById(
    "refresh-btn"
)
.addEventListener(
    "click",
    () => {

        loadLatest();
        loadHistory();

    }
);


// ======================================
// AUTO REFRESH
// ======================================

loadHistory();

setInterval(
    loadHistory,
    5000
);
// ======================================
// EXPORT EXCEL
// ======================================

async function exportExcel() {

    try {

        const res =
            await fetch(
                "history.php"
            );

        const data =
            await res.json();

        if (
            !data ||
            data.length === 0
        ) {

            alert(
                "Data kosong!"
            );

            return;
        }

        const wb =
            XLSX.utils.book_new();

        const ws =
            XLSX.utils.json_to_sheet(
                data
            );

        XLSX.utils.book_append_sheet(
            wb,
            ws,
            "Riwayat Sensor"
        );

        // ==========================
        // SUMMARY
        // ==========================

        const avgTemp =
            (
                data.reduce(
                    (s, r) =>
                        s + Number(r.suhu),
                    0
                )
                / data.length
            ).toFixed(2);

        const avgPH =
            (
                data.reduce(
                    (s, r) =>
                        s + Number(r.ph),
                    0
                )
                / data.length
            ).toFixed(2);

        const avgFuzzy =
            (
                data.reduce(
                    (s, r) =>
                        s + Number(r.fuzzy),
                    0
                )
                / data.length
            ).toFixed(2);

        const baik =
            data.filter(
                r =>
                String(r.status)
                .toUpperCase()
                === "BAIK"
            ).length;

        const buruk =
            data.filter(
                r =>
                String(r.status)
                .toUpperCase()
                === "BURUK"
            ).length;

        const summary =
        [
            ["Parameter","Nilai"],
            ["Rata-rata Suhu",avgTemp],
            ["Rata-rata pH",avgPH],
            ["Rata-rata Fuzzy",avgFuzzy],
            ["Jumlah BAIK",baik],
            ["Jumlah BURUK",buruk]
        ];

        const ws2 =
            XLSX.utils.aoa_to_sheet(
                summary
            );

        XLSX.utils.book_append_sheet(
            wb,
            ws2,
            "Summary"
        );

        XLSX.writeFile(
            wb,
            "Monitoring_Kualitas_Air.xlsx"
        );

    }
    catch(err) {

        console.error(err);

        alert(
            "Gagal export Excel"
        );

    }

}


// ======================================
// BUTTON EXPORT
// ======================================

document
.getElementById(
    "export-btn"
)
.addEventListener(
    "click",
    exportExcel
);


// ======================================
// KONTROL POMPA
// ======================================

async function sendPumpControl(
    pompa,
    status
) {

    try {

        await fetch(
            "control.php",
            {
                method: "POST",

                headers: {
                    "Content-Type":
                    "application/x-www-form-urlencoded"
                },

                body:
                    "pompa=" +
                    encodeURIComponent(
                        pompa
                    ) +
                    "&status=" +
                    encodeURIComponent(
                        status
                    )
            }
        );

        console.log(
            pompa +
            " -> " +
            status
        );

    }
    catch(err) {

        console.error(
            "Control Error:",
            err
        );

    }

}


// ======================================
// PUMP MANUAL FLAG
// ======================================

document
.getElementById(
    "pump1-tog"
)
.addEventListener(
    "change",
    function() {

        this._manual = true;

    }
);

document
.getElementById(
    "pump2-tog"
)
.addEventListener(
    "change",
    function() {

        this._manual = true;

    }
);


// ======================================
// DASHBOARD INIT
// ======================================

async function initDashboard() {

    await loadLatest();

    await loadHistory();

}

initDashboard();


// ======================================
// AUTO REFRESH
// ======================================

setInterval(
    () => {

        loadLatest();

        loadHistory();

    },
    5000
);


// ======================================
// ONLINE STATUS
// ======================================

window.addEventListener(
    "online",
    () => {

        document.getElementById(
            "esp-status"
        ).textContent =
            "Online";

    }
);

window.addEventListener(
    "offline",
    () => {

        document.getElementById(
            "esp-status"
        ).textContent =
            "Offline";

    }
);