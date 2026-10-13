import { fileURLToPath } from 'node:url'
import { createApp } from './app.ts'
import { configWarnings, loadConfig, loadDotEnv } from './config.ts'
import { openDb, pruneExpired } from './db/db.ts'
import { createMailer } from './mail/mailer.ts'
import { createProviders } from './providers.ts'

loadDotEnv()
// keys.env: a visible file for API keys (Finder hides .env files)
loadDotEnv(fileURLToPath(new URL('../keys.env', import.meta.url)))
const cfg = loadConfig()
const db = openDb(cfg.dbPath)
const app = createApp(cfg, db, createMailer(cfg), createProviders(cfg, db))

for (const w of configWarnings(cfg)) console.warn(`⚠ ${w}`)
pruneExpired(db)
setInterval(() => pruneExpired(db), 3600_000).unref()

app.server.listen(cfg.port, cfg.host, () => {
  console.log(`Capsight API on http://${cfg.host}:${cfg.port}  (web app: ${cfg.appUrl})`)
  console.log(`LLM: en=${cfg.llm.en.provider}:${cfg.llm.en.model}  zh=${cfg.llm.zh.provider}:${cfg.llm.zh.model}`)
})

const stop = () => {
  app.server.close(() => {
    db.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 5000).unref()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
