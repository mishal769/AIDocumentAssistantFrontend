import { useEffect, useRef, useState } from "react";
import "./App.css";

// Change this if your backend runs somewhere other than localhost:8000
const API_BASE = "https://illustrious-generosity-production-1820.up.railway.app";

// A fresh id per browser TAB (sessionStorage is unique per tab and is
// cleared when the tab closes — unlike localStorage, which would be shared
// across tabs). The backend uses this to keep each tab's uploaded
// documents — and its 5-document limit — separate from every other tab.
function getSessionId() {
  let id = sessionStorage.getItem("docentra_session_id");
  if (!id) {
    id =
      crypto.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem("docentra_session_id", id);
  }
  return id;
}

const SESSION_ID = getSessionId();
const NGROK_HEADERS = {
  "ngrok-skip-browser-warning": "true",
  "X-Session-Id": SESSION_ID,
};

function Bookmark({ text }) {
  return <span className="bookmark">{text}</span>;
}

// Placeholder used to protect an escaped "\*" (literal asterisk meant to be
// displayed, e.g. "A\*" for the A* algorithm) from being treated as a
// markdown bold/italic delimiter while we parse.
const STAR_PLACEHOLDER = "\u0000";

function preprocessEscapes(text) {
  return text.replace(/\\\*/g, STAR_PLACEHOLDER);
}

function restoreEscapes(text) {
  return text.split(STAR_PLACEHOLDER).join("*");
}

// Turns "**bold**" into <strong> and "*italic*" into <em> instead of
// showing the raw asterisks.
function renderInlineMarkdown(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 3) {
      return <strong key={i}>{restoreEscapes(part.slice(2, -2))}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 1) {
      return <em key={i}>{restoreEscapes(part.slice(1, -1))}</em>;
    }
    return restoreEscapes(part);
  });
}

function isTableRow(line) {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.length > 1;
}

function isTableSeparatorRow(line) {
  const t = line.trim();
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(t);
}

function parseTableRow(line) {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return t.split("|").map((c) => c.trim());
}

function isHorizontalRule(line) {
  const t = line.trim();
  return /^(-{3,}|_{3,}|\*{3,})$/.test(t);
}

