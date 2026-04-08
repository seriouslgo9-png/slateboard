(function () {
  const boardsGrid = document.getElementById("boards-grid");
  const emptyState = document.getElementById("dashboard-empty");
  const newBoardButton = document.getElementById("new-board-button");
  const logoutButton = document.getElementById("logout-button");
  const dashboardUser = document.getElementById("dashboard-user");

  function renderBoards(items) {
    boardsGrid.innerHTML = "";
    emptyState.hidden = items.length > 0;

    items.forEach(function (item) {
      const card = document.createElement("article");
      card.className = "dashboard-card card";
      card.innerHTML =
        '<p class="eyebrow">' + item.roomKey + "</p>" +
        "<h2>" + (item.title || "Untitled board") + "</h2>" +
        '<p class="dashboard-meta">Updated ' + new Date(item.updatedAt).toLocaleString() + "</p>" +
        '<a class="btn btn-secondary" href="./board.html?roomKey=' + encodeURIComponent(item.roomKey) + '">Open board</a>';
      boardsGrid.appendChild(card);
    });
  }

  async function fetchJson(path, options) {
    const response = await fetch(path, Object.assign(
      {
        credentials: "include",
      },
      options || {},
    ));

    const data = await response.json().catch(function () {
      return {};
    });

    if (!response.ok) {
      throw new Error(data.message || "Request failed.");
    }

    return data;
  }

  async function loadBoards() {
    try {
      const auth = await fetchJson("/api/auth/refresh", { method: "POST" });
      if (auth && auth.user) {
        dashboardUser.textContent = auth.user.displayName || auth.user.email;
      }

      const boards = await fetchJson("/api/boards");
      renderBoards(boards);
    } catch (error) {
      window.location.href = "./auth.html";
    }
  }

  newBoardButton.addEventListener("click", async function () {
    try {
      const board = await fetchJson("/api/boards", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "Untitled board" }),
      });
      window.location.href = "./board.html?roomKey=" + encodeURIComponent(board.roomKey);
    } catch (error) {
      dashboardUser.textContent = error.message;
    }
  });

  logoutButton.addEventListener("click", async function () {
    try {
      await fetch("/api/auth/logout", {
        method: "DELETE",
        credentials: "include",
      });
    } finally {
      window.location.href = "./auth.html";
    }
  });

  loadBoards();
})();
