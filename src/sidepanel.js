import { transcribeAssignment } from "./agent.js";
import { readHeaderForAgent } from "./headerFile.js";
import { extractAssignmentInPage } from "./extract.js";
import { loadSettings } from "./settings.js";
import { assembleTex, fileNameFor, guessMeta, splitDraftQuestions } from "./template.js";

const $ = (id) => document.getElementById(id);

const els = {
  course: $("course"),
  assignment: $("assignment"),
  title: $("title-preview"),
  read: $("read"),
  screenshot: $("screenshot"),
  instructions: $("instructions"),
  standing: $("standing"),
  sourceWrap: $("source-wrap"),
  sourceMeta: $("source-meta"),
  source: $("source"),
  transcribe: $("transcribe"),
  draft: $("draft"),
  output: $("output"),
  save: $("save"),
  copy: $("copy"),
  status: $("status"),
  settings: $("settings"),
};

const extension = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
let pageInfo = { href: "", title: "", h1: "", truncated: false };
let busy = false;
let persistTimer = 0;

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
}

function syncActions() {
  const hasTex = Boolean(els.output.value.trim());
  els.read.disabled = busy;
  els.transcribe.disabled = busy;
  els.draft.disabled = busy;
  els.save.disabled = busy || !hasTex;
  els.copy.disabled = !hasTex;
}

function previewTitle() {
  const course = els.course.value.trim() || "MATHXXX";
  const assignment = els.assignment.value.trim() || "X";
  els.title.textContent = `${course} Assignment ${assignment}`;
}

function markTouched(input) {
  input.dataset.touched = "1";
}

function fillMeta(text) {
  const guess = guessMeta(text, `${pageInfo.title}\n${pageInfo.h1}`);
  if (guess.course && !els.course.dataset.touched) els.course.value = guess.course;
  if (guess.assignment && !els.assignment.dataset.touched) els.assignment.value = guess.assignment;
  previewTitle();
}

async function persistDraft() {
  if (!globalThis.chrome?.storage?.session) return;
  await chrome.storage.session.set({
    draft: {
      course: els.course.value,
      assignment: els.assignment.value,
      source: els.source.value,
      tex: els.output.value,
      courseTouched: els.course.dataset.touched || "",
      assignmentTouched: els.assignment.dataset.touched || "",
      href: pageInfo.href,
      title: pageInfo.title,
      h1: pageInfo.h1,
      truncated: pageInfo.truncated,
      sourceMeta: els.sourceMeta.textContent,
      instructions: els.instructions.value,
    },
  });
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistDraft().catch(() => {});
  }, 200);
}

