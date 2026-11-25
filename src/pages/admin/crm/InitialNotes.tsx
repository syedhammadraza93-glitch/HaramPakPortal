import { useRef, useState, type ReactNode } from "react";

const prefix = "rich-note:v1:";
const formatting = { b: "strong", strong: "strong", i: "em", em: "em", u: "u" } as const;

function formatTag(name: string) {
  return Object.hasOwn(formatting, name) ? formatting[name as keyof typeof formatting] : undefined;
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
  return name === "div" || name === "p" ? `<div>${children}</div>` : children;
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
    if (name === "div") return <div key={key}>{children}</div>;
    return null;
  }

  return <div className="whitespace-pre-wrap break-words">{Array.from(template.content.childNodes, render)}</div>;
}

export function InitialNotes() {
  const editor = useRef<HTMLDivElement>(null);
  const selection = useRef<Range | null>(null);
  const [value, setValue] = useState("");

  function sync() {
    const field = editor.current;
    if (!field) return;
    const plainText = field.innerText.trim();
    if (!plainText) return setValue("");
    const markup = Array.from(field.childNodes, encode).join("");
    setValue(/<(strong|em|u)>/.test(markup) || plainText.startsWith(prefix) ? prefix + markup : plainText);
  }

  function rememberSelection() {
    const current = window.getSelection();
    if (current?.rangeCount && editor.current?.contains(current.anchorNode) && editor.current.contains(current.focusNode)) {
      selection.current = current.getRangeAt(0).cloneRange();
    }
  }

  function applyFormat(command: string) {
    editor.current?.focus();
    if (selection.current) {
      const current = window.getSelection();
      current?.removeAllRanges();
      current?.addRange(selection.current);
    }
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(command);
    rememberSelection();
    sync();
  }

  return (
    <div className="space-y-1">
      <div id="initial-notes-label" className="text-sm font-medium">Initial notes</div>
      <div className="rounded-md border bg-white">
        <div role="group" aria-label="Note formatting" className="flex flex-wrap gap-1 border-b bg-slate-50 p-1">
          {["bold", "italic", "underline"].map(command => (
            <button key={command} type="button" onMouseDown={event => event.preventDefault()}
              onClick={() => applyFormat(command)} className="rounded px-3 py-2 text-sm capitalize hover:bg-slate-200">
              {command}
            </button>
          ))}
        </div>
        <div ref={editor} contentEditable role="textbox" aria-multiline="true" aria-labelledby="initial-notes-label"
          aria-describedby="initial-notes-limit" aria-invalid={value.length > 1500}
          className="min-h-24 whitespace-pre-wrap break-words p-2 text-sm"
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
