export const DEFAULT_HEADER_PATH = "/Users/maxwellhe/Desktop/Everything/LatexHeader";
export const DEFAULT_AUTHOR = "Maxwell He";

const DANGEROUS_COMMAND =
  /\\(immediate|write18|openout|closeout|newwrite|input|include|includeonly|InputIfFileExists|usepackage|RequirePackage|documentclass|makeatletter|makeatother|catcode|openin|read|special|@@input)\b/g;

export function escapeLatexText(value) {
  return String(value)
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

export function sanitizeStatement(statement) {
  return stripAnswerChrome(
    String(statement || "")
      .replace(/\u0000/g, "")
      .replace(DANGEROUS_COMMAND, "\\textbackslash{}$1")
      .replace(/\\(begin|end)\{document\}/g, ""),
  ).trim();
}

const PART_START = /^[ \t]*(?:[-*+]\s+)?(?:\(([a-z])\)|([a-z])\))[ \t]*[:.)]?[ \t]*/i;
const INLINE_PART = /(?:^|(?<=\s))(?:\(([a-z])\)|([a-z])\))(?=\s)/gi;

function partLetter(line) {
  const match = String(line).match(PART_START);
  if (!match) return "";
  return (match[1] || match[2]).toLowerCase();
}

function isAlphabetical(letters) {
  if (letters.length < 2 || letters[0] !== "a") return false;
  for (let i = 1; i < letters.length; i += 1) {
    if (letters[i].charCodeAt(0) !== letters[i - 1].charCodeAt(0) + 1) return false;
  }
  return true;
}

function explodePartLines(lines) {
  const out = [];
  for (const line of lines) {
    const matches = [...String(line).matchAll(INLINE_PART)];
    const letters = matches.map((match) => (match[1] || match[2]).toLowerCase());
    if (!isAlphabetical(letters)) {
      out.push(line);
      continue;
    }
    const gaps = matches.slice(0, -1).map((match, index) => {
      const start = match.index + match[0].length;
      const end = matches[index + 1].index;
      return line.slice(start, end).trim();
    });
    if (gaps.some((gap) => gap === "" || /^(?:and|or|&)$/i.test(gap))) {
      out.push(line);
      continue;
    }
    const head = line.slice(0, matches[0].index).trimEnd();
    if (head.trim()) out.push(head.trimEnd());
    for (let index = 0; index < matches.length; index += 1) {
      const start = matches[index].index;
      const end = index + 1 < matches.length ? matches[index + 1].index : line.length;
      out.push(line.slice(start, end).trim());
    }
  }
  return out;
}

function enumerateBlock(items) {
  const body = items
    .map((item) => {
      const text = item.body.replace(PART_START, "").trim();
      return `\\item[(${item.letter})] ${text}`.trimEnd();
    })
    .join("\n");
  return `\\begin{enumerate}\n${body}\n\\end{enumerate}`;
}

function wrapPartRuns(text) {
  const lines = explodePartLines(String(text).split("\n"));
  const marks = [];
  lines.forEach((line, index) => {
    const letter = partLetter(line);
    if (letter) marks.push({ index, letter });
  });

  const ranges = [];
  const used = new Set();
  for (let index = 0; index < marks.length; index += 1) {
    if (used.has(index) || marks[index].letter !== "a") continue;
    const sequence = [marks[index]];
    used.add(index);
    let expected = "b".charCodeAt(0);
    for (let next = index + 1; next < marks.length; next += 1) {
      if (marks[next].letter.charCodeAt(0) !== expected) break;
      sequence.push(marks[next]);
      used.add(next);
      expected += 1;
    }
    if (sequence.length < 2) {
      used.delete(index);
      continue;
    }
    ranges.push(sequence);
  }

  if (ranges.length === 0) return lines.join("\n");

  const replaced = new Set();
  const chunks = new Map();
  for (const sequence of ranges) {
    const last = sequence[sequence.length - 1];
    const nextMark = marks.find((mark) => mark.index > last.index);
    const end = nextMark ? nextMark.index : lines.length;
    const items = sequence.map((mark, index) => {
      const stop = index + 1 < sequence.length ? sequence[index + 1].index : end;
      for (let line = mark.index; line < stop; line += 1) replaced.add(line);
      return {
        letter: mark.letter,
        body: lines.slice(mark.index, stop).join("\n").trim(),
      };
    });
    chunks.set(sequence[0].index, enumerateBlock(items));
  }

  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (chunks.has(index)) out.push(chunks.get(index));
    if (!replaced.has(index)) out.push(lines[index]);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function maskProtected(text) {
  const masks = [];
  const hide = (chunk) => {
    const token = `\uE000${masks.length}\uE001`;
    masks.push(chunk);
    return token;
  };
  const masked = hideLists(text, hide).replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$(?:\\.|[^$\n])+\$/g, hide);
  return {
    masked,
    restore(value) {
      return masks.reduce((current, chunk, index) => current.replace(`\uE000${index}\uE001`, chunk), value);
    },
  };
}

