browser.action.onClicked.addListener(() => {
  void browser.tabs.create({ url: browser.runtime.getURL("dashboard.html") });
});
