import { bindImageZoom } from './imageZoom.js';
import { languageReady, t } from '../shared/i18n.js';

const api = window.api;
const image = document.getElementById('preview-image');
const close = () => api.dockAction('close');
const [attachment] = await Promise.all([api.getImagePreview(), languageReady]);

if (!attachment) {
  close();
} else {
  bindImageZoom(document);
  image.alt = attachment.name;
  image.src = 'eventdock-attachment://image/' + attachment.id;

  document.getElementById('preview-close').addEventListener('click', close);
  document.getElementById('preview-viewport').addEventListener('click', event => {
    if (event.target !== image) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
  document.getElementById('preview-copy').addEventListener('click', async () => {
    const copied = await api.eventAttachment(null, 'copy', attachment.id).catch(() => false);
    document.getElementById('preview-status').textContent = t(copied ? 'dockImageCopied' : 'dockAttachmentFailed');
  });
}
