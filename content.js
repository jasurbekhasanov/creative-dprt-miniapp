// Ma'lumot sahifalari mazmuni (Agentlik, Ish jarayonlari, Kim nima qiladi, Qo'llanmalar)
// Har biri sarlavha (title) va bo'limlar (sections) dan iborat.
// section turlari: "heading", "text", "list" (oddiy), "numbered" (raqamli), "subheading"

const CONTENT = {
  about: {
    title: "Agentlik haqida",
    sections: [
      { type: "subheading", text: "Missiyamiz" },
      { type: "text", text: "Har bir kuchli g'oyaga o'zi munosib bo'lgan e'tiborni olib berish." },

      { type: "subheading", text: "Yo'limiz (vision)" },
      { type: "text", text: "Biz har bir inson kreator bo'lgan va yaratganini ko'rsatishdan qo'rqmaydigan dunyoni ko'ramiz." },

      { type: "subheading", text: "Qadriyatlarimiz" },
      {
        type: "numbered",
        items: [
          "Biz muammolarni hal qilamiz.",
          "Xom g'oyani chiroyli dizayn qutqarmaydi.",
          "O'sishga intilish va tanqidni qabul qilish har qanday iste'doddan muhimroq.",
          "Kechikish, ishonchni yo'qotish degani.",
          "Odamlar va'dasida turishini talab qil.",
          "Ish to'liq bitmaguncha, ish hali tugamagan.",
          "Hech narsani taxmin qilma.",
        ],
      },
    ],
  },

  workflow: {
    title: "Ish jarayonlari",
    sections: [
      { type: "heading", text: "Qoidalar" },
      {
        type: "list",
        items: [
          "G'oya rad etilsa. Avval art direktor mijoz bilan g'oyani qayta ishlaydi. Vaziyat o'zgarsa, kreativ direktor kiradi va yo'nalishni qayta belgilaydi.",
          "O'zgartirishlar. Tasdiqlangan g'oya doirasidagi o'zgartirishlar cheklanmagan, ular ishning bir qismi. G'oyaning o'zi o'zgara boshlasa, bu yangi ish hisoblanadi. Chegaradan chiqilganini art direktor aniqlaydi.",
          "Muddat. Mijoz videoni yuborgan paytda kelishiladi. Loyiha menejeri dizaynerlarning bandligiga qarab muddat beradi.",
        ],
      },
    ],
  },

  roles: {
    title: "Kim nima qiladi?",
    sections: [
      // Kreativ direktor
      { type: "heading", text: "Kreativ direktor kim?" },
      { type: "text", text: "Kreativ direktor – kanalning vizual yo'nalishi va umumiy sifat standartiga javobgar. Art direktor g'oya bersa, kreativ direktor yo'nalishni belgilaydi va darajani ushlab turadi." },
      { type: "subheading", text: "Asosiy vazifalari" },
      {
        type: "list",
        items: [
          "Kanal stili va vizual yo'nalishini belgilash",
          "Moodboard va referenslar bazasini shakllantirish",
          "Sifat standartini belgilash va natijaga qarab yo'nalishni to'g'rilash",
          "Art direktorning didi va qaror berish ko'nikmasini o'stirib borish",
        ],
      },
      { type: "subheading", text: "Nimalarga aralashmaydi?" },
      {
        type: "list",
        items: [
          "Muqova g'oyasi – art direktor/menejer",
          "Ijro va texnik qismi – dizayner",
          "Muddat va yuk taqsimoti – art direktor/menejer",
          "Mijoz bilan shart, muddat, narx – loyiha menejeri",
        ],
      },
      { type: "subheading", text: "Javobgarlik zonalari" },
      {
        type: "list",
        items: [
          "Kreativ yo'nalish (concept & direction). G'oyani o'zi yozmaydi, lekin u qaysi yo'nalishda bo'lishini belgilaydi va jamoani shunga yo'naltiradi.",
          "G'oya va vizual mosligi. Shunchaki \"chiroyli\", lekin ma'nosiz yechimlarni o'tkazmaydi. Har bir qaror asosli bo'lishi kerak.",
          "Jamoani yo'naltirish. Buyruq bermaydi, jamoa ishini bitta umumiy maqsadga qaratadi.",
          "Qaror qabul qilish. Bahsli vaziyatda oxirgi so'zni aytadi. Qaror didga emas, auditoriya va maqsadga tayanadi.",
          "Natijani baholash. Loyiha oxirida nimaga erishilganini tahlil qiladi va keyingi ishlar uchun xulosa chiqaradi.",
        ],
      },
      { type: "subheading", text: "Aralashish chegarasi" },
      { type: "text", text: "Kreativ direktor har bir muqovaga aralashmaydi. U faqat kanal stili belgilanayotganda, u o'zgarganda, kelishmovchiliklarda yoki ko'rsatkichlar tushganda ishga kiradi. Kunlik topshiriq va tekshiruvlar jamoaning o'zida qoladi. Kreativ direktorning har kuni aralashishi, tizim to'g'ri ishlamayotganini bildiradi." },
      { type: "subheading", text: "Muvaffaqiyat qanday ko'rinadi" },
      { type: "text", text: "Kreativ direktorning ishi boshqalarning qaroriga bog'liq. Kanallar stili ushlab turilgan, ko'rsatkichlar o'sayotgan va art direktorlar uning aralashuvisiz to'g'ri qaror oladigan holat uning muvaffaqiyatidir. U tizimni shunday qurishi kerakki, vaqt o'tib o'ziga bo'lgan ehtiyoj kamaysin." },
      { type: "note", text: "Hozir bu rolni bajaradi: Jasurbek Hasanov." },

      // Art direktor
      { type: "heading", text: "Art direktor/menejer kim?" },
      { type: "text", text: "Art direktor — muqovaning g'oyasi va ijro sifati uchun javobgar shaxs. U har bir video uchun nima kerakligini aniqlaydi, topshiriqni yozadi va ish chiqquniga qadar uni nazorat qilib boradi." },
      { type: "subheading", text: "Asosiy vazifalari" },
      {
        type: "list",
        items: [
          "Videoni ko'rib, muqova g'oyasini ishlab chiqish",
          "Dizaynerga aniq va tushunarli topshiriq yozish",
          "Jarayonni nazorat qilish va o'z vaqtida fidbek berish",
          "Ish mijozga topshirishga tayyormi yoki yo'q, shuni hal qilish",
          "Dizaynerlarga yo'l-yo'riq ko'rsatib, ularni o'stirib borish",
        ],
      },
      { type: "subheading", text: "Javobgarlik zonalari" },
      {
        type: "list",
        items: [
          "G'oya va topshiriq. Videoga qanday muqova kerakligini hal qiladi. Dizaynerdan g'oyani kutib o'tirmaydi, unga nima qilish kerakligi tayyor holda tushuntiriladi.",
          "Ijro nazorati. Ishni oxirida emas, jarayonida ko'radi. Muammo boshlanishida tuzatilsa, bir soat ketadi; oxirida tuzatilsa, kun ketadi.",
          "Sifat nazorati. Ish mijozga ketadimi yoki qaytadimi, buni art direktor aytadi. Uning qarori g'oyaning bajarilganiga va kanalning talabiga tayanadi.",
          "Dizaynerni o'stirish. Fidbek faqat ishni tuzatish uchun emas, dizaynerni o'stirish uchun ham beriladi.",
          "Sifat past chiqqanda. Ish kutilgan darajada chiqmasa, buni birinchi art direktor aniqlaydi va yashirmaydi.",
          "Qaror qabul qilish. Loyiha ichida ijro bo'yicha oxirgi so'z art direktorda. Yo'nalish haqidagi bahs kreativ direktorga o'tadi.",
        ],
      },
      { type: "subheading", text: "Aralashish chegarasi" },
      { type: "text", text: "Art direktor har bir loyihada har kuni bo'ladi. Bu uning asosiy ishi. Lekin u dizaynerning o'rniga o'tirib fotoshopda ishlamaydi, mijoz bilan muddat yoki narxni muhokama qilmaydi. Uning o'zi dizayn qilib bera boshlagani jamoada odam yetmayotganini bildiradi." },
      { type: "subheading", text: "Muvaffaqiyat qanday ko'rinadi" },
      { type: "text", text: "Mijozdan kam revision kelsa, dizaynerlar bir xil xatoni takrorlamasa va ishlar art direktor o'zi qilib bermasdan vaqtida chiqib ketsa, uning ishi bajarilgan bo'ladi." },
      { type: "note", text: "Hozir bu rolni bajaradi: Komron Toshkanov." },

      // Dizayner
      { type: "heading", text: "Dizayner kim?" },
      { type: "text", text: "Dizayner — muqovaning ijrosi uchun javobgar shaxs. Art direktor bergan g'oyani eng yaxshi ko'rinishga chiqarish va uni belgilangan vaqtda topshirish uning ishi." },
      { type: "subheading", text: "Asosiy vazifalari" },
      {
        type: "list",
        items: [
          "Topshiriqni o'qib, g'oyani tushunib olish",
          "Referens va materiallarni yig'ish",
          "Muqovani tayyorlash va variantlarini ko'rsatish",
          "Fidbek bo'yicha tuzatishlar kiritish",
          "Yakuniy fayllarni belgilangan standartda va vaqtida topshirish",
        ],
      },
      { type: "subheading", text: "Javobgarlik zonalari" },
      {
        type: "list",
        items: [
          "G'oyani tushunish. Ishni boshlashdan oldin g'oyani to'liq tushunib olish shart. Mavhum joyi bo'lsa, taxmin qilib ketmaydi, so'rab aniqlashtiradi.",
          "Ijro. Kompozitsiya, ranglar, shrift va ishlov berish dizaynerning mas'uliyati. Bir xil g'oyadan ham o'rtamiyona, ham kuchli muqova yasash mumkin.",
          "Vaqt va mas'uliyat. O'z ish vaqtini o'zi rejalashtiradi, lekin muddat o'zgarmaydi. Ulgurmasligini sezsa, muammo paydo bo'lgan zahoti aytadi.",
          "Fidbek. Tuzatishlar ishning ajralmas qismi. Fidbek shaxsga emas, ish sifatiga beriladi.",
          "O'sishga ochiqlik. Har bir topshiriqda mantiqni tushunib borish va vaqt o'tib o'zi ham yechim taklif qila oladigan darajaga chiqish muhim.",
        ],
      },
      { type: "subheading", text: "Muvaffaqiyat qanday ko'rinadi" },
      { type: "text", text: "Ishlari kam tuzatish bilan o'tsa, muddatlari barqaror bo'lsa va bir yil ichida bir xil izohlar takrorlanmay qolsa, dizayner o'z ishini bajarayotgan bo'ladi." },

      // Loyiha menejeri
      { type: "heading", text: "Loyiha menejeri kim?" },
      { type: "text", text: "Loyiha menejeri — mijoz bilan aloqa va barcha kelishuvlar uchun javobgar. U mijozning talablarini jamoaga tushunarli tilda yetkazadi, jamoaning natijasini esa mijozga to'g'ri taqdim etadi." },
      { type: "subheading", text: "Asosiy vazifalari" },
      {
        type: "list",
        items: [
          "Mijoz bilan doimiy va sifatli muloqotni olib borish",
          "Muddat va shartlarni kelishish",
          "Kelgan buyurtmani jamoaga uzatish va jarayonni kuzatish",
          "Tayyor ishni mijozga topshirish",
          "Shartnoma, hujjatlar va to'lovlar nazoratini yuritish",
        ],
      },
      { type: "subheading", text: "Javobgarlik zonalari" },
      {
        type: "list",
        items: [
          "Mijoz bilan muloqot. U mijoz uchun kompaniyaning yuzi. Mijozning maqsadini aniq o'rganib, jamoaga to'liq yetkazadi.",
          "Muddat va kelishuv. Mijozga aytiladigan muddatni art direktorning ish yuklamasiga qarab belgilaydi. Aytilgan muddat va'da.",
          "Fors-major va ochiqlik. Ish kechiksa yoki kutilgan natija chiqmasa, buni mijoz sezishidan oldin boricha aytadi.",
          "Mijozlarni saqlab qolish. Munosabatlarni faqat buyurtma tushganda emas, doimiy ravishda olib boradi.",
          "Hujjat va to'lovlar. Shartnomalar, hisob-fakturalar va to'lovlar o'z vaqtida bo'lishini ta'minlaydi.",
        ],
      },
      { type: "text", text: "Loyiha menejeri jamoaga qanday ishlashni emas, nima va qachon kerakligini aytadi. Mijozdan kelgan dizayn bo'yicha izohlarni o'zi baholamaydi — ularni art direktorga yuboradi." },
      { type: "subheading", text: "Muvaffaqiyat qanday ko'rinadi" },
      { type: "text", text: "Mijozlar uzoq muddat birga ishlasa, chala kelishuvlar sababli qayta ishlar chiqmasa va jamoa mijoz bilan muloqotga chalg'imay o'z ishini qilsa, loyiha menejeri o'z vazifasini a'lo darajada bajarayotgan bo'ladi." },
      { type: "note", text: "Hozir bu rolni bajaradi: -." },
    ],
  },

  guides: {
    title: "Qo'llanmalar",
    sections: [
      { type: "text", text: "Bu bo'lim tez orada to'ldiriladi." },
    ],
  },
};

module.exports = { CONTENT };
