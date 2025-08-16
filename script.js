/***** UTIL *****/
const $ = (q, root = document) => root.querySelector(q);
const $$ = (q, root = document) => [...root.querySelectorAll(q)];
const ls = {
  get: (k, def) => {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? def;
    } catch {
      return def;
    }
  },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const timeHHMM = (d = new Date()) =>
  String(d.getHours()).padStart(2, "0") +
  ":" +
  String(d.getMinutes()).padStart(2, "0");

/***** STATE *****/
let todos = ls.get("todos", []); // {id,text,done,priority, dueDate, dueTime, reminded}
let notes = ls.get("notes", []); // {id,text}
let bookmarks = ls.get("bookmarks", []); // {id,url,desc}
let alarms = ls.get("alarms", []); // {id,time,label,repeat,active,soundDataUrl?}

const settings = ls.get("settings", { theme: "dark" });

/***** THEME *****/
(function initTheme() {
  if (settings.theme === "dark") document.documentElement.classList.add("dark");
  $("#themeToggle").addEventListener("click", () => {
    const isDark = document.documentElement.classList.toggle("dark");
    settings.theme = isDark ? "dark" : "light";
    ls.set("settings", settings);
  });
})();

/***** NAVIGATION *****/
const tabs = ["todo", "notes", "bookmarks", "alarms"];
const views = {
  todo: $("#view-todo"),
  notes: $("#view-notes"),
  bookmarks: $("#view-bookmarks"),
  alarms: $("#view-alarms"),
};
function showTab(tab) {
  tabs.forEach((t) => {
    views[t].classList.toggle("hidden", t !== tab);
    $(`.bottom-nav button[data-tab="${t}"]`).classList.toggle(
      "active",
      t === tab
    );
  });
  history.replaceState(null, "", `#${tab}`);
}
$(".bottom-nav").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (!btn) return;
  showTab(btn.dataset.tab);
});
window.addEventListener("load", () => {
  const hash = (location.hash || "#todo").replace("#", "");
  if (tabs.includes(hash)) showTab(hash);
  // PWA shortcuts quick add
  if (hash === "add-todo") {
    showTab("todo");
    $("#todoText").focus();
  }
  if (hash === "add-note") {
    showTab("notes");
    $("#noteText").focus();
  }
  if (hash === "add-bookmark") {
    showTab("bookmarks");
    $("#bmUrl").focus();
  }
  if (hash === "add-alarm") {
    showTab("alarms");
    $("#alarmTime").focus();
  }
});

/***** INSTALL BUTTON *****/
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $("#installBtn").hidden = false;
});
$("#installBtn").addEventListener("click", async () => {
  if (!deferredPrompt) return;
  await deferredPrompt.prompt();
  deferredPrompt = null;
  $("#installBtn").hidden = true;
});

/***** NOTIFICATIONS *****/
if ("Notification" in window) {
  if (Notification.permission === "default") {
    // Ask gently after a short delay
    setTimeout(() => Notification.requestPermission().catch(() => {}), 2000);
  }
}

/***** TODOS *****/
const todoList = $("#todoList");
function renderTodos() {
  todoList.innerHTML = "";
  todos.forEach((t) => {
    const li = document.createElement("li");
    li.className = "item";
    li.draggable = true;
    li.dataset.id = t.id;
    li.innerHTML = `
      <span class="handle">⠿</span>
      <input type="checkbox" ${t.done ? "checked" : ""} aria-label="done"/>
      <div class="spacer">
        <div class="row gap">
          <span class="todo-text ${t.done ? "done" : ""}">${escapeHtml(
      t.text
    )}</span>
          
        </div>
        <small class="muted">
          ${
            t.dueDate
              ? `Due ${t.dueDate}${t.dueTime ? " " + t.dueTime : ""}`
              : ""
          }
        </small>
      </div>
        <button class="btn write" data-act="edit">✏️</button>
        <button class="btn danger delete" data-act="del">🗑️</button>
    `;
    todoList.appendChild(li);
  });
  attachDnd(todoList, (newOrderIds) => {
    todos = newOrderIds.map((id) => todos.find((t) => t.id === id));
    ls.set("todos", todos);
  });
}
function priorityClass(p) {
  return (p || "").toLowerCase();
}
function escapeHtml(s) {
  return s?.replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        m
      ])
  );
}

