/// <reference types="chrome"/>

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "extract-selection-md",
    title: "Extract Selection to Markdown",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "extract-selection-md" && tab?.id) {
    // Inject a script to copy the raw HTML of the selection, then process it.
    // In a full implementation, this will send the HTML to the AI backend.
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const div = document.createElement('div');
          div.appendChild(range.cloneContents());
          const html = div.innerHTML;
          // Temporarily just copy the HTML to clipboard as a placeholder
          navigator.clipboard.writeText(html);
          alert("Selection captured for MarkDown Flow!");
        }
      }
    });
  }
});
