// Start-, Einrichtungs- und Fehlerseite der Desktop-App. Zustand und Texte kommen aus der Hülle (src-tauri/src/lib.rs).
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const $ = (s) => document.querySelector(s);
let texts = {};
let lang = "en";
let plan = null;

const t = (key, args = {}) => (texts[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => args[k] ?? m);
const gb = (mb) => `${(mb / 1024).toLocaleString(lang, { maximumFractionDigits: 1 })} GB`;
const bytes = (b) => b >= 1 << 30 ? `${(b / (1 << 30)).toLocaleString(lang, { maximumFractionDigits: 2 })} GB`
  : `${Math.round(b / (1 << 20)).toLocaleString(lang)} MB`;

function show(id) {
  for (const s of ["starting", "setup", "installing", "failed"]) $("#" + s).hidden = s !== id;
}

function render(status) {
  switch (status.phase) {
    case "starting":
      show("starting");
      $("#step").textContent = t(status.key);
      break;
    case "ready":
      show("starting");
      $("#step").textContent = "";
      break;
    case "setup":
      plan = status.plan;
      show("setup");
      renderSetup();
      break;
    case "installing":
      show("installing");
      renderProgress(status.progress);
      break;
    case "failed":
      show("failed");
      $("#error").textContent = t(status.key, status.args);
      $("#logfile").textContent = status.log ? t("log_file", { path: status.log }) : "";
      $("#tail").textContent = status.tail;
      $("#tail").hidden = !status.tail;
      $("#retry").focus();
      break;
  }
}

function renderSetup() {
  const p = plan, hw = p.hardware;
  $("#home").textContent = p.home;
  $("#hw").textContent = [t("setup_hw_ram", { ram: hw.ram_gb }), hw.vram_gb ? t("setup_hw_vram", { vram: hw.vram_gb }) : "",
    hw.gpus.join(", ")].filter(Boolean).join(" · ");
  const box = $("#lmChoices");
  if (!box.dataset.built) {
    box.replaceChildren(...["0.6B", "1.7B", "4B"].map((size) => {
      const l = document.createElement("label");
      l.innerHTML = `<input type="radio" name="lm" value="${size}"> <b>${size}</b><span class="tag"></span><span class="mb"></span>`;
      return l;
    }));
    box.addEventListener("change", updateSizes);
    $("#xl").addEventListener("change", updateSizes);
    box.dataset.built = "1";
    box.querySelector(`input[value="${p.choice.lm}"]`).checked = true;
    $("#xl").checked = p.choice.xl;
  }
  for (const l of box.querySelectorAll("label")) {
    const size = l.querySelector("input").value;
    l.querySelector(".tag").textContent = size === p.recommended ? t("setup_recommended") : "";
    l.querySelector(".mb").textContent = p.sizes_mb[size] ? gb(p.sizes_mb[size]) : "";
  }
  $("#noEngine").hidden = p.engine_available || p.engine_present;
  $("#install").disabled = !(p.engine_available || p.engine_present);
  updateSizes();
}

function choice() {
  return { lm: $("#lmChoices input:checked")?.value || plan.recommended, xl: $("#xl").checked };
}

function updateSizes() {
  const c = choice();
  const lmName = `acestep-5Hz-lm-${c.lm}-Q8_0.gguf`;
  let mb = plan.base_mb;
  if (!plan.present.includes(lmName)) mb += plan.sizes_mb[c.lm] || 0;
  if (c.xl && !plan.present.some((n) => n.includes("xl-sft"))) mb += plan.sizes_mb.XL || 0;
  $("#sizes").textContent = `${t("setup_download", { size: gb(mb) })} · ${t("setup_free", { size: `${plan.hardware.free_gb} GB` })}`;
}

function renderProgress(p) {
  $("#instStep").textContent = t(p.key, { index: p.index, count: p.count, file: p.file });
  const bar = $(".bar"), pct = p.total ? Math.min(100, (p.done / p.total) * 100) : 0;
  bar.classList.toggle("busy", !p.total);
  bar.setAttribute("aria-valuenow", String(Math.round(pct)));
  $("#barFill").style.width = p.total ? `${pct}%` : "";
  $("#instDetail").textContent = p.total
    ? `${bytes(p.done)} / ${bytes(p.total)}${p.bytes_per_sec ? ` · ${bytes(p.bytes_per_sec)}/s` : ""}`
    : "";
}

function applyTexts() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-t]").forEach((e) => { e.textContent = t(e.dataset.t); });
}

let last = { phase: "starting", key: "step_check" };
async function load() {
  const s = await invoke("splash_state");
  texts = s.texts;
  lang = s.lang;
  applyTexts();
  render(last = s.status);
}

listen("status", (e) => render(last = e.payload));
listen("lang", load);
$("#retry").onclick = () => invoke("retry");
$("#logs").onclick = () => invoke("open_logs");
$("#folder").onclick = () => invoke("open_folder");
$("#quit").onclick = $("#quit2").onclick = () => invoke("quit");
$("#changeHome").onclick = () => invoke("choose_home");
$("#install").onclick = () => { $("#install").disabled = true; invoke("install", { choice: choice() }); };
$("#cancel").onclick = () => { $("#cancel").disabled = true; invoke("cancel_install"); };
listen("status", (e) => { if (e.payload.phase !== "installing") $("#cancel").disabled = false; });
load();
