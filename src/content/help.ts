/**
 * Customer help guide (EN + AM). Placeholders filled from live settings:
 * {name} business name, {hours} payment window, {days} printing file retention,
 * {mb} max printing file size, {receiptMb} receipt size limit.
 */
type L = { en: string; am: string };
export type HelpBlock =
  | { kind: "p"; text: L }
  | { kind: "steps"; items: L[] }
  | { kind: "list"; items: L[] }
  | { kind: "tip"; text: L }
  | { kind: "statuses"; items: { status: string; text: L }[] }
  | { kind: "faq"; items: { q: L; a: L }[] };

export interface HelpSection {
  id: string;
  icon: "store" | "user" | "cart" | "clipboard" | "bank" | "truck" | "search" | "printer" | "tag" | "shield" | "help" | "refresh";
  title: L;
  blocks: HelpBlock[];
  links?: { href: string; label: L }[];
}

export const HELP: HelpSection[] = [
  {
    id: "what-we-offer",
    icon: "store",
    title: { en: "What you can do on {name}", am: "በ{name} ምን ማድረግ ይችላሉ" },
    blocks: [
      { kind: "list", items: [
        { en: "Cosmetics — perfumes, skincare, makeup, haircare and beauty accessories.", am: "የውበት ምርቶች — ሽቶዎች፣ የቆዳ እንክብካቤ፣ ሜካፕ፣ የፀጉር እንክብካቤ እና የውበት መለዋወጫዎች።" },
        { en: "Electronics — smartphones, chargers, earphones, power banks, cables and accessories.", am: "ኤሌክትሮኒክስ — ስማርት ስልኮች፣ ቻርጀሮች፣ የጆሮ ማዳመጫዎች፣ ፓወር ባንኮች፣ ኬብሎች እና መለዋወጫዎች።" },
        { en: "Printing — upload your documents online, see the price, pay, and collect your prints.", am: "ህትመት — ሰነዶችዎን በመስመር ላይ ይጫኑ፣ ዋጋውን ይመልከቱ፣ ይክፈሉ እና ህትመትዎን ይውሰዱ።" },
      ] },
      { kind: "p", text: {
        en: "All prices are in Ethiopian Birr (ETB). You pay by bank transfer and upload your receipt; our team checks the payment in our bank account and then prepares your order for delivery or pickup.",
        am: "ሁሉም ዋጋዎች በኢትዮጵያ ብር ናቸው። በባንክ ዝውውር ከፍለው ደረሰኝዎን ይጫናሉ፤ ቡድናችን ክፍያውን በባንክ ሂሳባችን አረጋግጦ ትዕዛዝዎን ለማድረስ ወይም ለመውሰድ ያዘጋጃል።" } },
    ],
  },
  {
    id: "account",
    icon: "user",
    title: { en: "1. Create your account", am: "1. መለያ ይክፈቱ" },
    blocks: [
      { kind: "p", text: { en: "You need a free account to place an order. It keeps your orders safe and lets you follow them from any phone or computer.",
        am: "ለማዘዝ ነፃ መለያ ያስፈልግዎታል። ትዕዛዞችዎን ይጠብቃል፣ ከማንኛውም ስልክ ወይም ኮምፒውተር እንዲከታተሏቸውም ያስችላል።" } },
      { kind: "steps", items: [
        { en: "Tap the person icon at the top, then “Create account”.", am: "ከላይ ያለውን የሰው ምልክት ይንኩ፣ ከዚያ «መለያ ይክፈቱ»ን ይምረጡ።" },
        { en: "Enter your name, email and a password (at least 8 characters with letters and a number) and accept the terms.", am: "ስምዎን፣ ኢሜይልዎን እና የይለፍ ቃል (ቢያንስ 8 ፊደላት ከፊደልና ቁጥር ጋር) ያስገቡ፣ ውሎቹንም ይቀበሉ።" },
        { en: "Open the confirmation email we send you and tap the link (check the Spam folder if you don’t see it).", am: "የምንልክልዎትን የማረጋገጫ ኢሜይል ከፍተው ሊንኩን ይንኩ (ካላዩት Spam ማህደሩን ይመልከቱ)።" },
        { en: "Done — you can now sign in and order.", am: "ተጠናቋል — አሁን ገብተው ማዘዝ ይችላሉ።" },
      ] },
      { kind: "tip", text: { en: "Forgot your password? On the sign-in page tap “Forgot password?” and we email you a link to choose a new one.",
        am: "የይለፍ ቃልዎን ረሱ? በመግቢያ ገጹ ላይ «የይለፍ ቃል ረሱ?»ን ይንኩ፣ አዲስ ለመምረጥ የሚያስችል ሊንክ በኢሜይል እንልክልዎታለን።" } },
    ],
    links: [{ href: "/account/signup", label: { en: "Create account", am: "መለያ ይክፈቱ" } }],
  },
  {
    id: "shopping",
    icon: "cart",
    title: { en: "2. Find products and fill your basket", am: "2. ምርቶችን ያግኙ፣ ጋሪዎን ይሙሉ" },
    blocks: [
      { kind: "list", items: [
        { en: "Browse by department (Cosmetics, Electronics) or use the search box at the top.", am: "በክፍል (የውበት ምርቶች፣ ኤሌክትሮኒክስ) ያስሱ ወይም ከላይ ያለውን የፍለጋ ሳጥን ይጠቀሙ።" },
        { en: "Filter by category, sort by price, or show only items in stock.", am: "በምድብ ያጣሩ፣ በዋጋ ይደርድሩ ወይም ያሉትን ዕቃዎች ብቻ ያሳዩ።" },
        { en: "Reviews: after you receive a product, open it (or your completed order → “Write a review”) and give 1–5 stars with an optional comment. Reviews appear after we check them; your name shows as first name and initial.", am: "አስተያየቶች፦ ምርቱን ከተቀበሉ በኋላ ይክፈቱት (ወይም የተጠናቀቀ ትዕዛዝዎ → «አስተያየት ይጻፉ») እና ከ1–5 ኮከብ ከአማራጭ አስተያየት ጋር ይስጡ። አስተያየቶች ከተመረመሩ በኋላ ይታያሉ፤ ስምዎ በመጀመሪያ ስም እና በመነሻ ፊደል ይታያል።" },
        { en: "Sold out? Tap “Notify me when available” on the product page (signed in) and we email you — and send a phone notification if you turned them on — as soon as it is back.", am: "ተሽጧል? በምርቱ ገጽ ላይ «ሲገኝ አሳውቀኝ»ን ይንኩ (ገብተው)፤ እንደገና እንደተገኘ በኢሜይል — የስልክ ማሳወቂያ ካበሩም በስልክ — እናሳውቅዎታለን።" },
        { en: "Open a product to see photos, details and price, then tap “Add to basket”.", am: "ፎቶዎችን፣ ዝርዝሮችን እና ዋጋውን ለማየት ምርቱን ይክፈቱ፣ ከዚያ «ወደ ጋሪ ጨምር»ን ይንኩ።" },
        { en: "Open the basket (bag icon) to change quantities or remove items. Your basket is saved on your account when you are signed in.", am: "ብዛትን ለመቀየር ወይም ዕቃዎችን ለማስወገድ ጋሪውን (የቦርሳ ምልክት) ይክፈቱ። ሲገቡ ጋሪዎ በመለያዎ ላይ ይቀመጣል።" },
      ] },
    ],
    links: [{ href: "/shop", label: { en: "Start shopping", am: "መግዛት ይጀምሩ" } }],
  },
  {
    id: "checkout",
    icon: "clipboard",
    title: { en: "3. Place your order (checkout)", am: "3. ትዕዛዝ ያስገቡ (ክፍያ)" },
    blocks: [
      { kind: "steps", items: [
        { en: "In the basket tap “Checkout”.", am: "በጋሪው ውስጥ «ወደ ክፍያ»ን ይንኩ።" },
        { en: "Check your name and phone number (we call this number about delivery).", am: "ስምዎን እና ስልክ ቁጥርዎን ያረጋግጡ (ስለ ማድረስ በዚህ ቁጥር እንደውላለን)።" },
        { en: "Choose Delivery (pick your city — the fee is shown) or Pickup from our shop (free).", am: "ማድረስ (ከተማዎን ይምረጡ — ክፍያው ይታያል) ወይም ከሱቃችን መውሰድ (ነፃ) ይምረጡ።" },
        { en: "Have a promo code? Enter it and tap “Apply” — the discount appears in the total.", am: "የቅናሽ ኮድ አለዎት? ያስገቡት እና «ተግብር»ን ይንኩ — ቅናሹ በድምሩ ላይ ይታያል።" },
        { en: "Tick “I agree to the terms and conditions” and tap “Place order”.", am: "«በውሎቹ እስማማለሁ»ን ምልክት አድርገው «ትዕዛዝ አስገባ»ን ይንኩ።" },
      ] },
      { kind: "tip", text: { en: "The price shown when you place the order is the price you pay, even if our prices change later. Items are reserved for you for {hours} hours while you pay.",
        am: "ትዕዛዝ ሲያስገቡ የሚታየው ዋጋ ዋጋችን በኋላ ቢቀየርም የሚከፍሉት ዋጋ ነው። ሲከፍሉ ዕቃዎቹ ለ{hours} ሰዓታት ይያዙልዎታል።" } },
    ],
  },
  {
    id: "paying",
    icon: "bank",
    title: { en: "4. Pay by bank transfer and upload your receipt", am: "4. በባንክ ይክፈሉ፣ ደረሰኝ ይጫኑ" },
    blocks: [
      { kind: "p", text: { en: "After you place the order you see our bank account and the exact amount. We also email them to you.",
        am: "ትዕዛዝ ካስገቡ በኋላ የባንክ ሂሳባችንን እና ትክክለኛውን መጠን ያያሉ። በኢሜይልም እንልካቸዋለን።" } },
      { kind: "steps", items: [
        { en: "In your bank app (or at the bank), transfer the exact amount to the account shown.", am: "በባንክ መተግበሪያዎ (ወይም በባንክ) የሚታየውን ትክክለኛ መጠን ወደ ተገለጸው ሂሳብ ያስተላልፉ።" },
        { en: "Write your order number (for example ET-10042) as the reason / remark.", am: "የትዕዛዝ ቁጥርዎን (ለምሳሌ ET-10042) በምክንያት / ማብራሪያ ላይ ይጻፉ።" },
        { en: "Take a screenshot of the receipt (or save the PDF).", am: "የደረሰኙን ፎቶ (screenshot) ያንሱ (ወይም PDF ያስቀምጡ)።" },
        { en: "On your order page tap “Submit payment proof”: add the transaction reference (usually starts with FT…) and upload the receipt (JPG, PNG or PDF, up to {receiptMb} MB).", am: "በትዕዛዝ ገጽዎ ላይ «የክፍያ ማረጋገጫ አስገባ»ን ይንኩ፦ የግብይት ማጣቀሻ ቁጥሩን (ብዙውን ጊዜ በFT… ይጀምራል) ያስገቡ እና ደረሰኙን (JPG፣ PNG ወይም PDF፣ እስከ {receiptMb} MB) ይጫኑ።" },
      ] },
      { kind: "tip", text: { en: "Pay within {hours} hours. If we do not receive the payment in time, the order expires and the items are released — you can simply order again.",
        am: "በ{hours} ሰዓታት ውስጥ ይክፈሉ። ክፍያው በጊዜው ካልደረሰን ትዕዛዙ ጊዜው ያልፍበታል፣ ዕቃዎቹም ይለቀቃሉ — እንደገና ማዘዝ ይችላሉ።" } },
      { kind: "tip", text: { en: "Pay only to the bank account shown on our website or in our emails. We never ask for your password or bank PIN.",
        am: "በድረ-ገጻችን ወይም በኢሜይሎቻችን ላይ ወደሚታየው የባንክ ሂሳብ ብቻ ይክፈሉ። የይለፍ ቃልዎን ወይም የባንክ ፒንዎን በፍጹም አንጠይቅም።" } },
    ],
  },
  {
    id: "after-payment",
    icon: "truck",
    title: { en: "5. After you pay: what happens next", am: "5. ከከፈሉ በኋላ ምን ይሆናል" },
    blocks: [
      { kind: "p", text: { en: "Our team checks that the money has arrived in our bank account (a receipt picture alone is not enough). We email you at every important step. Your order shows one of these statuses:",
        am: "ቡድናችን ገንዘቡ ወደ ባንክ ሂሳባችን መግባቱን ያረጋግጣል (የደረሰኝ ፎቶ ብቻውን በቂ አይደለም)። በእያንዳንዱ አስፈላጊ ደረጃ በኢሜይል እናሳውቅዎታለን። ትዕዛዝዎ ከእነዚህ ሁኔታዎች አንዱን ያሳያል፦" } },
      { kind: "statuses", items: [
        { status: "awaiting_payment", text: { en: "We are waiting for your bank transfer and receipt.", am: "የባንክ ዝውውርዎን እና ደረሰኝዎን እየጠበቅን ነው።" } },
        { status: "pending_verification", text: { en: "We received your receipt and are checking the payment.", am: "ደረሰኝዎን ተቀብለናል፣ ክፍያውን እያረጋገጥን ነው።" } },
        { status: "payment_rejected", text: { en: "We could not find the payment. The reason is shown — check the transfer and upload a new receipt.", am: "ክፍያውን ማግኘት አልቻልንም። ምክንያቱ ይታያል — ዝውውሩን አረጋግጠው አዲስ ደረሰኝ ይጫኑ።" } },
        { status: "confirmed", text: { en: "Payment verified — your order is confirmed.", am: "ክፍያ ተረጋግጧል — ትዕዛዝዎ ጸድቋል።" } },
        { status: "processing", text: { en: "We are preparing your order.", am: "ትዕዛዝዎን እያዘጋጀን ነው።" } },
        { status: "ready_for_pickup", text: { en: "Ready — come to our shop to collect it.", am: "ዝግጁ ነው — ከሱቃችን ይውሰዱት።" } },
        { status: "out_for_delivery", text: { en: "On its way — keep your phone nearby.", am: "በመንገድ ላይ ነው — ስልክዎን በአቅራቢያ ያቆዩ።" } },
        { status: "completed", text: { en: "Delivered or collected. Thank you!", am: "ደርሷል ወይም ተወስዷል። እናመሰግናለን!" } },
        { status: "cancelled", text: { en: "The order was cancelled. Contact us if you already paid.", am: "ትዕዛዙ ተሰርዟል። አስቀድመው ከፍለው ከሆነ ያግኙን።" } },
        { status: "expired", text: { en: "Payment was not received in time. You can order again.", am: "ክፍያው በጊዜው አልደረሰም። እንደገና ማዘዝ ይችላሉ።" } },
      ] },
    ],
  },
  {
    id: "tracking",
    icon: "search",
    title: { en: "6. Follow your order", am: "6. ትዕዛዝዎን ይከታተሉ" },
    blocks: [
      { kind: "list", items: [
        { en: "My account → My orders: all your orders and their status, from any device (sign in first).", am: "የእኔ መለያ → ትዕዛዞቼ፦ ሁሉም ትዕዛዞችዎ እና ሁኔታቸው፣ ከማንኛውም መሣሪያ (መጀመሪያ ይግቡ)።" },
        { en: "My account → Personal details: your name, phone, delivery city and address are saved and filled in at checkout. Your name, phone and email are locked once saved — contact us to change them. Tap “Change delivery details” to update the city and address.", am: "የእኔ መለያ → የግል መረጃ፦ ስምዎ፣ ስልክዎ፣ የማድረሻ ከተማ እና አድራሻዎ ተቀምጠው ክፍያ ሲፈጽሙ በራሳቸው ይሞላሉ። ስም፣ ስልክና ኢሜይል አንዴ ከተቀመጡ ይቆለፋሉ — ለመቀየር ያግኙን። ከተማና አድራሻ ለመቀየር «የማድረሻ መረጃን ቀይር»ን ይንኩ።" },
        { en: "Our emails: tap the button in the email. If you are asked to sign in, use the same account you ordered with.", am: "ኢሜይሎቻችን፦ በኢሜይሉ ውስጥ ያለውን ቁልፍ ይንኩ። እንዲገቡ ከተጠየቁ ያዘዙበትን መለያ ይጠቀሙ።" },
        { en: "Track order page: enter your order number and the tracking code shown after checkout.", am: "ትዕዛዝ መከታተያ ገጽ፦ የትዕዛዝ ቁጥርዎን እና ከክፍያ በኋላ የታየውን የመከታተያ ኮድ ያስገቡ።" },
        { en: "Phone notifications: in My account tap “Turn on notifications” to get a message on your phone at every step (on iPhone, first install the app — see the top of this page).", am: "የስልክ ማሳወቂያዎች፦ በየእኔ መለያ ውስጥ «ማሳወቂያዎችን አብራ»ን ይንኩ፣ በእያንዳንዱ ደረጃ በስልክዎ ላይ መልዕክት ይደርስዎታል (በiPhone መጀመሪያ መተግበሪያውን ይጫኑ — የዚህን ገጽ ላይኛው ክፍል ይመልከቱ)።" },
      ] },
    ],
    links: [{ href: "/account", label: { en: "My account", am: "የእኔ መለያ" } }, { href: "/track-order", label: { en: "Track order", am: "ትዕዛዝ ይከታተሉ" } }],
  },
  {
    id: "printing",
    icon: "printer",
    title: { en: "7. Printing service", am: "7. የህትመት አገልግሎት" },
    blocks: [
      { kind: "steps", items: [
        { en: "Go to Printing and upload your files: PDF, Word (.docx) or images, up to {mb} MB each.", am: "ወደ ህትመት ይሂዱ እና ፋይሎችዎን ይጫኑ፦ PDF፣ Word (.docx) ወይም ምስሎች፣ እያንዳንዳቸው እስከ {mb} MB።" },
        { en: "Choose black & white or colour, paper size (A4/A3), single or double-sided, and number of copies.", am: "ጥቁር-ነጭ ወይም ባለቀለም፣ የወረቀት መጠን (A4/A3)፣ ባለአንድ ወይም ባለሁለት ገጽ እና የቅጂ ብዛት ይምረጡ።" },
        { en: "PDFs and images get a price immediately. For Word files we count the pages and email you the price (usually within opening hours).", am: "PDF እና ምስሎች ወዲያውኑ ዋጋ ያገኛሉ። ለWord ፋይሎች ገጾቹን ቆጥረን ዋጋውን በኢሜይል እንልካለን (ብዙውን ጊዜ በስራ ሰዓት)።" },
        { en: "Add the priced job to your basket, check out and pay by bank transfer like any order.", am: "ዋጋ የወጣለትን ስራ ወደ ጋሪዎ ያስገቡ፣ እንደማንኛውም ትዕዛዝ በባንክ ዝውውር ይክፈሉ።" },
        { en: "We email you when your prints are ready.", am: "ህትመትዎ ሲዘጋጅ በኢሜይል እናሳውቅዎታለን።" },
      ] },
      { kind: "tip", text: { en: "Your documents are private: only our staff can open them, and they are deleted automatically as soon as you collect your prints (at the latest {days} days after upload).",
        am: "ሰነዶችዎ የግል ናቸው፦ ሊከፍቷቸው የሚችሉት ሰራተኞቻችን ብቻ ናቸው፣ ህትመቶችዎን እንደወሰዱ ወዲያውኑ (ቢዘገይ ከተጫኑ ከ{days} ቀናት በኋላ) በራስ-ሰር ይሰረዛሉ።" } },
    ],
    links: [{ href: "/printing", label: { en: "Start a printing job", am: "የህትመት ስራ ይጀምሩ" } }],
  },
  {
    id: "promotions",
    icon: "tag",
    title: { en: "8. Offers and promo codes", am: "8. ቅናሾች እና የቅናሽ ኮዶች" },
    blocks: [
      { kind: "list", items: [
        { en: "Current offers are shown on the home page; sale prices are shown on the products.", am: "የወቅቱ ቅናሾች በመነሻ ገጹ ላይ ይታያሉ፤ የቅናሽ ዋጋዎች በምርቶቹ ላይ ይታያሉ።" },
        { en: "Personal codes for you appear under My account → My offers.", am: "ለእርስዎ ብቻ የተሰጡ ኮዶች በየእኔ መለያ → የእኔ ቅናሾች ስር ይታያሉ።" },
        { en: "Enter a code at checkout and tap “Apply”. Some codes have a minimum order, an end date, or can be used once per account.", am: "ኮዱን በክፍያ ጊዜ ያስገቡ እና «ተግብር»ን ይንኩ። አንዳንድ ኮዶች ዝቅተኛ የትዕዛዝ መጠን፣ የማብቂያ ቀን አላቸው ወይም በአንድ መለያ አንድ ጊዜ ብቻ ይሰራሉ።" },
      ] },
    ],
  },
  {
    id: "wallet",
    icon: "bank",
    title: { en: "Account balance (shop credit)", am: "የመለያ ቀሪ ሂሳብ (የሱቅ ክሬዲት)" },
    blocks: [
      { kind: "steps", items: [
        { en: "Open My account → My balance → Top up.", am: "የእኔ መለያ → የእኔ ቀሪ ሂሳብ → ገንዘብ ይሙሉን ይክፈቱ።" },
        { en: "Transfer the amount to our bank account and write your email as the reason.", am: "መጠኑን ወደ ባንክ ሂሳባችን ያስተላልፉ እና ኢሜይልዎን በምክንያት ላይ ይጻፉ።" },
        { en: "Enter the amount and upload the receipt. We add it to your balance after we see the money in our bank account (you get an email).", am: "መጠኑን ያስገቡ እና ደረሰኙን ይጫኑ። ገንዘቡን በባንክ ሂሳባችን ካየን በኋላ ወደ ቀሪ ሂሳብዎ እንጨምረዋለን (ኢሜይል ይደርስዎታል)።" },
        { en: "At checkout choose “Pay with my balance” — the order is confirmed immediately.", am: "በክፍያ ጊዜ «በቀሪ ሂሳቤ ክፈል»ን ይምረጡ — ትዕዛዙ ወዲያውኑ ይረጋገጣል።" },
      ] },
      { kind: "tip", text: { en: "The balance can hold up to 10,000 ETB and pays only for a whole order. It is shop credit: it is not paid out as cash, and refunds of cancelled balance-paid orders return to it.",
        am: "ቀሪ ሂሳቡ እስከ 10,000 ብር መያዝ ይችላል፣ የሚከፍለውም ሙሉ ትዕዛዝ ብቻ ነው። የሱቅ ክሬዲት ነው፦ በጥሬ ገንዘብ አይከፈልም፣ በቀሪ ሂሳብ የተከፈሉ የተሰረዙ ትዕዛዞች ተመላሽም ወደዚሁ ይመለሳል።" } },
    ],
    links: [{ href: "/account/wallet", label: { en: "My balance", am: "የእኔ ቀሪ ሂሳብ" } }],
  },
  {
    id: "returns",
    icon: "refresh",
    title: { en: "9. Cancellations, returns and contact", am: "9. ስረዛ፣ መመለስ እና ማግኘት" },
    blocks: [
      { kind: "p", text: { en: "To cancel or change an order, contact us as soon as possible with your order number. Returns and refunds follow our Terms and conditions.",
        am: "ትዕዛዝ ለመሰረዝ ወይም ለመቀየር በተቻለ ፍጥነት በትዕዛዝ ቁጥርዎ ያግኙን። መመለስ እና ተመላሽ በውሎቻችን እና ሁኔታዎቻችን መሰረት ይከናወናሉ።" } },
    ],
    links: [{ href: "/contact", label: { en: "Contact us", am: "ያግኙን" } }, { href: "/terms", label: { en: "Terms and conditions", am: "ውሎች እና ሁኔታዎች" } }],
  },
  {
    id: "faq",
    icon: "help",
    title: { en: "Frequently asked questions", am: "በተደጋጋሚ የሚጠየቁ ጥያቄዎች" },
    blocks: [
      { kind: "faq", items: [
        { q: { en: "Can I pay cash or on delivery?", am: "በጥሬ ገንዘብ ወይም ሲደርስ መክፈል እችላለሁ?" },
          a: { en: "Online orders are paid by bank transfer before we deliver. For anything special, contact us.", am: "የመስመር ላይ ትዕዛዞች ከማድረሳችን በፊት በባንክ ዝውውር ይከፈላሉ። ለልዩ ጉዳዮች ያግኙን።" } },
        { q: { en: "How long does payment verification take?", am: "ክፍያን ማረጋገጥ ምን ያህል ጊዜ ይወስዳል?" },
          a: { en: "Usually a few hours during opening hours. You get an email as soon as it is verified.", am: "ብዙውን ጊዜ በስራ ሰዓት ጥቂት ሰዓታት። እንደተረጋገጠ ኢሜይል ይደርስዎታል።" } },
        { q: { en: "I didn’t receive an email.", am: "ኢሜይል አልደረሰኝም።" },
          a: { en: "Check the Spam / Promotions folder, and that you signed up with the right email. Your order status is always visible in My account.", am: "Spam / Promotions ማህደሩን ይመልከቱ፣ በትክክለኛው ኢሜይል መመዝገብዎንም ያረጋግጡ። የትዕዛዝዎ ሁኔታ ሁልጊዜ በየእኔ መለያ ውስጥ ይታያል።" } },
        { q: { en: "The link in the email says I must sign in.", am: "በኢሜይሉ ውስጥ ያለው ሊንክ እንድገባ ይጠይቀኛል።" },
          a: { en: "That keeps your order private. Sign in with the account you ordered with and you go straight to the order.", am: "ይህ ትዕዛዝዎን የግል ያደርገዋል። ባዘዙበት መለያ ይግቡ፣ በቀጥታ ወደ ትዕዛዙ ይወስድዎታል።" } },
        { q: { en: "My order expired. What now?", am: "ትዕዛዜ ጊዜው አልፎበታል። አሁን ምን ላድርግ?" },
          a: { en: "The payment did not arrive within {hours} hours, so the items were released. Place the order again. If you already paid, contact us with your receipt.", am: "ክፍያው በ{hours} ሰዓታት ውስጥ ስላልደረሰ ዕቃዎቹ ተለቀዋል። እንደገና ያዝዙ። አስቀድመው ከፍለው ከሆነ ከደረሰኝዎ ጋር ያግኙን።" } },
        { q: { en: "Is my information safe?", am: "መረጃዬ ደህንነቱ የተጠበቀ ነው?" },
          a: { en: "Yes. Receipts and documents are stored privately and only our staff can see them. Read our Privacy policy for details.", am: "አዎ። ደረሰኞች እና ሰነዶች በግል ይቀመጣሉ፣ ሊያያቸው የሚችሉት ሰራተኞቻችን ብቻ ናቸው። ለዝርዝሩ የግላዊነት ፖሊሲያችንን ያንብቡ።" } },
      ] },
    ],
    links: [{ href: "/privacy", label: { en: "Privacy policy", am: "የግላዊነት ፖሊሲ" } }],
  },
];