$("#addTodoBtn").addEventListener("click", addTodoFromInputs);
$("#todoForm").addEventListener("submit", (e) => {
  e.preventDefault();
  addTodoFromInputs();
});
function addTodoFromInputs() {
  const text = $("#todoText").value.trim();
  if (!text) return;
  const priority = $("#todoPriority").value || "Medium";
  const dueDate = $("#todoDueDate").value || null;
  const dueTime = $("#todoDueTime").value || null;
  todos.push({
    id: crypto.randomUUID(),
    text,
    done: false,
    priority,
    dueDate,
    dueTime,
    reminded: false,
  });
  ls.set("todos", todos);
  $("#todoText").value = "";
  $("#todoDueDate").value = "";
  $("#todoDueTime").value = "";
  renderTodos();
}
todoList.addEventListener("click", (e) => {
  const li = e.target.closest("li.item");
  if (!li) return;
  const id = li.dataset.id;
  const idx = todos.findIndex((t) => t.id === id);
  if (e.target.matches('input[type="checkbox"]')) {
    todos[idx].done = !todos[idx].done;
    ls.set("todos", todos);
    renderTodos();
  } else if (e.target.closest('[data-act="del"]')) {
    todos.splice(idx, 1);
    ls.set("todos", todos);
    renderTodos();
  } else if (e.target.closest('[data-act="edit"]')) {
    const t = todos[idx];
    const text = prompt("Edit task", t.text);
    if (text !== null) {
      t.text = text.trim();
      ls.set("todos", todos);
      renderTodos();
    }
  }
});

/***** REMINDERS LOOP *****/
function shouldFireTodoReminder(t, now = new Date()) {
  if (!t.dueDate || t.done || t.reminded) return false;
  const due = new Date(t.dueDate + "T" + (t.dueTime || "09:00"));
  // fire when we reach the due minute
  return now >= due && now - due < 60 * 1000; // within a minute
}
function notify(title, body) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch {}
}
setInterval(() => {
  const now = new Date();
  let changed = false;
  todos.forEach((t) => {
    if (shouldFireTodoReminder(t, now)) {
      notify("Task due", t.text);
      t.reminded = true;
      changed = true;
    }
  });
  if (changed) ls.set("todos", todos);
}, 30 * 1000);

/***** NOTES *****/
const notesList = $("#notesList");
function renderNotes() {
  notesList.innerHTML = "";
  notes.forEach((n) => {
    const li = document.createElement("li");
    li.className = "item";
    li.draggable = true;
    li.dataset.id = n.id;
    li.innerHTML = `
      <span class="handle">⠿</span>
      <div class="spacer">${escapeHtml(n.text).replace(/\n/g, "<br/>")}</div>
      <button class="btn write" data-act="edit">✏️</button>
      <button class="btn danger delete" data-act="del">🗑️</button>
    `;
    notesList.appendChild(li);
  });
  attachDnd(notesList, (orderIds) => {
    notes = orderIds.map((id) => notes.find((n) => n.id === id));
    ls.set("notes", notes);
  });
}
$("#addNoteBtn").addEventListener("click", () => {
  const text = $("#noteText").value.trim();
  if (!text) return;
  notes.push({ id: crypto.randomUUID(), text });
  ls.set("notes", notes);
  $("#noteText").value = "";
  renderNotes();
});
notesList.addEventListener("click", (e) => {
  const li = e.target.closest("li.item");
  if (!li) return;
  const id = li.dataset.id;
  const idx = notes.findIndex((n) => n.id === id);
  if (e.target.closest('[data-act="del"]')) {
    notes.splice(idx, 1);
    ls.set("notes", notes);
    renderNotes();
  } else if (e.target.closest('[data-act="edit"]')) {
    const t = prompt("Edit note", notes[idx].text);
    if (t !== null) {
      notes[idx].text = t;
      ls.set("notes", notes);
      renderNotes();
    }
  }
});

