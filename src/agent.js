import { parseAgentJson } from "./template.js";

const SYSTEM_PROMPT = `You transcribe math assignment webpages into LaTeX problem statements for a student homework file.

Return only JSON with this shape:
{
  "course": "MATH 240",
  "assignment": "3",
  "questions": [
    {"number": 1, "statement": "LaTeX problem statement"}
  ]
}

Rules:
- Include every question on the page, in order. Do not invent questions that are not there.
- Q1, Q2, Question 1, Question 2, and similar headings are separate questions. One question object each.
- "statement" is the problem only. Do not write a solution, hints about how to solve it, or a \section command.
- Omit answer boxes. Do not transcribe "drop your answer here", "click browse", or "Supports: PDF, JPG, and PNG formats".
- Escape backslashes in JSON. The two characters backslash and t are a tab, and backslash and b are a backspace. Write \\\\textit, \\\\begin, \\\\big, \\\\text, and \\\\leq.
- Transcribe all mathematics as LaTeX. Use \\[ \\] for display math and $ $ for inline math.
- Use amsmath environments such as align and cases when the layout needs them.
- Parts labeled (a), (b), (c), (d), and so on must use exactly this form:
\\begin{enumerate}
\\item[(a)] ...
\\item[(b)] ...
\\item[(c)] ...
\\item[(d)] ...
\\end{enumerate}
The optional argument includes the parentheses, as in \\item[(a)]. Do not write \\item[a], \\item by itself, or an enumitem label.
- In enumerate, itemize, and description, put \\begin, each \\item, and \\end on their own lines. One item per line.
- Keep \\textit{...} from the extracted text. That is italic type on the page. If a screenshot shows italics the text missed, wrap those words in \\textit as well.
- The user message includes the header path and, when a header file was opened, its contents. The homework file already inputs that path. Do not paste the header into a statement, do not add another \\input, and do not redefine commands or environments the header already defines. Use those commands when the notation matches.
- Escape LaTeX special characters in prose.
- If a figure cannot be transcribed, write \\textit{[Figure: short description]}.
- Use the course and assignment hints when the page does not state them. If they are still unknown, use empty strings.
- Do not wrap the JSON in markdown.`;

export function composeSystemPrompt(extraPrompt, assignmentPrompt) {
  const standing = String(extraPrompt || "").trim();
  const current = String(assignmentPrompt || "").trim();
  const parts = [SYSTEM_PROMPT];
  if (standing) parts.push(`Standing instructions:\n${standing}`);
  if (current) parts.push(`Instructions for this assignment:\n${current}`);
  if (standing || current) {
    parts.push(
      "Follow the standing instructions and the instructions for this assignment for wording and notation. Lettered parts still use \\item[(a)], and each list item stays on its own line. Still return only the JSON object, and still do not write a solution.",
    );
  }
  return parts.join("\n\n");
}

function headerSection({ headerPath, headerName, headerText, headerTruncated }) {
  const lines = [`Header path: ${headerPath || "(none)"}`];
  if (headerName) lines.push(`Opened header file: ${headerName}`);
  if (headerText) {
    lines.push(
      "The homework file already inputs this path. Use the header's commands. Do not paste the header into a statement.",
      "",
      "--- header file ---",
      headerText,
      "--- end header ---",
    );
    if (headerTruncated) lines.push("Note: the header file was truncated.");
  } else {
    lines.push("No header file was opened, so its definitions are not included.");
  }
  return lines.join("\n");
}

export function buildUserPrompt({
  title,
  href,
  h1,
  text,
  course,
  assignment,
  truncated,
  hasImage,
  headerPath,
  headerName,
  headerText,
  headerTruncated,
  extraPrompt,
  assignmentPrompt,
}) {
  const standing = String(extraPrompt || "").trim();
  const current = String(assignmentPrompt || "").trim();
  const instructionParts = [];
  if (standing) instructionParts.push(`Standing instructions:\n${standing}`);
  if (current) instructionParts.push(`Instructions for this assignment:\n${current}`);
  const instructions = instructionParts.length
    ? `\n\nFollow these instructions for wording and notation. Lettered parts still use \\item[(a)], and each list item stays on its own line.\n\n${instructionParts.join("\n\n")}`
    : "";
  return `Page title: ${title || "(none)"}
Heading: ${h1 || "(none)"}
URL: ${href || "(none)"}
Course hint: ${course || "(unknown)"}
Assignment hint: ${assignment || "(unknown)"}
${truncated ? "Note: the page text was truncated.\n" : ""}${hasImage ? "A screenshot of the visible area is attached. Use it for italics, bold, mathematics, and figures the extracted text missed. Keep \\textit commands already in the text.\n" : ""}${headerSection({ headerPath, headerName, headerText, headerTruncated })}

Transcribe the assignment below.

${text || "(no text extracted)"}${instructions}`;
}

