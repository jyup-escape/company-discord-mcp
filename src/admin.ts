import { z } from 'zod';
import { readConfig } from './config.js';
import { Store, type User } from './store.js';
import type { Grant } from './auth.js';

const config = readConfig();
const [command, id] = process.argv.slice(2);
const store = new Store(config.DATABASE_PATH, config.DATABASE_KEY);
try {
  if (command === 'users') console.table(store.list<User>('users').map(r => r.value));
  else if (command === 'audit') console.table(store.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all());
  else if (['disable', 'enable', 'revoke'].includes(command ?? '')) {
    z.string().regex(/^\d{17,20}$/).parse(id);
    const userId = id!;
    store.transaction(() => {
      const user = store.get<User>('users', userId) ?? { id: userId, name: '(未登録)', disabled: false };
      if (command !== 'revoke') store.set('users', userId, { ...user, disabled: command === 'disable' });
      if (command !== 'enable') for (const grant of store.list<Grant>('grants')) {
        if (grant.value.userId === userId) store.set('grants', grant.id, { ...grant.value, revoked: true }, grant.value.expires);
      }
      store.audit(userId, `admin_${command}`, 'success');
    });
    console.log(`${command}: ${userId}`);
  } else {
    console.error('Usage: npm run admin -- users | audit | disable USER_ID | enable USER_ID | revoke USER_ID');
    process.exitCode = 1;
  }
} finally { store.close(); }
