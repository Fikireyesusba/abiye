/**
 * Default (fallback) legal content — the live text is edited in
 * /admin/settings → Legal and stored in website_settings.legal.
 * Format: "## Heading" lines start a section; other lines are plain text.
 *
 * DRAFT legal content (English + Amharic). Must be reviewed by the business
 * owner / a legal advisor before launch. {name} is replaced with the business name.
 */
export interface LegalSection {
  heading: string;
  body: string;
}

export const privacy: Record<"en" | "am", LegalSection[]> = {
  en: [
    { heading: "What we collect", body: "When you order, we collect your name, phone number, delivery city and address, delivery instructions, the products you order, your bank transaction reference and the payment receipt you upload. For printing services we also store the documents you upload." },
    { heading: "Why we use it", body: "We use this information only to process, verify, deliver and support your orders, and to contact you about them. We do not sell your information or use it for third-party advertising." },
    { heading: "Payment receipts and documents", body: "Receipts and printing documents are stored privately. Only authorized {name} staff can open them. Printing documents are deleted automatically as soon as the prints are collected, or at the latest after the retention period shown on the printing page. Copies of payment receipts are kept by {name} for its accounting records." },
    { heading: "Who can see your data", body: "Only staff who need it for your order. Our hosting providers (Vercel and Supabase) store data on our behalf under their security terms. Order notifications are sent to a private staff Telegram chat." },
    { heading: "Your choices", body: "You may ask us to correct or delete your information by contacting us, unless we must keep it to meet legal or accounting obligations." },
    { heading: "Contact", body: "For privacy questions, contact {name} using the details on our Contact page." },
  ],
  am: [
    { heading: "የምንሰበስበው መረጃ", body: "ሲያዝዙ ስምዎን፣ ስልክ ቁጥርዎን፣ የማድረሻ ከተማና አድራሻዎን፣ የማድረሻ መመሪያዎን፣ ያዘዟቸውን ምርቶች፣ የባንክ ግብይት ማጣቀሻ ቁጥርዎን እና የሚጭኑትን የክፍያ ደረሰኝ እንሰበስባለን። ለህትመት አገልግሎት የሚጭኗቸውን ሰነዶችም እናስቀምጣለን።" },
    { heading: "ለምን እንጠቀምበታለን", body: "ይህን መረጃ የምንጠቀመው ትዕዛዝዎን ለማስኬድ፣ ለማረጋገጥ፣ ለማድረስ እና ለመደገፍ እንዲሁም ስለ ትዕዛዝዎ ለማግኘትዎ ብቻ ነው። መረጃዎን አንሸጥም ወይም ለሶስተኛ ወገን ማስታወቂያ አንጠቀምበትም።" },
    { heading: "የክፍያ ደረሰኞች እና ሰነዶች", body: "ደረሰኞች እና የህትመት ሰነዶች በግል ይቀመጣሉ። ሊከፍቷቸው የሚችሉት የተፈቀደላቸው የ{name} ሰራተኞች ብቻ ናቸው። የህትመት ሰነዶች ህትመቶቹ እንደተወሰዱ ወዲያውኑ፣ ወይም ቢዘገይ በህትመት ገጹ ላይ ከተገለጸው የማቆያ ጊዜ በኋላ በራስ-ሰር ይሰረዛሉ። የክፍያ ደረሰኞች ቅጂዎች ለሂሳብ መዝገብ በ{name} ይቀመጣሉ።" },
    { heading: "መረጃዎን ማን ሊያይ ይችላል", body: "ለትዕዛዝዎ የሚያስፈልጋቸው ሰራተኞች ብቻ። የማስተናገጃ አቅራቢዎቻችን (Vercel እና Supabase) በደህንነት ውሎቻቸው መሰረት መረጃን በእኛ ስም ያከማቻሉ። የትዕዛዝ ማሳወቂያዎች ወደ የግል የሰራተኞች ቴሌግራም ቡድን ይላካሉ።" },
    { heading: "የእርስዎ ምርጫዎች", body: "በህግ ወይም በሂሳብ ግዴታ ምክንያት ማቆየት ካላስፈለገን በስተቀር መረጃዎን እንድናስተካክል ወይም እንድንሰርዝ እኛን በማግኘት መጠየቅ ይችላሉ።" },
    { heading: "ያግኙን", body: "ለግላዊነት ጥያቄዎች በ«ያግኙን» ገጻችን ላይ ባሉት አድራሻዎች {name}ን ያግኙ።" },
  ],
};

