const zoomStep = 1.25;
const maxScale = 8;

export function bindImageZoom(root) {
  const viewport = root.querySelector('#preview-viewport');
  const image = root.querySelector('#preview-image');
  const zoomIn = root.querySelector('#preview-zoom-in');
  const zoomOut = root.querySelector('#preview-zoom-out');
  let scale = 1;
  let fitting = true;

  function fitScale() {
    return Math.min(1, (viewport.offsetWidth - 1) / image.naturalWidth,
      (viewport.offsetHeight - 1) / image.naturalHeight);
  }

  function applyScale(value, pointer) {
    if (!image.naturalWidth || viewport.clientWidth < 2 || viewport.clientHeight < 2) return;
    const minimum = Math.min(fitScale(), 0.05);
    const frame = viewport.getBoundingClientRect();
    const x = pointer?.clientX ?? frame.left + viewport.clientWidth / 2;
    const y = pointer?.clientY ?? frame.top + viewport.clientHeight / 2;
    const before = image.getBoundingClientRect();
    scale = Math.min(maxScale, Math.max(minimum, value));
    image.style.width = image.naturalWidth * scale + 'px';
    if (fitting) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    } else if (before.width && before.height) {
      const after = image.getBoundingClientRect();
      viewport.scrollLeft += after.left + (x - before.left) / before.width * after.width - x;
      viewport.scrollTop += after.top + (y - before.top) / before.height * after.height - y;
    }
    image.toggleAttribute('data-zoomed', scale > fitScale() + 0.001);
    zoomOut.disabled = scale <= minimum;
    zoomIn.disabled = scale >= maxScale;
  }

  function fit() {
    fitting = true;
    applyScale(fitScale());
  }

  function step(direction, pointer) {
    fitting = false;
    applyScale(scale * zoomStep ** direction, pointer);
  }

  image.addEventListener('load', fit);
  zoomIn.addEventListener('click', () => step(1));
  zoomOut.addEventListener('click', () => step(-1));
  root.querySelector('#preview-fit').addEventListener('click', fit);
  image.addEventListener('click', event => {
    if (image.hasAttribute('data-zoomed')) fit();
    else step(2, event);
  });
  viewport.addEventListener('wheel', event => {
    if (!event.deltaY) return;
    event.preventDefault();
    step(event.deltaY < 0 ? 1 : -1, event);
  }, { passive: false });
  new ResizeObserver(() => {
    if (fitting) fit();
  }).observe(viewport);

  return { fit };
}
