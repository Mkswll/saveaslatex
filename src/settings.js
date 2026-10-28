import { DEFAULT_AUTHOR, DEFAULT_HEADER_PATH } from "./template.js";

export const DEFAULT_SETTINGS = {
  provider: "openai",
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  author: DEFAULT_AUTHOR,
  headerPath: DEFAULT_HEADER_PATH,
  extraPrompt: "",
};

export const PROVIDER_PRESETS = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-5",
  },
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1",
  },
};

export async function loadSettings() {
  if (!globalThis.chrome?.storage?.local) return { ...DEFAULT_SETTINGS };
  const stored = await chrome.storage.local.get(null);
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings) {
  const next = {
    provider: settings.provider || DEFAULT_SETTINGS.provider,
    apiKey: settings.apiKey || "",
    baseUrl: (settings.baseUrl || DEFAULT_SETTINGS.baseUrl).trim(),
    model: (settings.model || DEFAULT_SETTINGS.model).trim(),
    author: (settings.author || DEFAULT_AUTHOR).trim(),
    headerPath: (settings.headerPath || DEFAULT_HEADER_PATH).trim(),
    extraPrompt: String(settings.extraPrompt || "").trim(),
  };
  await chrome.storage.local.set(next);
  return next;
}
