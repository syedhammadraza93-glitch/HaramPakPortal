import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Link2, List, ListOrdered, RemoveFormatting, Underline } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

const prefix = "rich-note:v1:";
const formatting = { b: "strong", strong: "strong", i: "em", em: "em", u: "u", ul: "ul", ol: "ol", li: "li" } as const;

function formatTag(name: string) {
  return Object.hasOwn(formatting, name) ? formatting[name as keyof typeof formatting] : undefined;
}

const colors = ["#0f172a", "#b91c1c", "#166534", "#1d4ed8", "#7e22ce"];
const sizes = ["small", "medium", "large", "x-large", "xx-large"];

function safeLink(value: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function encode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  if (!(node instanceof HTMLElement)) return "";
  const name = node.localName;
  if (name === "br") return "<br>";
  const children = Array.from(node.childNodes, encode).join("");
  const tag = formatTag(name);
  if (tag) return `<${tag}>${children}</${tag}>`;
  if (name === "a") {
    const href = safeLink(node.getAttribute("href"));
    return href ? `<a href="${href.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">${children}</a>` : children;
  }
  if (name === "font") {
    const color = node.getAttribute("color");
    const size = node.getAttribute("size");
    return `<font${color && colors.includes(color) ? ` color="${color}"` : ""}${size && /^[2-6]$/.test(size) ? ` size="${size}"` : ""}>${children}</font>`;
  }
  if (name === "div" || name === "p") {
    const align = node.getAttribute("align") || node.style.textAlign;
    return `<div${/^(left|center|right)$/.test(align) ? ` align="${align}"` : ""}>${children}</div>`;
  }
  return children;
}

export function NoteDetails({ value }: { value: string }) {
  if (!value.startsWith(prefix)) return <p className="whitespace-pre-wrap break-words">{value}</p>;

  const template = document.createElement("template");
  template.innerHTML = value.slice(prefix.length);

  function render(node: Node, key: number): ReactNode {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof HTMLElement)) return null;
    const children = Array.from(node.childNodes, render);
    const name = node.localName;
    const Tag = formatTag(name);
    if (Tag) return <Tag key={key}>{children}</Tag>;
    if (name === "br") return <br key={key} />;
    if (name === "div") {
      const align = node.getAttribute("align");
      return <div key={key} style={{ textAlign: align === "left" || align === "center" || align === "right" ? align : undefined }}>{children}</div>;
    }
    if (name === "a") {
      const href = safeLink(node.getAttribute("href"));
      return href ? <a key={key} href={href} className="underline" target="_blank" rel="noopener noreferrer">{children}</a> : children;
    }
    if (name === "font") {
      const color = node.getAttribute("color");
      const size = Number(node.getAttribute("size"));
      return <span key={key} style={{ color: color && colors.includes(color) ? color : undefined, fontSize: sizes[size - 2] }}>{children}</span>;
    }
    return null;
  }

  return <div className="whitespace-pre-wrap break-words [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ms-5">{Array.from(template.content.childNodes, render)}</div>;
}

