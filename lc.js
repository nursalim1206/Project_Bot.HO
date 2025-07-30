// lc.js
const puppeteer = require("puppeteer");
const dayjs = require("dayjs");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch").default;
const FormData = require("form-data");

const TELEGRAM_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN";
const GRAFANA_URL = "http://nmc.psn.co.id:3000/d/SJI6FWjnk/xl-newtech-satnet-2?orgId=1&refresh=1m";
const USERNAME = "nmc";
const PASSWORD = "nmcPSN123";

const HO_DIR = "HO_LC";
const DATA_DIR = path.join(HO_DIR, "Data_HO");
const FOTO_DIR = path.join(HO_DIR, "Foto_HO");

// Buat folder jika belum ada
[HO_DIR, DATA_DIR, FOTO_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Mapping panel Beam
const beam110 = [
  { or: 1, id: 134 },
  { or: 2, id: 135 },
  { or: 3, id: 136 },
  { or: 4, id: 137 },
  { or: 5, id: 138 },
  { or: 6, id: 139 },
];

const beam111 = [
  { or: 1, id: 140 },
  { or: 2, id: 141 },
  { or: 4, id: 142 },
  { or: 3, id: 143 },
  { or: 5, id: 144 },
  { or: 6, id: 145 },
  { or: 7, id: 146 },
];

// Kirim ke Telegram
async function sendTelegramFile(chatId, filePath, caption = "") {
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("document", fs.createReadStream(filePath));
  formData.append("caption", caption);

  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, {
    method: "POST",
    body: formData,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram error: ${JSON.stringify(data)}`);
}

// Fungsi utama LC
async function runHOLC(chatId, agentName, bot) {
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

    const trafficTexts = await page.$$eval(".css-1ygjoln", (els) =>
      els.map((e) => e.innerText.trim())
    );

    const getSiteFromPanel = async (panelId) => {
      const raw = await page.$eval(`[data-panelid="${panelId}"]`, (el) => el.innerText);
      const match = raw.match(/(\d+)\s*site/i);
      return match ? parseInt(match[1]) : "-";
    };

    let beam110Report = "📡 Beam 110:\n";
    for (const { or, id } of beam110) {
      const site = await getSiteFromPanel(id);
      const index = or - 1;
      const traffic = trafficTexts[index] || "- / -";
      beam110Report += `OR#${or} current/peak - terminal associated : ${traffic} - ${site} site\n`;
    }

    let beam111Report = "\n📡 Beam 111:\n";
    for (const { or, id } of beam111) {
      const site = await getSiteFromPanel(id);
      const index = beam110.length + or - 1;
      const traffic = trafficTexts[index] || "- / -";
      beam111Report += `OR#${or} current/peak - terminal associated : ${traffic} - ${site} site\n`;
    }

    const shift = (() => {
      const hour = dayjs().hour();
      if (hour >= 7 && hour < 15) return 1;
      if (hour >= 15 && hour < 22) return 2;
      return 3;
    })();

    const report = `📊 Traffic Report HO LC

👤 Agent: ${agentName}
🕒 Shift: ${shift}

${beam110Report}
${beam111Report}
`;

    const timestamp = dayjs().format("YYYYMMDD_HHmmss");
    const txtPath = path.join(DATA_DIR, `HO_LC_${timestamp}.txt`);
    const ssPath = path.join(FOTO_DIR, `Grafana_${timestamp}.png`);

    fs.writeFileSync(txtPath, report);
    await page.screenshot({ path: ssPath });

    await sendTelegramFile(chatId, txtPath, "📄 Laporan HO LC");
    await sendTelegramFile(chatId, ssPath, "🖼️ Screenshot Dashboard");
  } catch (err) {
    console.error("❌ Error:", err.message);
    await bot.sendMessage(chatId, "❌ Gagal memproses laporan HO LC.");
  } finally {
    await browser.close();
  }
}

module.exports = { runHOLC };
