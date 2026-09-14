// Faqat ishlab chiqish uchun: ?demo=1 bilan Notion'siz to'liq oqimni sinash.
// ?demo=1&role=designer - dizayner ko'rinishi, aks holda art direktor.
(function () {
  function shift(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  const STATUS_ORDER = ["Draft", "G'oya kerak", "Tasdiqlanyapti", "Dizaynda", "Art direktorda", "Mijozda", "Finish", "Archive"];
  // Notion'dagi Select/Status ranglari API'dan aynan shu shaklda keladi.
  const STATUS_OPTIONS = [
    { name: "Draft", color: "gray" },
    { name: "G'oya kerak", color: "purple" },
    { name: "Tasdiqlanyapti", color: "yellow" },
    { name: "Dizaynda", color: "blue" },
    { name: "Art direktorda", color: "orange" },
    { name: "Mijozda", color: "pink" },
    { name: "Finish", color: "green" },
    { name: "Archive", color: "gray" },
  ];
  const PRIORITIES = ["Urgent 🔥", "High 🥵", "Normal"];

  const PEOPLE = {
    p1: { id: "p1", name: "Siroj Rahimov", username: "siroj", degree: "Designer" },
    p2: { id: "p2", name: "Usmonxon Yo'ldoshev", username: "usmonxon", degree: "Designer" },
    p3: { id: "p3", name: "Komron Aliyev", username: "komron", degree: "Designer" },
    p4: { id: "p4", name: "Abdurahmon Sodiqov", username: "abdurahmon", degree: "Designer" },
    p5: { id: "p5", name: "Nusratilla Karimov", username: "nusratilla", degree: "Designer" },
    ad: { id: "ad", name: "Jasurbek Hasanov", username: "jasurbek", degree: "Art director" },
  };

  const PROJECTS = [
    { id: "pr1", name: "Uzum Market" },
    { id: "pr2", name: "Korzinka" },
    { id: "pr3", name: "Cambridge" },
    { id: "pr4", name: "Milliy Taomlar" },
    { id: "pr5", name: "Creative Dprt" },
  ];

  //       nom, status, dedlayn(kun), prioritet, loyiha, dizaynerlar
  const RAW = [
    ["Yangi yil kampaniyasi - key visual", "Dizaynda", -3, "Urgent 🔥", "pr1", ["p1"]],
    ["Instagram story shablonlari (10 ta)", "Art direktorda", -1, "High 🥵", "pr2", ["p2"]],
    ["Bosh sahifa banneri - qayta ishlash", "Dizaynda", -2, "High 🥵", "pr3", ["p1", "p3"]],
    ["Logotip redizayn - 2-iteratsiya", "Mijozda", 0, "High 🥵", "pr3", ["p3"]],
    ["Bannerlar to'plami - fevral", "Dizaynda", 0, "Normal", "pr1", ["p4"]],
    ["Packaging mockup", "Dizaynda", 0, null, "pr4", ["p5"]],
    ["Reels uchun motion shablon", "Tasdiqlanyapti", 0, "Normal", "pr2", ["p1"]],
    ["Brandbook - tipografika bo'limi", "G'oya kerak", 2, "High 🥵", "pr3", ["p2", "p3"]],
    ["Outdoor bilbord 6x3", "Draft", 3, null, "pr1", ["p4"]],
    ["Sayt bosh sahifasi - hero blok", "Dizaynda", 4, "Normal", "pr3", ["p5"]],
    ["Merch dizayni: futbolka + stikerlar", "Tasdiqlanyapti", 6, null, "pr5", ["p3"]],
    ["Prezentatsiya shabloni", "Art direktorda", 8, "Normal", "pr4", ["p1"]],
    ["Ramazon kampaniyasi - moodboard", "G'oya kerak", 12, "High 🥵", "pr2", ["p2"]],
    ["Katalog maketi 48 bet", "Draft", 17, null, "pr4", ["p4", "p5"]],
    ["Yanvar hisoboti uchun infografika", "Finish", -6, "Normal", "pr5", ["p3"]],
    ["Eski logotip arxivi", "Archive", -30, null, "pr3", ["p1"]],
  ];

  const TASKS = RAW.map(function (r, i) {
    const proj = PROJECTS.find((p) => p.id === r[4]);
    return {
      id: "demo-" + i,
      name: r[0],
      status: r[1],
      dedlayn: shift(r[2]),
      prioritet: r[3],
      projectId: r[4],
      projectName: proj ? proj.name : null,
      designers: r[5].map((id) => ({ id: id, name: PEOPLE[id].name, username: PEOPLE[id].username })),
      url: "https://notion.so/demo",
    };
  });

  // Namuna Notion kontenti
  const BLOCKS = [
    { type: "heading_2", text: [{ t: "Video nima haqida" }] },
    { type: "paragraph", text: [
      { t: "Mijoz yangi kampaniya uchun asosiy vizual so'ramoqda. Material samimiy, tabiiy va bir qarashda tushunarli bo'lishi kerak." },
    ]},
    { type: "paragraph", text: [{ t: "Vizualning vazifasi: ", b: true }, { t: "muammoni dramatizatsiya qilmasdan, yechim borligini his qildirish." }] },
    { type: "heading_2", text: [{ t: "Dizayn vazifasi" }] },
    { type: "bulleted_list_item", text: [{ t: "Reference'dan aynan nimani olamiz", b: true }], children: [
      { type: "paragraph", text: [{ t: "Kompozitsiya, yorug'lik yo'nalishi va bitta aniq fokus nuqtasi." }] },
      { type: "paragraph", text: [{ t: "Kayfiyat jiddiy, ammo qo'rqinchli bo'lmasin." }] },
    ]},
    { type: "callout", emoji: "⚠️", text: [{ t: "Dizayn reference'dagi ishning nusxasi bo'lib qolmasin. Faqat tamoyil va kayfiyat olinadi." }] },
    { type: "bulleted_list_item", text: [{ t: "Qanchalik AI ishlatish mumkin", b: true }], children: [
      { type: "paragraph", text: [{ t: "AI faqat kerakli detal va fonni to'g'rilash uchun, me'yorida ishlatiladi." }] },
    ]},

    { type: "heading_2", text: [{ t: "Reference" }] },
    { type: "image", url: "/assets/demo-reference-1.svg", caption: [{ t: "Kompozitsiya va iliq yorug'lik uchun" }] },
    { type: "image", url: "/assets/demo-reference-2.svg", caption: [{ t: "Atmosfera va kontrast uchun" }] },
    { type: "callout", emoji: "📌", text: [{ t: "Birinchi variantda eski kampaniya uslubini saqlang, keyingi variantlarda erkinroq ishlash mumkin." }] },

    { type: "heading_2", text: [{ t: "Matnlar" }] },
    { type: "bulleted_list_item", text: [{ t: "Muqova matni", b: true }], children: [
      { type: "numbered_list_item", text: [{ t: "Yangi yil — yangi imkoniyat" }] },
      { type: "numbered_list_item", text: [{ t: "Kampaniyani birga boshlaymiz" }] },
      { type: "numbered_list_item", text: [{ t: "Asosiy taklif birinchi qatorda" }] },
    ]},
    { type: "bulleted_list_item", text: [{ t: "Sarlavha", b: true }], children: [
      { type: "numbered_list_item", text: [{ t: "Asosiy taklif birinchi qatorda" }] },
      { type: "numbered_list_item", text: [{ t: "Ikkinchi qatorda qisqa izoh" }] },
    ]},
    { type: "heading_2", text: [{ t: "Foydalanish uchun rasmlar" }] },
    { type: "bookmark", url: "https://www.notion.so/", caption: [{ t: "Rasmlar uchun web bookmark" }] },
    { type: "file", url: "/assets/demo-reference-1.svg", name: "Yuklangan reference fayli" },
  ];

  function board(role) {
    const isManager = role !== "designer";
    const me = isManager ? PEOPLE.ad : PEOPLE.p1;
    // Nusxa qaytaramiz: chaqiruvchi ro'yxatni o'zgartirsa, DEMO holati buzilmasin
    const visible = isManager ? TASKS.slice() : TASKS.filter((t) => t.designers.some((d) => d.id === me.id));
    const b = {};
    STATUS_ORDER.forEach((s) => (b[s] = []));
    visible.forEach((t) => (b[t.status] = b[t.status] || []).push(t));
    return {
      requester: { id: me.id, name: me.name, degree: me.degree, isManager: isManager },
      statusOrder: STATUS_ORDER,
      statusOptions: STATUS_OPTIONS,
      priorities: PRIORITIES,
      board: b,
      tasks: visible,
    };
  }

  window.DEMO = {
    board: board,
    meta: function () {
      return {
        statusOrder: STATUS_ORDER,
        statusOptions: STATUS_OPTIONS,
        priorities: PRIORITIES,
        projects: PROJECTS,
        designers: Object.values(PEOPLE).map((p) => ({ id: p.id, name: p.name, degree: p.degree })),
      };
    },
    task: function (id) {
      const t = TASKS.find((x) => x.id === id);
      if (!t) return null;
      return { task: t, blocks: BLOCKS, statusOrder: STATUS_ORDER, statusOptions: STATUS_OPTIONS, priorities: PRIORITIES };
    },
    setStatus: function (id, status) {
      const t = TASKS.find((x) => x.id === id);
      if (t) t.status = status;
      return { ok: true, status: status };
    },
    create: function (payload) {
      const proj = PROJECTS.find((p) => p.id === payload.projectId);
      const t = {
        id: "demo-new-" + Date.now(),
        name: payload.name,
        status: payload.status || "Draft",
        dedlayn: payload.dedlayn || null,
        prioritet: payload.prioritet || null,
        projectId: payload.projectId || null,
        projectName: proj ? proj.name : null,
        designers: (payload.designerIds || []).map((id) => ({ id: id, name: PEOPLE[id].name, username: PEOPLE[id].username })),
        url: "https://notion.so/demo",
      };
      TASKS.unshift(t);
      return { ok: true, task: t };
    },
  };
})();
