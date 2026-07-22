const copyText = async (text, button) => {
  try {
    await navigator.clipboard.writeText(text);
    const previous = button.textContent;
    button.textContent = "Copied";
    window.setTimeout(() => { button.textContent = previous; }, 1400);
  } catch {
    button.textContent = "Select & copy";
  }
};

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", () => copyText(button.dataset.copy, button));
});

document.querySelectorAll("[data-copy-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.getElementById(button.dataset.copyTarget);
    if (target) copyText(target.textContent.trim(), button);
  });
});

const installCommand = document.getElementById("install-command");
document.querySelectorAll("[data-command]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("[data-command]").forEach((item) => {
      item.classList.toggle("active", item === tab);
      item.setAttribute("aria-selected", item === tab ? "true" : "false");
    });
    installCommand.textContent = tab.dataset.command;
  });
});

document.getElementById("year").textContent = new Date().getFullYear();
