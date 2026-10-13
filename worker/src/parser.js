// Разбор страницы публичного канала t.me/s/<канал>.
// Товар — пост со строкой «Price:». Пост «SOLD» отмечает проданный товар,
// на него ссылается блок ответа (tgme_widget_message_reply).
// Используются только публичные данные страницы.

const CHANNEL = "Yorisell";
const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}‍️⃣]/gu;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return String.fromCodePoint(value);
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function collapse(text) {
  return text.replace(/\s+/g, " ").trim();
}

// Текст без эмодзи и лишних пробелов.
function plain(text) {
  return collapse(text.replace(EMOJI_RE, ""));
}

function htmlToText(html) {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(withBreaks);
}

function parseMessage(postId, block) {
  const publishedAt = /<time datetime="([^"]+)"/.exec(block)?.[1] ?? null;
  const viewsMatch = /class="tgme_widget_message_views">(\d+)</.exec(block);
  const replyMatch = /tgme_widget_message_reply[^"]*" href="https:\/\/t\.me\/Yorisell\/(\d+)"/.exec(block);
  const photos = [
    ...block.matchAll(/<a class="tgme_widget_message_photo_wrap[^"]*"[^>]*background-image:url\('([^']+)'\)/g),
  ].map((m) => m[1]);

  // Собственный текст поста: от его начала до реакций или футера. Цитата ответа сюда не входит.
  let ownHtml = "";
  const textOpen = /<div[^>]*class="tgme_widget_message_text js-message_text"[^>]*>/.exec(block);
  if (textOpen) {
    const rest = block.slice(textOpen.index + textOpen[0].length);
    const end = rest.search(/class="tgme_widget_message_(reactions|footer)/);
    // Обрезаем до открывающего «<» тега реакций, чтобы не осталось обрывка тега.
    ownHtml = end >= 0 ? rest.slice(0, rest.lastIndexOf("<", end)) : rest;
  }

  const quoteMatch = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/i.exec(ownHtml);
  const quote = quoteMatch ? plain(htmlToText(quoteMatch[1])) : "";
  const lines = htmlToText(ownHtml.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, ""))
    .split("\n")
    .map(collapse)
    .filter(Boolean);
  const flat = lines.join("\n");

  const isSold = /\bSOLD\b/i.test(flat);
  const priceMatch = /Price:\s*(\d[\d. ]*\d|\d)/i.exec(flat);
  const priceRub = priceMatch ? Number(priceMatch[1].replace(/[. ]/g, "")) : null;
  const isListing = priceRub !== null;

  let title = null;
  let condition = null;
  let size = null;
  let sizeNote = null;
  let fit = null;
  let description = null;

  if (isListing) {
    title = plain(flat.split(/\s*-?\s*(?:Condition|Size|Price):/i)[0]) || null;

    const conditionMatch = /Condition:\s*(.*?)(?=\s+-\s*(?:Size|Price):|\n|$)/i.exec(flat);
    condition = conditionMatch ? plain(conditionMatch[1]) || null : null;

    const sizeMatch = /Size:\s*(.*?)(?=\s+-\s*(?:Price|Condition):|\n|$)/i.exec(flat);
    if (sizeMatch) {
      const raw = plain(sizeMatch[1]);
      const parts = /^(.*?)\s*\((.*)\)$/.exec(raw);
      size = plain(parts ? parts[1] : raw) || null;
      const inner = parts ? plain(parts[2]) : "";
      const fitMatch = /^Fit\s*(.*)$/i.exec(inner);
      if (fitMatch) fit = fitMatch[1].replace(/\s*,\s*/g, ", ").trim() || null;
      else sizeNote = inner || null;
    }

    // Описание — цитата. Если её нет, берём текст после цены до служебных строк.
    description = quote;
    if (!description) {
      const after = flat.slice(priceMatch.index + priceMatch[0].length);
      description = plain(after.split(/🚚|Личная встреча|Замеры\/вопросы|Связь:/)[0]);
    }
  }

  return {
    postId,
    url: `https://t.me/${CHANNEL}/${postId}`,
    publishedAt,
    views: viewsMatch ? Number(viewsMatch[1]) : null,
    photos,
    kind: isListing ? "listing" : isSold ? "sold" : "other",
    isSold,
    replyToPostId: replyMatch ? Number(replyMatch[1]) : null,
    title,
    condition,
    size,
    sizeNote,
    fit,
    priceRub,
    description: description || null,
  };
}

// Возвращает посты страницы в порядке страницы: { postId, kind, title, priceRub, photos, ... }.
export function parseChannelPage(html) {
  const starts = [...html.matchAll(/data-post="Yorisell\/(\d+)"/g)];
  return starts.map((match, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].index : html.length;
    return parseMessage(Number(match[1]), html.slice(match.index, end));
  });
}
