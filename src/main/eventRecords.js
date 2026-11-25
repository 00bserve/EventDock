import { clipboard, dialog, nativeImage, protocol } from 'electron';
import { readFile, stat, copyFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { maxAttachmentBytes } from './eventStore.js';
import { t } from './i18n.js';

const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const contentTypes = new Set([
  'doc', 'paragraph', 'text', 'heading', 'blockquote', 'bulletList',
  'orderedList', 'listItem', 'codeBlock', 'horizontalRule', 'hardBreak', 'image',
  'taskList', 'taskItem', 'table', 'tableRow', 'tableCell', 'tableHeader',
]);
const markTypes = new Set(['bold', 'italic', 'strike', 'underline', 'code', 'link']);

function normalizeRecord(value, previous) {
  if (!value || typeof value.title !== 'string' || !Array.isArray(value.tags) ||
      !Number.isSafeInteger(value.eventTime) || value.eventTime < 0 ||
      value.eventTime > 253402300799999 || value.content?.type !== 'doc' ||
      JSON.stringify(value.content).length > 1_000_000) {
    throw new Error('Invalid event');
  }

  const imageSources = new Set(previous.attachments.filter(a => a.mime.startsWith('image/'))
    .map(a => 'eventdock-attachment://image/' + a.id));

  function node(input, depth = 0) {
    if (depth > 40 || !contentTypes.has(input?.type)) throw new Error('Invalid editor node');
    const out = { type: input.type };
    if (input.type === 'text') {
      if (typeof input.text !== 'string' || !input.text.length) throw new Error('Invalid editor text');
      out.text = input.text;
    }
    if (input.type === 'image') {
      if (!imageSources.has(input.attrs?.src)) throw new Error('Invalid editor image');
      out.attrs = { src: input.attrs.src, alt: String(input.attrs.alt ?? '').slice(0, 180) };
      for (const dimension of ['width', 'height']) {
        const size = input.attrs?.[dimension];
        if (Number.isFinite(size) && size > 0 && size <= 8192) out.attrs[dimension] = Math.round(size);
      }
    }
    if (input.type === 'heading') out.attrs = { level: Math.max(1, Math.min(6, Math.trunc(input.attrs?.level) || 1)) };
    if (input.type === 'orderedList') out.attrs = { start: Math.max(1, Math.trunc(input.attrs?.start) || 1) };
    if (input.type === 'taskItem') out.attrs = { checked: input.attrs?.checked === true };
    if (input.type === 'tableCell' || input.type === 'tableHeader') {
      out.attrs = {
        colspan: Math.max(1, Math.min(100, Math.trunc(input.attrs?.colspan) || 1)),
        rowspan: Math.max(1, Math.min(100, Math.trunc(input.attrs?.rowspan) || 1)),
        colwidth: Array.isArray(input.attrs?.colwidth) ? input.attrs.colwidth.slice(0, 100)
          .map(width => Math.max(0, Math.min(1000, Math.trunc(width) || 0))) : null,
      };
    }
    if (Array.isArray(input.marks)) {
      out.marks = input.marks.filter(mark => markTypes.has(mark?.type)).flatMap(mark => {
        if (mark.type !== 'link') return [{ type: mark.type }];
        const href = mark.attrs?.href;
        return typeof href === 'string' && /^(https?:\/\/|mailto:)/i.test(href)
          ? [{ type: 'link', attrs: { href: href.slice(0, 2048) } }] : [];
      });
    }
    if (Array.isArray(input.content)) out.content = input.content.map(child => node(child, depth + 1));
    return out;
  }

  function plainText(node) {
    if (node.type === 'text') return node.text;
    if (node.type === 'hardBreak') return '\n';
    const separator = ['paragraph', 'heading', 'codeBlock'].includes(node.type) ? '' : '\n';
    return (node.content || []).map(plainText).join(separator);
  }

  const content = node(value.content);
  if (!content.content?.length) content.content = [{ type: 'paragraph' }];
  return {
    title: value.title.trim().slice(0, 200),
    content,
    plainText: plainText(content).trim().slice(0, 100_000),
    tags: [...new Set(value.tags.filter(tag => typeof tag === 'string')
      .map(tag => tag.trim().slice(0, 30)).filter(Boolean))].slice(0, 12),
    eventTime: value.eventTime,
    draft: previous.draft && !value.finish,
  };
}

export function registerAttachmentProtocol(store) {
  protocol.handle('eventdock-attachment', async request => {
    const url = new URL(request.url);
    const id = url.pathname.slice(1);
    const attachment = url.hostname === 'image' && identifier.test(id) && store.getAttachment(id);
    if (!attachment?.mime.startsWith('image/')) return new Response(null, { status: 404 });
    try {
      return new Response(await readFile(attachment.file), {
        headers: { 'Content-Type': attachment.mime, 'X-Content-Type-Options': 'nosniff' },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

export function createEventRecords({ store, publish, getDetail, getSelected }) {
  let pending;
  let timer;

  function feedback(id, revision, saved) {
    const win = getDetail();
    if (win && !win.isDestroyed()) {
      win.webContents.send('event-dock:save-result', { id, revision, saved });
    }
  }

  function flush() {
    clearTimeout(timer);
    if (!pending) return true;

    const { id, revision, record } = pending;
    try {
      store.save(id, record);
    } catch (error) {
      console.error('[EventDock] Could not save event:', error);
      feedback(id, revision, false);
      return false;
    }
    pending = undefined;
    feedback(id, revision, true);
    publish();
    return true;
  }

  function stage(id, revision, value) {
    if (id !== getSelected() || !Number.isSafeInteger(revision)) return;
    try {
      const previous = store.get(id);
      if (!previous) return;
      const record = normalizeRecord(value, previous);
      // A later keystroke must not undo explicit completion before the timer fires.
      if (pending?.id === id && !pending.record.draft) record.draft = false;
      pending = { id, revision, record };
      clearTimeout(timer);
      if (value.finish) flush();
      else timer = setTimeout(flush, 300);
    } catch (error) {
      console.error('[EventDock] Invalid edit:', error);
      feedback(id, revision, false);
    }
  }

  async function attach(id, bytes) {
    if (getSelected() !== id || !flush() || !store.get(id)) return null;
    if (bytes instanceof ArrayBuffer) {
      if (bytes.byteLength > maxAttachmentBytes) throw new Error('Image exceeds size limit');
      const image = store.addAttachment(id, '', Buffer.from(bytes), true);
      publish();
      return image;
    }
    if (bytes !== undefined) return null;
    const win = getDetail();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'] });
    if (canceled || getSelected() !== id || !flush() || !store.get(id)) return null;
    const file = filePaths[0];
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > maxAttachmentBytes) throw new Error('Invalid attachment size');
    const content = await readFile(file);
    if (getSelected() !== id || !store.get(id)) return null;
    const attachment = store.addAttachment(id, basename(file), content, false);
    publish();
    return attachment;
  }

  async function exportAttachment(id, attachmentId) {
    if (id !== getSelected() || !identifier.test(attachmentId)) return false;
    const attachment = store.getAttachment(attachmentId);
    if (attachment?.eventId !== id) return false;
    const win = getDetail();
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: attachment.name });
    if (canceled || !filePath) return false;
    await copyFile(attachment.file, filePath);
    return true;
  }

  async function copyImage(id, attachmentId) {
    if (id !== getSelected() || !identifier.test(attachmentId)) return false;
    const attachment = store.getAttachment(attachmentId);
    if (attachment?.eventId !== id || !attachment.mime.startsWith('image/')) return false;
    const image = nativeImage.createFromBuffer(await readFile(attachment.file));
    if (image.isEmpty()) return false;
    clipboard.writeImage(image);
    return true;
  }

  async function remove(id) {
    const current = () => id === getSelected() && store.get(id);
    if (!current() || !flush()) return false;
    const options = {
      type: 'warning',
      message: t('dockDeleteConfirm'),
      buttons: [t('cancel'), t('delete')],
      defaultId: 0,
      cancelId: 0,
    };
    const answer = await dialog.showMessageBox(getDetail(), options);
    if (answer.response !== 1 || !current() || !flush()) return false;
    store.remove(id);
    return true;
  }

  return { stage, flush, attach, exportAttachment, copyImage, remove };
}
