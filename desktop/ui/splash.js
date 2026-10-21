// Start- und Fehlerseite der Desktop-App. Zustand und Texte kommen aus der Hülle (Rust), siehe src-tauri/src/lib.rs.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const $ = (s) => document.querySelector(s);
let texts = {};

const t = (key, args = {}) => (texts[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => args[k] ?? m);

function render(status) {
  const failed = status.phase === "failed";
  $("#starting").hidden = failed;
  $("#failed").hidden = !failed;
  if (status.phase === "starting") $("#step").textContent = t(status.key);
  if (status.phase === "ready") $("#step").textContent = "";
  if (failed) {
    $("#error").textContent = t(status.key, status.args);
    $("#logfile").textContent = status.log ? t("log_file", { path: status.log }) : "";
    $("#tail").textContent = status.tail;
    $("#tail").hidden = !status.tail;
    $("#retry").focus();
  }
}

function applyTexts(lang) {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-t]").forEach((e) => { e.textContent = t(e.dataset.t); });
}

let last = { phase: "starting", key: "step_check" };
async function load() {
  const s = await invoke("splash_state");
  texts = s.texts;
  applyTexts(s.lang);
  render(last = s.status);
}

listen("status", (e) => render(last = e.payload));
listen("lang", load);
$("#retry").onclick = () => invoke("retry");
$("#logs").onclick = () => invoke("open_logs");
$("#folder").onclick = () => invoke("open_folder");
$("#quit").onclick = () => invoke("quit");
load();
