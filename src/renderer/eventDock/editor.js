import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';

export function createEditor(element, onUpdate, onImage) {
  function insertFiles(files) {
    const images = Array.from(files || []).filter(file => file.type.startsWith('image/'));
    if (!editor.isEditable || !images.length) return false;
    void onImage(images);
    return true;
  }

  const editor = new Editor({
    element,
    injectCSS: false,
    editable: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: false } }),
      Image.configure({
        allowBase64: false,
        resize: { enabled: true, directions: ['bottom-right'], minWidth: 24, minHeight: 24, alwaysPreserveAspectRatio: true },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit,
    ],
    editorProps: {
      handlePaste: (_view, event) => insertFiles(event.clipboardData?.files),
      handleDrop: (_view, event) => insertFiles(event.dataTransfer?.files),
    },
    onUpdate,
  });
  return editor;
}