export const terms: Record<"en" | "am", LegalSection[]> = {
  en: [
    { heading: "Orders", body: "Placing an order reserves the items for the payment window shown at checkout. If payment is not submitted in time, the order expires and the items are released." },
    { heading: "Prices", body: "All prices are in Ethiopian Birr (ETB). The price confirmed at checkout is the price you pay, even if our prices change later." },
    { heading: "Payment", body: "We accept bank transfer to the account shown at checkout. Your order is confirmed only after our team verifies the transfer in our bank account. A receipt image alone is not proof of payment. If a payment cannot be verified it is rejected and the order is cancelled automatically; you are welcome to place a new order." },
    { heading: "Delivery and pickup", body: "Delivery fees depend on your city and are shown before you order. Delivery times are estimates. Pickup orders can be collected at our shop once marked ready." },
    { heading: "Printing services", body: "Printing prices are calculated from page count, copies, paper size, color and sides. Where we cannot count pages automatically, we send a quote before you pay. You are responsible for having the right to print the documents you upload." },
    { heading: "Cancellations and returns", body: "Contact us as soon as possible to cancel. Items must be returned unused and in original packaging, unless faulty. Hygiene-sensitive cosmetics cannot be returned once opened. Refunds for verified payments are made by bank transfer." },
    { heading: "Contact", body: "Questions about these terms: contact {name} using the details on our Contact page." },
  ],
  am: [
    { heading: "ትዕዛዞች", body: "ትዕዛዝ ማስገባት ዕቃዎቹን በክፍያ ጊዜ ውስጥ ለእርስዎ ይይዛል። ክፍያ በጊዜው ካልገባ ትዕዛዙ ጊዜው ያልፍበታል እና ዕቃዎቹ ይለቀቃሉ።" },
    { heading: "ዋጋዎች", body: "ሁሉም ዋጋዎች በኢትዮጵያ ብር ናቸው። በክፍያ ጊዜ የተረጋገጠው ዋጋ ዋጋችን ቢቀየርም የሚከፍሉት ዋጋ ነው።" },
    { heading: "ክፍያ", body: "በክፍያ ጊዜ ወደሚታየው ሂሳብ የሚደረግ የባንክ ዝውውር እንቀበላለን። ትዕዛዝዎ የሚረጋገጠው ቡድናችን ዝውውሩን በባንክ ሂሳባችን ካረጋገጠ በኋላ ብቻ ነው። የደረሰኝ ምስል ብቻውን የክፍያ ማረጋገጫ አይደለም። ሊረጋገጥ የማይችል ክፍያ ውድቅ ይደረጋል፤ ትዕዛዙም በራሱ ይሰረዛል። አዲስ ትዕዛዝ ማዘዝ ይችላሉ።" },
    { heading: "ማድረስ እና መውሰድ", body: "የማድረሻ ክፍያ በከተማዎ ላይ የተመሰረተ ሲሆን ከማዘዝዎ በፊት ይታያል። የማድረሻ ጊዜዎች ግምቶች ናቸው። የመውሰጃ ትዕዛዞች ዝግጁ ከተባሉ በኋላ ከሱቃችን ሊወሰዱ ይችላሉ።" },
    { heading: "የህትመት አገልግሎቶች", body: "የህትመት ዋጋ በገጽ ብዛት፣ በቅጂ፣ በወረቀት መጠን፣ በቀለም እና በገጽ ይሰላል። ገጾችን በራስ-ሰር መቁጠር በማንችልበት ጊዜ ከክፍያ በፊት የዋጋ ግምት እንልካለን። የሚጭኗቸውን ሰነዶች የማሳተም መብት እንዳለዎት ማረጋገጥ የእርስዎ ኃላፊነት ነው።" },
    { heading: "ስረዛ እና መመለስ", body: "ለመሰረዝ በተቻለ ፍጥነት ያግኙን። ዕቃዎች ጉድለት ከሌለባቸው በስተቀር ያልተጠቀሙባቸው እና በመጀመሪያ ማሸጊያቸው መመለስ አለባቸው። ለንጽህና ስሜታዊ የሆኑ የውበት ምርቶች ከተከፈቱ በኋላ መመለስ አይችሉም። ለተረጋገጡ ክፍያዎች ተመላሽ በባንክ ዝውውር ይደረጋል።" },
    { heading: "ያግኙን", body: "ስለ እነዚህ ውሎች ጥያቄዎች ካሉዎት በ«ያግኙን» ገጻችን ላይ ባሉት አድራሻዎች {name}ን ያግኙ።" },
  ],
};

export function toLegalText(sections: LegalSection[]): string {
  return sections.map((x) => `## ${x.heading}\n\n${x.body}`).join("\n\n");
}

/** Parse the admin-edited text into headings + paragraphs. Rendered as plain text (no HTML). */
export function parseLegalText(text: string): { heading: string | null; paragraphs: string[] }[] {
  const sections: { heading: string | null; paragraphs: string[] }[] = [];
  let current: { heading: string | null; paragraphs: string[] } = { heading: null, paragraphs: [] };
  for (const block of text.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("## ")) {
      if (current.heading !== null || current.paragraphs.length) sections.push(current);
      const [first, ...rest] = trimmed.split("\n");
      current = { heading: first.slice(3).trim(), paragraphs: rest.length ? [rest.join("\n")] : [] };
    } else current.paragraphs.push(trimmed);
  }
  if (current.heading !== null || current.paragraphs.length) sections.push(current);
  return sections;
}
