'use client';

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { cleanHtml, safeLinkUrl, textToHtml } from './rich-text';

type Mark = 'bold' | 'italic' | 'underline' | 'strike';
type Block = 'ul' | 'ol' | 'blockquote';
const MARKS: Record<Mark, { tag: string; match: string[]; command: string }> = {
  bold: { tag: 'strong', match: ['strong', 'b'], command: 'bold' },
  italic: { tag: 'em', match: ['em', 'i'], command: 'italic' },
  underline: { tag: 'u', match: ['u'], command: 'underline' },
  strike: { tag: 's', match: ['s', 'strike', 'del'], command: 'strikeThrough' },
};
const INLINE = ['strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'a', 'code', 'span', 'font'];

/** execCommand chỉ dùng khi trình duyệt hỗ trợ (jsdom không có); còn lại dùng cài đặt DOM nhỏ bên dưới. */
function canExec(command: string) {
  try { return typeof document.execCommand === 'function' && !!document.queryCommandSupported?.(command); } catch { return false; }
}
function closestIn(node: Node | null, names: string[], root: HTMLElement): HTMLElement | null {
  for (let cur = node; cur && cur !== root; cur = cur.parentNode) {
    if (cur.nodeType === Node.ELEMENT_NODE && names.includes((cur as Element).tagName.toLowerCase())) return cur as HTMLElement;
  }
  return null;
}
function unwrap(element: Element) {
  const parent = element.parentNode; if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
}
function selectContents(node: Node) {
  const selection = window.getSelection(); if (!selection) return;
  const range = document.createRange(); range.selectNodeContents(node);
  selection.removeAllRanges(); selection.addRange(range);
}

type Tool = { key: string; label: string; shortcut?: string; icon: ReactNode; run: () => void };

export function RichTextEditor({ value, onChange, onError, label, placeholder }: {
  value: string; onChange: (html: string) => void; onError: (message: string) => void; label: string; placeholder?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const lastRange = useRef<Range | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  // Nội dung chỉ được ghi từ ngoài vào khi khác DOM hiện tại (mở nháp, chuyển tiếp, gửi xong), nên con trỏ không nhảy khi gõ.
  useEffect(() => { if (root.current && root.current.innerHTML !== value) root.current.innerHTML = value; }, [value]);

  const emit = () => { if (root.current) onChange(root.current.innerHTML); };
  const remember = () => {
    const selection = window.getSelection();
    if (root.current && selection?.rangeCount && root.current.contains(selection.getRangeAt(0).commonAncestorContainer)) lastRange.current = selection.getRangeAt(0).cloneRange();
  };
  /** Vùng chọn hiện tại trong editor; khi focus đã sang thanh công cụ thì khôi phục vùng chọn cuối. */
  const currentRange = () => {
    const editor = root.current, selection = window.getSelection();
    if (!editor || !selection) return null;
    if (selection.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)) return selection.getRangeAt(0);
    if (lastRange.current && editor.contains(lastRange.current.commonAncestorContainer)) { selection.removeAllRanges(); selection.addRange(lastRange.current); return selection.getRangeAt(0); }
    const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
    selection.removeAllRanges(); selection.addRange(range); return range;
  };

  function applyMark(mark: Mark) {
    const editor = root.current, range = currentRange(); if (!editor || !range) return;
    const spec = MARKS[mark], existing = closestIn(range.commonAncestorContainer, spec.match, editor);
    if (range.collapsed) {
      // Con trỏ chưa chọn chữ: để trình duyệt bật kiểu gõ tiếp theo.
      if (canExec(spec.command)) document.execCommand(spec.command);
      else if (existing) unwrap(existing);
    } else if (existing) {
      unwrap(existing);
    } else {
      const element = document.createElement(spec.tag);
      element.appendChild(range.extractContents());
      element.querySelectorAll(spec.match.join(',')).forEach(unwrap);
      range.insertNode(element);
      selectContents(element);
    }
    remember(); emit();
  }

  function applyBlock(kind: Block) {
    const editor = root.current, range = currentRange(); if (!editor || !range) return;
    const existing = closestIn(range.commonAncestorContainer, [kind], editor);
    if (canExec(kind === 'blockquote' ? 'formatBlock' : kind === 'ul' ? 'insertUnorderedList' : 'insertOrderedList')) {
      if (kind === 'blockquote') document.execCommand('formatBlock', false, existing ? 'div' : 'blockquote');
      else document.execCommand(kind === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
      remember(); emit(); return;
    }
    if (existing) {
      if (kind !== 'blockquote') existing.querySelectorAll(':scope > li').forEach((li) => { const div = document.createElement('div'); while (li.firstChild) div.appendChild(li.firstChild); li.replaceWith(div); });
      unwrap(existing); remember(); emit(); return;
    }
    let blocks = Array.from(editor.childNodes).filter((node) => range.intersectsNode(node));
    if (!blocks.length) { const div = document.createElement('div'); div.appendChild(document.createElement('br')); editor.appendChild(div); blocks = [div]; }
    const wrapper = document.createElement(kind);
    editor.insertBefore(wrapper, blocks[0]);
    for (const block of blocks) {
      if (kind === 'blockquote') { wrapper.appendChild(block); continue; }
      const li = document.createElement('li');
      if (block.nodeType === Node.ELEMENT_NODE && ['div', 'p'].includes((block as Element).tagName.toLowerCase())) { while (block.firstChild) li.appendChild(block.firstChild); block.parentNode?.removeChild(block); }
      else li.appendChild(block);
      wrapper.appendChild(li);
    }
    selectContents(wrapper); remember(); emit();
  }

  function insertLink() {
    const editor = root.current, saved = currentRange()?.cloneRange(); if (!editor || !saved) return;
    const input = window.prompt('Địa chỉ liên kết (http://, https:// hoặc mailto:)', 'https://');
    if (input === null || input === undefined) return;
    const href = safeLinkUrl(input);
    if (!href) { onError('Liên kết chỉ nhận địa chỉ http://, https:// hoặc mailto:.'); return; }
    const selection = window.getSelection(); if (!selection) return;
    selection.removeAllRanges(); selection.addRange(saved);
    const anchor = document.createElement('a');
    anchor.setAttribute('href', href); anchor.setAttribute('rel', 'noopener noreferrer'); anchor.setAttribute('target', '_blank');
    if (saved.collapsed) anchor.textContent = href.replace(/^mailto:/, '');
    else { anchor.appendChild(saved.extractContents()); anchor.querySelectorAll('a').forEach(unwrap); }
    saved.insertNode(anchor);
    selectContents(anchor); remember(); emit();
  }

  function clearFormatting() {
    const editor = root.current, range = currentRange(); if (!editor || !range) return;
    if (canExec('removeFormat')) { document.execCommand('removeFormat'); document.execCommand('unlink'); remember(); emit(); return; }
    for (let inline = closestIn(range.commonAncestorContainer, INLINE, editor); inline; inline = closestIn(range.commonAncestorContainer, INLINE, editor)) unwrap(inline);
    if (!range.collapsed) {
      const text = document.createTextNode(range.toString());
      range.deleteContents(); range.insertNode(text); selectContents(text);
    }
    remember(); emit();
  }

  const tools: Tool[] = [
    { key: 'bold', label: 'Đậm', shortcut: 'Ctrl+B', icon: <strong>B</strong>, run: () => applyMark('bold') },
    { key: 'italic', label: 'Nghiêng', shortcut: 'Ctrl+I', icon: <em>I</em>, run: () => applyMark('italic') },
    { key: 'underline', label: 'Gạch dưới', shortcut: 'Ctrl+U', icon: <u>U</u>, run: () => applyMark('underline') },
    { key: 'strike', label: 'Gạch ngang', icon: <s>S</s>, run: () => applyMark('strike') },
    { key: 'ul', label: 'Danh sách dấu đầu dòng', icon: <svg className="mail-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>, run: () => applyBlock('ul') },
    { key: 'ol', label: 'Danh sách đánh số', icon: <svg className="mail-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 5h1.5v4M3.5 9h3M3.5 14.5a1.5 1.5 0 0 1 3 .5L3.5 19h3"/></svg>, run: () => applyBlock('ol') },
    { key: 'quote', label: 'Trích dẫn', icon: <svg className="mail-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17h3l2-4V7H5v6h3zM14 17h3l2-4V7h-6v6h3z"/></svg>, run: () => applyBlock('blockquote') },
    { key: 'link', label: 'Chèn liên kết', icon: <svg className="mail-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>, run: insertLink },
    { key: 'clear', label: 'Xoá định dạng', icon: <svg className="mail-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V4h16v3M9 20h6M12 4l-3 16"/><path d="m15 15 6 6M21 15l-6 6"/></svg>, run: clearFormatting },
  ];

  function onEditorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const mark = ({ b: 'bold', i: 'italic', u: 'underline' } as Record<string, Mark>)[event.key.toLowerCase()];
    if (mark) { event.preventDefault(); applyMark(mark); }
  }
  /** Dán: chỉ giữ HTML trong allowlist (bỏ style, ảnh, script…) hoặc văn bản thuần. */
  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    const range = currentRange(); if (!range) return;
    event.preventDefault();
    const html = event.clipboardData.getData('text/html'), text = event.clipboardData.getData('text/plain');
    const fragment = range.createContextualFragment(html ? cleanHtml(html) : textToHtml(text));
    const last = fragment.lastChild;
    range.deleteContents(); range.insertNode(fragment);
    if (last) { range.setStartAfter(last); range.collapse(true); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); }
    remember(); emit();
  }
  /** Thanh công cụ một điểm Tab (roving tabindex), di chuyển bằng mũi tên/Home/End. */
  function onToolbarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: buttons.length - 1 }[event.key];
    if (next === undefined || index < 0) return;
    event.preventDefault();
    const target = (next + buttons.length) % buttons.length;
    setFocusIndex(target); buttons[target].focus();
  }

  return <div className="mail-editor-wrap">
    <div className="mail-editor-toolbar" role="toolbar" aria-label="Định dạng nội dung" onKeyDown={onToolbarKeyDown}>
      {tools.map((tool, index) => <button key={tool.key} type="button" className="mail-editor-tool" aria-label={tool.label}
        title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label} tabIndex={index === focusIndex ? 0 : -1}
        onMouseDown={(event) => event.preventDefault()} onFocus={() => setFocusIndex(index)} onClick={tool.run}>{tool.icon}</button>)}
    </div>
    <div ref={root} className="mail-editor" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={label}
      data-placeholder={placeholder} tabIndex={0} onInput={() => { remember(); emit(); }} onKeyDown={onEditorKeyDown}
      onKeyUp={remember} onMouseUp={remember} onBlur={remember} onPaste={onPaste}/>
  </div>;
}
