const DB_NAME = "saveaslatex";
const STORE = "files";
const HEADER_KEY = "header";
const MAX_HEADER = 80000;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runTransaction(db, mode, run) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Could not store the header file."));
  });
}

async function putHandle(handle) {
  const db = await openDb();
  try {
    await runTransaction(db, "readwrite", (store) => store.put(handle, HEADER_KEY));
  } finally {
    db.close();
  }
}

async function takeHandle() {
  const db = await openDb();
  try {
    return (await runTransaction(db, "readonly", (store) => store.get(HEADER_KEY))) || null;
  } finally {
    db.close();
  }
}

async function deleteHandle() {
  const db = await openDb();
  try {
    await runTransaction(db, "readwrite", (store) => store.delete(HEADER_KEY));
  } finally {
    db.close();
  }
}

function clip(text) {
  const value = String(text || "");
  if (value.length <= MAX_HEADER) return { text: value, truncated: false };
  return { text: value.slice(0, MAX_HEADER), truncated: true };
}

async function cacheHeader(name, text, truncated) {
  if (!globalThis.chrome?.storage?.local) return;
  await chrome.storage.local.set({
    headerFileName: name,
    headerFileText: text,
    headerFileTruncated: truncated,
  });
}

export async function headerFileStatus() {
  if (!globalThis.chrome?.storage?.local) return { name: "", truncated: false };
  const stored = await chrome.storage.local.get(["headerFileName", "headerFileTruncated"]);
  return {
    name: stored.headerFileName || "",
    truncated: Boolean(stored.headerFileTruncated),
  };
}

export async function chooseHeaderFile() {
  if (typeof window.showOpenFilePicker !== "function") {
    throw new Error("This browser cannot open a local header file.");
  }
  const [handle] = await window.showOpenFilePicker({
    multiple: false,
    excludeAcceptAllOption: false,
    types: [
      {
        description: "LaTeX",
        accept: { "text/plain": [".tex", ".ltx", ".sty"] },
      },
    ],
  });
  const file = await handle.getFile();
  const clipped = clip(await file.text());
  await putHandle(handle);
  await cacheHeader(file.name, clipped.text, clipped.truncated);
  return { name: file.name, ...clipped };
}

export async function forgetHeaderFile() {
  await deleteHandle();
  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.remove(["headerFileName", "headerFileText", "headerFileTruncated"]);
  }
}

async function readIfGranted() {
  const handle = await takeHandle();
  if (!handle?.getFile) return null;
  const permission = await handle.queryPermission({ mode: "read" });
  if (permission !== "granted") return null;
  const file = await handle.getFile();
  const clipped = clip(await file.text());
  return { name: file.name, ...clipped };
}

export async function readHeaderForAgent() {
  const stored = globalThis.chrome?.storage?.local
    ? await chrome.storage.local.get(["headerFileName", "headerFileText", "headerFileTruncated"])
    : {};
  let header = {
    name: stored.headerFileName || "",
    text: stored.headerFileText || "",
    truncated: Boolean(stored.headerFileTruncated),
  };
  try {
    const fresh = await readIfGranted();
    if (fresh) {
      header = fresh;
      await cacheHeader(fresh.name, fresh.text, fresh.truncated);
    }
  } catch {
    // The cached copy is still sent to the agent.
  }
  return header;
}