function blockedPage(url = "") {
  if (/^(chrome|chrome-extension|edge|about|devtools):/i.test(url)) {
    return "This tab is a Chrome page. Click the assignment tab, then read it again.";
  }
  if (/\.pdf([?#]|$)/i.test(url)) {
    return "Chrome's PDF viewer can't be read. Open the assignment as a webpage.";
  }
  return "";
}

async function activeTab() {
  try {
    const reply = await chrome.runtime.sendMessage({ type: "active-web-tab" });
    if (reply?.tab?.id && !blockedPage(reply.tab.url)) return reply.tab;
  } catch {
    /* The service worker will answer after this panel reloads. */
  }

  const current = await chrome.windows.getCurrent();
  const [attached] = await chrome.tabs.query({ active: true, windowId: current.id });
  if (attached?.id && !blockedPage(attached.url)) return attached;

  let tab;
  try {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    const focused = windows.find((win) => win.focused) || windows.find((win) => win.id !== current.id) || windows[0];
    tab = focused?.tabs?.find((item) => item.active && !blockedPage(item.url));
  } catch {
    tab = null;
  }
  if (tab?.id) return tab;

  throw new Error(blockedPage(attached?.url) || "Open the assignment in a normal tab, then read it again.");
}

async function injectExtractor(tabId) {
  const attempts = [
    { target: { tabId, allFrames: true }, world: "MAIN" },
    { target: { tabId, allFrames: true }, world: "ISOLATED" },
    { target: { tabId }, world: "MAIN" },
    { target: { tabId }, world: "ISOLATED" },
  ];
  let lastError = new Error("Nothing could be read from this page.");
  for (const attempt of attempts) {
    try {
      const results = await chrome.scripting.executeScript({
        ...attempt,
        func: extractAssignmentInPage,
      });
      const frame = pickFrame(results);
      if (frame?.text || frame?.selection) return frame;
      const message = (results || []).map((result) => result?.error).find(Boolean);
      if (message) lastError = new Error(message);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (/<all_urls>|activeTab|Cannot access contents/i.test(lastError.message)) {
    throw new Error(
      "Reload Save as LaTeX on chrome://extensions so version 1.3.3 is running, then close this panel and open it again. Site access can stay On all sites.",
    );
  }
  throw lastError;
}

function frameScore(frame) {
  const text = frame.selection && frame.selection.length > 40 ? frame.selection : frame.text || "";
  const questions = (text.match(/\b(question|problem|exercise)\b/gi) || []).length;
  return text.length + questions * 400;
}

function pickFrame(results) {
  const frames = (results || []).map((result) => result?.result).filter((frame) => frame?.text || frame?.selection);
  frames.sort((a, b) => frameScore(b) - frameScore(a));
  return frames[0] || null;
}

async function readPage() {
  const tab = await activeTab();
  const frame = await injectExtractor(tab.id);
  const url = frame.href || tab.url || "";
  const selection = (frame.selection || "").trim();
  const pageText = (frame.text || "").trim();
  const useSelection = selection.length > 40 && (pageText.length === 0 || selection.length + 20 < pageText.length);
  let text = (useSelection ? selection : pageText).trim();
  if (!text) {
    throw new Error(
      `No assignment text was found on “${tab.title || url || "this tab"}”. If the problems are in a PDF viewer, open the HTML page instead, or paste the problems into Page text.`,
    );
  }

  const truncated = text.length > 100000;
  if (truncated) text = text.slice(0, 100000);
  if (pageInfo.href && frame.href && pageInfo.href !== frame.href) {
    delete els.course.dataset.touched;
    delete els.assignment.dataset.touched;
  }
  pageInfo = { href: frame.href || url, title: frame.title || "", h1: frame.h1 || "", truncated };
  els.source.value = text;
  els.sourceWrap.open = true;
  els.sourceWrap.scrollIntoView({ block: "nearest" });
  const questions = splitDraftQuestions(text);
  const headed = questions.length > 1 || /(?:question|problem|exercise|q\d)/i.test(text.slice(0, 80));
  els.sourceMeta.textContent = [
    frame.title || url,
    useSelection ? "using the selection" : "",
    headed ? `${questions.length} question${questions.length === 1 ? "" : "s"}` : "no question headings",
    truncated ? "truncated" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  fillMeta(text);
  await persistDraft();
  const count = text.length.toLocaleString();
  const where = frame.title || tab.title || url;
  setStatus(
    `Read ${count} characters from “${where}” into Page text. Draft locally or Transcribe to fill the homework file.`,
  );
}

async function currentShot(tab) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const scale = Math.min(1, 1400 / image.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

async function writeTex(questions, settings) {
  const tex = assembleTex({
    course: els.course.value.trim(),
    assignment: els.assignment.value.trim(),
    author: settings.author,
    headerPath: settings.headerPath,
    questions,
  });
  els.output.value = tex;
  syncActions();
  await persistDraft();
  return tex;
}

async function onRead() {
  if (busy) return;
  busy = true;
  syncActions();
  setStatus("Reading this page…");
  try {
    await readPage();
  } catch (error) {
    const message = error.message || "Could not read this page.";
    if (els.sourceWrap) els.sourceWrap.open = true;
    els.sourceMeta.textContent = message;
    setStatus(message, true);
  } finally {
    busy = false;
    syncActions();
  }
}

async function onTranscribe() {
  if (busy) return;
  const text = els.source.value.trim();
  if (!text) {
    setStatus("Read the assignment page first.", true);
    return;
  }
  busy = true;
  syncActions();
  setStatus("Transcribing with the agent…");
  try {
    const settings = await loadSettings();
    const header = await readHeaderForAgent();
    let imageDataUrl = null;
    if (els.screenshot.checked) {
      if (!extension) throw new Error("Screenshots are available in the extension.");
      setStatus("Capturing the visible area…");
      imageDataUrl = await currentShot(await activeTab());
      setStatus("Transcribing with the agent…");
    }
    const plan = await transcribeAssignment({
      settings,
      imageDataUrl,
      page: {
        title: pageInfo.title,
        href: pageInfo.href,
        h1: pageInfo.h1,
        text,
        course: els.course.value.trim(),
        assignment: els.assignment.value.trim(),
        truncated: pageInfo.truncated,
        headerPath: settings.headerPath,
        assignmentPrompt: els.instructions.value,
        headerName: header.name,
        headerText: header.text,
        headerTruncated: header.truncated,
      },
    });
    if (plan.course && !els.course.dataset.touched) els.course.value = plan.course;
    if (plan.assignment && !els.assignment.dataset.touched) els.assignment.value = plan.assignment;
    if (!els.course.value.trim() && plan.course) els.course.value = plan.course;
    if (!els.assignment.value.trim() && plan.assignment) els.assignment.value = plan.assignment;
    previewTitle();
    const standing = String(settings.extraPrompt || "").trim();
    const current = els.instructions.value.trim();
    await writeTex(plan.questions, settings);
    const count = plan.questions.length;
    const headerNote = header.name ? ` Included ${header.name}.` : "";
    const instructionNote =
      standing && current
        ? " Settings instructions and the instructions for this assignment were sent."
        : standing
          ? " Settings instructions were sent."
          : current
            ? " Instructions for this assignment were sent."
            : "";
    const shotNote = imageDataUrl ? " Screenshot of the visible area was sent." : "";
    setStatus(`Wrote ${count} question${count === 1 ? "" : "s"}.${headerNote}${instructionNote}${shotNote}`);
  } catch (error) {
    const message = error.message || "The agent failed.";
    setStatus(
      /<all_urls>|activeTab permission is required/i.test(message)
        ? "Reload Save as LaTeX on chrome://extensions so version 1.3.3 is running, then close this panel and open it again."
        : message,
      true,
    );
  } finally {
    busy = false;
    syncActions();
  }
}

async function onDraft() {
  if (busy) return;
  const text = els.source.value.trim();
  if (!text) {
    setStatus("Read the assignment page first, or paste it into Page text.", true);
    return;
  }
  busy = true;
  syncActions();
  try {
    const settings = await loadSettings();
    const questions = splitDraftQuestions(text);
    await writeTex(questions, settings);
    const count = questions.length;
    const hasInstructions = Boolean(String(settings.extraPrompt || "").trim() || els.instructions.value.trim());
    const instructionNote = hasInstructions ? " Extra instructions are sent only by Transcribe with agent." : "";
    setStatus(`Drafted ${count} question${count === 1 ? "" : "s"} without an agent.${instructionNote}`);
  } catch (error) {
    setStatus(error.message || "Could not draft the file.", true);
  } finally {
    busy = false;
    syncActions();
  }
}

function anchorDownload(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function onSave() {
  const text = els.output.value;
  if (!text.trim()) return;
  const filename = fileNameFor(els.course.value, els.assignment.value);
  if (!extension || !chrome.downloads?.download) {
    anchorDownload(filename, text);
    setStatus(`Saved ${filename}.`);
    return;
  }
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const id = await chrome.downloads.download({ url, filename, saveAs: true });
    const done = (delta) => {
      if (delta.id !== id || !delta.state || delta.state.current === "in_progress") return;
      URL.revokeObjectURL(url);
      chrome.downloads.onChanged.removeListener(done);
    };
    chrome.downloads.onChanged.addListener(done);
    setStatus(`Choose where to save ${filename}.`);
  } catch (error) {
    URL.revokeObjectURL(url);
    anchorDownload(filename, text);
    setStatus(error.message || `Saved ${filename}.`, Boolean(error.message));
  }
}

async function onCopy() {
  const text = els.output.value;
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    els.output.focus();
    els.output.select();
    document.execCommand("copy");
  }
  setStatus("Copied the LaTeX.");
}

els.course.addEventListener("input", () => {
  markTouched(els.course);
  previewTitle();
  schedulePersist();
});
els.assignment.addEventListener("input", () => {
  markTouched(els.assignment);
  previewTitle();
  schedulePersist();
});
els.source.addEventListener("input", schedulePersist);
els.instructions.addEventListener("input", schedulePersist);
els.output.addEventListener("input", () => {
  syncActions();
  schedulePersist();
});
els.read.addEventListener("click", () => void onRead());
els.transcribe.addEventListener("click", () => void onTranscribe());
els.draft.addEventListener("click", () => void onDraft());
els.save.addEventListener("click", () => void onSave());
els.copy.addEventListener("click", () => void onCopy());
els.settings.addEventListener("click", () => {
  if (extension) chrome.runtime.openOptionsPage();
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void onSave();
  }
});

async function restoreDraft() {
  if (!globalThis.chrome?.storage?.session) return;
  const stored = await chrome.storage.session.get("draft");
  const draft = stored?.draft;
  if (!draft) return;
  els.course.value = draft.course || "";
  els.assignment.value = draft.assignment || "";
  els.source.value = draft.source || "";
  els.output.value = draft.tex || "";
  els.instructions.value = draft.instructions || "";
  els.sourceMeta.textContent = draft.sourceMeta || "";
  if (draft.courseTouched) els.course.dataset.touched = draft.courseTouched;
  if (draft.assignmentTouched) els.assignment.dataset.touched = draft.assignmentTouched;
  if (draft.source) els.sourceWrap.open = true;
  pageInfo = {
    href: draft.href || "",
    title: draft.title || "",
    h1: draft.h1 || "",
    truncated: Boolean(draft.truncated),
  };
  previewTitle();
  if (draft.tex) setStatus("Restored the last draft.");
}

function renderStanding(extraPrompt) {
  const text = String(extraPrompt || "").trim();
  els.standing.textContent = text
    ? `Settings, sent with every transcription: ${text}`
    : "No extra instructions are saved in Settings. Write them there; they save as you type.";
}

async function init() {
  previewTitle();
  syncActions();
  if (new URLSearchParams(location.search).has("preview")) {
    els.course.value = "MATH 240";
    els.assignment.value = "3";
    els.source.value = "Question 1\nCompute $\\int_0^1 x^2\\,dx$.\n\nQuestion 2\nShow that $n! > 2^n$ for $n \\ge 4$.";
    els.sourceWrap.open = true;
    previewTitle();
    await onDraft();
    return;
  }
  await restoreDraft();
  syncActions();
  if (!extension) return;
  const settings = await loadSettings();
  renderStanding(settings.extraPrompt);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.prototype.hasOwnProperty.call(changes, "extraPrompt")) {
      renderStanding(changes.extraPrompt.newValue);
    }
  });
  if (!els.output.value && !settings.apiKey && settings.provider !== "ollama") {
    setStatus("Add an API key in Settings to use an agent. Draft locally works without one.");
  }
}

init().catch((error) => setStatus(error.message || "Could not open the panel.", true));
