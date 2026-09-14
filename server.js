// Creative Dprt Mini App - Backend Server
// Notion Task Management DB bilan ishlaydi: o'qish, status o'zgartirish, task yaratish.

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("@notionhq/client");
const { CONTENT } = require("./content");
require("dotenv").config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.APP_URL || "https://creative-dprt-miniapp-production.up.railway.app";
const TG_API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : null;
const NOTIFICATION_CHAT_ID = process.env.NOTIFICATION_CHAT_ID || null;
const MINI_APP_LINK = process.env.MINI_APP_LINK || "https://t.me/crdprt_bot/tasks";
const NOTIFICATION_TIMEZONE = "Asia/Tashkent";

// Faqat lokal ishlab chiqish uchun: imzosiz ?username= bilan kirishga ruxsat
const ALLOW_INSECURE = process.env.ALLOW_INSECURE_USERNAME === "1";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const TASK_DB_ID = process.env.NOTION_TASK_DB_ID;
const DESIGNERS_DB_ID = process.env.NOTION_DESIGNERS_DB_ID;

if (!NOTION_TOKEN || !TASK_DB_ID || !DESIGNERS_DB_ID) {
  console.error("XATOLIK: NOTION_TOKEN, NOTION_TASK_DB_ID, NOTION_DESIGNERS_DB_ID kerak.");
}

const notion = new Client({ auth: NOTION_TOKEN });

// Zaxira tartib - Notion sxemasi o'qilmasa shu ishlatiladi
const FALLBACK_STATUS_ORDER = [
  "Draft", "G'oya kerak", "Tasdiqlanyapti", "Dizaynda",
  "Art direktorda", "Mijozda", "Finish", "Archive",
];

const MANAGER_DEGREES = ["Art director", "Creative Director"];

/* ==========================================================================
   Telegram initData imzosini tekshirish
   Frontend x-telegram-init-data sarlavhasida yuboradi. Bot tokeni bilan
   HMAC hisoblab, Telegram imzolaganini tasdiqlaymiz. Busiz istalgan odam
   boshqa birovning nomidan so'rov yubora olardi.
   ========================================================================== */
function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  let params;
  try { params = new URLSearchParams(initData); } catch (e) { return null; }

  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  // Bot token bilan HMAC tekshiruvida `hash`dan boshqa barcha kelgan
  // maydonlar qatnashadi. Yangi `signature` maydoni faqat uchinchi tomon
  // Ed25519 tekshiruvida chiqarib tashlanadi; bu yerda uni saqlab qolamiz.

  const dataCheckString = [...params.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  // Vaqt bo'yicha xavfsiz taqqoslash
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > 24 * 3600) return null; // 24 soatdan eski

  try { return JSON.parse(params.get("user") || "null"); } catch (e) { return null; }
}

function usernameFromRequest(req) {
  const initData = req.get("x-telegram-init-data") || req.body?.initData;
  if (BOT_TOKEN) {
    const user = verifyInitData(initData, BOT_TOKEN);
    if (user?.username) return String(user.username).replace(/^@/, "").toLowerCase();
    if (!ALLOW_INSECURE) return null;
  }
  // BOT_TOKEN yo'q yoki ALLOW_INSECURE_USERNAME=1 - lokal rejim
  const q = req.query.username || req.body?.username || "";
  return String(q).replace(/^@/, "").toLowerCase() || null;
}

// Har bir himoyalangan endpoint uchun: foydalanuvchini aniqlab, Designers DB'dan topamiz
async function requireUser(req, res) {
  const username = usernameFromRequest(req);
  if (!username) {
    res.status(401).json({ error: "Kirish tasdiqlanmadi. Ilovani Telegram ichidan oching." });
    return null;
  }
  const designers = await getDesigners();
  const requester = Object.values(designers).find((d) => d.username === username);
  if (!requester) {
    res.status(403).json({ error: "Siz Designers bazasida topilmadingiz. Admin bilan bog'laning." });
    return null;
  }
  requester.isManager = MANAGER_DEGREES.includes(requester.degree);
  return { requester, designers };
}

/* ==========================================================================
   Kesh qatlami
   ========================================================================== */
function cached(ttlMs, fn) {
  let value = null, at = 0, inflight = null;
  const wrapped = async function () {
    if (value && Date.now() - at < ttlMs) return value;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        value = await fn();
        at = Date.now();
        return value;
      } finally { inflight = null; }
    })();
    return inflight;
  };
  wrapped.clear = () => { value = null; at = 0; };
  return wrapped;
}

