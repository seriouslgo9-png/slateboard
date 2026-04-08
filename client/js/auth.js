(function () {
  const loginTab = document.getElementById("login-tab");
  const registerTab = document.getElementById("register-tab");
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const feedback = document.getElementById("auth-feedback");

  function setTab(name) {
    const loginActive = name === "login";
    loginTab.classList.toggle("is-active", loginActive);
    registerTab.classList.toggle("is-active", !loginActive);
    loginForm.hidden = !loginActive;
    registerForm.hidden = loginActive;
    feedback.hidden = true;
  }

  async function send(path, payload) {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(function () {
      return {};
    });

    if (!response.ok) {
      throw new Error(data.message || "Request failed.");
    }

    return data;
  }

  function showError(message) {
    feedback.hidden = false;
    feedback.textContent = message;
    feedback.dataset.kind = "error";
  }

  loginTab.addEventListener("click", function () {
    setTab("login");
  });

  registerTab.addEventListener("click", function () {
    setTab("register");
  });

  loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    try {
      await send("/api/auth/login", {
        email: document.getElementById("login-email").value,
        password: document.getElementById("login-password").value,
      });
      window.location.href = "./dashboard.html";
    } catch (error) {
      showError(error.message);
    }
  });

  registerForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    try {
      await send("/api/auth/register", {
        displayName: document.getElementById("register-name").value,
        email: document.getElementById("register-email").value,
        password: document.getElementById("register-password").value,
      });
      window.location.href = "./dashboard.html";
    } catch (error) {
      showError(error.message);
    }
  });

  setTab("login");
})();
