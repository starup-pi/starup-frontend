"use strict";
let account = null;
let csrfToken = "";
let policyVersion = "";
let nextFeed = null;
let waitingWorker = null;
let updateRequested = false;
const PUSH_STORAGE_KEY = "starup-push-id";
// Preserve the subscription reference across the brand change; it is not a token.
try {
  const legacyPushId = localStorage.getItem("nexora-push-id");
  if (legacyPushId && !localStorage.getItem(PUSH_STORAGE_KEY)) localStorage.setItem(PUSH_STORAGE_KEY, legacyPushId);
  localStorage.removeItem("nexora-push-id");
} catch { /* Restricted storage must not prevent the public feed from loading. */ }
const byId = (id) => document.getElementById(id);
const notice = (message) => { byId("notice").textContent = message; };
const statuses = {
  OPEN: "Aberta", IN_PROGRESS: "Em andamento", COMPLETED: "Concluída",
  CANCELLED: "Cancelada", SUBMITTED: "Enviada", ACCEPTED: "Aceita",
  DELIVERED: "Entregue", REJECTED: "Rejeitada", WITHDRAWN: "Retirada"
};
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, handler) {
  const node = element("button", text);
  node.type = "button";
  node.addEventListener("click", () => run(handler, node));
  return node;
}
async function run(action, node) {
  if (node) node.disabled = true;
  try { await action(); }
  catch (error) { notice(error.message || "Não foi possível concluir a ação."); }
  finally { if (node) node.disabled = false; }
}
async function api(path, { method = "GET", data, publicRead = false } = {}) {
  if (new URL(path, location.origin).origin !== location.origin) throw new Error("Destino não permitido.");
  if (method !== "GET" && !navigator.onLine) throw new Error("Conecte-se para concluir esta ação.");
  const response = await fetch(path, {
    method, credentials: publicRead ? "omit" : "same-origin",
    cache: "no-store",
    headers: publicRead ? {} : data ? { "Content-Type": "application/json", "X-CSRFToken": csrfToken } :
      { "X-CSRFToken": csrfToken },
    body: data ? JSON.stringify(data) : undefined
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fields = body.fields ? Object.entries(body.fields).map(([key, value]) => key + ": " + value).join(" ") : "";
    throw new Error([body.message || "Não foi possível concluir a solicitação.", fields].filter(Boolean).join(" "));
  }
  if (publicRead && response.headers.get("X-StarUP-Cached-At")) body.cachedAt = Number(response.headers.get("X-StarUP-Cached-At"));
  return body;
}
async function initCsrf() {
  const result = await api("/api/v1/auth/csrf/");
  csrfToken = result.csrf_token;
  policyVersion = result.policy_version;
}
function renderAccount() {
  byId("auth-panel").hidden = Boolean(account);
  byId("account-panel").hidden = !account;
  byId("demand-panel").hidden = account?.role !== "CLIENT";
  byId("workspace-panel").hidden = !account || account.role === "INVESTOR";
  byId("private-demands-panel").hidden = account?.role !== "CLIENT";
  if (account) {
    byId("account-title").textContent = account.role === "INVESTOR" ?
      "Sua vitrine privada" : (account.profile.name || account.profile.display_name || "Sua conta");
  }
}
async function restoreAccount() {
  try { account = await api("/api/v1/me/"); } catch { account = null; }
  renderAccount();
  if (account && account.role !== "INVESTOR") await loadWorkspace();
}
function renderPost(post) {
  const content = post.content;
  const card = element("article", undefined, "card");
  const type = { DEMAND: "Demanda", STARTUP: "Startup", REVIEWED_SOLUTION: "Solução avaliada" }[post.kind];
  card.append(element("span", type, "meta"));
  card.append(element("h3", content.title || content.name || content.demand_title));
  if (post.kind === "DEMAND") {
    card.append(element("p", content.description));
    card.append(element("p", statuses[content.status], "meta"));
    if (account?.role === "STARTUP" && content.status === "OPEN") {
      const details = element("details");
      details.append(element("summary", "Enviar proposta"));
      const form = document.createElement("form");
      const label = element("label", "Como sua startup resolve esta demanda?");
      const textarea = document.createElement("textarea");
      textarea.required = true; textarea.maxLength = 10000;
      label.append(textarea); form.append(label, element("button", "Enviar proposta"));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        run(async () => {
          await api("/api/v1/solutions/", { method: "POST", data: { demand_id: content.id, proposal: textarea.value } });
          textarea.value = ""; notice("Proposta enviada."); await loadWorkspace();
        }, form.querySelector("button"));
      });
      details.append(form); card.append(details);
    }
  } else if (post.kind === "STARTUP") {
    card.append(element("p", content.description));
    card.append(element("p", content.review_count ? Number(content.average_rating).toFixed(1) + "/5 · " + content.review_count + " avaliações" : "Ainda sem avaliações", "meta"));
    if (content.website) {
      try {
        const url = new URL(content.website);
        if (["https:", "http:"].includes(url.protocol)) {
          const link = element("a", "Conhecer a startup");
          link.href = url.href; link.rel = "noopener noreferrer"; link.target = "_blank"; card.append(link);
        }
      } catch { /* Do not render invalid legacy URLs. */ }
    }
  } else {
    card.append(element("p", content.startup_name + " · " + content.rating + "/5 estrelas"));
  }
  return card;
}
async function loadFeed(append = false) {
  const path = append && nextFeed ? new URL(nextFeed).pathname + new URL(nextFeed).search : "/api/v1/feed/";
  const result = await api(path, { publicRead: true });
  if (!append) byId("feed").replaceChildren();
  result.results.forEach((post) => byId("feed").append(renderPost(post)));
  if (!append && !result.results.length) byId("feed").append(element("p", "A vitrine está pronta para receber as primeiras demandas."));
  nextFeed = result.next; byId("more-feed").hidden = !nextFeed;
  byId("feed-status").textContent = result.cachedAt ?
    "Cópia salva em " + new Date(result.cachedAt).toLocaleString("pt-BR") + ". Atualização em segundo plano quando houver conexão." : navigator.onLine ?
    "Conteúdo público. Atualização em segundo plano quando disponível." :
    "Exibindo a última cópia salva. Conecte-se para verificar atualizações.";
}
async function transition(solution, target, delivery = "") {
  await api("/api/v1/solutions/" + solution.id + "/transition/", {
    method: "POST", data: { status: target, ...(delivery ? { delivery } : {}) }
  });
  notice("Proposta atualizada."); await loadWorkspace(); await loadFeed();
}
async function loadWorkspace(path = "/api/v1/solutions/", append = false) {
  const result = await api(path);
  if (!append) byId("solutions").replaceChildren();
  byId("more-solutions")?.remove();
  for (const solution of result.results) {
    const card = element("article", undefined, "card");
    card.append(element("h3", solution.startup_name), element("p", solution.proposal),
      element("p", statuses[solution.status], "meta"));
    if (solution.delivery) card.append(element("p", solution.delivery));
    if (account.role === "CLIENT" && solution.status === "SUBMITTED") {
      card.append(button("Aceitar proposta", () => transition(solution, "ACCEPTED")));
      card.append(button("Rejeitar", () => transition(solution, "REJECTED")));
    }
    if (account.role === "STARTUP" && solution.status === "SUBMITTED")
      card.append(button("Retirar proposta", () => transition(solution, "WITHDRAWN")));
    if (account.role === "STARTUP" && solution.status === "ACCEPTED")
      card.append(button("Iniciar execução", () => transition(solution, "IN_PROGRESS")));
    if (account.role === "STARTUP" && solution.status === "IN_PROGRESS") {
      const form = document.createElement("form");
      const label = element("label", "Descreva a entrega");
      const input = document.createElement("textarea"); input.required = true; input.maxLength = 10000;
      label.append(input); form.append(label, element("button", "Registrar entrega"));
      form.addEventListener("submit", (event) => { event.preventDefault(); run(() => transition(solution, "DELIVERED", input.value), form.querySelector("button")); });
      card.append(form);
    }
    if (account.role === "CLIENT" && solution.status === "DELIVERED") {
      const form = document.createElement("form");
      const label = element("label", "Confirme a entrega com sua avaliação");
      const select = document.createElement("select");
      [1, 2, 3, 4, 5].forEach((rating) => { const option = element("option", rating + " estrelas"); option.value = rating; select.append(option); });
      label.append(select); form.append(label, element("button", "Confirmar entrega e avaliar"));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        run(async () => {
          await api("/api/v1/reviews/", { method: "POST", data: { solution_id: solution.id, rating: Number(select.value) } });
          notice("Avaliação registrada."); await loadWorkspace(); await loadFeed();
        }, form.querySelector("button"));
      });
      card.append(form);
    }
    byId("solutions").append(card);
  }
  if (result.next) {
    const more = button("Carregar mais propostas", () => loadWorkspace(result.next, true));
    more.id = "more-solutions"; byId("solutions").append(more);
  }
  if (account.role === "CLIENT" && !append) await loadPrivateDemands();
}
async function loadPrivateDemands(path = "/api/v1/demands/?mine=true&visibility=PRIVATE", append = false) {
    const demands = await api(path);
    if (!append) byId("private-demands").replaceChildren();
    byId("more-private-demands")?.remove();
    for (const demand of demands.results.filter((item) => item.visibility === "PRIVATE")) {
      const card = element("article", undefined, "card");
      card.append(element("h3", demand.title), element("p", statuses[demand.status], "meta"));
      if (demand.status === "OPEN") card.append(button("Publicar na vitrine", async () => {
        await api("/api/v1/demands/" + demand.id + "/", { method: "PATCH", data: { visibility: "PUBLIC" } });
        await loadWorkspace(); await loadFeed();
      }));
      byId("private-demands").append(card);
    }
    if (demands.next) {
      const more = button("Carregar mais demandas", () => loadPrivateDemands(demands.next, true));
      more.id = "more-private-demands"; byId("private-demands").append(more);
    }
}
byId("login-form").addEventListener("submit", (event) => {
  event.preventDefault(); const form = event.currentTarget;
  run(async () => {
    const result = await api("/api/v1/auth/login/", { method: "POST", data: Object.fromEntries(new FormData(form)) });
    csrfToken = result.csrf_token; form.reset(); await restoreAccount(); await loadFeed();
  }, form.querySelector("button"));
});
function registrationRole() {
  const role = byId("register-form").elements.role.value;
  document.querySelectorAll("[data-registration]").forEach((node) => {
    node.hidden = node.dataset.registration !== role;
    node.querySelectorAll("input,select,textarea").forEach((input) => { input.disabled = node.hidden; });
  });
}
byId("register-form").elements.role.addEventListener("change", registrationRole);
byId("register-form").addEventListener("submit", (event) => {
  event.preventDefault(); const form = event.currentTarget;
  run(async () => {
    const data = Object.fromEntries(new FormData(form)); delete data.policy; data.policy_version = policyVersion;
    await api("/api/v1/auth/register/", { method: "POST", data });
    form.reset(); registrationRole(); notice("Solicitação recebida. Entre com seus dados para continuar.");
  }, form.querySelector("button"));
});
byId("demand-form").addEventListener("submit", (event) => {
  event.preventDefault(); const form = event.currentTarget;
  run(async () => {
    await api("/api/v1/demands/", { method: "POST", data: Object.fromEntries(new FormData(form)) });
    form.reset(); notice("Demanda criada."); await loadFeed(); await loadWorkspace();
  }, form.querySelector("button"));
});
byId("logout").addEventListener("click", () => run(async () => {
  await api("/api/v1/auth/logout/", { method: "POST" });
  account = null; csrfToken = ""; renderAccount(); byId("solutions").replaceChildren(); byId("private-demands").replaceChildren();
  if ("serviceWorker" in navigator) navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_PRIVATE_DATA" });
  await initCsrf(); await loadFeed();
}));
byId("erase-account").addEventListener("click", () => run(async () => {
  if (!window.confirm("Excluir sua conta e retirar seus dados pessoais?")) return;
  await api("/api/v1/me/", { method: "DELETE" });
  location.reload();
}));
byId("refresh-feed").addEventListener("click", () => run(() => loadFeed()));
byId("more-feed").addEventListener("click", () => run(() => loadFeed(true)));
function base64Bytes(value) {
  const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
byId("enable-push").addEventListener("click", () => run(async () => {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Este navegador não oferece notificações push.");
  const config = await api("/api/v1/push/config/");
  if (!config.public_key) throw new Error("Notificações ainda não foram configuradas.");
  if (await Notification.requestPermission() !== "granted") throw new Error("Notificações não autorizadas.");
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64Bytes(config.public_key) });
  const response = await api("/api/v1/push/subscriptions/", {
    method: "POST", data: { endpoint: subscription.endpoint, keys: subscription.toJSON().keys, consent: true }
  });
  localStorage.setItem(PUSH_STORAGE_KEY, response.id); notice("Notificações ativadas.");
}));
byId("disable-push").addEventListener("click", () => run(async () => {
  const id = localStorage.getItem(PUSH_STORAGE_KEY);
  if (id) await api("/api/v1/push/subscriptions/" + id + "/", { method: "DELETE" });
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
  }
  localStorage.removeItem(PUSH_STORAGE_KEY); notice("Notificações desativadas.");
}));
function networkState() {
  byId("network-status").hidden = navigator.onLine;
  byId("network-status").textContent = "Você está offline. A vitrine salva continua disponível; ações precisam de conexão.";
}
window.addEventListener("offline", networkState);
window.addEventListener("online", () => { networkState(); run(async () => { await initCsrf(); await restoreAccount(); await loadFeed(); }); });
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js").then((registration) => {
    const update = () => { waitingWorker = registration.waiting; byId("update-banner").hidden = !waitingWorker; };
    update();
    registration.addEventListener("updatefound", () => {
      registration.installing?.addEventListener("statechange", update);
    });
  }).catch(() => notice("Não foi possível ativar o modo offline."));
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!updateRequested || reloading) return; reloading = true; location.reload();
  });
}
byId("update-app").addEventListener("click", () => {
  updateRequested = true; waitingWorker?.postMessage({ type: "ACTIVATE_UPDATE" });
});
registrationRole(); networkState();
run(async () => {
  if (navigator.onLine) {
    try {
      await initCsrf(); await restoreAccount();
      const categories = await api("/api/v1/categories/", { publicRead: true });
      categories.results.forEach((category) => {
        const option = element("option", category.name); option.value = category.id; byId("category-select").append(option);
      });
    } catch { notice("O acesso à conta está indisponível. A vitrine salva pode continuar acessível."); }
  }
  await loadFeed();
});
