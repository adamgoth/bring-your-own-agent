import {
  agentboard,
  type AgentTask,
  type Connection,
  type TaskEvent,
} from "../../../byoa-extension/sdk";
import {
  BoardStore,
  restore,
  seed,
  type Card,
  type Change,
  type Column,
} from "./board";
import { registerTools } from "./tools";
import "./style.css";

const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="m5 12 14-7-7 14-2-7-5 0Z"/><path d="m10 12 9-7"/>',
  sparkle:
    '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  undo: '<path d="M3 10h12a6 6 0 0 1 0 12M3 10l5-5M3 10l5 5"/>',
};
function icon(name: keyof typeof icons) {
  return `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}
const esc = (text: unknown) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
let connection: Connection = {
  available: false,
  configured: false,
  connected: false,
};
let connecting = false;
let task: TaskEvent | null = null;
let activeTask: AgentTask | undefined;
let taskDismissed = false;
let restoreMessage = "";
let initial = seed;
try {
  initial = restore(localStorage.getItem("boardwalk-v1"));
} catch {
  restoreMessage =
    "Saved board could not be restored. Showing the sample board.";
}
let store: BoardStore;
const save = () => {
  try {
    localStorage.setItem(
      "boardwalk-v1",
      JSON.stringify({ ...store.state, proposals: [] }),
    );
  } catch {
    toast("Browser storage is unavailable. Keep this tab open.");
  }
  renderBoard();
  renderReview();
  renderStats();
};
store = new BoardStore(initial, save);
let toolsStatus = "Checking page tools…";

document.querySelector("#app")!.innerHTML = `
  <aside class="sidebar"><a class="brand" href="#" aria-label="Boardwalk home"><span class="brand-mark">${icon("grid")}</span>boardwalk<span class="brand-period">.</span></a>
    <div class="workspace-picker"><span class="workspace-avatar">S</span><span>Studio workspace<small>Personal space</small></span>${icon("chevron")}</div>
    <div class="nav-label">WORKSPACE</div><button class="nav-item active" data-action="board">${icon("grid")} Project board <span>01</span></button>
    <button class="nav-item" data-action="review">${icon("sparkle")} Agent proposals <span id="nav-pending">0</span></button>
    <div class="sidebar-note"><span class="note-symbol">✳</span><strong>Your board.<br>Your agent.</strong><p>Bring the agent you already use. Keep the work here.</p><button data-action="connect-menu">Connect an agent <span>↗</span></button></div>
    <div class="sidebar-bottom"><span class="small-dot"></span> DEMO 02 <span>WEBMCP</span></div>
  </aside>
  <div class="main-shell"><header class="topbar"><div class="breadcrumb">Studio <span>/</span> Projects <span>/</span> <strong>Summer launch</strong></div><div class="top-actions"><div class="connection-wrap"><button id="agent-indicator" class="connection-button" data-action="connect-menu" aria-expanded="false" aria-controls="connection-menu"></button><div id="connection-menu" class="connection-menu" hidden></div></div><span class="user-avatar" title="Sample workspace">S</span></div></header>
  <main><div class="page-heading"><div><div class="eyebrow">THE SUMMER LAUNCH</div><h1>A little more momentum.</h1><p>A home for the next good idea. And the small steps that get it there.</p></div><div class="heading-actions"><button class="button secondary" data-action="new">${icon("plus")} New card</button><button class="button primary" data-action="ask">${icon("sparkle")} Ask agent</button></div></div>
  <div class="board-toolbar"><div class="board-tab">${icon("grid")} Board <span class="tab-count" id="total-count"></span></div><div class="board-progress" id="board-progress"></div><div class="toolbar-end"><button class="quiet" id="undo-button" data-action="undo">${icon("undo")} Undo</button><span class="toolbar-divider"></span><span id="selection-count">All cards</span></div></div>
  <div id="board" class="board" aria-label="Project board"></div>
  <div class="board-footer"><span><span class="small-dot"></span> Saved in this browser</span><button class="quiet" data-action="tools">Made for people & their agents ${icon("sparkle")}</button></div>
  <details id="tool-details" class="tool-details"><summary>Developer tools</summary><p id="tool-status"></p><p>Page tools: get_board_snapshot · get_selected_cards · propose_board_changes</p><p>This demo uses the same BYOA client as Margin. No app-specific extension handlers.</p></details>
  </main><div id="task-status" class="task-status" hidden></div></div>
  <aside id="review-panel" class="review-panel" aria-label="Agent proposals" hidden><div class="review-header"><div><span class="eyebrow">YOUR AGENT’S IDEAS</span><h2>A second pair of eyes.</h2></div><button class="icon-button" aria-label="Close proposals" data-action="close-review">${icon("close")}</button></div><p class="review-intro">Nothing changes until you say so. Review a proposal, then accept the batch or let it go.</p><div id="proposals"></div></aside>
  <dialog id="ask-dialog"><form id="ask-form"><div class="dialog-header"><div class="dialog-symbol">${icon("sparkle")}</div><button type="button" class="icon-button" data-action="close-ask" aria-label="Close agent request">${icon("close")}</button></div><h2>A little help moving forward.</h2><p id="ask-scope" class="dialog-subtitle"></p><label for="instruction">What would you like to do?</label><textarea id="instruction" rows="4" maxlength="5000" placeholder="Break the selected card into smaller tasks, prioritize the backlog, or plan a focused week…" required></textarea><div class="prompt-chips"><button type="button" data-prompt="Break the selected cards into small, actionable tasks. Propose new cards in Backlog and keep the original cards.">Break it down</button><button type="button" data-prompt="Read the whole board and propose priorities for a focused week. Explain your choices.">Find the focus</button><button type="button" data-prompt="Make the selected card titles and descriptions clearer and more actionable.">Make it clearer</button></div><div class="dialog-footer"><span>Proposals first. You have the final say.</span><button id="send-button" class="button primary" type="submit">${icon("arrow")} Send</button></div><p id="ask-error" class="error" role="alert" hidden></p></form></dialog>
  <dialog id="card-dialog"><form id="card-form"><div class="dialog-header"><span class="eyebrow">A SMALL NEXT STEP</span><button type="button" class="icon-button" data-action="close-card" aria-label="Close card">${icon("close")}</button></div><h2 id="card-dialog-title">Make room for an idea.</h2><input type="hidden" name="cardId"><label for="card-title">Title</label><input id="card-title" name="title" required maxlength="140" placeholder="What needs to happen?"><label for="card-description">Details</label><textarea id="card-description" name="description" rows="3" maxlength="2000" placeholder="A little context goes a long way."></textarea><div class="field-row"><div><label for="card-column">Column</label><select id="card-column" name="columnId">${store.state.columns.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div><div><label for="card-priority">Priority</label><select id="card-priority" name="priority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></div></div><div class="dialog-footer"><span>Keep it small. Keep it moving.</span><button class="button primary" type="submit">Save card</button></div></form></dialog>
  <div id="toast" class="toast" role="status" hidden></div>`;

function renderStats() {
  const count = store.state.cards.length;
  const done = store.state.cards.filter((c) => c.columnId === "done").length;
  $("#total-count").textContent = String(count);
  $("#board-progress").innerHTML =
    `<div class="progress-track"><span style="width:${count ? (done / count) * 100 : 0}%"></span></div><span>${done} of ${count} complete</span>`;
  $("#selection-count").innerHTML = store.selected.size
    ? `${store.selected.size} selected <button class="quiet" data-action="clear-selection">Clear</button>`
    : "All cards";
  $("#undo-button").toggleAttribute("disabled", !store.canUndo);
}
function tagColor(label: string) {
  return ["purple", "sage", "peach", "blue"][
    [...label].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4
  ];
}
function renderCard(card: Card) {
  const selected = store.selected.has(card.id);
  return `<article class="card ${selected ? "selected" : ""}" tabindex="0" draggable="true" data-card="${esc(card.id)}" aria-label="${esc(card.title)}" aria-selected="${selected}" role="option"><div class="card-top"><button class="card-checkbox ${selected ? "checked" : ""}" aria-label="Select ${esc(card.title)}" data-select="${esc(card.id)}" aria-pressed="${selected}">${selected ? icon("check") : ""}</button><span class="priority priority-${card.priority}"><span></span>${card.priority}</span><button class="card-menu" aria-label="Edit ${esc(card.title)}" data-edit="${esc(card.id)}">···</button></div><h3>${esc(card.title)}</h3><p>${esc(card.description)}</p><div class="card-footer"><div class="tags">${card.labels.map((label) => `<span class="tag ${tagColor(label)}">${esc(label)}</span>`).join("")}</div><select class="move-select" data-move="${esc(card.id)}" aria-label="Move ${esc(card.title)}"><option value="" selected disabled>Move ↗</option>${store.state.columns
    .filter((c) => c.id !== card.columnId)
    .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
    .join("")}</select></div></article>`;
}
function renderBoard() {
  $("#board").innerHTML = store.state.columns
    .map((column) => {
      const cards = store.state.cards.filter(
        (card) => card.columnId === column.id,
      );
      return `<section class="column" data-column="${column.id}" aria-label="${esc(column.name)}"><div class="column-header"><span class="column-dot" style="background:${column.color}"></span><h2>${esc(column.name)}</h2><span class="column-count">${cards.length}</span><button class="icon-button" aria-label="Add card to ${esc(column.name)}" data-new="${column.id}">${icon("plus")}</button></div><div class="card-list" role="listbox" aria-label="${esc(column.name)} cards" aria-multiselectable="true">${cards.map(renderCard).join("")}</div><button class="add-card" data-new="${column.id}">${icon("plus")} Add a card</button></section>`;
    })
    .join("");
}
function describe(change: Change, changes: Change[]) {
  const current = store.state.cards.find((c) => c.id === change.cardId);
  const columnName = (id?: string) =>
    store.state.columns.find((c) => c.id === id)?.name ||
    changes.find((c) => c.op === "create_column" && c.columnId === id)?.name ||
    id ||
    "";
  const details: string[] = [];
  let title = change.title || current?.title || "New card";
  let label: string = change.op;
  if (change.op === "create_column") {
    title = change.name!;
    label = "Create column";
  } else if (change.op === "rename_column") {
    title = `${columnName(change.columnId)} → ${change.name}`;
    label = "Rename column";
  } else if (change.op === "delete") {
    label = "Delete card";
    details.push(
      `Remove from ${columnName(current?.columnId)}. Undo can restore this card after acceptance.`,
    );
    if (current?.description) details.push(current.description);
  } else if (change.columnId) {
    details.push(
      `${current ? columnName(current.columnId) + " → " : ""}${columnName(change.columnId)}`,
    );
  }
  if (change.priority) details.push(`Priority: ${change.priority}`);
  if (change.description !== undefined) details.push(change.description);
  if (change.labels) details.push(`Labels: ${change.labels.join(", ")}`);
  return `<div class="proposal-change"><span class="change-op">${esc(label)}</span><strong>${esc(title)}</strong>${details.map((detail) => `<p>${esc(detail)}</p>`).join("")}</div>`;
}
function renderReview() {
  const pending = store.state.proposals.filter((p) => p.status === "pending");
  $("#nav-pending").textContent = String(pending.length);
  $("#proposals").innerHTML = pending.length
    ? pending
        .map(
          (proposal) =>
            `<section class="proposal"><div class="proposal-label">${icon("sparkle")} ${proposal.changes.length} proposed ${proposal.changes.length === 1 ? "change" : "changes"}</div><p class="proposal-reason">${esc(proposal.reason)}</p>${proposal.changes.map((change) => describe(change, proposal.changes)).join("")}${proposal.baseRevision !== store.state.revision ? '<p class="stale">The board changed. Ask for a fresh proposal.</p>' : ""}<div class="proposal-actions"><button class="button primary" data-accept="${esc(proposal.id)}" ${proposal.baseRevision !== store.state.revision ? "disabled" : ""}>Accept changes</button><button class="quiet" data-dismiss="${esc(proposal.id)}">Dismiss</button></div></section>`,
        )
        .join("")
    : `<div class="empty-review">${icon("sparkle")}<h3>A fresh perspective is welcome.</h3><p>Ask your agent to help. Its proposals will appear here for your review.</p><button class="button secondary" data-action="ask">Ask agent</button></div>`;
}
function renderConnection() {
  const label = connection.connected
    ? `${connection.agentName || "Agent connected"}${task?.busy ? " · Working…" : ""}`
    : "Not connected";
  $("#agent-indicator").innerHTML =
    `<span class="status-dot ${connection.connected ? "connected" : ""}"></span><span class="profile-name">${esc(label)}</span>${icon("chevron")}`;
  $("#agent-indicator").title = label;
  $("#connection-menu").innerHTML = `<strong>${connection.connected?esc(connection.agentName || "Your agent"):"Connect your agent"}</strong>${!connection.available?'<p>Enable BYOA, then reload this page.</p>':`<p>${connecting?'Choose a profile in the BYOA window.':connection.connected?'Your agent is connected. Change profiles in BYOA whenever you like.':'BYOA will ask you to choose a profile and approve this site.'}</p><button class="button primary" data-action="connect" ${connecting?'disabled':''}>${connecting?'Waiting for BYOA…':connection.connected?'Change profile':'Connect agent'}</button><div class="connection-actions"><button data-action="agent-settings">Agent settings</button>${connection.connected?'<button data-action="chat">View agent chat</button><button data-action="disconnect">Disconnect</button>':''}</div>`}`;
  $("#send-button").toggleAttribute(
    "disabled",
    !connection.connected || !!task?.busy,
  );
}
function renderTask() {
  renderConnection();
  const status = $("#task-status");
  status.hidden = !task || taskDismissed;
  if (!task) return;
  const title = task.busy
    ? task.status === "queued"
      ? "Waiting your turn"
      : "Your agent is working"
    : task.status === "done"
      ? "A little progress, together."
      : task.status === "cancelled"
        ? "Task stopped"
        : "Something needs attention";
  const detail =
    task.status === "done"
      ? "Review proposals on the board, or open the agent chat for details."
      : task.detail;
  status.innerHTML = `<span class="task-symbol ${task.busy ? "spinning" : ""}">${icon("sparkle")}</span><div><strong>${title}</strong><p>${esc(detail)}${task.usage ? ` · ${task.usage.totalTokens.toLocaleString()} tokens${task.usage.usageKnown ? "" : " (usage incomplete; step limit applies)"}` : ""}</p></div><div class="task-buttons">${task.busy ? '<button data-action="cancel">Cancel</button>' : '<button data-action="review">Review</button>'}<button data-action="chat">View chat</button>${!task.busy ? `<button class="icon-button" data-action="dismiss-task" aria-label="Dismiss task status">${icon("close")}</button>` : ""}</div>`;
}
function openAsk() {
  const selected = store.state.cards.filter((c) => store.selected.has(c.id));
  $("#ask-scope").textContent = selected.length
    ? `${selected.length} selected ${selected.length === 1 ? "card" : "cards"} · ${selected.map((c) => c.title).join(", ")}`
    : "Working with the whole board";
  $("#ask-error").hidden = true;
  renderConnection();
  ($("#ask-dialog") as HTMLDialogElement).showModal();
}
function openCard(columnId: Column = "backlog", id?: string) {
  const card = store.state.cards.find((c) => c.id === id);
  const form = $("#card-form") as HTMLFormElement;
  form.reset();
  $("#card-column").innerHTML = store.state.columns
    .map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`)
    .join("");
  for (const [name, value] of Object.entries({
    cardId: card?.id || "",
    title: card?.title || "",
    description: card?.description || "",
    columnId: card?.columnId || columnId,
    priority: card?.priority || "medium",
  }))
    (form.elements.namedItem(name) as HTMLInputElement).value = value;
  $("#card-dialog-title").textContent = card
    ? "A little more clarity."
    : "Make room for an idea.";
  ($("#card-dialog") as HTMLDialogElement).showModal();
}
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 5000);
}
const guarded = (operation: () => unknown | Promise<unknown>) => {
  try {
    Promise.resolve(operation()).catch((error) =>
      toast(error instanceof Error ? error.message : String(error)),
    );
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  }
};

