import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const source = resolve(process.env.DATABASE_FILE || 'data/funpace-db.json');
const backupDir = resolve(process.env.BACKUP_DIR || 'backups');

if (!existsSync(source)) {
  console.error(`Database file not found: ${source}`);
  process.exit(1);
}

mkdirSync(backupDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = resolve(backupDir, `${timestamp}-${basename(source)}`);

copyFileSync(source, target);
console.log(`Backup created: ${target}`);