function hideLists(text, hide) {
  let out = "";
  let cursor = 0;
  const pattern = /\\begin\{(?:enumerate|itemize|description)\}/g;
  let match = pattern.exec(text);
  while (match) {
    if (match.index < cursor) {
      match = pattern.exec(text);
      continue;
    }
    const end = findListEnd(text, pattern.lastIndex);
    if (end < 0) break;
    out += text.slice(cursor, match.index);
    out += hide(text.slice(match.index, end));
    cursor = end;
    pattern.lastIndex = end;
    match = pattern.exec(text);
  }
  return `${out}${text.slice(cursor)}`;
}

function findListEnd(source, from) {
  const pattern = /\\(begin|end)\{(enumerate|itemize|description)\*?\}/g;
  pattern.lastIndex = from;
  let depth = 1;
  let match = pattern.exec(source);
  while (match) {
    depth += match[1] === "begin" ? 1 : -1;
    if (depth === 0) return pattern.lastIndex;
    match = pattern.exec(source);
  }
  return -1;
}

function bareName(command, keyword) {
  const match = command.match(new RegExp(`^\\\\${keyword}\\{(enumerate|itemize|description)\\*?\\}`));
  return match ? `\\${keyword}{${match[1].replace("*", "")}}` : command.trim();
}

function prettyList(block) {
  const begin = block.match(/^\\begin\{(?:enumerate|itemize|description)\*?\}(?:\[[^\]]*\])?/)?.[0];
  const end = block.match(/\\end\{(?:enumerate|itemize|description)\*?\}$/)?.[0];
  if (!begin || !end) return block;
  let inner = block.slice(begin.length, block.length - end.length);
  inner = inner.replace(
    /[ \t]*\\begin\{(?:enumerate|itemize|description)\*?\}(?:\[[^\]]*\])?/g,
    (command) => `\n${bareName(command, "begin")}\n`,
  );
  inner = inner.replace(/[ \t]*\\end\{(enumerate|itemize|description)\*?\}/g, (_, name) => `\n\\end{${name.replace("*", "")}}\n`);
  inner = inner.replace(/[ \t]*\\item\b/g, "\n\\item");
  inner = inner.replace(/\\item(\[[^\]]*\])?[ \t]*/g, (_, option) => `\\item${option || ""} `);
  const lines = inner
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return `${bareName(begin, "begin")}\n${lines.join("\n")}\n${bareName(end, "end")}\n`;
}

function normalizeItemLabels(text) {
  return text.replace(/^\\item(?:\s*\[\(?([a-z])\)?\]|\s+\(([a-z])\)|\s+([a-z])\))?[ \t]*/gm, (match, bracket, paren, bare) => {
    const letter = (bracket || paren || bare || "").toLowerCase();
    if (!letter) return match;
    return `\\item[(${letter})] `;
  });
}

export function formatLists(text) {
  const source = String(text || "").replace(/\r\n/g, "\n");
  let out = "";
  let cursor = 0;
  const beginPattern = /\\begin\{(?:enumerate|itemize|description)\*?\}(?:\[[^\]]*\])?/g;
  let match = beginPattern.exec(source);
  while (match) {
    if (match.index < cursor) {
      match = beginPattern.exec(source);
      continue;
    }
    const end = findListEnd(source, beginPattern.lastIndex);
    if (end < 0) break;
    out += source.slice(cursor, match.index);
    out += prettyList(source.slice(match.index, end));
    cursor = end;
    beginPattern.lastIndex = end;
    match = beginPattern.exec(source);
  }
  return `${out}${source.slice(cursor)}`;
}

export function formatPartLabels(statement) {
  const prepared = unwrapPartLabels(dropItemlessEnumerates(String(statement || "").replace(/\r\n/g, "\n")));
  const listed = formatLists(prepared);
  const labeled = normalizeItemLabels(listed);
  const protectedText = maskProtected(labeled);
  return protectedText.restore(wrapPartRuns(protectedText.masked)).trim();
}

function unwrapPartLabels(text) {
  return text.replace(/\\(?:textit|emph|textbf)\{\s*(\([a-z]\))\s*\}/gi, "$1");
}

