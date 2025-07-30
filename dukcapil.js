const puppeteer = require("puppeteer");
const XLSX = require("xlsx");
const dayjs = require("dayjs");
require("dayjs/locale/id");
dayjs.locale("id");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch").default;
const FormData = require("form-data");

const GRAFANA_URL = "http://nmc.psn.co.id:3000/d/zpGIrtHHz/xl-dukcapil?orgId=1&refresh=1m";
const USERNAME = "nmc";
const PASSWORD = "nmcPSN123";
const HO_DIR = "HO";
const DATA_DIR = path.join(HO_DIR, "Data_HO");
const FOTO_DIR = path.join(HO_DIR, "Foto_HO");
[HO_DIR, DATA_DIR, FOTO_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

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

function processExcelTicketdukcapil(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets["Worksheet"];
  const data = XLSX.utils.sheet_to_json(sheet);

  let result = "Data Tiket:\n";
  let count = 1;

  data.forEach((row) => {
    const status = (row["TICKET STATUS"] || "").trim().toLowerCase();
    if (status === "closed") return;

    const id = row["CPA ID"] || "Tidak Ada ID";
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

async function sendTelegramFile(chatId, filePath, caption = "", bot) {
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("document", fs.createReadStream(filePath));
  formData.append("caption", caption);

  const res = await fetch(
    `https://api.telegram.org/bot${bot.token}/sendDocument`,
    {
      method: "POST",
      body: formData,
    }
  );

  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram error: ${JSON.stringify(data)}`);
}

async function runHODukcapil(chatId, agentName, ticketData, bot) {
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

    const legends = await page.$$eval(".css-1ygjoln", (els) => els.map((e) => e.innerText));
    const linkDown = await page.$eval('[data-panelid="115"] div[style*="font-size: 50px"] span', (el) => el.textContent.trim());
    const linkUp = await page.$eval('[data-panelid="113"] div[style*="font-size: 50px"] span', (el) => el.textContent.trim());

    const hour = dayjs().hour();
    const { greeting, shift } =
      hour >= 7 && hour < 15 ? { greeting: "Selamat pagi", shift: 1 } :
      hour >= 15 && hour < 22 ? { greeting: "Selamat sore", shift: 2 } :
      { greeting: "Selamat malam", shift: 3 };

    const laporan = `${greeting},\nBerikut Handover Monitoring Project XL Dukcapil Shift ${shift}\n\nTrafik XL Dukacpil\nTrafik In Last/Peak = ${legends[0] || "-"} / ${legends[2] || "-"}\nTrafik Out Last/Peak = ${legends[4] || "-"} / ${legends[6] || "-"}\n\nSalam,\n${agentName}\n\n============================\nLink Up : ${linkUp || "-"}\nLink Down : ${linkDown || "-"}\n============================\n\n${ticketData}`;

    const txtPath = path.join(DATA_DIR, `HO_DUKCAPIL_${dayjs().format("YYYYMMDD_HHmmss")}.txt`);
    fs.writeFileSync(txtPath, laporan);

    const ssPath = path.join(FOTO_DIR, `Grafana_${dayjs().format("YYYYMMDD_HHmmss")}.png`);
    await page.screenshot({ path: ssPath });

    await sendTelegramFile(chatId, txtPath, "📄 Laporan HO Dukcapil", bot);
    await sendTelegramFile(chatId, ssPath, "🖼️ Screenshot Dashboard", bot);
  } catch (err) {
    console.error("❌ Error:", err.message);
    await bot.sendMessage(chatId, "❌ Gagal memproses laporan HO Dukcapil.");
  } finally {
    await browser.close();
  }
}

module.exports = {
  processExcelTicketdukcapil,
  runHODukcapil,
};