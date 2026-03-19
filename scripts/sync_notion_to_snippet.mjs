import { getConfig, syncByDate, validateConfig } from "./notion_snippet_sync_core.mjs";

async function main() {
  const cfg = getConfig();
  validateConfig(cfg);

  const result = await syncByDate(cfg, cfg.NOTION_TARGET_DATE);
  console.log("Synced selected Notion DB page to Snippet successfully.");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
