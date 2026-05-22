(function () {
  "use strict";

  const query = new URLSearchParams(window.location.search);
  const defaults = window.APP_CONFIG || {};
  const config = {
    apiBaseUrl: query.get("apiBaseUrl") || defaults.apiBaseUrl || "",
    roomId: query.get("roomId") || defaults.roomId || "",
    secret: query.get("secret") || defaults.secret || "",
    role: query.get("role") || defaults.role || "simple",
    pollIntervalMs: Number(query.get("pollIntervalMs") || defaults.pollIntervalMs || 7000),
  };

  const state = {
    mode: config.role === "normal" ? "normal" : "simple",
    lastSeenAt: "",
    messages: [],
    pendingTranscript: "",
    isRecording: false,
    recognition: null,
    selectedImageFile: null,
    isSending: false,
    pollTimer: null,
  };

  const elements = {
    title: document.getElementById("screenTitle"),
    modeToggle: document.getElementById("modeToggle"),
    statusBanner: document.getElementById("statusBanner"),
    messageList: document.getElementById("messageList"),
    simpleComposer: document.getElementById("simpleComposer"),
    normalComposer: document.getElementById("normalComposer"),
    simpleRecordButton: document.getElementById("simpleRecordButton"),
    draftPreview: document.getElementById("draftPreview"),
    draftText: document.getElementById("draftText"),
    confirmDraftButton: document.getElementById("confirmDraftButton"),
    cancelDraftButton: document.getElementById("cancelDraftButton"),
    messageInput: document.getElementById("messageInput"),
    sendTextButton: document.getElementById("sendTextButton"),
    imageInput: document.getElementById("imageInput"),
    sendImageButton: document.getElementById("sendImageButton"),
    imageName: document.getElementById("imageName"),
  };

  function init() {
    if (!config.apiBaseUrl || !config.roomId || !config.secret) {
      setStatus("config.js または URL パラメータに apiBaseUrl / roomId / secret を設定してください。", "error");
    }

    bindEvents();
    applyMode(state.mode);
    renderMessages();
    fetchMessages({ initial: true });
    startPolling();
  }

  function bindEvents() {
    elements.modeToggle.addEventListener("click", toggleMode);
    elements.simpleRecordButton.addEventListener("click", onSimplePrimaryAction);
    elements.confirmDraftButton.addEventListener("click", onConfirmDraft);
    elements.cancelDraftButton.addEventListener("click", onCancelDraft);
    elements.sendTextButton.addEventListener("click", onSendText);
    elements.sendImageButton.addEventListener("click", onSendImage);
    elements.imageInput.addEventListener("change", onImageSelected);
    window.addEventListener("beforeunload", cleanupRecognition);
  }

  function toggleMode() {
    applyMode(state.mode === "simple" ? "normal" : "simple");
  }

  function applyMode(mode) {
    state.mode = mode;
    const isSimple = mode === "simple";
    elements.title.textContent = isSimple ? "かんたんメッセージ" : "ノーマルメッセージ";
    elements.modeToggle.textContent = isSimple ? "ノーマルへ" : "かんたんへ";
    elements.simpleComposer.classList.toggle("hidden", !isSimple);
    elements.normalComposer.classList.toggle("hidden", isSimple);
    renderMessages();
  }

  function renderMessages() {
    elements.messageList.innerHTML = "";

    if (state.messages.length === 0) {
      const empty = document.createElement("p");
      empty.className = "message-meta";
      empty.textContent = "まだメッセージはありません";
      elements.messageList.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();

    state.messages.forEach((message) => {
      const card = document.createElement("article");
      const isSelf = message.senderRole === state.mode;
      card.className = [
        "message-card",
        isSelf ? "self" : "",
        state.mode === "simple" ? "simple" : "",
      ]
        .filter(Boolean)
        .join(" ");

      const meta = document.createElement("span");
      meta.className = "message-meta";
      meta.textContent = `${message.senderRole === "simple" ? "かんたん" : "ノーマル"} · ${formatTimestamp(
        message.createdAt
      )}`;
      card.appendChild(meta);

      if (message.type === "image" && message.imageUrl) {
        const image = document.createElement("img");
        image.className = "message-image";
        image.src = message.imageUrl;
        image.alt = "送信された画像";
        image.loading = "lazy";
        card.appendChild(image);
      }

      if (message.text) {
        const text = document.createElement("p");
        text.className = "message-text";
        text.textContent = message.text;
        card.appendChild(text);
      }

      fragment.appendChild(card);
    });

    elements.messageList.appendChild(fragment);
    elements.messageList.scrollTop = elements.messageList.scrollHeight;
  }

  function onSimplePrimaryAction() {
    if (state.isSending) {
      return;
    }

    if (state.pendingTranscript) {
      return;
    }

    if (state.isRecording) {
      stopRecognition();
      return;
    }

    startRecognition();
  }

  function startRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setStatus("このブラウザでは音声入力が使えません。ノーマル画面を使ってください。", "error");
      return;
    }

    cleanupRecognition();

    const recognition = new SpeechRecognition();
    recognition.lang = "ja-JP";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    let finalTranscript = "";

    recognition.onstart = function () {
      state.isRecording = true;
      elements.simpleRecordButton.textContent = "録音完了";
      elements.simpleRecordButton.classList.add("is-recording");
      setStatus("話してください。終わったら「録音完了」を押します。");
    };

    recognition.onresult = function (event) {
      let interimTranscript = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0] ? result[0].transcript : "";

        if (result.isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      elements.draftPreview.classList.remove("hidden");
      elements.draftText.textContent = (finalTranscript || interimTranscript || "").trim();
    };

    recognition.onerror = function (event) {
      cleanupRecognition();
      state.pendingTranscript = "";
      elements.draftPreview.classList.add("hidden");
      setStatus(`音声入力に失敗しました: ${event.error}`, "error");
    };

    recognition.onend = function () {
      const transcript = (finalTranscript || elements.draftText.textContent || "").trim();
      state.isRecording = false;
      elements.simpleRecordButton.textContent = "メッセージ送信";
      elements.simpleRecordButton.classList.remove("is-recording");

      if (transcript) {
        state.pendingTranscript = transcript;
        elements.draftText.textContent = transcript;
        elements.draftPreview.classList.remove("hidden");
        setStatus("内容を確認してから送信してください。", "success");
      } else {
        elements.draftPreview.classList.add("hidden");
        setStatus("音声が聞き取れませんでした。もう一度お試しください。", "error");
      }
    };

    state.recognition = recognition;
    recognition.start();
  }

  function stopRecognition() {
    if (state.recognition) {
      state.recognition.stop();
    }
  }

  function cleanupRecognition() {
    if (!state.recognition) {
      return;
    }

    state.recognition.onstart = null;
    state.recognition.onresult = null;
    state.recognition.onerror = null;
    state.recognition.onend = null;
    try {
      state.recognition.abort();
    } catch (error) {
      // Ignore abort errors when recognition already ended.
    }
    state.recognition = null;
    state.isRecording = false;
    elements.simpleRecordButton.textContent = "メッセージ送信";
    elements.simpleRecordButton.classList.remove("is-recording");
  }

  async function onConfirmDraft() {
    if (!state.pendingTranscript) {
      return;
    }

    await sendMessage({
      type: "text",
      text: state.pendingTranscript,
      senderRole: "simple",
    });

    state.pendingTranscript = "";
    elements.draftText.textContent = "";
    elements.draftPreview.classList.add("hidden");
  }

  function onCancelDraft() {
    state.pendingTranscript = "";
    elements.draftText.textContent = "";
    elements.draftPreview.classList.add("hidden");
    setStatus("送信を取り消しました。");
  }

  async function onSendText() {
    const text = elements.messageInput.value.trim();
    if (!text) {
      setStatus("送信する文字を入力してください。", "error");
      return;
    }

    const success = await sendMessage({
      type: "text",
      text,
      senderRole: "normal",
    });

    if (success) {
      elements.messageInput.value = "";
    }
  }

  function onImageSelected(event) {
    const [file] = event.target.files || [];
    state.selectedImageFile = file || null;
    elements.imageName.textContent = file ? `選択中: ${file.name}` : "画像はまだ選ばれていません";
  }

  async function onSendImage() {
    if (!state.selectedImageFile) {
      setStatus("送信する画像を選んでください。", "error");
      return;
    }

    const imageData = await fileToDataUrl(state.selectedImageFile);
    const success = await sendMessage({
      type: "image",
      text: "",
      senderRole: "normal",
      imageData,
      fileName: state.selectedImageFile.name,
      mimeType: state.selectedImageFile.type || "image/jpeg",
    });

    if (success) {
      state.selectedImageFile = null;
      elements.imageInput.value = "";
      elements.imageName.textContent = "画像はまだ選ばれていません";
    }
  }

  async function sendMessage(payload) {
    if (!config.apiBaseUrl || !config.roomId || !config.secret) {
      setStatus("送信前に config.js を設定してください。", "error");
      return false;
    }

    state.isSending = true;
    setStatus("送信しています...");

    try {
      const response = await fetch(config.apiBaseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
        },
        body: JSON.stringify({
          roomId: config.roomId,
          secret: config.secret,
          clientTimestamp: new Date().toISOString(),
          ...payload,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "送信に失敗しました。");
      }

      if (data.message) {
        upsertMessages([data.message]);
      }

      setStatus("送信しました。", "success");
      await fetchMessages();
      return true;
    } catch (error) {
      setStatus(error.message || "送信に失敗しました。", "error");
      return false;
    } finally {
      state.isSending = false;
    }
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = window.setInterval(fetchMessages, config.pollIntervalMs);
  }

  function stopPolling() {
    if (state.pollTimer) {
      window.clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  async function fetchMessages(options) {
    if (!config.apiBaseUrl || !config.roomId || !config.secret) {
      return;
    }

    const initial = options && options.initial;
    const since = !initial && state.lastSeenAt ? state.lastSeenAt : "";
    const url = new URL(config.apiBaseUrl);
    url.searchParams.set("roomId", config.roomId);
    url.searchParams.set("secret", config.secret);
    if (since) {
      url.searchParams.set("since", since);
    }

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "読み込みに失敗しました。");
      }

      const messages = Array.isArray(data.messages) ? data.messages : [];
      upsertMessages(messages);
      if (messages.length > 0 || initial) {
        setStatus(initial ? "会話を読み込みました。" : "最新メッセージを更新しました。");
      }
    } catch (error) {
      setStatus(error.message || "読み込みに失敗しました。", "error");
    }
  }

  function upsertMessages(incomingMessages) {
    if (!incomingMessages.length) {
      return;
    }

    const byId = new Map(state.messages.map((message) => [message.id, message]));
    incomingMessages.forEach((message) => {
      byId.set(message.id, message);
    });

    state.messages = Array.from(byId.values()).sort(function (left, right) {
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });
    state.lastSeenAt = state.messages[state.messages.length - 1].createdAt;
    renderMessages();
  }

  function setStatus(message, tone) {
    elements.statusBanner.textContent = message || "";
    elements.statusBanner.classList.remove("is-error", "is-success");
    if (tone === "error") {
      elements.statusBanner.classList.add("is-error");
    }
    if (tone === "success") {
      elements.statusBanner.classList.add("is-success");
    }
  }

  function formatTimestamp(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return new Intl.DateTimeFormat("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("画像の読み込みに失敗しました。"));
      };
      reader.readAsDataURL(file);
    });
  }

  init();
})();
