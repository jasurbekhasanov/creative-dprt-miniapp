const test = require("node:test");
const assert = require("node:assert/strict");

// Modullar serverni ishga tushirmasdan yuklanadi; tashqi API chaqirilmaydi.
process.env.NOTION_TOKEN = "test-token";
process.env.NOTION_TASK_DB_ID = "test-task-db";
process.env.NOTION_DESIGNERS_DB_ID = "test-designers-db";
process.env.BOT_TOKEN = "test-bot-token";
const sirojId = "11111111-1111-4111-8111-111111111111";
const komronId = "22222222-2222-4222-8222-222222222222";
process.env.NOTIFICATION_CHAT_ROUTES = JSON.stringify({
  [sirojId]: "-1001111111111",
  [komronId]: "-1002222222222",
});

const {
  NOTIFICATION_CHATS,
  buildDailyNotificationMessages,
  designerMessage,
  managerMessage,
  sendGroupNotification,
} = require("../server");

const today = "2026-09-15";
const diqqat = {
  id: "task-1", name: "Diqqat", projectName: "Bir martalik ishlar",
  status: "Dizaynda", dedlayn: "2026-09-14", prioritet: "High",
  designers: [{ id: sirojId, name: "Siroj", username: "rustamovpro" }],
};

test("xabarlar faqat tasdiqlangan shaxsiy guruhlarga yo'naltiriladi", () => {
  assert.equal(NOTIFICATION_CHATS.size, 2);
  assert.equal(NOTIFICATION_CHATS.get(sirojId), "-1001111111111");
  assert.equal(NOTIFICATION_CHATS.get(komronId), "-1002222222222");
  assert.ok(![...NOTIFICATION_CHATS.values()].includes("-1009999999999"));

  const people = {
    siroj: { id: sirojId, name: "Siroj", username: "rustamovpro", degree: "Designer", active: true },
    komron: { id: komronId, name: "Komron", username: "komron_toshkanov", degree: "Art director", active: true },
    muhammadrizo: { id: "33333333-3333-4333-8333-333333333333", name: "Muhammadrizo", username: "Riz0_1", degree: "Designer", active: true },
    jasurbek: { id: "44444444-4444-4444-8444-444444444444", name: "Jasurbek", username: "khasanov_jasurbek", degree: "Creative Director", active: true },
  };
  const messages = buildDailyNotificationMessages(people, [diqqat], 14, today);
  assert.deepEqual(messages.map((m) => m.chatId), ["-1001111111111", "-1002222222222"]);
});

test("dizayner ertalab vaziyatni, 14:00 va 20:00 da faqat keyingi qadamni oladi", () => {
  const person = { username: "rustamovpro" };
  const morning = designerMessage(person, [diqqat], 8, today);
  const midday = designerMessage(person, [diqqat], 14, today);
  const evening = designerMessage(person, [diqqat], 20, today);
  assert.match(morning, /Kechikkan:/);
  assert.match(morning, /Diqqat.*Bir martalik ishlar/);
  assert.match(midday, /Diqqat.*Bir martalik ishlar.*kechikyapti/);
  assert.match(midday, /art direktorga yozib yuboring/);
  assert.doesNotMatch(midday, /Kechikkan:|Bugun:|Assalomu alaykum/);
  assert.match(evening, /hali art direktorga topshirilmagan/);
  assert.match(evening, /holatini va keyingi qadamni yozib qoldiring/);
  assert.doesNotMatch(evening, /Kechikkan:|Bugun:|Assalomu alaykum/);
});

test("art direktor ertalab barcha ochiq ishni, keyin faqat amaliy qadamlarni ko'radi", () => {
  const person = { username: "komron_toshkanov" };
  const tasks = [
    { ...diqqat, name: "Fidbek", status: "Art direktorda" },
    { ...diqqat, name: "Mijoz javobi", status: "Mijozda", dedlayn: today },
    { ...diqqat, name: "Keyingi hafta", status: "Dizaynda", dedlayn: "2026-09-17" },
    { ...diqqat, name: "G'oya", status: "G'oya kerak", dedlayn: null },
  ];
  const morning = managerMessage(person, tasks, 8, today);
  const midday = managerMessage(person, tasks, 14, today);
  const evening = managerMessage(person, tasks, 20, today);
  assert.match(morning, /Nazoratda 4 ta ochiq ish/);
  assert.match(morning, /Keyingi hafta.*2 kundan keyin/);
  assert.match(morning, /G'oya.*muddat belgilanmagan/);
  assert.match(midday, /Fidbek[\s\S]*fidbek bering/);
  assert.match(midday, /Mijoz javobi[\s\S]*Mijozdan javobni so‘rang/);
  assert.doesNotMatch(midday, /Keyingi hafta|G'oya\/tasdiq kerak:|Nazoratda 4/);
  assert.match(evening, /ertangi qadamni belgilang/);
  assert.doesNotMatch(evening, /G'oya\/tasdiq kerak:|Nazoratda 4/);
});

test("Telegram xabari alohida topic ID siz General mavzusiga jo'natiladi", async () => {
  const originalFetch = global.fetch;
  let payload;
  global.fetch = async (_url, opts) => {
    payload = JSON.parse(opts.body);
    return { json: async () => ({ ok: true }) };
  };
  try {
    await sendGroupNotification("-1001111111111", "Sinov matni");
    assert.equal(payload.chat_id, "-1001111111111");
    assert.equal(payload.message_thread_id, undefined);
    assert.equal(payload.reply_markup.inline_keyboard[0][0].text, "Topshiriqlar");
  } finally {
    global.fetch = originalFetch;
  }
});