// Bir foydalanuvchi Mini App'ni ketma-ket ochganda Notion'ga bir xil og'ir
// so'rovni qayta yubormaymiz. Mutatsiyalarda kesh tozalanadi.
const BOARD_CACHE_TTL_MS = 45 * 1000;
const boardCache = new Map();

async function cachedBoard(requester, designers) {
  const key = `${requester.isManager ? "manager" : "designer"}:${requester.id}`;
  const hit = boardCache.get(key);
  if (hit?.value && Date.now() - hit.at < BOARD_CACHE_TTL_MS) return hit.value;
  if (hit?.inflight) return hit.inflight;

  const entry = hit || {};
  entry.inflight = buildBoard(requester, designers)
    .then((value) => {
      entry.value = value;
      entry.at = Date.now();
      return value;
    })
    .finally(() => { entry.inflight = null; });
  boardCache.set(key, entry);
  return entry.inflight;
}

function clearBoardCache() {
  boardCache.clear();
  getAllTaskPages.clear();
}

async function queryAll(database_id, extra) {
  const results = [];
  let cursor;
  do {
    const resp = await notion.databases.query({
      database_id, start_cursor: cursor, page_size: 100, ...(extra || {}),
    });
    results.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
  return results;
}

// Art direktor ko'rinishi butun bazani talab qiladi. Natijani qisqa vaqt
// saqlaymiz va server startida oldindan yuklaymiz.
const getAllTaskPages = cached(45 * 1000, () => queryAll(TASK_DB_ID));

function titleOf(page) {
  const prop = Object.values(page.properties || {}).find((p) => p.type === "title");
  return prop?.title?.[0]?.plain_text || "";
}

/* ---- Designers ---- */
const getDesigners = cached(2 * 60 * 1000, async () => {
  const pages = await queryAll(DESIGNERS_DB_ID);
  const out = {};
  for (const page of pages) {
    const p = page.properties;
    out[page.id] = {
      id: page.id,
      name: p.Name?.title?.[0]?.plain_text || "",
      username: (p.Username?.rich_text?.[0]?.plain_text || "").replace(/^@/, "").toLowerCase(),
      degree: p.Degree?.select?.name || "",
      active: p.Active?.checkbox ?? false,
    };
  }
  return out;
});

/* ---- Task DB sxemasi: status va prioritet variantlari, Projects DB id ---- */
const getSchema = cached(10 * 60 * 1000, async () => {
  try {
    const db = await notion.databases.retrieve({ database_id: TASK_DB_ID });
    const props = db.properties || {};

    const statusProp = props.Status;
    let statusOrder = FALLBACK_STATUS_ORDER;
    let statusOptions = FALLBACK_STATUS_ORDER.map((name) => ({ name, color: "default" }));
    if (statusProp?.type === "status" && statusProp.status?.options?.length) {
      statusOrder = statusProp.status.options.map((o) => o.name);
      statusOptions = statusProp.status.options.map((o) => ({ name: o.name, color: o.color || "default" }));
    } else if (statusProp?.type === "select" && statusProp.select?.options?.length) {
      statusOrder = statusProp.select.options.map((o) => o.name);
      statusOptions = statusProp.select.options.map((o) => ({ name: o.name, color: o.color || "default" }));
    }

    const prioProp = props.Prioritet;
    const priorities = prioProp?.select?.options?.map((o) => o.name) || [];

    return {
      statusOrder,
      statusOptions,
      priorities,
      statusType: statusProp?.type || "status",
      projectsDbId: props.Projects?.relation?.database_id || null,
    };
  } catch (e) {
    console.error("Sxemani o'qib bo'lmadi:", e.message);
    return {
      statusOrder: FALLBACK_STATUS_ORDER,
      statusOptions: FALLBACK_STATUS_ORDER.map((name) => ({ name, color: "default" })),
      priorities: [], statusType: "status", projectsDbId: null,
    };
  }
});

/* ---- Loyihalar: bitta so'rov bilan, har biriga alohida emas ---- */
const getProjects = cached(5 * 60 * 1000, async () => {
  const { projectsDbId } = await getSchema();
  if (!projectsDbId) return {};
  try {
    const pages = await queryAll(projectsDbId);
    const out = {};
    for (const p of pages) out[p.id] = { id: p.id, name: titleOf(p) || "Nomsiz loyiha" };
    return out;
  } catch (e) {
    console.error("Loyihalarni o'qib bo'lmadi:", e.message);
    return {};
  }
});

/* ==========================================================================
   Vazifalarni formatlash
   ========================================================================== */
function formatTask(page, designers, projects) {
  const p = page.properties;
  const designerRels = p.Designers?.relation || [];
  const projectRels = p.Projects?.relation || [];
  const taskDesigners = designerRels.map((r) => designers[r.id]).filter(Boolean);
  const project = projectRels.length ? projects[projectRels[0].id] : null;

  return {
    id: page.id,
    name: p.Name?.title?.[0]?.plain_text || "(nomsiz)",
    status: p.Status?.status?.name || p.Status?.select?.name || "Draft",
    dedlayn: p.Dedlayn?.date?.start || null,
    prioritet: p.Prioritet?.select?.name || null,
    projectId: projectRels[0]?.id || null,
    projectName: project ? project.name : (projectRels.length ? "Noma'lum loyiha" : null),
    designers: taskDesigners.map((d) => ({ id: d.id, name: d.name, username: d.username })),
    url: page.url,
  };
}

async function buildBoard(requester, designers) {
  // Dizayner uchun Notion'ning o'zida filtrlash eng katta tezlik yutug'i:
  // oldin butun Tasks bazasi yuklanib, keyin Node ichida ajratilar edi.
  const taskQuery = requester.isManager
    ? undefined
    : { filter: { property: "Designers", relation: { contains: requester.id } } };
  const [schema, projects, pages] = await Promise.all([
    getSchema(), getProjects(), requester.isManager ? getAllTaskPages() : queryAll(TASK_DB_ID, taskQuery),
  ]);

  const tasks = [];
  for (const page of pages) {
    const t = formatTask(page, designers, projects);
    // Manager bo'lmasa - faqat o'ziga biriktirilgan ishlar
    if (!requester.isManager && !t.designers.some((d) => d.id === requester.id)) continue;
    tasks.push(t);
  }

  const board = {};
  for (const s of schema.statusOrder) board[s] = [];
  for (const t of tasks) (board[t.status] = board[t.status] || []).push(t);

  return {
    requester: {
      id: requester.id,
      name: requester.name,
      degree: requester.degree,
      isManager: requester.isManager,
    },
    statusOrder: schema.statusOrder,
    statusOptions: schema.statusOptions,
    priorities: schema.priorities,
    board,
    tasks,
  };
}

/* ==========================================================================
   GET /api/board
   ========================================================================== */
app.get("/api/board", async (req, res) => {
  try {
    const auth = await requireUser(req, res);
    if (!auth) return;
    res.set("Cache-Control", "private, no-store, max-age=0");
    res.json(await cachedBoard(auth.requester, auth.designers));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server xatoligi: " + err.message });
  }
});

/* ==========================================================================
   GET /api/meta - task yaratish formasi uchun ro'yxatlar
   ========================================================================== */
app.get("/api/meta", async (req, res) => {
  try {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const [schema, projects] = await Promise.all([getSchema(), getProjects()]);
    res.json({
      statusOrder: schema.statusOrder,
      statusOptions: schema.statusOptions,
      priorities: schema.priorities,
      projects: Object.values(projects).sort((a, b) => a.name.localeCompare(b.name)),
      designers: Object.values(auth.designers)
        .filter((d) => d.active)
        .map((d) => ({ id: d.id, name: d.name, degree: d.degree }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server xatoligi: " + err.message });
  }
});

/* ==========================================================================
   Notion bloklarini o'qish - kontentni Telegram ichida ko'rsatish uchun
   ========================================================================== */
function richText(rt) {
  return (rt || []).map((r) => ({
    t: r.plain_text,
    b: !!r.annotations?.bold,
    i: !!r.annotations?.italic,
    s: !!r.annotations?.strikethrough,
    u: !!r.annotations?.underline,
    c: !!r.annotations?.code,
    href: r.href || null,
  }));
}

const INLINE_TYPES = new Set([
  "paragraph", "heading_1", "heading_2", "heading_3",
  "bulleted_list_item", "numbered_list_item", "to_do", "quote", "toggle",
]);
const CONTAINER_TYPES = new Set(["column_list", "column", "synced_block", "template"]);

async function listChildren(blockId) {
  const out = [];
  let cursor;
  do {
    const resp = await notion.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 });
    out.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function readBlocks(blockId, depth) {
  const raw = await listChildren(blockId);
  const out = [];

  for (const b of raw) {
    const type = b.type;
    const node = { type };

    if (INLINE_TYPES.has(type)) {
      node.text = richText(b[type]?.rich_text);
      if (type === "to_do") node.checked = !!b.to_do?.checked;
    } else if (type === "callout") {
      node.text = richText(b.callout?.rich_text);
      node.emoji = b.callout?.icon?.emoji || null;
    } else if (type === "code") {
      node.text = richText(b.code?.rich_text);
      node.language = b.code?.language || "";
    } else if (type === "image") {
      const img = b.image;
      node.url = img?.type === "external" ? img.external?.url : img?.file?.url;
      node.expiryTime = img?.type === "file" ? img.file?.expiry_time || null : null;
      node.caption = richText(img?.caption);
    } else if (type === "bookmark" || type === "embed" || type === "link_preview") {
      node.url = b[type]?.url || null;
      node.caption = richText(b[type]?.caption);
    } else if (type === "file" || type === "pdf" || type === "video") {
      const f = b[type];
      node.url = f?.type === "external" ? f.external?.url : f?.file?.url;
      node.expiryTime = f?.type === "file" ? f.file?.expiry_time || null : null;
      node.name = f?.name || null;
      node.caption = richText(f?.caption);
    } else if (type === "divider") {
      // qo'shimcha ma'lumot kerak emas
    } else if (CONTAINER_TYPES.has(type)) {
      // Column va synced blocklarning o'z matni yo'q, ammo ichidagi bloklar muhim.
      node.type = "container";
    } else if (type === "child_page") {
      node.text = [{ t: b.child_page?.title || "Sahifa" }];
    } else if (type === "table_of_contents" || type === "breadcrumb") {
      continue; // ko'rsatishdan foyda yo'q
    } else {
      // Noma'lum tur: matni bo'lsa olamiz, bo'lmasa tashlab ketamiz
      const rt = b[type]?.rich_text;
      if (!rt?.length) continue;
      node.type = "paragraph";
      node.text = richText(rt);
    }

    if (b.has_children && depth > 0) {
      try { node.children = await readBlocks(b.id, depth - 1); } catch (e) {}
    }
    out.push(node);
  }
  return out;
}

// Brief bloklari ko'pincha taskning o'zidan og'irroq. Bir xil brief qisqa vaqt
// ichida qayta ochilsa, Notion'ni yana boshidan o'qimaymiz. Signed file URL'lar
// odatda ancha uzoq yashaydi, kesh esa atigi 2 daqiqa.
const BRIEF_CACHE_TTL_MS = 2 * 60 * 1000;
const briefCache = new Map();

async function getBriefBlocks(pageId) {
  const hit = briefCache.get(pageId);
  if (hit?.value && Date.now() - hit.at < BRIEF_CACHE_TTL_MS) return hit.value;
  if (hit?.inflight) return hit.inflight;

  if (!hit && briefCache.size >= 50) briefCache.delete(briefCache.keys().next().value);
  const entry = hit || {};
  entry.inflight = readBlocks(pageId, 4)
    .then((value) => {
      entry.value = value;
      entry.at = Date.now();
      return value;
    })
    .finally(() => { entry.inflight = null; });
  briefCache.set(pageId, entry);
  return entry.inflight;
}

/* ==========================================================================
   GET /api/task/:id - tafsilot + Notion kontenti
   ========================================================================== */
app.get("/api/task/:id", async (req, res) => {
  try {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const { requester, designers } = auth;

    // Sahifa xususiyatlari va brief bloklari bir-biriga bog'liq emas; parallel
    // olish birinchi ochilishdagi ikki ketma-ket Notion kutishini bittaga tushiradi.
    const [page, projects, schema, blocks] = await Promise.all([
      notion.pages.retrieve({ page_id: req.params.id }),
      getProjects(),
      getSchema(),
      getBriefBlocks(req.params.id).catch((e) => {
        console.error("Bloklarni o'qishda xato:", e.message);
        return [];
      }),
    ]);
    const task = formatTask(page, designers, projects);

    // Dizayner faqat o'ziga biriktirilgan ishni ko'ra oladi
    if (!requester.isManager && !task.designers.some((d) => d.id === requester.id)) {
      return res.status(403).json({ error: "Bu vazifa sizga biriktirilmagan." });
    }

    // Browser vaqtinchalik rasm/fayl URL'larini uzoq muddat saqlab qolmasin.
    res.set("Cache-Control", "private, no-store, max-age=0");
    res.json({ task, blocks, statusOrder: schema.statusOrder, statusOptions: schema.statusOptions, priorities: schema.priorities });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Vazifani ochib bo'lmadi: " + err.message });
  }
});

/* ==========================================================================
   PATCH /api/task/:id/status - holatni o'zgartirish
   ========================================================================== */
app.patch("/api/task/:id/status", async (req, res) => {
  try {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const { requester, designers } = auth;

    const status = req.body?.status;
    const schema = await getSchema();
    if (!status || !schema.statusOrder.includes(status)) {
      return res.status(400).json({ error: "Noto'g'ri holat." });
    }

    const page = await notion.pages.retrieve({ page_id: req.params.id });
    const projects = await getProjects();
    const task = formatTask(page, designers, projects);

    const isMine = task.designers.some((d) => d.id === requester.id);
    if (!requester.isManager && !isMine) {
      return res.status(403).json({ error: "Bu vazifa sizga biriktirilmagan." });
    }
    // Arxivga faqat manager ko'chira oladi
    if (!requester.isManager && status === "Archive") {
      return res.status(403).json({ error: "Arxivga ko'chirishni art direktor qiladi." });
    }

    const value = schema.statusType === "select" ? { select: { name: status } } : { status: { name: status } };
    await notion.pages.update({ page_id: req.params.id, properties: { Status: value } });
    clearBoardCache();

    res.json({ ok: true, status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Holatni o'zgartirib bo'lmadi: " + err.message });
  }
});

/* ==========================================================================
   POST /api/tasks - yangi vazifa (faqat art/kreativ direktor)
   ========================================================================== */
app.post("/api/tasks", async (req, res) => {
  try {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const { requester, designers } = auth;

    if (!requester.isManager) {
      return res.status(403).json({ error: "Vazifa yaratishni art direktor qiladi." });
    }

    const { name, projectId, designerIds, dedlayn, prioritet, status } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Vazifa nomi kerak." });
    }

    const schema = await getSchema();
    const finalStatus = schema.statusOrder.includes(status) ? status : schema.statusOrder[0];

    const properties = {
      Name: { title: [{ text: { content: String(name).trim().slice(0, 2000) } }] },
      Status: schema.statusType === "select"
        ? { select: { name: finalStatus } }
        : { status: { name: finalStatus } },
    };

    if (dedlayn && /^\d{4}-\d{2}-\d{2}$/.test(dedlayn)) {
      properties.Dedlayn = { date: { start: dedlayn } };
    }
    if (prioritet && (!schema.priorities.length || schema.priorities.includes(prioritet))) {
      properties.Prioritet = { select: { name: prioritet } };
    }
    if (Array.isArray(designerIds) && designerIds.length) {
      const valid = designerIds.filter((id) => designers[id]);
      if (valid.length) properties.Designers = { relation: valid.map((id) => ({ id })) };
    }
    if (projectId) {
      const projects = await getProjects();
      if (projects[projectId]) properties.Projects = { relation: [{ id: projectId }] };
    }

    const page = await notion.pages.create({ parent: { database_id: TASK_DB_ID }, properties });
    clearBoardCache();
    const projects = await getProjects();
    res.json({ ok: true, task: formatTask(page, designers, projects) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Vazifa yaratib bo'lmadi: " + err.message });
  }
});

/* ==========================================================================
   Ma'lumot sahifalari
   ========================================================================== */
app.get("/api/content/:page", (req, res) => {
  const data = CONTENT[req.params.page];
  if (!data) return res.status(404).json({ error: "Sahifa topilmadi" });
  res.json(data);
});

/* ==========================================================================
   Kunlik Telegram eslatmalari
   08:00, 14:00 va 20:00 — Asia/Tashkent. Xabarlar Tasks guruhiga yuboriladi.
   ========================================================================== */
const NOTIFICATION_HOURS = new Set([8, 14, 20]);
const DESIGNER_WORK_STATUSES = new Set(["Draft", "G'oya kerak", "Dizaynda"]);
const CLOSED_STATUSES = new Set(["Finish", "Archive"]);
const sentNotificationSlots = new Set();
let notificationRunInFlight = false;

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortText(value, limit = 90) {
  const text = String(value ?? "").trim();
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
}

function notificationClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: NOTIFICATION_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function dateSerial(dateKey) {
  const [year, month, day] = String(dateKey).slice(0, 10).split("-").map(Number);
  return Number.isFinite(year + month + day) ? Date.UTC(year, month - 1, day) : NaN;
}

function deadlineDelta(task, todayKey) {
  if (!task.dedlayn) return null;
  const due = dateSerial(task.dedlayn);
  const today = dateSerial(todayKey);
  return Number.isFinite(due) && Number.isFinite(today) ? Math.round((due - today) / 86400000) : null;
}

function notificationPriority(task) {
  const value = String(task.prioritet || "").toLowerCase();
  if (value.includes("urgent")) return 0;
  if (value.includes("high")) return 1;
  return 2;
}

function sortNotificationTasks(tasks, todayKey) {
  return tasks.slice().sort((a, b) => {
    const ad = deadlineDelta(a, todayKey), bd = deadlineDelta(b, todayKey);
    if (ad !== bd) return (ad ?? 9999) - (bd ?? 9999);
    return notificationPriority(a) - notificationPriority(b);
  });
}

function greetingForHour(hour) {
  return hour === 8 ? "xayrli tong" : hour === 20 ? "xayrli kech" : "xayrli kun";
}

function dueText(delta, designerStyle) {
  if (delta === 0) return "bugun 🚀";
  const days = Math.abs(delta);
  return designerStyle ? `${days} kun kechikkan` : `${days} kun o'tdi${days <= 2 ? " 🚀" : ""}`;
}

function taskNames(task) {
  return shortText(task.designers.map((d) => d.name).filter(Boolean).join(", ") || "Dizayner biriktirilmagan", 80);
}

function designerTaskLine(task, todayKey) {
  const delta = deadlineDelta(task, todayKey);
  const project = task.projectName ? ` — ${htmlEscape(shortText(task.projectName, 55))}` : "";
  return `• <b>${htmlEscape(shortText(task.name))}</b>${project}, ${dueText(delta, true)}`;
}

function managerTaskLine(task, todayKey) {
  const delta = deadlineDelta(task, todayKey);
  return `• <b>${htmlEscape(shortText(task.name))}</b> — ${htmlEscape(taskNames(task))}, ${dueText(delta, false)}`;
}

function designerSummary(hour, total, overdueCount, todayCount) {
  const counts = [
    overdueCount ? `${overdueCount} ta kechikkan` : "",
    todayCount ? `${todayCount} ta bugun` : "",
  ].filter(Boolean).join(", ");
  if (hour === 8) {
    if (total === 1 && overdueCount === 1) return "Bugun sizda 1 ta muhim task bor. Uning muddati o'tgan.";
    if (total === 1) return "Bugun sizda 1 ta muhim task bor. Uning muddati bugun.";
    return `Bugun sizda ${total} ta muhim task bor: ${counts}.`;
  }
  if (hour === 14) {
    if (overdueCount === total) return `Sizda ${total} ta kechikkan task ochiq turibdi.`;
    return `Sizda ${total} ta muhim task ochiq turibdi: ${counts}.`;
  }
  if (total === 1 && overdueCount === 1) return "Sizda 1 ta task ochiq qoldi. Uning muddati o'tgan.";
  return `Sizda ${total} ta task ochiq qoldi: ${counts}.`;
}

function designerMessage(designer, tasks, hour, todayKey) {
  const relevant = sortNotificationTasks(tasks.filter((task) => {
    const delta = deadlineDelta(task, todayKey);
    return DESIGNER_WORK_STATUSES.has(task.status) && delta !== null && delta <= 0;
  }), todayKey);
  if (!relevant.length) return null;

  const overdue = relevant.filter((task) => deadlineDelta(task, todayKey) < 0);
  const dueToday = relevant.filter((task) => deadlineDelta(task, todayKey) === 0);
  const intro = hour === 8
    ? `Assalomu alaykum @${htmlEscape(designer.username)}, ${greetingForHour(hour)}!`
    : hour === 14
      ? `@${htmlEscape(designer.username)}, 14:00 holati:`
      : `@${htmlEscape(designer.username)}, kun yakuni:`;
  const lines = [intro, "", designerSummary(hour, relevant.length, overdue.length, dueToday.length)];

  if (overdue.length) {
    lines.push("", "<b>Kechikkan:</b>", "", ...overdue.slice(0, 6).map((task) => designerTaskLine(task, todayKey)));
  }
  if (dueToday.length) {
    lines.push("", "<b>Bugun:</b>", "", ...dueToday.slice(0, 6).map((task) => designerTaskLine(task, todayKey)));
  }

  const first = relevant[0];
  if (hour === 8) {
    lines.push("", "<b>✅ Bugungi fokus:</b>", "", `• ${htmlEscape(shortText(first.name))} taskini birinchi navbatda yakunlang. Agar muammo bo'lsa, holatini yozib qoldiring.`);
  } else if (hour === 14) {
    lines.push("", "<b>✅ Keyingi qadam:</b>", "", `• ${htmlEscape(shortText(first.name))} taski qaysi bosqichda ekanini tekshiring va statusini yangilang.`);
  } else {
    lines.push("", "<b>✅ Yakunlashdan oldin:</b>", "", "• Ish tayyor bo'lsa topshiring. Ulgurmagan bo'lsangiz, muammoni va keyingi qadamni yozib qoldiring.");
  }
  return lines.join("\n");
}

const MANAGER_NOTIFICATION_SECTIONS = [
  { title: "G'oya/tasdiq kerak", statuses: new Set(["G'oya kerak", "Tasdiqlanyapti"]) },
  { title: "Dizaynerda", statuses: new Set(["Draft", "Dizaynda"]) },
  { title: "Art direktorda", statuses: new Set(["Art direktorda"]) },
  { title: "Mijozda", statuses: new Set(["Mijozda"]) },
];

function managerAction(task, todayKey, index) {
  const delta = deadlineDelta(task, todayKey);
  const late = delta < 0 ? `, ${Math.abs(delta)} kundan beri kechikkan` : "";
  const designer = htmlEscape(taskNames(task));
  const name = htmlEscape(shortText(task.name));
  if (task.status === "Mijozda") return `${index}. ${name} taskini mijozdan qayta so'rang${late}.`;
  if (task.status === "Art direktorda") return `${index}. ${name} uchun ${designer}ga fidbek bering${late}.`;
  if (task.status === "Dizaynda" || task.status === "Draft") return `${index}. ${name} bo'yicha ${designer} bilan holatni tekshiring${late}.`;
  return `${index}. ${name} bo'yicha g'oya yoki tasdiq jarayonini yakunlang${late}.`;
}

function managerMessage(manager, tasks, hour, todayKey) {
  const relevant = sortNotificationTasks(tasks.filter((task) => {
    const delta = deadlineDelta(task, todayKey);
    return !CLOSED_STATUSES.has(task.status) && delta !== null && delta <= 0;
  }), todayKey);
  if (!relevant.length) return null;

  const intro = hour === 8
    ? `Assalomu alaykum @${htmlEscape(manager.username)}, ${greetingForHour(hour)}!`
    : hour === 14
      ? `@${htmlEscape(manager.username)}, 14:00 holati:`
      : `@${htmlEscape(manager.username)}, kun yakuni:`;
  const summary = hour === 8
    ? `Bugun ${relevant.length} ta ish e'tibor talab qiladi 🚀`
    : hour === 14
      ? `${relevant.length} ta ish hali e'tibor talab qilmoqda.`
      : `${relevant.length} ta ish ochiq qoldi.`;
  const lines = [intro, "", summary];

  for (const section of MANAGER_NOTIFICATION_SECTIONS) {
    const sectionTasks = relevant.filter((task) => section.statuses.has(task.status));
    if (!sectionTasks.length) continue;
    lines.push("", `<b>${section.title}:</b>`, "", ...sectionTasks.slice(0, 5).map((task) => managerTaskLine(task, todayKey)));
  }

  if (hour === 20) {
    lines.push("", "<b>✅ Yakunlashdan oldin:</b>", "",
      "1. Bajarilgan tasklarni yoping.",
      "2. Qolgan tasklarning statusini yangilang.",
      "3. Muammo bor ishlar uchun keyingi qadamni belgilang.");
  } else {
    const actions = relevant.slice(0, 3);
    lines.push("", hour === 14 ? "<b>✅ Keyingi qadamlar:</b>" : "<b>✅ Bugungi vazifalar:</b>", "");
    lines.push(...actions.map((task, index) => managerAction(task, todayKey, index + 1)));
  }
  return lines.join("\n");
}

async function sendGroupNotification(text) {
  const response = await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: NOTIFICATION_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: "Topshiriqlar", url: MINI_APP_LINK }]] },
    }),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || "Telegram xabarni qabul qilmadi");
}

async function runDailyNotifications(hour, todayKey) {
  const [designers, projects, pages] = await Promise.all([
    getDesigners(),
    getProjects(),
    getAllTaskPages(),
  ]);
  const tasks = pages.map((page) => formatTask(page, designers, projects));
  const people = Object.values(designers).filter((person) => person.active && person.username);
  const messages = [];

  for (const person of people.filter((person) => !MANAGER_DEGREES.includes(person.degree))) {
    const mine = tasks.filter((task) => task.designers.some((designer) => designer.id === person.id));
    const text = designerMessage(person, mine, hour, todayKey);
    if (text) messages.push(text);
  }
  for (const manager of people.filter((person) => MANAGER_DEGREES.includes(person.degree))) {
    const text = managerMessage(manager, tasks, hour, todayKey);
    if (text) messages.push(text);
  }

  for (let index = 0; index < messages.length; index += 1) {
    await sendGroupNotification(messages[index]);
    if (index < messages.length - 1) await new Promise((resolve) => setTimeout(resolve, 1100));
  }
  console.log(`Kunlik ${hour}:00 xabari: ${messages.length} ta xabar yuborildi`);
}

async function checkNotificationSchedule() {
  if (!TG_API || !NOTIFICATION_CHAT_ID || notificationRunInFlight) return;
  const now = notificationClock();
  if (!NOTIFICATION_HOURS.has(now.hour) || now.minute > 2) return;
  const slotKey = `${now.date}:${now.hour}`;
  if (sentNotificationSlots.has(slotKey)) return;

  sentNotificationSlots.add(slotKey);
  notificationRunInFlight = true;
  try {
    await runDailyNotifications(now.hour, now.date);
  } catch (error) {
    console.error(`Kunlik ${now.hour}:00 xabarida xato:`, error.message);
  } finally {
    notificationRunInFlight = false;
    for (const key of sentNotificationSlots) if (!key.startsWith(now.date + ":")) sentNotificationSlots.delete(key);
  }
}

function startNotificationScheduler() {
  if (!TG_API || !NOTIFICATION_CHAT_ID) {
    console.log("Kunlik Telegram eslatmalari o'chirilgan (NOTIFICATION_CHAT_ID yo'q). ");
    return;
  }
  console.log("Kunlik Telegram eslatmalari: 08:00, 14:00, 20:00 (Asia/Tashkent)");
  setTimeout(checkNotificationSchedule, 1500);
  setInterval(checkNotificationSchedule, 30 * 1000).unref();
}

/* ==========================================================================
   Telegram webhook
   ========================================================================== */
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const msg = req.body?.message;
    if (!msg?.text) return;
    if (msg.text.trim().startsWith("/start")) await sendWelcome(msg.chat.id);
  } catch (e) {
    console.error("Webhook xatosi:", e.message);
  }
});