function dropItemlessEnumerates(text) {
  let out = "";
  let cursor = 0;
  const pattern = /\\begin\{enumerate\*?\}(?:\[[^\]]*\])?/g;
  let match = pattern.exec(text);
  while (match) {
    if (match.index < cursor) {
      match = pattern.exec(text);
      continue;
    }
    const end = findListEnd(text, pattern.lastIndex);
    if (end < 0) {
      out += text.slice(cursor, match.index);
      cursor = pattern.lastIndex;
      pattern.lastIndex = cursor;
      match = pattern.exec(text);
      continue;
    }
    const block = text.slice(match.index, end);
    if (!/\\item\b/.test(block)) {
      const endCommand = block.match(/\\end\{enumerate\*?\}$/)?.[0] || "";
      const inner = block.slice(match[0].length, block.length - endCommand.length);
      out += text.slice(cursor, match.index) + inner;
      cursor = end;
      pattern.lastIndex = end;
    }
    match = pattern.exec(text);
  }
  return `${out}${text.slice(cursor)}`;
}

export function questionLabel(question, index) {
  const raw = String(question?.number ?? index + 1).trim();
  if (/^\d+[a-z]?$/i.test(raw)) return raw;
  return String(index + 1);
}

function questionBlock(number, statement) {
  const body = formatPartLabels(sanitizeStatement(statement));
  const tail = body ? `\n\n${body}\n` : "\n";
  return `\\section*{Question ${number}}\n\\markright{Question ${number}}${tail}`;
}

export function assembleTex({
  course,
  assignment,
  author = DEFAULT_AUTHOR,
  headerPath = DEFAULT_HEADER_PATH,
  questions,
}) {
  const safeCourse = escapeLatexText(String(course || "MATHXXX").replace(/\s+/g, " ").trim() || "MATHXXX");
  const safeAssignment = escapeLatexText(
    String(assignment || "X").replace(/\s+/g, " ").trim() || "X",
  );
  const safeAuthor = escapeLatexText(String(author || DEFAULT_AUTHOR).replace(/\s+/g, " ").trim() || DEFAULT_AUTHOR);
  const header = String(headerPath || DEFAULT_HEADER_PATH).trim() || DEFAULT_HEADER_PATH;
  if (/[{}\r\n]/.test(header)) {
    throw new Error("The header path cannot contain braces or line breaks.");
  }

  const title = `${safeCourse} Assignment ${safeAssignment}`;
  const items = Array.isArray(questions) && questions.length > 0 ? questions : [{ number: 1, statement: "" }];
  const blocks = items.map((question, index) => questionBlock(questionLabel(question, index), question.statement));

  return `\\documentclass{article}
\\usepackage[margin = 0.75in, headheight = 0.75in]{geometry}

\\input{${header}}

\\title{${title}}
\\author{${safeAuthor}}
% \\date{}

\\pagestyle{fancy}
% \\fancyhf{}
\\fancyhead[R]{${title}}

\\begin{document}

\\maketitle

${blocks.join("\n\\newpage\n")}
\\end{document}
`;
}

export function fileNameFor(course, assignment) {
  const clean = (value, fallback) =>
    String(value || fallback)
      .trim()
      .replace(/\s+/g, "")
      .replace(/[^\w.-]+/g, "") || fallback;
  return `${clean(course, "MATHXXX")}_Assignment_${clean(assignment, "X")}.tex`;
}

export function parseAgentJson(raw) {
  let text = String(raw || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("The agent did not return JSON.");
  }
  const plan = JSON.parse(repairLatexJson(text.slice(start, end + 1)));
  if (!plan || !Array.isArray(plan.questions)) {
    throw new Error("The agent response did not include a questions list.");
  }
  return {
    course: String(plan.course || "").trim(),
    assignment: String(plan.assignment || "").trim(),
    questions: expandQuestions(
      plan.questions.map((question, index) => ({
        number: question?.number ?? index + 1,
        statement: String(question?.statement || ""),
      })),
    ),
  };
}

export function guessMeta(text, title = "") {
  const blob = `${title}\n${text || ""}`;
  const course = blob.match(/\b((?:MATH|MAT|STAT|STATS|PHYS|CS|COMP|ECON|ENGR)\s*-?\s*\d{2,4}[A-Z]?)\b/i);
  const assignment = blob.match(
    /\b(?:assignment|homework|problem\s*set|pset|hw)\s*#?\s*([A-Z]?\d+[A-Z]?)\b/i,
  );
  return {
    course: course ? course[1].replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").toUpperCase() : "",
    assignment: assignment ? assignment[1] : "",
  };
}

