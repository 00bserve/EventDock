import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import initSqlJs from 'sql.js';

const require = createRequire(import.meta.url);
const emptyDocument = { type: 'doc', content: [{ type: 'paragraph' }] };
export const maxAttachmentBytes = 25 * 1024 * 1024;

const imageFormats = [
  { mime: 'image/png', extension: 'png', matches: b => b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
  { mime: 'image/jpeg', extension: 'jpg', matches: b => b.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) },
  { mime: 'image/gif', extension: 'gif', matches: b => /^(GIF87a|GIF89a)$/.test(b.toString('ascii', 0, 6)) },
  { mime: 'image/webp', extension: 'webp', matches: b => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

export async function openEventStore(directory) {
  const data = join(directory, 'data');
  const assets = join(directory, 'attachments');
  const database = join(data, 'events.db');
  const temporary = database + '.tmp';
  mkdirSync(data, { recursive: true });
  mkdirSync(assets, { recursive: true });

  const SQL = await initSqlJs({ wasmBinary: readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm')) });
  let db = new SQL.Database(existsSync(database) ? readFileSync(database) : undefined);

  function rows(sql, parameters = []) {
    const statement = db.prepare(sql);
    try {
      statement.bind(parameters);
      const result = [];
      while (statement.step()) result.push(statement.getAsObject());
      return result;
    } finally {
      statement.free();
    }
  }

  function persist() {
    writeFileSync(temporary, db.export(), { flush: true });
    renameSync(temporary, database);
    // sql.js resets database pragmas when exporting the file.
    db.run('PRAGMA foreign_keys = ON');
  }

  function change(operation) {
    db.run('BEGIN');
    try {
      const result = operation();
      db.run('COMMIT');
      persist();
      return result;
    } catch (error) {
      // Restore the last durable snapshot, including after a failed file replacement.
      db.close();
      db = new SQL.Database(existsSync(database) ? readFileSync(database) : undefined);
      db.run('PRAGMA foreign_keys = ON');
      throw error;
    }
  }

  const version = rows('PRAGMA user_version')[0].user_version;
  if (version > 2) throw new Error('Event database format is newer than this version.');
  db.run('PRAGMA foreign_keys = ON');
  if (version === 0) {
    change(() => db.run(`
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        plainText TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        eventTime INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        draft INTEGER NOT NULL DEFAULT 1,
        deletedAt INTEGER
      );
      CREATE INDEX event_time ON events(eventTime DESC);
      CREATE TABLE attachments (
        id TEXT PRIMARY KEY,
        eventId TEXT NOT NULL REFERENCES events(id),
        name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL
      );
      CREATE INDEX attachments_event ON attachments(eventId);
      PRAGMA user_version = 1;
    `));
  }

  if (version < 2) {
    change(() => db.run('ALTER TABLE events ADD COLUMN completedAt INTEGER; PRAGMA user_version = 2;'));
  }

  function get(id) {
    const event = rows('SELECT * FROM events WHERE id = ? AND deletedAt IS NULL', [id])[0];
    if (!event) return null;
    return {
      ...event,
      content: JSON.parse(event.content),
      tags: JSON.parse(event.tags),
      attachments: rows('SELECT id, name, mime, size FROM attachments WHERE eventId = ? ORDER BY rowid', [id]),
    };
  }

  function getAttachment(id) {
    const attachment = rows(`
      SELECT a.* FROM attachments a JOIN events e ON e.id = a.eventId
      WHERE a.id = ? AND e.deletedAt IS NULL
    `, [id])[0];
    return attachment ? { ...attachment, file: join(assets, attachment.id) } : null;
  }

  return {
    list() {
      return rows(`
        SELECT id, title, substr(plainText, 1, 160) AS summary, tags, eventTime, archived, draft, completedAt,
          EXISTS(SELECT 1 FROM attachments WHERE eventId = events.id) AS attachment
        FROM events WHERE deletedAt IS NULL ORDER BY eventTime DESC, createdAt DESC
      `).map(event => ({ ...event, tags: JSON.parse(event.tags) }));
    },
    get,
    create() {
      const id = randomUUID();
      const now = Date.now();
      change(() => db.run(
        'INSERT INTO events (id, content, eventTime, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
        [id, JSON.stringify(emptyDocument), now, now, now],
      ));
      return id;
    },
    save(id, record) {
      change(() => db.run(`
        UPDATE events SET title = ?, content = ?, plainText = ?, tags = ?, eventTime = ?,
          updatedAt = ?, draft = ?
        WHERE id = ? AND deletedAt IS NULL
      `, [record.title, JSON.stringify(record.content), record.plainText, JSON.stringify(record.tags),
        record.eventTime, Date.now(), Number(record.draft), id]));
    },
    toggleComplete(id) {
      const now = Date.now();
      change(() => db.run(
        'UPDATE events SET completedAt = CASE WHEN completedAt IS NULL THEN ? ELSE NULL END, updatedAt = ? WHERE id = ? AND deletedAt IS NULL',
        [now, now, id],
      ));
    },
    archive(id, archived) {
      change(() => db.run('UPDATE events SET archived = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL',
        [Number(archived), Date.now(), id]));
    },
    remove(id) {
      const now = Date.now();
      change(() => db.run('UPDATE events SET deletedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL',
        [now, now, id]));
    },
    getAttachment,
    addAttachment(eventId, name, bytes, inline) {
      if (!bytes.length || bytes.length > maxAttachmentBytes) throw new Error('Invalid attachment size');
      const format = imageFormats.find(candidate => candidate.matches(bytes));
      if (inline && !format) throw new Error('Unsupported inline image');
      const id = randomUUID();
      const mime = format?.mime ?? 'application/octet-stream';
      const safeName = (name || ('image.' + format?.extension)).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180);
      const file = join(assets, id);
      writeFileSync(file, bytes, { flag: 'wx', flush: true });
      try {
        change(() => db.run('INSERT INTO attachments VALUES (?, ?, ?, ?, ?)',
          [id, eventId, safeName, mime, bytes.length]));
      } catch (error) {
        rmSync(file, { force: true });
        throw error;
      }
      return { id, name: safeName, mime, size: bytes.length };
    },
    removeAttachment(eventId, id) {
      const attachment = getAttachment(id);
      if (!attachment || attachment.eventId !== eventId) return false;
      const event = get(eventId);
      function withoutImage(node) {
        if (node.content) node.content = node.content
          .filter(child => child.type !== 'image' || child.attrs?.src !== 'eventdock-attachment://image/' + id)
          .map(withoutImage);
        return node;
      }
      const content = withoutImage(event.content);
      if (!content.content.length) content.content.push({ type: 'paragraph' });
      change(() => {
        db.run('UPDATE events SET content = ?, updatedAt = ? WHERE id = ?',
          [JSON.stringify(content), Date.now(), eventId]);
        db.run('DELETE FROM attachments WHERE id = ?', [id]);
      });
      try { rmSync(attachment.file, { force: true }); } catch (error) {
        console.warn('[EventDock] Could not remove unreferenced attachment:', error.message);
      }
      return true;
    },
  };
}