/***** BOOKMARKS *****/
const bmList = $("#bmList");
function favicon(url) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
    url
  )}&sz=64`;
}
function renderBookmarks() {
  bmList.innerHTML = "";
  bookmarks.forEach((b) => {
    const li = document.createElement("li");
    li.className = "item";
    li.draggable = true;
    li.dataset.id = b.id;
    li.innerHTML = `
      <span class="handle">⠿</span>
      <img class="favicon" src="${favicon(b.url)}" alt="" />
      <div class="spacer">
        <div><a class="textWrap" href="${
          b.url
        }" target="_blank" rel="noopener">${escapeHtml(b.url)}</a></div>
        <small class="muted">${escapeHtml(b.desc || "")}</small>
      </div>
      <button class="btn write" data-act="edit">✏️</button>
      <button class="btn danger delete" data-act="del">🗑️</button>
    `;
    bmList.appendChild(li);
  });
  attachDnd(bmList, (orderIds) => {
    bookmarks = orderIds.map((id) => bookmarks.find((x) => x.id === id));
    ls.set("bookmarks", bookmarks);
  });
}
$("#addBmBtn").addEventListener("click", () => {
  const url = $("#bmUrl").value.trim();
  if (!url) return;
  const desc = $("#bmDesc").value.trim();
  bookmarks.push({ id: crypto.randomUUID(), url, desc });
  ls.set("bookmarks", bookmarks);
  $("#bmUrl").value = "";
  $("#bmDesc").value = "";
  renderBookmarks();
});
bmList.addEventListener("click", (e) => {
  const li = e.target.closest("li.item");
  if (!li) return;
  const id = li.dataset.id;
  const idx = bookmarks.findIndex((b) => b.id === id);
  if (e.target.closest('[data-act="del"]')) {
    bookmarks.splice(idx, 1);
    ls.set("bookmarks", bookmarks);
    renderBookmarks();
  } else if (e.target.closest('[data-act="edit"]')) {
    const b = bookmarks[idx];
    const url = prompt("Edit URL", b.url);
    if (url === null) return;
    const desc = prompt("Edit description", b.desc || "");
    if (desc === null) return;
    b.url = url.trim();
    b.desc = desc.trim();
    ls.set("bookmarks", bookmarks);
    renderBookmarks();
  }
});

/***** DRAG & DROP (generic for UL lists of .item) *****/
function attachDnd(listEl, onReorder) {
  let dragId = null;
  listEl.querySelectorAll(".item").forEach((it) => {
    it.addEventListener("dragstart", (e) => {
      dragId = it.dataset.id;
      it.classList.add("dragging");
    });
    it.addEventListener("dragend", (e) => {
      it.classList.remove("dragging");
      dragId = null;
      onReorder(orderFromDom(listEl));
    });
  });
  listEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    const dragging = listEl.querySelector(".dragging");
    if (!dragging) return;
    const after = getDragAfterElement(listEl, e.clientY);
    if (after == null) listEl.appendChild(dragging);
    else listEl.insertBefore(dragging, after);
  });
  function orderFromDom(ul) {
    return $$(".item", ul).map((li) => li.dataset.id);
  }
  function getDragAfterElement(container, y) {
    const els = [...container.querySelectorAll(".item:not(.dragging)")];
    return els.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset)
          return { offset, element: child };
        else return closest;
      },
      { offset: Number.NEGATIVE_INFINITY }
    ).element;
  }
}

/***** ALARMS *****/
const alarmList = $("#alarmList");
let ringing = { audio: null, alarmId: null };

function renderAlarms() {
  alarmList.innerHTML = "";
  alarms.forEach((a) => {
    const li = document.createElement("li");
    li.className = "item";
    li.dataset.id = a.id;
    li.innerHTML = `
      <div class="spacer">
        <strong>${a.time}</strong> — ${escapeHtml(a.label || "")}
        <small class="muted">(${a.repeat})</small>
      </div>
      <label class="row gap">
        <input type="checkbox" ${a.active ? "checked" : ""} data-act="toggle" />
        <span>Active</span>
      </label>
      <button class="btn" data-act="test">▶️</button>
      <button class="btn danger" data-act="del">🗑️</button>
    `;
    alarmList.appendChild(li);
  });
}
$("#addAlarmBtn").addEventListener("click", async () => {
  const time = $("#alarmTime").value;
  if (!time) return;
  const label = $("#alarmLabel").value.trim();
  const repeat = $("#alarmRepeat").value;
  const file = $("#alarmSound").files[0];
  let soundDataUrl = null;
  if (file) {
    soundDataUrl = await fileToDataUrl(file);
  }
  alarms.push({
    id: crypto.randomUUID(),
    time,
    label,
    repeat,
    active: true,
    soundDataUrl,
  });
  ls.set("alarms", alarms);
  $("#alarmTime").value = "";
  $("#alarmLabel").value = "";
  $("#alarmSound").value = "";
  renderAlarms();
});
alarmList.addEventListener("click", (e) => {
  const li = e.target.closest("li.item");
  if (!li) return;
  const id = li.dataset.id;
  const idx = alarms.findIndex((a) => a.id === id);
  if (e.target.closest('[data-act="del"]')) {
    if (ringing.alarmId === id) stopRinging();
    alarms.splice(idx, 1);
    ls.set("alarms", alarms);
    renderAlarms();
  } else if (e.target.closest('[data-act="test"]')) {
    playAlarm(alarms[idx]);
    showAlarmPopup(alarms[idx]);
  }
});
alarmList.addEventListener("change", (e) => {
  if (!e.target.matches('input[type="checkbox"][data-act="toggle"]')) return;
  const li = e.target.closest("li.item");
  const id = li.dataset.id;
  const a = alarms.find((x) => x.id === id);
  a.active = e.target.checked;
  ls.set("alarms", alarms);
});

function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}
function isWeekday(d) {
  const n = d.getDay();
  return n >= 1 && n <= 5;
}
function isWeekend(d) {
  const n = d.getDay();
  return n === 0 || n === 6;
}

function checkAlarms() {
  const now = new Date();
  const hhmm = timeHHMM(now);
  alarms.forEach((a) => {
    if (!a.active) return;
    if (a.time !== hhmm) return;
    // Repeat filter
    if (a.repeat === "weekdays" && !isWeekday(now)) return;
    if (a.repeat === "weekends" && !isWeekend(now)) return;
    playAlarm(a);
    showAlarmPopup(a);
    if (a.repeat === "once") {
      a.active = false;
      ls.set("alarms", alarms);
      renderAlarms();
    }
  });
}
function playAlarm(a) {
  try {
    if (ringing.audio) stopRinging();
    const audio = new Audio(a.soundDataUrl || "assets/alarm.mp3");
    audio.loop = true;
    audio.play().catch(() => {});
    if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
    ringing = { audio, alarmId: a.id };
    // optional notification
    notify("Alarm", a.label ? `${a.label} (${a.time})` : `Alarm at ${a.time}`);
  } catch {}
}
function stopRinging() {
  if (ringing.audio) {
    ringing.audio.pause();
    ringing.audio.currentTime = 0;
  }
  ringing = { audio: null, alarmId: null };
}
function showAlarmPopup(a) {
  $("#alarmPopupText").textContent = a.label || `Alarm at ${a.time}`;
  const dlg = $("#alarmPopup");
  if (!dlg.open) dlg.showModal();
}
$("#stopAlarmBtn").addEventListener("click", () => {
  stopRinging();
  $("#alarmPopup").close();
});
$("#snoozeAlarmBtn").addEventListener("click", () => {
  stopRinging();
  const now = new Date(Date.now() + 5 * 60 * 1000);
  const t = timeHHMM(now);
  alarms.push({
    id: crypto.randomUUID(),
    time: t,
    label: "Snoozed",
    repeat: "once",
    active: true,
  });
  ls.set("alarms", alarms);
  renderAlarms();
  $("#alarmPopup").close();
});

// Pollers
setInterval(checkAlarms, 1000);

/***** INITIAL RENDER *****/
renderTodos();
renderNotes();
renderBookmarks();
renderAlarms();

/***** SERVICE WORKER *****/
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}

/***** HELPERS *****/
// Fill today as default due date for convenience
$("#todoDueDate").value = todayISO();

/***** ACCESSIBILITY SMALLS *****/
document.addEventListener("keydown", (e) => {
  // Quick add from Enter in todo text
  if (e.key === "Enter" && document.activeElement === $("#todoText")) {
    e.preventDefault();
    $("#addTodoBtn").click();
  }
});
