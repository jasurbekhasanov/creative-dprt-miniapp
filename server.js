// Creative Dprt Mini App - Backend Server
// Notion Task Management DB'dan ma'lumot olib, Telegram Mini App'ga beradi

const express = require("express");
const cors = require("cors");
const path = require("path");
const { Client } = require("@notionhq/client");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// Frontend (Telegram Mini App) statik fayllarini shu serverdan beramiz
app.use(express.static(path.join(__dirname, "..", "frontend")));

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
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server xatoligi: " + err.message });
  }
});

// "/" so'rovi statik middleware orqali frontend/index.html'ni avtomatik beradi

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishga tushdi`);
});
