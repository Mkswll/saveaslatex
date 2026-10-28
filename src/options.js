import { chooseHeaderFile, forgetHeaderFile, headerFileStatus } from "./headerFile.js";
import { DEFAULT_SETTINGS, PROVIDER_PRESETS, loadSettings, saveSettings } from "./settings.js";

const $ = (id) => document.getElementById(id);
const fields = ["provider", "apiKey", "baseUrl", "model", "author", "headerPath", "extraPrompt"];

function readForm() {
  return {
    provider: $("provider").value,
    apiKey: $("apiKey").value.trim(),
    baseUrl: $("baseUrl").value.trim(),
    model: $("model").value.trim(),
    author: $("author").value.trim(),
    headerPath: $("headerPath").value.trim(),
    extraPrompt: $("extraPrompt").value.trim(),
  };
}

function writeForm(settings) {
  for (const field of fields) $(field).value = settings[field] ?? "";
}

function applyPreset(name) {
  const preset = PROVIDER_PRESETS[name];
  $("provider").value = name;
  $("baseUrl").value = preset.baseUrl;
  $("model").value = preset.model;
  if (name === "ollama") $("apiKey").value = "";
}

for (const name of Object.keys(PROVIDER_PRESETS)) {
  $(`preset-${name}`).addEventListener("click", () => applyPreset(name));
}

let extraTimer = 0;
$("extraPrompt").addEventListener("input", () => {
  clearTimeout(extraTimer);
  extraTimer = setTimeout(() => {
    if (!globalThis.chrome?.storage?.local) return;
    chrome.storage.local.set({ extraPrompt: $("extraPrompt").value.trim() }).catch((error) => {
      setStatus(error.message || "Could not save the extra instructions.", true);
    });
  }, 300);
});

$("save").addEventListener("click", async () => {
  const status = $("status");
  try {
    await saveSettings({ ...DEFAULT_SETTINGS, ...readForm() });
    status.classList.remove("error");
    status.textContent = "Saved.";
  } catch (error) {
    status.classList.add("error");
    status.textContent = error.message || "Could not save settings.";
  }
});

function setStatus(message, isError = false) {
  const status = $("status");
  status.classList.toggle("error", isError);
  status.textContent = message;
}

async function showHeaderFile() {
  const header = await headerFileStatus();
  const note = $("header-file-status");
  $("forget-header").disabled = !header.name;
  if (!header.name) {
    note.textContent = "No header file opened. The agent only sees the path. If LatexHeader is hidden in the picker, switch the dialog to All files.";
    return;
  }
  note.textContent = header.truncated
    ? `Opened ${header.name}. The copy sent to the agent is truncated.`
    : `Opened ${header.name}. The agent reads this file and is told the header path.`;
}

$("choose-header").addEventListener("click", async () => {
  try {
    const file = await chooseHeaderFile();
    setStatus(`Opened ${file.name}.`);
    await showHeaderFile();
  } catch (error) {
    if (error?.name === "AbortError") return;
    setStatus(error.message || "Could not open the header file.", true);
  }
});

$("forget-header").addEventListener("click", async () => {
  try {
    await forgetHeaderFile();
    setStatus("Forgot the header file.");
    await showHeaderFile();
  } catch (error) {
    setStatus(error.message || "Could not forget the header file.", true);
  }
});

loadSettings()
  .then(async (settings) => {
    writeForm(settings);
    await showHeaderFile();
  })
  .catch((error) => {
    setStatus(error.message || "Could not load settings.", true);
  });
