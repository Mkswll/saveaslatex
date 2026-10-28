chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
});

let webTabId = null;

function isWebUrl(url) {
  return /^https?:/i.test(url || "");
}

async function rememberTab(tabId) {
  if (!tabId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isWebUrl(tab.url)) webTabId = tab.id;
  } catch {
    if (webTabId === tabId) webTabId = null;
  }
}

async function currentWebTab() {
  if (webTabId != null) {
    try {
      const tab = await chrome.tabs.get(webTabId);
      if (isWebUrl(tab.url)) return tab;
    } catch {
      webTabId = null;
    }
  }
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const ordered = [...windows.filter((win) => win.focused), ...windows];
  for (const win of ordered) {
    const tab = win.tabs?.find((item) => item.active && isWebUrl(item.url));
    if (tab) {
      webTabId = tab.id;
      return tab;
    }
  }
  return null;
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  rememberTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (tab.active && (change.url || change.status === "complete")) rememberTab(tabId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "active-web-tab") return undefined;
  currentWebTab()
    .then((tab) => sendResponse({ tab }))
    .catch(() => sendResponse({ tab: null }));
  return true;
});

currentWebTab().catch(() => {});
