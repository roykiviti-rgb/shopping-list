import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, onSnapshot, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = (id) => document.getElementById(id);
const SCREENS = ["loading", "setup", "login", "denied", "app"];
const LAST_LIST_KEY = "shopping:lastList";

function show(screen) {
  for (const id of SCREENS) $(id).classList.toggle("hidden", id !== screen);
}

if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("PASTE")) {
  show("setup");
  throw new Error("firebase-config.js is not filled in");
}

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
// Local cache keeps the list readable and editable in a store with bad reception;
// changes sync once the connection is back.
const db = initializeFirestore(fbApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

let user = null;
let lists = [];
let items = [];
let currentListId = readLastList();
let unsubLists = null;
let unsubItems = null;
let creatingDefault = false;
let itemsLoaded = false;

// ---------- auth ----------

onAuthStateChanged(auth, (u) => {
  user = u;
  stopListeners();
  if (!u) {
    show("login");
    return;
  }
  $("menuUser").textContent = u.email;
  show("app");
  watchLists();
});

$("loginBtn").addEventListener("click", async () => {
  $("loginError").textContent = "";
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, provider);
    } else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
      $("loginError").textContent = `ההתחברות נכשלה (${e.code})`;
    }
  }
});

async function logout() {
  stopListeners();
  await signOut(auth);
}

$("deniedLogout").addEventListener("click", logout);

function stopListeners() {
  unsubItems?.();
  unsubLists?.();
  unsubItems = unsubLists = null;
  lists = [];
  items = [];
}

function onError(err) {
  console.error(err);
  if (err.code === "permission-denied") {
    stopListeners();
    $("deniedEmail").textContent = user?.email ?? "";
    show("denied");
  } else {
    toast("שגיאה: " + (err.code || err.message));
  }
}

// ---------- lists ----------

function watchLists() {
  unsubLists = onSnapshot(collection(db, "lists"), async (snap) => {
    lists = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

    if (lists.length === 0) {
      // Only create the first list once the server confirmed there really are none.
      if (!snap.metadata.fromCache && !creatingDefault) {
        creatingDefault = true;
        try {
          await createList("רשימת קניות");
        } finally {
          creatingDefault = false;
        }
      }
      return;
    }

    if (!lists.some((l) => l.id === currentListId)) selectList(lists[0].id);
    else renderListSelect();
  }, onError);
}

function renderListSelect() {
  const select = $("listSelect");
  select.replaceChildren(...lists.map((l) => {
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = l.name;
    return opt;
  }));
  select.value = currentListId ?? "";
  document.title = `${lists.find((l) => l.id === currentListId)?.name ?? "רשימת קניות"} 🛒`;
}

function selectList(id) {
  currentListId = id;
  writeLastList(id);
  renderListSelect();
  watchItems(id);
}

$("listSelect").addEventListener("change", (e) => selectList(e.target.value));

async function createList(name) {
  const ref = await addDoc(collection(db, "lists"), {
    name,
    createdAt: Date.now(),
    createdBy: user.email,
  });
  selectList(ref.id);
}

async function renameList() {
  const list = lists.find((l) => l.id === currentListId);
  if (!list) return;
  const name = await askText("שינוי שם הרשימה", list.name);
  if (name) await updateDoc(doc(db, "lists", list.id), { name }).catch(onError);
}

async function deleteList() {
  const list = lists.find((l) => l.id === currentListId);
  if (!list) return;
  if (lists.length === 1) {
    toast("אי אפשר למחוק את הרשימה האחרונה");
    return;
  }
  const ok = await askConfirm("מחיקת רשימה", `למחוק את "${list.name}" ואת כל הפריטים בה?`);
  if (!ok) return;
  try {
    const snap = await getDocs(collection(db, "lists", list.id, "items"));
    await deleteInBatches(snap.docs.map((d) => d.ref));
    await deleteDoc(doc(db, "lists", list.id));
    selectList(lists.find((l) => l.id !== list.id).id);
  } catch (err) {
    onError(err);
  }
}

async function deleteInBatches(refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

// ---------- items ----------

const itemsCol = () => collection(db, "lists", currentListId, "items");
const itemRef = (id) => doc(db, "lists", currentListId, "items", id);
const normalize = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();

function watchItems(listId) {
  unsubItems?.();
  items = [];
  itemsLoaded = false;
  renderItems();
  unsubItems = onSnapshot(collection(db, "lists", listId, "items"), (snap) => {
    items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    itemsLoaded = true;
    renderItems();
  }, onError);
}

$("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("itemName").value.trim().replace(/\s+/g, " ");
  const qty = $("itemQty").value.trim();
  if (!name || !currentListId) return;
  $("itemName").value = "";
  $("itemQty").value = "";
  $("itemName").focus();

  // Re-adding something already on the list updates it instead of creating a duplicate.
  const existing = items.find((i) => normalize(i.name) === normalize(name));
  try {
    if (existing) {
      const patch = { done: false, updatedAt: Date.now() };
      if (qty) patch.qty = qty;
      await updateDoc(itemRef(existing.id), patch);
      if (!existing.done) toast(`"${existing.name}" כבר ברשימה`);
    } else {
      await addDoc(itemsCol(), {
        name,
        qty,
        note: "",
        done: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        addedBy: firstName(user),
      });
    }
  } catch (err) {
    onError(err);
  }
});

