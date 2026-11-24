import { t } from '../shared/i18n.js';

const { createEditor } = await import(await window.api.getEditorUrl());

const maxImageBytes = 25 * 1024 * 1024;
const imageUrl = id => 'eventdock-attachment://image/' + id;

function localDateTime(timestamp) {
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function createRecordView(api, formatDate) {
  const byId = id => document.getElementById(id);
  const editorHost = byId('event-content');
  const title = byId('edit-title');
  const time = byId('edit-time');
  const tags = byId('edit-tags');
  const detail = document.querySelector('.detail');
  const more = document.querySelector('.record-more');
  const toolbar = byId('editor-tools');
  const linkForm = byId('link-form');
  const linkAddress = byId('link-address');
  const editor = createEditor(editorHost, () => save(), insertImages);
  let wanted;
  let record;
  let editing = false;
  let revision = 0;
  let finishing;
  let previewRevision;
  let previewing = false;
  let tagValues = [];
  let status;
  let busy = false;

  function message(key) {
    status = key;
    const output = byId('save-status');
    output.textContent = key ? t(key) : '';
    output.dataset.saved = String(key === 'dockSaved');
  }

  function setEditing(value) {
    editing = value;
    detail.dataset.editorMode = value ? 'editing' : previewing ? 'preview' : 'reading';
    const mode = byId('detail-mode');
    mode.dataset.i18n = value ? 'dockEditContent' : previewing ? 'dockPreview' : 'dockDetail';
    mode.textContent = t(mode.dataset.i18n);
    const edit = byId('record-edit');
    edit.dataset.i18n = previewing ? 'dockBackToEditor' : 'edit';
    edit.textContent = t(edit.dataset.i18n);
    byId('record-preview').hidden = !value;
    if (record) api.dockAction('editing', { id: record.id, active: value });
    editor.setEditable(value, false);
    byId('record-fields').hidden = !value;
    byId('record-heading').hidden = value;
    toolbar.hidden = !value;
    linkForm.hidden = true;
    linkAddress.value = '';
    byId('record-edit').hidden = value;
    byId('record-save').hidden = !value;
    byId('record-attach').hidden = !value;
    renderAttachments();
    refreshToolbar();
  }

  function setContent(next) {
    record = next;
    title.value = next.title;
    time.value = localDateTime(next.eventTime);
    tagValues = [...next.tags];
    tags.value = '';
    renderTagEditor();
    editor.commands.setContent(next.content, { emitUpdate: false });
  }

  function currentTags() {
    return [...new Set([...tagValues, ...tags.value.split(/[,，]/)]
      .map(tag => tag.trim().slice(0, 30)).filter(Boolean))].slice(0, 12);
  }

  function renderTagEditor() {
    const list = byId('edit-tag-list');
    const chips = tagValues.map(value => {
      const chip = document.createElement('span');
      chip.className = 'tag tag-edit';
      chip.append(document.createTextNode(value));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', t('delete') + ' ' + value);
      remove.addEventListener('click', () => {
        tagValues = tagValues.filter(tag => tag !== value);
        renderTagEditor();
        tags.focus();
        save();
      });
      chip.append(remove);
      return chip;
    });
    list.replaceChildren(...chips);
  }

  function commitTags() {
    if (!tags.value.trim()) return;
    tagValues = currentTags();
    tags.value = '';
    renderTagEditor();
    save();
  }

  function describe() {
    if (!record) return;
    title.setAttribute('aria-label', t('dockTitleField'));
    byId('event-title').textContent = record.title || record.plainText.split('\n')[0].slice(0, 80) || t('dockUntitled');
    byId('event-time').textContent = formatDate(record, true);
    byId('event-time').dateTime = new Date(record.eventTime).toISOString();
    byId('event-tags').replaceChildren(...record.tags.map(tag => {
      const chip = document.createElement('span');
      chip.className = 'tag';
      chip.textContent = tag;
      return chip;
    }));
    byId('record-archive').textContent = t(record.archived ? 'dockRestoreEvent' : 'dockArchiveEvent');
    if (status) message(status);
    renderAttachments();
  }

  async function update(id, startEditing, summary) {
    if (!id) return;
    if (id === wanted) {
      if (record && summary) record.archived = summary.archived;
      describe();
      return;
    }
    wanted = id;
    record = null;
    finishing = undefined;
    previewRevision = undefined;
    previewing = false;
    more.open = false;
    message(null);
    const next = await api.getEventRecord(id);
    if (!next || wanted !== id) return;
    setContent(next);
    setEditing(startEditing);
    describe();
    if (startEditing) title.focus();
  }

  function save(finish = false, preview = false) {
    if (!record || !editing) return;
    const eventTime = time.value === localDateTime(record.eventTime)
      ? record.eventTime : new Date(time.value).getTime();
    if (!Number.isFinite(eventTime) || eventTime < 0) {
      message('dockInvalidTime');
      return;
    }
    message('dockSaving');
    const current = ++revision;
    if (finish) finishing = current;
    if (preview) previewRevision = current;
    api.stageEvent(record.id, current, {
      title: title.value,
      content: editor.getJSON(),
      tags: currentTags(),
      eventTime,
      finish,
    });
  }

  api.onEventSaved(async result => {
    if (result.id !== record?.id || result.revision !== revision) return;
    if (!result.saved) {
      message('dockSaveFailed');
      return;
    }
    message('dockSaved');
    if (finishing === result.revision || previewRevision === result.revision) {
      const next = await api.getEventRecord(result.id);
      if (!next || record?.id !== result.id || revision !== result.revision) return;
      previewing = previewRevision === result.revision;
      previewRevision = undefined;
      finishing = undefined;
      setContent(next);
      setEditing(false);
      describe();
    }
  });

  async function withAttachment(action, value) {
    if (!record || busy) return;
    const id = record.id;
    busy = true;
    try {
      const result = await api.eventAttachment(id, action, value);
      if (!result || record?.id !== id) return;
      if (action === 'add') record.attachments.push(result);
      if (action === 'remove') setContent(result);
      renderAttachments();
      return result;
    } catch (error) {
      console.error(error);
      message('dockAttachmentFailed');
    } finally {
      busy = false;
    }
  }

  async function insertImages(files) {
    const id = record?.id;
    for (const file of files) {
      if (record?.id !== id || !editing) return;
      if (file.size > maxImageBytes) {
        message('dockAttachmentFailed');
        continue;
      }
      const attachment = await withAttachment('add', await file.arrayBuffer());
      if (attachment && record?.id === id && editing) {
        editor.chain().focus().setImage({ src: imageUrl(attachment.id), alt: attachment.name }).run();
      }
    }
  }

  function renderAttachments() {
    if (!record) return;
    const cards = record.attachments.map(attachment => {
      const card = document.createElement('div');
      card.className = 'attachment-card';
      if (attachment.mime.startsWith('image/')) {
        const image = document.createElement('img');
        image.src = imageUrl(attachment.id);
        image.alt = attachment.name;
        image.loading = 'lazy';
        const thumbnail = document.createElement('button');
        thumbnail.type = 'button';
        thumbnail.className = 'attachment-preview';
        thumbnail.append(image);
        thumbnail.addEventListener('click', () => openPreview(attachment));
        card.append(thumbnail);
      }
      const details = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = attachment.name;
      const size = document.createElement('small');
      size.textContent = new Intl.NumberFormat(document.documentElement.lang, {
        style: 'unit', unit: 'kilobyte', maximumFractionDigits: 1,
      }).format(attachment.size / 1024);
      details.append(name, size);
      card.append(details);
      for (const [action, key] of [['export', 'dockExportAttachment'], ['remove', 'delete']]) {
        if (action === 'remove' && !editing) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'record-button';
        button.textContent = t(key);
        button.addEventListener('click', () => void withAttachment(action, attachment.id));
        card.append(button);
      }
      return card;
    });
    byId('attachment-list').replaceChildren(...cards);
    byId('attachments').hidden = !cards.length;
  }

  function openPreview(attachment) {
    api.dockAction('preview', attachment.id);
  }

  editorHost.addEventListener('click', event => {
    if (editing || event.target.tagName !== 'IMG') return;
    const attachment = record?.attachments.find(item => imageUrl(item.id) === event.target.src);
    if (attachment) openPreview(attachment);
  });
  tags.addEventListener('keydown', event => {
    if (event.isComposing || !['Enter', ',', '，'].includes(event.key)) return;
    event.preventDefault();
    commitTags();
  });
  tags.addEventListener('blur', commitTags);
  document.addEventListener('click', event => {
    if (more.open && !more.contains(event.target)) more.open = false;
  });

  for (const field of [title, time, tags]) field.addEventListener('input', () => save());
  byId('record-preview').addEventListener('click', () => save(false, true));
  byId('record-edit').addEventListener('click', () => {
    previewing = false;
    setEditing(true);
    title.focus();
  });
  byId('record-save').addEventListener('click', () => save(true));
  byId('record-attach').addEventListener('click', () => void withAttachment('add'));
  byId('record-delete').addEventListener('click', () => manage('remove'));
  byId('record-archive').addEventListener('click', () => manage(record?.archived ? 'restore' : 'archive'));
  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's' || !editing) return;
    event.preventDefault();
    save(true);
  });
  function refreshToolbar() {
    const formats = {
      bold: 'bold', italic: 'italic', underline: 'underline', ordered: 'orderedList',
      task: 'taskList', list: 'bulletList', heading: 'heading', quote: 'blockquote', code: 'codeBlock',
      link: 'link',
    };
    for (const [command, format] of Object.entries(formats)) {
      toolbar.querySelector('[data-command="' + command + '"]')
        .setAttribute('aria-pressed', String(editor.isActive(format)));
    }
    toolbar.querySelector('[data-command="undo"]').disabled = !editor.can().undo();
    toolbar.querySelector('[data-command="redo"]').disabled = !editor.can().redo();
  }

  editor.on('transaction', refreshToolbar);
  toolbar.addEventListener('mousedown', event => {
    if (event.target.closest('[data-command]')) event.preventDefault();
  });
  toolbar.addEventListener('click', event => {
    const command = event.target.closest('[data-command]')?.dataset.command;
    if (command === 'undo') editor.chain().focus().undo().run();
    if (command === 'redo') editor.chain().focus().redo().run();
    if (command === 'bold') editor.chain().focus().toggleBold().run();
    if (command === 'italic') editor.chain().focus().toggleItalic().run();
    if (command === 'underline') editor.chain().focus().toggleUnderline().run();
    if (command === 'ordered') editor.chain().focus().toggleOrderedList().run();
    if (command === 'task') editor.chain().focus().toggleTaskList().run();
    if (command === 'table') {
      if (editor.state.selection.node?.type.name === 'image') editor.commands.createParagraphNear();
      editor.chain().focus().insertTable({ rows: 3, cols: 3 }).run();
    }
    if (command === 'link') {
      linkForm.hidden = !linkForm.hidden;
      if (!linkForm.hidden) linkAddress.focus();
    }
    if (command === 'list') editor.chain().focus().toggleBulletList().run();
    if (command === 'heading') editor.chain().focus().toggleHeading({ level: 2 }).run();
    if (command === 'quote') editor.chain().focus().toggleBlockquote().run();
    if (command === 'code') editor.chain().focus().toggleCodeBlock().run();
  });

  linkForm.addEventListener('submit', event => {
    event.preventDefault();
    const address = linkAddress.value.trim();
    if (!/^(https?:\/\/|mailto:)/i.test(address)) {
      linkAddress.setCustomValidity('https://');
      linkAddress.reportValidity();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: address }).run();
    linkForm.hidden = true;
    linkAddress.value = '';
  });
  linkAddress.addEventListener('input', () => linkAddress.setCustomValidity(''));

  async function manage(action) {
    if (!record || busy) return;
    more.open = false;
    try {
      await api.manageEvent(record.id, action);
    } catch (error) {
      console.error(error);
      message('dockSaveFailed');
    }
  }

  return { update };
}