const ESCAPE_LATEX = new Set([
  "bar",
  "begin",
  "beta",
  "bf",
  "bfseries",
  "big",
  "bigg",
  "bigl",
  "bigr",
  "binom",
  "bmod",
  "bot",
  "box",
  "brace",
  "bullet",
  "flat",
  "footnote",
  "forall",
  "frac",
  "nabla",
  "newcommand",
  "newenvironment",
  "newline",
  "neq",
  "noindent",
  "not",
  "notin",
  "nu",
  "rangle",
  "rfloor",
  "rho",
  "right",
  "rightarrow",
  "rm",
  "tau",
  "text",
  "textbf",
  "textit",
  "textrm",
  "textsc",
  "texttt",
  "textup",
  "theta",
  "tilde",
  "times",
  "to",
  "top",
  "triangle",
]);

export function repairLatexJson(text) {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "\\") {
      out += text[i];
      continue;
    }
    const next = text[i + 1] || "";
    if (!next) {
      out += "\\\\";
      continue;
    }
    if (next === "\\") {
      out += "\\\\";
      i += 1;
      continue;
    }
    if (next === '"') {
      out += '\\"';
      i += 1;
      continue;
    }
    if (next === "/") {
      out += "\\/";
      i += 1;
      continue;
    }
    if (next === "u" && /^[0-9a-fA-F]{4}/.test(text.slice(i + 2, i + 6))) {
      out += text.slice(i, i + 6);
      i += 5;
      continue;
    }
    const word = text.slice(i + 1).match(/^[A-Za-z]+/)?.[0] || "";
    if (word && ESCAPE_LATEX.has(word)) {
      out += `\\\\${word}`;
      i += word.length;
      continue;
    }
    if ("bfnrt".includes(next)) {
      out += `\\${next}`;
      i += 1;
      continue;
    }
    if (word) {
      out += `\\\\${word}`;
      i += word.length;
      continue;
    }
    out += "\\\\";
  }
  return out;
}

function stripAnswerChrome(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => {
      const plain = line
        .trim()
        .replace(/^\\(?:textit|emph|textbf)\{/, "")
        .replace(/\}$/, "");
      if (!plain) return true;
      return !/^(?:drop your answer here(?:,?\s*or click browse)?|click browse|supports:\s*pdf\b.*)$/i.test(plain);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const QUESTION_HEADING =
  /(?:^|\n)[ \t]*(?:(\\(?:textit|emph|textbf))\{[ \t]*)?(?:question|problem|exercise|q(?=\d))[ \t]*(\d+[a-z]?)\b[ \t]*[:.)-]?[ \t]*/gi;

function questionMarks(source) {
  const marks = [];
  for (const match of source.matchAll(QUESTION_HEADING)) {
    let end = match.index + match[0].length;
    let whole = match[0];
    if (match[1]) {
      if (source[end] !== "}") continue;
      whole += "}";
      end += 1;
      while (source[end] === " " || source[end] === "\t") end += 1;
    }
    marks.push({ index: match.index, number: match[2], end });
  }
  return marks;
}

export function expandQuestions(questions) {
  const out = [];
  for (const question of questions || []) {
    const source = stripAnswerChrome(question?.statement || "");
    const marks = questionMarks(source);
    if (marks.length === 0) {
      out.push({ number: question?.number ?? out.length + 1, statement: source });
      continue;
    }
    if (marks[0].index > 0) {
      const preamble = source.slice(0, marks[0].index).trim();
      if (preamble) out.push({ number: question?.number ?? out.length + 1, statement: preamble });
    }
    for (let index = 0; index < marks.length; index += 1) {
      const mark = marks[index];
      const stop = index + 1 < marks.length ? marks[index + 1].index : source.length;
      out.push({ number: mark.number, statement: source.slice(mark.end, stop).trim() });
    }
  }
  return out.filter((question) => String(question.statement || "").trim());
}

export function splitDraftQuestions(text) {
  const source = stripAnswerChrome(String(text || "").replace(/\r\n/g, "\n")).trim();
  if (!source) return [];

  const marks = questionMarks(source);
  if (marks.length === 0) {
    return [{ number: 1, statement: source }];
  }

  return marks.map((mark, index) => {
    const stop = index + 1 < marks.length ? marks[index + 1].index : source.length;
    return {
      number: mark.number,
      statement: source.slice(mark.end, stop).trim(),
    };
  });
}