function toggleItem(item) {
  updateDoc(itemRef(item.id), {
    done: !item.done,
    doneAt: item.done ? null : Date.now(),
    doneBy: item.done ? null : firstName(user),
    updatedAt: Date.now(),
  }).catch(onError);
}

async function editItem(item) {
  const d = $("editDialog");
  $("editName").value = item.name;
  $("editQty").value = item.qty ?? "";
  $("editNote").value = item.note ?? "";
  if ((await openDialog(d, $("editName"))) !== "ok") return;
  const name = $("editName").value.trim().replace(/\s+/g, " ");
  if (!name) return;
  updateDoc(itemRef(item.id), {
    name,
    qty: $("editQty").value.trim(),
    note: $("editNote").value.trim(),
    updatedAt: Date.now(),
  }).catch(onError);
}

function removeItem(item) {
  deleteDoc(itemRef(item.id)).catch(onError);
  toast(`"${item.name}" נמחק`, "ביטול", () => {
    const { id, ...data } = item;
    addDoc(itemsCol(), data).catch(onError);
  });
}

$("clearDone").addEventListener("click", async () => {
  const done = items.filter((i) => i.done);
  if (!done.length) return;
  try {
    await deleteInBatches(done.map((i) => itemRef(i.id)));
  } catch (err) {
    onError(err);
  }
});

function renderItems() {
  const todo = items.filter((i) => !i.done).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const done = items.filter((i) => i.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));

  $("todoList").replaceChildren(...todo.map(renderItem));
  $("doneList").replaceChildren(...done.map(renderItem));
  $("doneCount").textContent = done.length;
  $("doneSection").classList.toggle("hidden", done.length === 0);
  $("emptyMsg").classList.toggle("hidden", todo.length > 0 || !itemsLoaded);

  const names = [...new Set(items.map((i) => i.name))];
  $("suggestions").replaceChildren(...names.map((n) => {
    const opt = document.createElement("option");
    opt.value = n;
    return opt;
  }));
}

function renderItem(item) {
  const li = document.createElement("li");
  li.className = "item";

  const check = document.createElement("button");
  check.type = "button";
  check.className = "check";
  check.setAttribute("aria-label", item.done ? "החזרה לרשימה" : "סימון כנקנה");
  check.addEventListener("click", () => toggleItem(item));

  const body = document.createElement("div");
  body.className = "item-body";
  body.addEventListener("click", () => toggleItem(item));

  const title = document.createElement("div");
  title.className = "item-title";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = item.name;
  title.append(name);
  if (item.qty) {
    const qty = document.createElement("span");
    qty.className = "qty";
    qty.textContent = item.qty;
    title.append(qty);
  }
  body.append(title);

  const metaParts = [];
  if (item.note) metaParts.push(item.note);
  if (item.done && item.doneBy) metaParts.push(`נקנה ע״י ${item.doneBy}`);
  else if (item.addedBy) metaParts.push(`נוסף ע״י ${item.addedBy}`);
  if (metaParts.length) {
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = metaParts.join(" · ");
    body.append(meta);
  }

  const edit = iconButton("✏️", "עריכה", () => editItem(item));
  const del = iconButton("✕", "מחיקה", () => removeItem(item));

  li.append(check, body, edit, del);
  return li;
}

function iconButton(text, label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "icon-btn";
  b.textContent = text;
  b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

// ---------- menu ----------

$("menuBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("menu").classList.toggle("hidden");
});
document.addEventListener("click", () => $("menu").classList.add("hidden"));

$("menu").addEventListener("click", async (e) => {
  const action = e.target.closest("button")?.dataset.action;
  if (!action) return;
  $("menu").classList.add("hidden");
  if (action === "new") {
    const name = await askText("שם הרשימה החדשה");
    if (name) createList(name).catch(onError);
  } else if (action === "rename") renameList();
  else if (action === "delete") deleteList();
  else if (action === "logout") logout();
});

// ---------- helpers ----------

function openDialog(dialog, focusEl) {
  dialog.returnValue = "";
  dialog.showModal();
  if (focusEl) {
    focusEl.focus();
    focusEl.select?.();
  }
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true });
  });
}

async function askText(title, initial = "") {
  $("promptTitle").textContent = title;
  $("promptInput").value = initial;
  const result = await openDialog($("promptDialog"), $("promptInput"));
  return result === "ok" ? $("promptInput").value.trim() : null;
}

async function askConfirm(title, text) {
  $("confirmTitle").textContent = title;
  $("confirmText").textContent = text;
  return (await openDialog($("confirmDialog"))) === "ok";
}

let toastTimer = null;
function toast(message, actionLabel, onAction) {
  const el = $("toast");
  el.replaceChildren(document.createTextNode(message));
  if (actionLabel) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = actionLabel;
    b.addEventListener("click", () => {
      el.classList.add("hidden");
      onAction();
    });
    el.append(b);
  }
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 4000);
}

function firstName(u) {
  return (u?.displayName || u?.email || "").split(/[\s@]/)[0];
}

function readLastList() {
  try {
    return localStorage.getItem(LAST_LIST_KEY);
  } catch {
    return null;
  }
}

function writeLastList(id) {
  try {
    localStorage.setItem(LAST_LIST_KEY, id);
  } catch {
    // Private mode: just don't remember the last list.
  }
}
