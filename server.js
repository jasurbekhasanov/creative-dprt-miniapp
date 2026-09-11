// Creative Dprt Mini App - Backend Server
// Notion Task Management DB'dan ma'lumot olib, Telegram Mini App'ga beradi

const express = require("express");
const cors = require("cors");
const path = require("path");
const { Client } = require("@notionhq/client");
const { CONTENT } = require("./content");
require("dotenv").config();

// Telegram bot token va mini app URL
const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.APP_URL || "https://creative-dprt-miniapp-production.up.railway.app";
const TG_API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : null;

const app = express();
app.use(cors());
app.use(express.json());

// Frontend (Telegram Mini App) statik fayllarini shu papkaning o'zidan beramiz
app.use(express.static(__dirname));

// Root "/" uchun index.html'ni aniq beramiz (static middleware ishlamay qolsa ham)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ---- Konfiguratsiya (environment variables orqali) ----
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const TASK_DB_ID = process.env.NOTION_TASK_DB_ID; // 2b0d246d6a804d62a66f402df19dbf4f
const DESIGNERS_DB_ID = process.env.NOTION_DESIGNERS_DB_ID; // 349aa210357d801aa73bc50e2864b782

if (!NOTION_TOKEN || !TASK_DB_ID || !DESIGNERS_DB_ID) {
  console.error(
    "XATOLIK: NOTION_TOKEN, NOTION_TASK_DB_ID, NOTION_DESIGNERS_DB_ID environment variable'lari kerak."
  );
}

const notion = new Client({ auth: NOTION_TOKEN });

// Status ustunlari - Kanban ustunlari tartibi
const STATUS_ORDER = [
  "Draft",
  "G'oya kerak",
  "Tasdiqlanyapti",
  "Dizaynda",
  "Art direktorda",
  "Mijozda",
  "Finish",
  "Archive",
];

// ---- Designers DB'ni keshlash (har so'rovda qayta so'ramaslik uchun) ----
let designersCache = null;
let designersCacheTime = 0;
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 daqiqa

async function getDesigners() {
  const now = Date.now();
  if (designersCache && now - designersCacheTime < CACHE_TTL_MS) {
    return designersCache;
  }

  const results = [];
  let cursor = undefined;
  do {
    const resp = await notion.databases.query({
      database_id: DESIGNERS_DB_ID,
      start_cursor: cursor,
    });
    results.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  const designers = {};
  for (const page of results) {
    const props = page.properties;
    const name = props.Name?.title?.[0]?.plain_text || "";
    const username = (props.Username?.rich_text?.[0]?.plain_text || "").replace(
      /^@/,
      ""
    );
    const degree = props.Degree?.select?.name || "";
    const active = props.Active?.checkbox ?? false;

    designers[page.id] = {
      id: page.id,
      name,
      username: username.toLowerCase(),
      degree,
      active,
    };
  }

  designersCache = designers;
  designersCacheTime = now;
  return designers;
}

// ---- Loyihalar (Projects) nomlarini olish uchun yordamchi ----
const projectNameCache = {};

async function getProjectName(pageId) {
  if (projectNameCache[pageId]) return projectNameCache[pageId];
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    const props = page.properties;
    // Projects DB'da title ustuni odatda "Name" bo'ladi
    const titleProp = Object.values(props).find((p) => p.type === "title");
    const name = titleProp?.title?.[0]?.plain_text || "Noma'lum loyiha";
    projectNameCache[pageId] = name;
    return name;
  } catch (e) {
    return "Noma'lum loyiha";
  }
}