export function InitialNotes() {
  const editor = useRef<HTMLDivElement>(null);
  const selection = useRef<Range | null>(null);
  const [value, setValue] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState(false);

  function sync() {
    const field = editor.current;
    if (!field) return;
    const plainText = field.innerText.trim();
    if (!plainText) return setValue("");
    const markup = Array.from(field.childNodes, encode).join("");
    setValue(/<(?:strong|em|u|ul|ol|li|a|font)\b|<div align=/.test(markup) || plainText.startsWith(prefix) ? prefix + markup : plainText);
  }

  function rememberSelection() {
    const current = window.getSelection();
    if (current?.rangeCount && editor.current?.contains(current.anchorNode) && editor.current.contains(current.focusNode)) {
      selection.current = current.getRangeAt(0).cloneRange();
    }
  }

  function applyFormat(command: string, argument?: string) {
    editor.current?.focus();
    if (selection.current) {
      const current = window.getSelection();
      current?.removeAllRanges();
      current?.addRange(selection.current);
    }
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(command, false, argument);
    rememberSelection();
    sync();
  }

  return (
    <div className="space-y-1">
      <div id="initial-notes-label" className="text-sm font-medium">Initial notes</div>
      <div className="rounded-md border bg-white">
        <div role="group" aria-label="Note formatting" className="flex flex-wrap items-center gap-1 border-b bg-slate-50 p-1">
          <select aria-label="Text size" defaultValue="" onChange={event => {
            applyFormat("fontSize", event.currentTarget.value);
            event.currentTarget.value = "";
          }} className="rounded border bg-white px-2 py-1 text-xs">
            <option value="" disabled>Text size</option>
            {["Small", "Normal", "Large", "Extra large", "Huge"].map((label, index) => <option key={label} value={index + 2}>{label}</option>)}
          </select>
          {([
            ["bold", "Bold", Bold], ["italic", "Italic", Italic], ["underline", "Underline", Underline],
            ["justifyLeft", "Align left", AlignLeft], ["justifyCenter", "Align center", AlignCenter], ["justifyRight", "Align right", AlignRight],
            ["insertUnorderedList", "Bulleted list", List], ["insertOrderedList", "Numbered list", ListOrdered],
            ["removeFormat", "Clear text formatting", RemoveFormatting],
          ] as const).map(([command, label, Icon]) => (
            <button key={command} type="button" title={label} aria-label={label} onMouseDown={event => event.preventDefault()}
              onClick={() => applyFormat(command)} className="rounded p-2 hover:bg-slate-200">
              <Icon size={16} aria-hidden="true" />
            </button>
          ))}
          <select aria-label="Text color" defaultValue="" onChange={event => {
            applyFormat("foreColor", event.currentTarget.value);
            event.currentTarget.value = "";
          }} className="rounded border bg-white px-2 py-1 text-xs">
            <option value="" disabled>Text color</option>
            {["Black", "Red", "Green", "Blue", "Purple"].map((label, index) => <option key={label} value={colors[index]}>{label}</option>)}
          </select>
          <button type="button" title="Add link to selected text" aria-label="Add link to selected text"
            aria-expanded={linkOpen} onMouseDown={event => event.preventDefault()}
            onClick={() => { setLinkOpen(open => !open); setLinkError(false); }} className="rounded p-2 hover:bg-slate-200">
            <Link2 size={16} aria-hidden="true" />
          </button>
        </div>
        {linkOpen && <div className="flex flex-wrap items-center gap-2 border-b p-2">
          <input autoFocus aria-label="Web address" placeholder="https://example.com" value={link}
            onChange={event => setLink(event.target.value)} className="min-w-0 flex-1 rounded border p-2 text-sm" />
          <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => {
            const href = safeLink(link.trim());
            if (!href || !selection.current || selection.current.collapsed) return setLinkError(true);
            applyFormat("createLink", href);
            setLink("");
            setLinkOpen(false);
          }}>Apply link</button>
          {linkError && <p role="alert" className="w-full text-xs text-red-700">Select note text and enter a valid web address beginning with https:// or http://.</p>}
        </div>}
        <div ref={editor} contentEditable role="textbox" aria-multiline="true" aria-labelledby="initial-notes-label"
          aria-describedby="initial-notes-limit" aria-invalid={value.length > 1500}
          className="min-h-24 whitespace-pre-wrap break-words p-2 text-sm [&_a]:underline [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ms-5"
          onInput={sync} onSelect={rememberSelection} onBlur={rememberSelection}
          onPaste={event => {
            event.preventDefault();
            document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
            sync();
          }}
          onDrop={event => event.preventDefault()} />
      </div>
      <input type="hidden" name="note" value={value} />
      <p id="initial-notes-limit" className="text-xs text-slate-600">Up to 1,500 characters, including formatting.</p>
    </div>
  );
}