// Turns raw markdown-ish text from the LLM (headings, tables, bullet lists,
// bold/italic, horizontal rules) into real rendered elements instead of
// showing the raw #, |, -, ** characters.
function renderMessageContent(content) {
  const escaped = preprocessEscapes(content);
  const lines = escaped.split("\n");
  const blocks = [];
  let currentList = [];
  let i = 0;

  const flushList = () => {
    if (currentList.length > 0) {
      blocks.push(
        <ul className="msg-list" key={`list-${blocks.length}`}>
          {currentList.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      currentList = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Table block: consume every consecutive "| ... |" line as one table
    if (isTableRow(line)) {
      flushList();
      const tableLines = [];
      while (i < lines.length && isTableRow(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      let headerCells = null;
      let bodyLines = tableLines;
      if (tableLines.length >= 2 && isTableSeparatorRow(tableLines[1])) {
        headerCells = parseTableRow(tableLines[0]);
        bodyLines = tableLines.slice(2);
      }
      const bodyRows = bodyLines
        .filter((l) => !isTableSeparatorRow(l))
        .map(parseTableRow);
      blocks.push(
        <table className="msg-table" key={`table-${blocks.length}`}>
          {headerCells && (
            <thead>
              <tr>
                {headerCells.map((cell, ci) => (
                  <th key={ci}>{renderInlineMarkdown(cell)}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {bodyRows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>{renderInlineMarkdown(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
      continue;
    }

    // Heading: #, ##, ### ... at line start
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      blocks.push(
        <div className={`msg-heading msg-heading--h${level}`} key={`h-${blocks.length}`}>
          {renderInlineMarkdown(headingMatch[2])}
        </div>
      );
      i++;
      continue;
    }

    // Horizontal rule: ---, ***, ___ on their own line
    if (isHorizontalRule(line)) {
      flushList();
      blocks.push(<hr className="msg-hr" key={`hr-${blocks.length}`} />);
      i++;
      continue;
    }

    // Bullet list item: "- " or "* " at line start
    const bulletMatch = trimmed.match(/^[-*]\s+(.*)/);
    if (bulletMatch) {
      currentList.push(bulletMatch[1]);
      i++;
      continue;
    }

    flushList();
    if (trimmed.length === 0) {
      i++;
      continue;
    }
    blocks.push(
      <p className="msg-line" key={`p-${blocks.length}`}>
        {renderInlineMarkdown(line)}
      </p>
    );
    i++;
  }
  flushList();

  return blocks;
}

function Message({ role, content, references, error }) {
  const isUser = role === "user";
  return (
    <div className={`msg-row ${isUser ? "msg-row--user" : "msg-row--assistant"}`}>
      <div className={`msg-bubble ${error ? "msg-bubble--error" : ""}`}>
        <div className="msg-text">{renderMessageContent(content)}</div>
        {references && references.length > 0 && (
          <div className="msg-refs">
            {references.map((ref, i) => (
              <Bookmark key={i} text={ref} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  // List of uploaded documents: [{doc_id, filename, total_pages, total_chunks}]
  const [documents, setDocuments] = useState([]);
  const [activeDocId, setActiveDocId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Chat history kept separately per document: { [doc_id]: [messages] }
  const [messagesByDoc, setMessagesByDoc] = useState({});
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);

  const [summaryLoading, setSummaryLoading] = useState(false);
  const [keywordsLoading, setKeywordsLoading] = useState(false);

  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);

  const activeDoc = documents.find((d) => d.doc_id === activeDocId) || null;
  const messages = activeDocId ? messagesByDoc[activeDocId] || [] : [];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, asking]);

  function appendMessage(docId, message) {
    setMessagesByDoc((prev) => ({
      ...prev,
      [docId]: [...(prev[docId] || []), message],
    }));
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (documents.length >= 5) {
      setUploadError("Upload limit reached — you can have at most 5 documents. Remove one first.");
      e.target.value = "";
      return;
    }

    setUploading(true);
    setUploadError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        headers: NGROK_HEADERS,
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Upload failed.");
      }
      const data = await res.json();

      // Add the new document to the list and make it the active one
      setDocuments((prev) => [...prev, data]);
      setActiveDocId(data.doc_id);
      setMessagesByDoc((prev) => ({
        ...prev,
        [data.doc_id]: [
          {
            role: "assistant",
            content: `Loaded "${data.filename}" — ${data.total_pages} pages, ${data.total_chunks} chunks indexed. Ask me anything about it.`,
          },
        ],
      }));
    } catch (err) {
      setUploadError(err.message || "Something went wrong uploading the file.");
    } finally {
      setUploading(false);
      e.target.value = ""; // allow re-uploading the same filename later
    }
  }

  async function handleAsk(e) {
    e.preventDefault();
    const q = question.trim();
    if (!q || asking || !activeDocId) return;

    appendMessage(activeDocId, { role: "user", content: q });
    setQuestion("");
    setAsking(true);

    try {
      const res = await fetch(`${API_BASE}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...NGROK_HEADERS },
        body: JSON.stringify({ doc_id: activeDocId, question: q, k: 3 }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "The assistant couldn't answer that.");
      }
      const data = await res.json();
      appendMessage(activeDocId, {
        role: "assistant",
        content: data.answer,
        references: data.references,
      });
    } catch (err) {
      appendMessage(activeDocId, { role: "assistant", content: err.message, error: true });
    } finally {
      setAsking(false);
    }
  }

  async function handleSummarize() {
    if (!activeDocId || summaryLoading) return;
    setSummaryLoading(true);
    appendMessage(activeDocId, { role: "user", content: "Summarize this document" });
    try {
      const res = await fetch(`${API_BASE}/summary?doc_id=${activeDocId}`, {
        headers: NGROK_HEADERS,
      });
      if (!res.ok) throw new Error("Could not generate a summary.");
      const data = await res.json();
      appendMessage(activeDocId, { role: "assistant", content: data.summary });
    } catch (err) {
      appendMessage(activeDocId, { role: "assistant", content: err.message, error: true });
    } finally {
      setSummaryLoading(false);
    }
  }

  async function handleKeywords() {
    if (!activeDocId || keywordsLoading) return;
    setKeywordsLoading(true);
    appendMessage(activeDocId, { role: "user", content: "Extract keywords from this document" });
    try {
      const res = await fetch(`${API_BASE}/keywords?doc_id=${activeDocId}`, {
        headers: NGROK_HEADERS,
      });
      if (!res.ok) throw new Error("Could not extract keywords.");
      const data = await res.json();
      const keywordText = `Top keywords: ${data.tfidf_keywords.join(", ")}\n\nLLM keywords: ${data.llm_keywords}`;
      appendMessage(activeDocId, { role: "assistant", content: keywordText });
    } catch (err) {
      appendMessage(activeDocId, { role: "assistant", content: err.message, error: true });
    } finally {
      setKeywordsLoading(false);
    }
  }

  async function handleRemoveDocument(docId, e) {
    e.stopPropagation();
    try {
      await fetch(`${API_BASE}/documents/${docId}`, {
        method: "DELETE",
        headers: NGROK_HEADERS,
      });
    } catch {
      // best-effort; still remove locally
    }
    setDocuments((prev) => prev.filter((d) => d.doc_id !== docId));
    setMessagesByDoc((prev) => {
      const next = { ...prev };
      delete next[docId];
      return next;
    });
    setActiveDocId((prev) => (prev === docId ? null : prev));
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">§</span>
          <div>
            <h1>Docentra</h1>
            <p className="brand-sub">AI Document Assistant</p>
          </div>
        </div>

        <div className="panel">
          <h2 className="panel-title">Documents</h2>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleUpload}
            hidden
          />
          <button
            className="btn btn--outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || documents.length >= 5}
          >
            {uploading
              ? "Uploading …"
              : documents.length >= 5
              ? "Limit reached (5/5)"
              : `+ Upload a PDF (${documents.length}/5)`}
          </button>
          {uploadError && <p className="error-text">{uploadError}</p>}

          {documents.length > 0 && (
            <ul className="doc-list">
              {documents.map((doc) => (
                <li
                  key={doc.doc_id}
                  className={`doc-list-item ${doc.doc_id === activeDocId ? "doc-list-item--active" : ""}`}
                  onClick={() => setActiveDocId(doc.doc_id)}
                >
                  <div className="doc-list-item__info">
                    <span className="doc-list-item__name">{doc.filename}</span>
                    <span className="doc-list-item__meta">
                      {doc.total_pages}p · {doc.total_chunks} chunks
                    </span>
                  </div>
                  <button
                    className="doc-list-item__remove"
                    onClick={(e) => handleRemoveDocument(doc.doc_id, e)}
                    title="Remove document"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel">
          <h2 className="panel-title">Summary</h2>
          <button
            className="btn btn--ghost"
            onClick={handleSummarize}
            disabled={!activeDocId || summaryLoading}
          >
            {summaryLoading ? "Summarizing…" : "Summarize document"}
          </button>
        </div>

        <div className="panel">
          <h2 className="panel-title">Keywords</h2>
          <button
            className="btn btn--ghost"
            onClick={handleKeywords}
            disabled={!activeDocId || keywordsLoading}
          >
            {keywordsLoading ? "Extracting Keyword..." : "Extract keywords"}
          </button>
        </div>
      </aside>

      <main className="chat">
        {activeDoc && (
          <div className="chat-header">
            Chatting with <strong>{activeDoc.filename}</strong>
          </div>
        )}
        <div className="chat-scroll" ref={scrollRef}>
          {documents.length === 0 && (
            <div className="empty-state">
              <span className="empty-mark">¶</span>
              <p>Upload a PDF on the left to open a conversation with it.</p>
            </div>
          )}
          {documents.length > 0 && !activeDocId && (
            <div className="empty-state">
              <span className="empty-mark">¶</span>
              <p>Select a document from the left to start chatting.</p>
            </div>
          )}
          {messages.map((m, i) => (
            <Message key={i} {...m} />
          ))}
          {asking && (
            <div className="msg-row msg-row--assistant">
              <div className="msg-bubble msg-bubble--thinking">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
            </div>
          )}
        </div>

        <form className="composer" onSubmit={handleAsk}>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={activeDocId ? "Ask a question about the document…" : "Select or upload a PDF to begin…"}
            disabled={!activeDocId || asking}
          />
          <button type="submit" className="btn btn--solid" disabled={!activeDocId || asking || !question.trim()}>
            Ask
          </button>
        </form>
      </main>
    </div>
  );
}