async function sendWelcome(chatId) {
  if (!TG_API) return console.error("BOT_TOKEN yo'q, xabar yuborib bo'lmadi.");
  const text =
    "<b>Creative Dprt</b>\n\n" +
    "Assalomu alaykum! Bu yerdan vazifalaringizni ko'rishingiz va agentlik haqidagi ma'lumotlarni topishingiz mumkin.\n\n" +
    "Quyidagi tugmadan foydalaning 👇";
  await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId, text, parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "📋 Ilovani ochish", web_app: { url: `${APP_URL}/` } }]] },
    }),
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server ${PORT}-portda ishga tushdi`);
  // Birinchi haqiqiy foydalanuvchi schema/designers/projects sovuq startini
  // kutib qolmasligi uchun server ishga tushishi bilan yengil ma'lumotlarni isitib olamiz.
  Promise.all([getDesigners(), getSchema(), getProjects(), getAllTaskPages()])
    .then(() => console.log("Notion keshlari tayyor"))
    .catch((e) => console.error("Notion keshini tayyorlashda xato:", e.message));
  startNotificationScheduler();
  if (!BOT_TOKEN) {
    console.log("BOT_TOKEN yo'q - bot o'chirilgan va initData tekshirilmaydi (faqat lokal rejim).");
  } else if (ALLOW_INSECURE) {
    console.warn("DIQQAT: ALLOW_INSECURE_USERNAME=1 - imzosiz ?username= ga ruxsat berilgan. Prodda o'chiring!");
  }
  if (TG_API) {
    try {
      const webhookUrl = `${APP_URL}/webhook`;
      const resp = await fetch(`${TG_API}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message"] }),
      });
      const result = await resp.json();
      console.log(result.ok ? "Webhook o'rnatildi: " + webhookUrl : "Webhook muammosi: " + result.description);
    } catch (e) {
      console.log("Webhook xatosi:", e.message);
    }
  }
});