function agentError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function readError(response) {
  const data = await response.json().catch(() => ({}));
  const message = data.error?.message || data.error?.error?.message || data.message || response.statusText;
  throw agentError(message || `Request failed (${response.status})`, response.status);
}

async function postJson(url, headers, body) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) await readError(response);
  return response.json();
}

function openAiContent(userText, imageDataUrl) {
  if (!imageDataUrl) return userText;
  return [
    { type: "text", text: userText },
    { type: "image_url", image_url: { url: imageDataUrl } },
  ];
}

async function callOpenAI(settings, system, userText, imageDataUrl) {
  const base = String(settings.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const headers = { "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  const body = {
    model: settings.model,
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: openAiContent(userText, imageDataUrl) },
    ],
  };

  const attempt = (extra) => postJson(`${base}/chat/completions`, headers, { ...body, ...extra });
  try {
    const data = await attempt({ max_tokens: 8192, response_format: { type: "json_object" } });
    return data.choices?.[0]?.message?.content || "";
  } catch (error) {
    if (error.status !== 400) throw error;
    if (!/response_format|temperature|max_tokens|unsupported|unrecognized/i.test(error.message)) throw error;
    try {
      const data = await attempt({ max_completion_tokens: 8192 });
      return data.choices?.[0]?.message?.content || "";
    } catch (second) {
      if (second.status !== 400) throw second;
      const data = await attempt({});
      return data.choices?.[0]?.message?.content || "";
    }
  }
}

function anthropicContent(userText, imageDataUrl) {
  if (!imageDataUrl) return userText;
  const match = imageDataUrl.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/);
  if (!match) return userText;
  return [
    {
      type: "image",
      source: { type: "base64", media_type: match[1], data: match[2] },
    },
    { type: "text", text: userText },
  ];
}

async function callAnthropic(settings, system, userText, imageDataUrl) {
  const base = String(settings.baseUrl || "https://api.anthropic.com").replace(/\/$/, "");
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": settings.apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  const body = {
    model: settings.model,
    max_tokens: 8192,
    system,
    messages: [{ role: "user", content: anthropicContent(userText, imageDataUrl) }],
  };
  let data;
  try {
    data = await postJson(`${base}/v1/messages`, headers, { ...body, temperature: 0 });
  } catch (error) {
    if (error.status !== 400 || !/temperature/i.test(error.message)) throw error;
    data = await postJson(`${base}/v1/messages`, headers, body);
  }
  const block = (data.content || []).find((part) => part.type === "text");
  return block?.text || "";
}

export async function transcribeAssignment({ settings, page, imageDataUrl }) {
  if (!settings.model?.trim()) {
    throw new Error("Set a model in Settings.");
  }
  if (settings.provider === "anthropic" && !settings.apiKey) {
    throw new Error("Add an Anthropic API key in Settings.");
  }
  if (settings.provider !== "ollama" && settings.provider !== "anthropic" && !settings.apiKey) {
    throw new Error("Add an API key in Settings, or choose a local model.");
  }

  const userText = buildUserPrompt({
    ...page,
    hasImage: Boolean(imageDataUrl),
    extraPrompt: settings.extraPrompt,
  });
  const system = composeSystemPrompt(settings.extraPrompt, page.assignmentPrompt);
  const call = settings.provider === "anthropic" ? callAnthropic : callOpenAI;
  let raw = await call(settings, system, userText, imageDataUrl);
  try {
    return parseAgentJson(raw);
  } catch {
    raw = await call(
      settings,
      system,
      `${userText}\n\nYour previous reply was not valid JSON. Return only the JSON object.`,
      imageDataUrl,
    );
    return parseAgentJson(raw);
  }
}