document.addEventListener("click", (event) => {
  const target = event.target as Element;
  const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
  const prompt = target.closest<HTMLElement>("[data-prompt]")?.dataset.prompt;
  const select = target.closest<HTMLElement>("[data-select]")?.dataset.select;
  const edit = target.closest<HTMLElement>("[data-edit]")?.dataset.edit;
  const create = target.closest<HTMLElement>("[data-new]")?.dataset.new;
  const accept = target.closest<HTMLElement>("[data-accept]")?.dataset.accept;
  const dismiss =
    target.closest<HTMLElement>("[data-dismiss]")?.dataset.dismiss;
  if (prompt) {
    ($("#instruction") as HTMLTextAreaElement).value = prompt;
    $("#instruction").focus();
    return;
  }
  if (select) {
    store.toggle(select);
    return;
  }
  if (edit) {
    openCard("backlog", edit);
    return;
  }
  if (create) {
    openCard(create as Column);
    return;
  }
  if (accept) {
    guarded(() => store.accept(accept));
    return;
  }
  if (dismiss) {
    store.dismiss(dismiss);
    return;
  }
  if (action) {
    guarded(() => {
      switch (action) {
        case "new":
          openCard();
          break;
        case "ask":
          openAsk();
          break;
        case "close-ask":
          ($("#ask-dialog") as HTMLDialogElement).close();
          break;
        case "close-card":
          ($("#card-dialog") as HTMLDialogElement).close();
          break;
        case "connect-menu":
          $("#connection-menu").hidden = !$("#connection-menu").hidden;
          $("#agent-indicator").setAttribute(
            "aria-expanded",
            String(!$("#connection-menu").hidden),
          );
          break;
        case "connect":
          connecting = true; renderConnection();
          return agentboard.connect().then(value=>{connection=value;}).finally(()=>{connecting=false;renderConnection();});
        case "disconnect":
          return agentboard.disconnect().then((value) => {
            connection = value;
            renderConnection();
          });
        case "agent-settings":
          return agentboard.openSettings();
        case "chat":
          return agentboard.openChat(task?.taskId);
        case "cancel":
          activeTask?.cancel();
          break;
        case "review":
          $("#review-panel").hidden = false;
          break;
        case "close-review":
          $("#review-panel").hidden = true;
          break;
        case "board":
          $("#review-panel").hidden = true;
          break;
        case "clear-selection":
          store.selected.clear();
          renderBoard();
          renderStats();
          break;
        case "undo":
          store.undo();
          break;
        case "dismiss-task":
          taskDismissed = true;
          renderTask();
          break;
        case "tools":
          ($("#tool-details") as HTMLDetailsElement).open = !(
            $("#tool-details") as HTMLDetailsElement
          ).open;
          break;
      }
    });
  } else if (!target.closest(".connection-wrap")) {
    $("#connection-menu").hidden = true;
    $("#agent-indicator").setAttribute("aria-expanded", "false");
  }
  const article = target.closest<HTMLElement>("[data-card]");
  if (article && !target.closest("button,select,input"))
    store.toggle(article.dataset.card!);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    $("#connection-menu").hidden = true;
    $("#agent-indicator").setAttribute("aria-expanded", "false");
    $("#review-panel").hidden = true;
  }
  const target = event.target as HTMLElement;
  if (
    (event.key === "Enter" || event.key === " ") &&
    target.matches("[data-card]")
  ) {
    event.preventDefault();
    store.toggle(target.dataset.card!);
  }
});
document.addEventListener("change", (event) => {
  const target = event.target as HTMLSelectElement;
  if (target.dataset.move)
    guarded(() =>
      store.change([
        {
          op: "move",
          cardId: target.dataset.move,
          columnId: target.value as Column,
        },
      ]),
    );
});
let dragging: string | undefined;
document.addEventListener("dragstart", (event) => {
  dragging = (event.target as Element).closest<HTMLElement>("[data-card]")
    ?.dataset.card;
  if (dragging) event.dataTransfer?.setData("text/plain", dragging);
});
document.addEventListener("dragover", (event) => {
  if (dragging && (event.target as Element).closest("[data-column]"))
    event.preventDefault();
});
document.addEventListener("drop", (event) => {
  const column = (event.target as Element).closest<HTMLElement>("[data-column]")
    ?.dataset.column;
  if (dragging && column) {
    event.preventDefault();
    guarded(() =>
      store.change([
        { op: "move", cardId: dragging, columnId: column as Column },
      ]),
    );
  }
  dragging = undefined;
});
document.addEventListener("dragend", () => {
  dragging = undefined;
});
$("#card-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.target as HTMLFormElement);
  guarded(() => {
    const id = String(data.get("cardId") || "");
    store.change([
      {
        op: id ? "update" : "create",
        ...(id ? { cardId: id } : {}),
        title: String(data.get("title")),
        description: String(data.get("description")),
        columnId: data.get("columnId") as Column,
        priority: data.get("priority") as Card["priority"],
      },
    ]);
    ($("#card-dialog") as HTMLDialogElement).close();
  });
});
$("#ask-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const prompt = ($("#instruction") as HTMLTextAreaElement).value.trim();
  if (!connection.connected || task?.busy || !prompt) return;
  void (async () => {
    try {
      activeTask = await agentboard.request({
        prompt: `Read get_board_snapshot and get_selected_cards first. Propose changes for review rather than applying them.\n\nUser request: ${prompt}`,
        tools: [
          "get_board_snapshot",
          "get_selected_cards",
          "propose_board_changes",
        ],
      });
      ($("#ask-dialog") as HTMLDialogElement).close();
      for await (const _event of activeTask.events) {
        /* Task subscription renders progress. */
      }
      activeTask = undefined;
    } catch (error) {
      $("#ask-error").textContent =
        error instanceof Error ? error.message : String(error);
      $("#ask-error").hidden = false;
    }
  })();
});
agentboard.subscribe((value) => {
  connection = value;
  renderConnection();
});
agentboard.subscribeTasks((value) => {
  task = value;
  taskDismissed = false;
  renderTask();
  if (
    value?.status === "done" &&
    store.state.proposals.some((p) => p.status === "pending")
  )
    $("#review-panel").hidden = false;
});
void agentboard.getStatus().then((value) => {
  connection = value;
  renderConnection();
});
renderBoard();
renderStats();
renderReview();
renderConnection();
void registerTools(store, (status) => {
  toolsStatus = status;
  $("#tool-status").textContent = toolsStatus;
});
if (restoreMessage) toast(restoreMessage);

// Follow the visible header edge instead of reserving space after it scrolls away.
const topbar = $(".topbar");
const reviewPanel = $("#review-panel");
let reviewPositionFrame = 0;
function positionReviewPanel() {
  cancelAnimationFrame(reviewPositionFrame);
  reviewPositionFrame = requestAnimationFrame(() => {
    reviewPanel.style.setProperty(
      "--review-top",
      `${Math.max(0, topbar.getBoundingClientRect().bottom)}px`,
    );
  });
}
window.addEventListener("scroll", positionReviewPanel, { passive: true });
window.addEventListener("resize", positionReviewPanel);
positionReviewPanel();
