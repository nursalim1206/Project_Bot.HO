// bts.js
const puppeteer = require("puppeteer");
const XLSX = require("xlsx");
const dayjs = require("dayjs");
require("dayjs/locale/id");
dayjs.locale("id");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch").default;
const FormData = require("form-data");

// Konfigurasi
const TELEGRAM_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN";
const GRAFANA_URL =
  "http://nmc.psn.co.id:3000/d/SJI6FWjnk/xl-newtech-satnet-2?orgId=1&refresh=1m";
const USERNAME = "nmc";
const PASSWORD = "nmcPSN123";

const HO_DIR = "HO_BTS";
const DATA_DIR = path.join(HO_DIR, "Data_HO");
const FOTO_DIR = path.join(HO_DIR, "Foto_HO");

// Buat folder jika belum ada
[HO_DIR, DATA_DIR, FOTO_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Kirim file ke Telegram
async function sendTelegramFile(chatId, filePath, caption = "") {
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("document", fs.createReadStream(filePath));
  formData.append("caption", caption);

  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`,
    {
      method: "POST",
      body: formData,
    }
  );
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram error: ${JSON.stringify(data)}`);
}

// Klasifikasi tiket
function classify(status, deskripsi) {
  if (status === "closed") return "Ticket telah di closed";
  if (deskripsi === "VSAT Hardware ? ODU") return "[Problem ODU]";
  if (deskripsi === "VSAT Connection ? Power") return "[Problem Power]";
  if (deskripsi === "VSAT Administration ? Temporary Blocking") return "[ComCase]";
  if (deskripsi === "Dimatikan") return "[Dimatikan]";
  if (deskripsi === "VSAT Hardware ? Konektor") return "[Problem Konektor]";
  if (deskripsi === "VSAT Hardware ? Modem") return "[Problem Modem]";
  if (typeof deskripsi === "string" && deskripsi.toLowerCase().includes("power")) return "[Problem Power]";
  return deskripsi || "Tidak digunakan lagi";
}

// Proses Excel Tiket
function processExcelTicketbts(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets["Worksheet"];
  const data = XLSX.utils.sheet_to_json(sheet);

  let result = "Data Tiket BTS:\n";
  let count = 1;

  data.forEach((row) => {
    const status = (row["TICKET STATUS"] || "").trim().toLowerCase();
    if (status === "closed") return;

    const id = row["SUBSCRIBER NUMBER"] || "Tidak Ada ID";
    const lokasi = row["SUBSCRIBER NAME"] || "-";
    const deskripsi = row["TROUBLE CATEGORY"] || "";
    const kategori = classify(status, deskripsi);

    result += `${count}. ${id} - ${lokasi} - ${kategori}\n`;
    count++;
  });

  if (count === 1) {
    result += "Tidak ada tiket aktif (Open/Update).\n";
  }

  return result;
}

// Fungsi utama HO BTS
async function runHOBTS(chatId, agentName, ticketData, bot) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox"],
    defaultViewport: { width: 1920, height: 1080 },
  });
  const page = await browser.newPage();

  try {
    await page.goto(GRAFANA_URL, { waitUntil: "networkidle2", timeout: 60000 });

    if (await page.$('input[name="user"]')) {
      await page.type('input[name="user"]', USERNAME);
      await page.type('input[name="password"]', PASSWORD);
      await Promise.all([
        page.click('button[type="submit"]'),
        page.waitForNavigation({ waitUntil: "networkidle2" }),
      ]);
    }

    await page.goto(GRAFANA_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector(".css-1ygjoln", { timeout: 60000 });

    const legends = await page.$$eval(".css-1ygjoln", (els) =>
      els.map((e) => e.innerText)
    );

    const linkUp = await page.$eval(
      '[data-panelid="66"] div[style*="font-size: 50px"] span',
      (el) => el.textContent.trim()
    );
    const linkDown = await page.$eval(
      '[data-panelid="67"] div[style*="font-size: 50px"] span',
      (el) => el.textContent.trim()
    );

    const hour = dayjs().hour();
    const { shift } =
      hour >= 7 && hour < 15
        ? { shift: 1 }
        : hour >= 15 && hour < 22
        ? { shift: 2 }
        : { shift: 3 };

    const hubForwardLast = legends[legends.length - 4] || "-";
    const hubForwardPeak = legends[legends.length - 3] || "-";
    const hubReturnLast = legends[legends.length - 2] || "-";
    const hubReturnPeak = legends[legends.length - 1] || "-";

    const backhaulOutLast = legends[0] || "-";
    const backhaulOutPeak = legends[1] || "-";
    const backhaulInLast = legends[2] || "-";
    const backhaulInPeak = legends[3] || "-";

    const laporan = `
📊 Traffic Report HO BTS

➡️ Forward Last/Peak: ${backhaulOutLast} / ${backhaulOutPeak}
⬅️ Return Last/Peak: ${backhaulInLast} / ${backhaulInPeak}

📡 Backhaul Trafik XL
Out Last/Peak: ${hubForwardLast} / ${hubForwardPeak}
In Last/Peak: ${hubReturnLast} / ${hubReturnPeak}

🔗 Link Up   : ${linkUp || "-"}
🔗 Link Down : ${linkDown || "-"}

👤 Agent: ${agentName}
🕒 Shift: ${shift}

============================
${ticketData}
`;

    const timestamp = dayjs().format("YYYYMMDD_HHmmss");
    const txtPath = path.join(DATA_DIR, `HO_BTS_${timestamp}.txt`);
    const ssPath = path.join(FOTO_DIR, `Grafana_${timestamp}.png`);

    fs.writeFileSync(txtPath, laporan);
    await page.screenshot({ path: ssPath });

    await sendTelegramFile(chatId, txtPath, "📄 Laporan HO BTS");
    await sendTelegramFile(chatId, ssPath, "🖼️ Screenshot Dashboard");
  } catch (err) {
    console.error("❌ Error:", err.message);
    await bot.sendMessage(chatId, "❌ Gagal memproses laporan HO BTS.");
  } finally {
    await browser.close();
  }
}

module.exports = { runHOBTS, processExcelTicketbts };