// ---- Task Management DB'dan barcha vazifalarni olish ----
async function getAllTasks() {
  const results = [];
  let cursor = undefined;
  do {
    const resp = await notion.databases.query({
      database_id: TASK_DB_ID,
      start_cursor: cursor,
      page_size: 100,
    });
    results.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
  return results;
}

// ---- Asosiy endpoint: kanban ma'lumotlarini olish ----
app.get("/api/board", async (req, res) => {
  try {
    const telegramUsername = (req.query.username || "").replace(/^@/, "").toLowerCase();

    if (!telegramUsername) {
      return res.status(400).json({ error: "username parametri kerak" });
    }

    const designers = await getDesigners();

    // So'rov yuborayotgan foydalanuvchini Designers DB'dan topamiz
    const requester = Object.values(designers).find(
      (d) => d.username === telegramUsername
    );

    if (!requester) {
      return res.status(403).json({
        error: "Siz Designers bazasida topilmadingiz. Admin bilan bog'laning.",
      });
    }

    const isManager =
      requester.degree === "Art director" ||
      requester.degree === "Creative Director";

    const tasks = await getAllTasks();

    // Har bir vazifani formatga o'tkazamiz
    const formattedTasks = [];
    for (const task of tasks) {
      const props = task.properties;
      const name = props.Name?.title?.[0]?.plain_text || "(nomsiz)";
      const status = props.Status?.status?.name || "Draft";
      const dedlaynObj = props.Dedlayn?.date;
      const dedlayn = dedlaynObj?.start || null;
      const prioritet = props.Prioritet?.select?.name || null;
      const designerRelations = props.Designers?.relation || [];
      const projectRelations = props.Projects?.relation || [];

      // Ushbu vazifaga biriktirilgan dizaynerlar
      const taskDesigners = designerRelations
        .map((r) => designers[r.id])
        .filter(Boolean);

      // Agar manager bo'lmasa, faqat o'ziga tegishli vazifalarni ko'rsatamiz
      if (!isManager) {
        const isMine = taskDesigners.some((d) => d.id === requester.id);
        if (!isMine) continue;
      }

      let projectName = null;
      if (projectRelations.length > 0) {
        projectName = await getProjectName(projectRelations[0].id);
      }

      formattedTasks.push({
        id: task.id,
        name,
        status,
        dedlayn,
        prioritet,
        projectName,
        designers: taskDesigners.map((d) => ({ name: d.name, username: d.username })),
        url: task.url,
      });
    }

    // Statuslar bo'yicha guruhlash (Kanban ustunlari)
    const board = {};
    for (const s of STATUS_ORDER) board[s] = [];
    for (const t of formattedTasks) {
      if (!board[t.status]) board[t.status] = [];
      board[t.status].push(t);
    }

    res.json({
      requester: {
        name: requester.name,
        degree: requester.degree,
        isManager,
      },
      statusOrder: STATUS_ORDER,
      board,
      tasks: formattedTasks, // Home sahifasi uchun tekis ro'yxat
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server xatoligi: " + err.message });
  }
});

// ---- Ma'lumot sahifalari endpoint'i (Agentlik, Ish jarayonlari, ...) ----
app.get("/api/content/:page", (req, res) => {
  const page = req.params.page;
  const data = CONTENT[page];
  if (!data) {
    return res.status(404).json({ error: "Sahifa topilmadi" });
  }
  res.json(data);
});

// ---- Telegram bot webhook: /start ga javob ----
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Telegram'ga darhol javob beramiz
  try {
    const update = req.body;
    const msg = update.message;
    if (!msg || !msg.text) return;

    const chatId = msg.chat.id;
    const text = msg.text.trim();

    if (text === "/start" || text.startsWith("/start")) {
      await sendWelcome(chatId);
    }
  } catch (e) {
    console.error("Webhook xatosi:", e.message);
  }
});

// Xush kelibsiz xabari + inline tugmalar
async function sendWelcome(chatId) {
  if (!TG_API) {
    console.error("BOT_TOKEN yo'q, xabar yuborib bo'lmadi.");
    return;
  }

  const welcomeText =
    "<b>Creative Dprt</b>\n\n" +
    "Assalomu alaykum! Bu yerdan vazifalaringizni ko'rishingiz va agentlik haqidagi ma'lumotlarni topishingiz mumkin.\n\n" +
    "Quyidagi tugmalardan foydalaning 👇";

  const keyboard = {
    inline_keyboard: [
      [{ text: "📋 Ilovani ochish", web_app: { url: `${APP_URL}/` } }],
    ],
  };

  await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: welcomeText,
      parse_mode: "HTML",
      reply_markup: keyboard,
    }),
  });
}

// "/" so'rovi statik middleware orqali frontend/index.html'ni avtomatik beradi

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server ${PORT}-portda ishga tushdi`);

  // Telegram webhook'ni avtomatik o'rnatamiz (bot /start'ga javob bera olishi uchun)
  if (TG_API) {
    try {
      const webhookUrl = `${APP_URL}/webhook`;
      const resp = await fetch(`${TG_API}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message"] }),
      });
      const result = await resp.json();
      if (result.ok) {
        console.log("Webhook o'rnatildi:", webhookUrl);
      } else {
        console.log("Webhook o'rnatishda muammo:", result.description);
      }
    } catch (e) {
      console.log("Webhook o'rnatishda xato:", e.message);
    }
  } else {
    console.log("BOT_TOKEN yo'q - bot funksiyasi o'chirilgan (faqat mini app ishlaydi).");
  }
});
