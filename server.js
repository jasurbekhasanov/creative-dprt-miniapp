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
  params.delete("signature"); // Telegram'ning yangi Ed25519 maydoni - HMAC'ga kirmaydi

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
  const [schema, projects, pages] = await Promise.all([
    getSchema(), getProjects(), queryAll(TASK_DB_ID),
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
    res.json(await buildBoard(auth.requester, auth.designers));
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

/* ==========================================================================
   GET /api/task/:id - tafsilot + Notion kontenti
   ========================================================================== */
app.get("/api/task/:id", async (req, res) => {
  try {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const { requester, designers } = auth;

    const page = await notion.pages.retrieve({ page_id: req.params.id });
    const projects = await getProjects();
    const task = formatTask(page, designers, projects);

    // Dizayner faqat o'ziga biriktirilgan ishni ko'ra oladi
    if (!requester.isManager && !task.designers.some((d) => d.id === requester.id)) {
      return res.status(403).json({ error: "Bu vazifa sizga biriktirilmagan." });
    }

    let blocks = [];
    try {
      blocks = await readBlocks(req.params.id, 4);
    } catch (e) {
      console.error("Bloklarni o'qishda xato:", e.message);
    }

    const schema = await getSchema();
    // Notion yuklagan rasm/fayl URL'lari vaqtinchalik. Har ochishda yangi URL qaytsin.
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
