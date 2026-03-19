const notionVersion = "2022-06-28";

export function getConfig() {
  return {
    NOTION_TOKEN:
      process.env.NOTION_TOKEN || "",
    NOTION_DATABASE_ID:
      process.env.NOTION_DATABASE_ID || "327262742fd7808b927ec3f886452404",
    NOTION_DATE_PROPERTY: process.env.NOTION_DATE_PROPERTY || "",
    NOTION_TARGET_DATE: process.env.NOTION_TARGET_DATE || getKstDate(),
    SNIPPET_API_URL: process.env.SNIPPET_API_URL || "https://api.1000.school/daily-snippets",
    SNIPPET_API_TOKEN:
      process.env.SNIPPET_API_TOKEN || "",
    SNIPPET_API_METHOD: (process.env.SNIPPET_API_METHOD || "POST").toUpperCase(),
  };
}

export function validateConfig(cfg) {
  if (!cfg.NOTION_TOKEN) throw new Error("Missing NOTION_TOKEN");
  if (!cfg.NOTION_DATABASE_ID) throw new Error("Missing NOTION_DATABASE_ID");
  if (!cfg.SNIPPET_API_URL) throw new Error("Missing SNIPPET_API_URL");
  if (!cfg.SNIPPET_API_TOKEN) throw new Error("Missing SNIPPET_API_TOKEN");
}

function getKstDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function normalizeId(raw) {
  return String(raw || "").replace(/-/g, "");
}

export async function notionRequest(cfg, endpoint, method = "GET", body) {
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.NOTION_TOKEN}`,
      "Notion-Version": notionVersion,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API error ${res.status}: ${text}`);
  }
  return res.json();
}

function richTextToPlain(richText = []) {
  return richText.map((rt) => rt.plain_text || "").join("");
}

function propertyValueToText(prop) {
  if (!prop) return "";
  if (prop.type === "title") return richTextToPlain(prop.title);
  if (prop.type === "rich_text") return richTextToPlain(prop.rich_text);
  if (prop.type === "date") return prop.date?.start || "";
  return "";
}

function detectTitlePropertyName(row) {
  if (!row?.properties) return null;
  for (const [name, prop] of Object.entries(row.properties)) {
    if (prop?.type === "title") return name;
  }
  return null;
}

function detectDatePropertyName(row) {
  if (!row?.properties) return null;
  for (const [name, prop] of Object.entries(row.properties)) {
    if (prop?.type === "date") return name;
  }
  return null;
}

async function queryDatabaseAll(cfg, databaseId) {
  let cursor;
  const all = [];
  do {
    const body = cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 };
    const data = await notionRequest(cfg, `/databases/${databaseId}/query`, "POST", body);
    all.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return all;
}

async function getAllChildren(cfg, blockId) {
  let cursor;
  const all = [];
  do {
    const query = cursor ? `?start_cursor=${cursor}` : "";
    const data = await notionRequest(cfg, `/blocks/${blockId}/children${query}`);
    all.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return all;
}

function richTextToMarkdown(richText = []) {
  return richText
    .map((rt) => {
      let text = rt.plain_text || "";
      const href = rt.href;
      const ann = rt.annotations || {};
      if (ann.code) text = `\`${text}\``;
      if (ann.bold) text = `**${text}**`;
      if (ann.italic) text = `*${text}*`;
      if (ann.strikethrough) text = `~~${text}~~`;
      if (href) text = `[${text}](${href})`;
      return text;
    })
    .join("");
}

function getBlockText(block, key) {
  return richTextToMarkdown(block[key]?.rich_text || []);
}

function codeFenceLanguage(block) {
  const lang = block.code?.language || "";
  return lang === "plain text" ? "" : lang;
}

function blockToMarkdown(block, indent = 0) {
  const pad = "  ".repeat(indent);
  switch (block.type) {
    case "paragraph": {
      const text = getBlockText(block, "paragraph");
      return text ? `${pad}${text}\n` : "\n";
    }
    case "heading_1":
      return `${pad}# ${getBlockText(block, "heading_1")}\n`;
    case "heading_2":
      return `${pad}## ${getBlockText(block, "heading_2")}\n`;
    case "heading_3":
      return `${pad}### ${getBlockText(block, "heading_3")}\n`;
    case "bulleted_list_item":
      return `${pad}- ${getBlockText(block, "bulleted_list_item")}\n`;
    case "numbered_list_item":
      return `${pad}1. ${getBlockText(block, "numbered_list_item")}\n`;
    case "to_do": {
      const checked = block.to_do?.checked ? "x" : " ";
      return `${pad}- [${checked}] ${getBlockText(block, "to_do")}\n`;
    }
    case "quote":
      return `${pad}> ${getBlockText(block, "quote")}\n`;
    case "divider":
      return `${pad}---\n`;
    case "code": {
      const lang = codeFenceLanguage(block);
      const text = getBlockText(block, "code");
      return `${pad}\`\`\`${lang}\n${text}\n\`\`\`\n`;
    }
    case "callout":
      return `${pad}> ${getBlockText(block, "callout")}\n`;
    default:
      return "";
  }
}

async function renderBlocks(cfg, blocks, indent = 0) {
  let markdown = "";
  for (const block of blocks) {
    markdown += blockToMarkdown(block, indent);
    if (block.has_children) {
      const children = await getAllChildren(cfg, block.id);
      markdown += await renderBlocks(cfg, children, indent + 1);
    }
    if (!markdown.endsWith("\n\n")) markdown += "\n";
  }
  return markdown.trim();
}

async function pushToSnippetApi(cfg, content) {
  const res = await fetch(cfg.SNIPPET_API_URL, {
    method: cfg.SNIPPET_API_METHOD,
    headers: {
      Authorization: `Bearer ${cfg.SNIPPET_API_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ content }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Snippet API error ${res.status}: ${text}`);

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function buildContentFromPage(cfg, row) {
  const titleProp = detectTitlePropertyName(row);
  const rowTitle = titleProp ? propertyValueToText(row.properties?.[titleProp]) : "";
  const blocks = await getAllChildren(cfg, row.id);
  const body = await renderBlocks(cfg, blocks);
  return rowTitle ? `# ${rowTitle}\n\n${body}` : body;
}

export async function syncByDate(cfg, targetDate = cfg.NOTION_TARGET_DATE) {
  const allRows = await queryDatabaseAll(cfg, normalizeId(cfg.NOTION_DATABASE_ID));
  if (!allRows.length) throw new Error("No rows found in database.");

  const datePropName = cfg.NOTION_DATE_PROPERTY || detectDatePropertyName(allRows[0]);
  if (!datePropName) throw new Error("Could not detect date property. Set NOTION_DATE_PROPERTY.");

  const rows = allRows.filter((row) => {
    const raw = propertyValueToText(row.properties?.[datePropName]);
    return raw && raw.slice(0, 10) === targetDate;
  });
  if (!rows.length) {
    throw new Error(
      `No database row found. date property='${datePropName}', target='${targetDate}'`
    );
  }

  const content = await buildContentFromPage(cfg, rows[0]);
  return pushToSnippetApi(cfg, content || "(empty)");
}

export async function syncByPageId(cfg, pageId) {
  const page = await notionRequest(cfg, `/pages/${normalizeId(pageId)}`);
  const parentDbId = normalizeId(page.parent?.database_id);
  if (parentDbId !== normalizeId(cfg.NOTION_DATABASE_ID)) {
    throw new Error("Ignoring event: page is not in NOTION_DATABASE_ID.");
  }
  const content = await buildContentFromPage(cfg, page);
  return pushToSnippetApi(cfg, content || "(empty)");
}

