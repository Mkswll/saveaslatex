/**
 * Injected into the page (main world). Must stay self-contained:
 * Chrome serializes this function alone.
 */
export function extractAssignmentInPage() {
  const SKIP = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE",
    "CANVAS",
    "VIDEO",
    "AUDIO",
    "OBJECT",
    "EMBED",
    "IFRAME",
    "NAV",
    "FOOTER",
    "SVG",
  ]);

  const mathByNode = new Map();
  try {
    const items = window.MathJax?.startup?.document?.math || [];
    for (const item of items) {
      if (item.typesetRoot && item.math) {
        mathByNode.set(item.typesetRoot, {
          tex: String(item.math),
          display: Boolean(item.display),
        });
      }
    }
  } catch {
    /* MathJax is optional */
  }

  function classText(el) {
    if (typeof el.className === "string") return `${el.id || ""} ${el.className}`;
    return el.id || "";
  }

  function isAnswerChrome(el) {
    if (el.tagName === "INPUT" || el.tagName === "BUTTON" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
      return true;
    }
    const label = classText(el);
    if (/dropzone|file-?upload|filepond|attachment/i.test(label) && !/question|problem|assignment|homework/i.test(label)) {
      return true;
    }
    if (el.childNodes.length > 6) return false;
    const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 180) return false;
    return /drop your answer here|supports:\s*pdf,\s*jpg/i.test(text);
  }

  function isChromeChrome(el) {
    const label = classText(el);
    if (!label.trim()) return false;
    if (/question|problem|assignment|homework|exercise|prompt/i.test(label)) return false;
    return /navbar|breadcrumb|cookie|sidebar|masthead|site-header|site-footer|global-nav|skip-link/i.test(
      label,
    );
  }

  function mathFromElement(el) {
    if (mathByNode.has(el)) return mathByNode.get(el);
    const tag = el.tagName;
    if (tag === "SCRIPT" && /^math\/tex/i.test(el.type || el.getAttribute("type") || "")) {
      return {
        tex: el.textContent || "",
        display: /display/i.test(el.type || ""),
      };
    }
    const looksMath =
      tag === "MJX-CONTAINER" ||
      el.classList?.contains("katex") ||
      el.classList?.contains("katex-display") ||
      el.classList?.contains("MathJax") ||
      el.classList?.contains("MathJax_Display");
    if (!looksMath) {
      const data = el.getAttribute?.("data-latex") || el.getAttribute?.("data-tex");
      if (!data) return null;
      return { tex: data, display: el.getAttribute("data-display") === "true" };
    }
    const annotation = el.querySelector?.('annotation[encoding="application/x-tex"]');
    if (annotation?.textContent) {
      const display =
        el.getAttribute?.("display") === "true" ||
        el.classList.contains("katex-display") ||
        el.classList.contains("MathJax_Display");
      return { tex: annotation.textContent, display };
    }
    return null;
  }

  function isMathRoot(el) {
    return (
      mathByNode.has(el) ||
      el.tagName === "MJX-CONTAINER" ||
      el.classList?.contains("katex") ||
      el.classList?.contains("katex-display") ||
      el.classList?.contains("MathJax") ||
      el.classList?.contains("MathJax_Display") ||
      (el.tagName === "SCRIPT" && /^math\/tex/i.test(el.type || ""))
    );
  }

  function wrap(tex, display) {
    const body = String(tex || "").trim();
    if (!body) return "";
    if (display || body.startsWith("\\[") || body.startsWith("$$") || /\\begin\{/.test(body)) {
      if (body.startsWith("\\[") || body.startsWith("$$") || body.startsWith("\\begin{")) {
        return `\n\n${body}\n\n`;
      }
      return `\n\n\\[${body}\\]\n\n`;
    }
    if (body.startsWith("$")) return body;
    return `$${body}$`;
  }

  const chunks = [];
  let budget = 200000;

  function push(text) {
    if (!text || budget <= 0) return;
    const slice = text.length > budget ? text.slice(0, budget) : text;
    budget -= slice.length;
    chunks.push(slice);
  }

  const BLOCK = new Set([
    "DIV",
    "SECTION",
    "ARTICLE",
    "MAIN",
    "BODY",
    "TABLE",
    "THEAD",
    "TBODY",
    "UL",
    "OL",
    "NAV",
    "HEADER",
    "FOOTER",
    "FORM",
    "BLOCKQUOTE",
    "FIGURE",
    "PRE",
    "HTML",
  ]);

  function elementStyle(el) {
    try {
      return getComputedStyle(el);
    } catch {
      return null;
    }
  }

  function shouldItalic(el, style, inItalic) {
    if (inItalic || BLOCK.has(el.tagName)) return false;
    if (el.tagName === "EM" || el.tagName === "I" || el.tagName === "CITE" || el.tagName === "DFN") return true;
    const font = style?.fontStyle;
    return font === "italic" || font === "oblique";
  }

  function walk(node, inItalic = false) {
    if (budget <= 0 || !node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.replace(/[ \t\f\v]+/g, " ");
      if (text.trim()) push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        for (const child of node.childNodes) walk(child, inItalic);
      }
      return;
    }

    const el = node;
    const math = mathFromElement(el);
    if (math && isMathRoot(el)) {
      push(wrap(math.tex, math.display));
      return;
    }
    const role = el.getAttribute?.("role");
    if (role === "navigation" || role === "contentinfo") return;
    if (SKIP.has(el.tagName) || el.hidden || isChromeChrome(el) || isAnswerChrome(el)) return;

    const style = elementStyle(el);
    if (style?.display === "none") return;

    if (el.tagName === "BR") {
      push("\n");
      return;
    }
    if (el.tagName === "IMG") {
      const alt = el.getAttribute("alt") || el.getAttribute("title") || "";
      push(alt ? ` [image: ${alt}] ` : " [image] ");
      return;
    }
    if (el.tagName === "LI") push("\n- ");
    if (/^H[1-6]$/.test(el.tagName)) push("\n\n");
    if (el.tagName === "PRE") {
      push(`\n${el.innerText}\n`);
      return;
    }

    const italic = shouldItalic(el, style, inItalic);
    if (italic) push("\\textit{");
    const nextItalic = inItalic || italic;
    if (el.shadowRoot) {
      walkAssigned(el.shadowRoot, nextItalic);
      if (!el.shadowRoot.querySelector("slot")) {
        for (const child of el.childNodes) walk(child, nextItalic);
      }
    } else {
      for (const child of el.childNodes) walk(child, nextItalic);
    }
    if (italic) push("}");

    if (/^(P|DIV|LI|H1|H2|H3|H4|H5|H6|TR|SECTION|ARTICLE|BLOCKQUOTE|TABLE)$/.test(el.tagName)) {
      push("\n");
    }
  }

  function walkAssigned(rootNode, inItalic = false) {
    for (const child of rootNode.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE && child.tagName === "SLOT") {
        const assigned = child.assignedNodes?.({ flatten: true }) || [];
        if (assigned.length > 0) {
          for (const node of assigned) walk(node, inItalic);
          continue;
        }
      }
      walk(child, inItalic);
    }
  }

  const candidates = [...document.querySelectorAll("article, main, [role='main']")];
  const richest = candidates.sort(
    (a, b) => (b.innerText?.length || 0) - (a.innerText?.length || 0),
  )[0];
  const root = richest && (richest.innerText?.trim().length || 0) >= 40 ? richest : document.body;
  walk(root);

  let text = chunks
    .join("")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00AD/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/([^\n])\n(?!\n)/g, "$1 ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\\textit\{\s*\}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) text = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").trim();

  const h1 = document.querySelector("h1")?.innerText?.trim() || "";
  let selection = "";
  try {
    selection = String(window.getSelection?.() || "").trim();
  } catch {
    selection = "";
  }

  return {
    href: location.href,
    title: document.title || "",
    h1,
    text,
    selection,
  };
}
