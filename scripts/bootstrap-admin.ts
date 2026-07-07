import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { transaction } from '../server/database.js';

type AdminRole = 'administrator' | 'finance' | 'operation';

function hashAdminPassword(password: string, salt = randomBytes(16).toString('hex')) {
  const derivedKey = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derivedKey}`;
}

async function main() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  const role = (String(process.env.ADMIN_ROLE || 'administrator') || 'administrator') as AdminRole;

  if (!email || !password) {
    throw new Error('Configure ADMIN_EMAIL e ADMIN_PASSWORD antes de executar o bootstrap.');
  }

  if (!['administrator', 'finance', 'operation'].includes(role)) {
    throw new Error('ADMIN_ROLE invalido.');
  }

  await transaction((database) => {
    const now = new Date().toISOString();
    const passwordHash = hashAdminPassword(password);
    const existingUser = database.adminUsers.find((item) => item.email === email);

    if (existingUser) {
      existingUser.passwordHash = passwordHash;
      existingUser.role = role;
      existingUser.updatedAt = now;
      existingUser.disabledAt = null;
      return;
    }

    database.adminUsers.push({
      id: randomUUID(),
      email,
      passwordHash,
      role,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      disabledAt: null,
    });
  }, { scope: 'admin-auth' });

  console.log(`Admin user ensured in database: ${email}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
