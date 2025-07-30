// index.js
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch").default;
const dayjs = require("dayjs");

// Import fungsi dari masing-masing file
const { processExcelTicketdukcapil, runHODukcapil } = require("./dukcapil");
const { runHOBTS, processExcelTicketbts } = require("./bts");

const { runHOLC } = require("./lc");

// Token Telegram dan path penyimpanan
const TELEGRAM_TOKEN = "7791978540:AAFsV8oLq8vyLCLJckJmNHTDSGzjZG6waik";
const DATA_DIR = path.join("HO", "Data_HO");

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const userState = {}; // Menyimpan state pengguna

// Saat /start ditekan
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "Selamat datang di HO Bot!\nPilih menu di bawah ini:",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "1️⃣ HO DUKCAPIL", callback_data: "HO_DUKCAPIL" }],
          [{ text: "2️⃣ HO BTS", callback_data: "HO_BTS" }],
          [{ text: "3️⃣ HO LC", callback_data: "HO_LC" }],
        ],
      },
    }
  );
});

// Menangani klik tombol menu HO
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (["HO_DUKCAPIL", "HO_BTS", "HO_LC"].includes(data)) {
    await bot.sendMessage(chatId, "👤 Masukkan nama agen:");
    userState[chatId] = { step: "WAIT_AGENT", hoType: data };
  } else {
    await bot.sendMessage(chatId, "⚠️ Menu tidak dikenal.");
  }
});

// Menangani pesan teks dan file
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  // Step 1: menunggu nama agen
  if (userState[chatId]?.step === "WAIT_AGENT") {
    userState[chatId].step = "WAIT_EXCEL";
    userState[chatId].agentName = msg.text;
    return bot.sendMessage(chatId, "📌 Kirim file Excel (Data Asli):");
  }

  // Step 2: menunggu file Excel
  if (userState[chatId]?.step === "WAIT_EXCEL" && msg.document) {
    const fileId = msg.document.file_id;
    const fileLink = await bot.getFileLink(fileId);
    const filePath = path.join(
      DATA_DIR,
      `raw_${dayjs().format("YYYYMMDD_HHmmss")}.xlsx`
    );

    // Unduh file Excel dari Telegram
    const res = await fetch(fileLink);
    const buffer = await res.buffer();
    fs.writeFileSync(filePath, buffer);

    const agent = userState[chatId].agentName;
    const hoType = userState[chatId].hoType;
    delete userState[chatId]; // Clear state

    await bot.sendMessage(
      chatId,
      `⏳ Memproses data ${hoType.replace("HO_", "")} untuk agen ${agent}...`
    );

    // Tambahkan try-catch di sini
try {
  const res = await fetch(fileLink);
  if (!res.ok) throw new Error(`Gagal download file: ${res.statusText}`);

  const buffer = await res.buffer();
  fs.writeFileSync(filePath, buffer);
} catch (err) {
  console.error("❌ Gagal mengunduh atau menyimpan file:", err.message);
  return bot.sendMessage(chatId, "❌ Gagal mengunduh file. Pastikan file Excel valid.");
}


    // Jalankan sesuai jenis HO
    if (hoType === "HO_DUKCAPIL") {
      const ticketDukcapil = processExcelTicketdukcapil(filePath);
      return runHODukcapil(chatId, agent, ticketDukcapil, bot);
    } else if (hoType === "HO_BTS") {
    const ticketBTS = processExcelTicketbts(filePath);
      return runHOBTS(chatId, agent,ticketBTS, bot);
    } else if (hoType === "HO_LC") {
      return runHOLC(chatId, agent, bot);
    }
  }

  // Jika bukan command atau file, beri peringatan
  if (!msg.text?.startsWith("/")) {
    bot.sendMessage(chatId, "⚠️ Kirim perintah atau file sesuai instruksi.");
  }
});

console.log("🤖 Bot HO siap berjalan...");
