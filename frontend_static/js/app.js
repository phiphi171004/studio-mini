// State Management
let voicesData = [];
let selectedVideoFile = null;
let selectedAudioFile = null;
let activePollingInterval = null;
let currentAudioPlayer = null;

// Khởi chạy khi DOM sẵn sàng
document.addEventListener("DOMContentLoaded", () => {
  initDropzones();
  checkApiHealth();
  fetchVoices();

  // Lắng nghe sự kiện đổi giọng đọc
  document.getElementById("voice-select").addEventListener("change", handleVoiceSelectChange);
});

// Chuyển Tab
function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
  document.querySelectorAll(".tab-view").forEach(view => view.classList.remove("active"));

  if (tab === "dubbing") {
    document.getElementById("tab-dubbing-btn").classList.add("active");
    document.getElementById("view-dubbing").classList.add("active");
  } else {
    document.getElementById("tab-voices-btn").classList.add("active");
    document.getElementById("view-voices").classList.add("active");
  }
}

// Kiểm tra trạng thái Backend
async function checkApiHealth() {
  const pill = document.getElementById("api-status-pill");
  try {
    const res = await fetch("/api/health");
    if (res.ok) {
      pill.innerHTML = `<span class="status-dot online"></span><span class="status-text">Backend Connected</span>`;
      pill.style.borderColor = "rgba(16, 185, 129, 0.25)";
    } else {
      throw new Error();
    }
  } catch {
    pill.innerHTML = `<span class="status-dot" style="background:#ef4444;box-shadow:0 0 8px #ef4444"></span><span class="status-text" style="color:#f87171">Backend Offline</span>`;
    pill.style.borderColor = "rgba(239, 68, 68, 0.25)";
  }
}

// Tải danh sách giọng đọc từ SQLite
async function fetchVoices() {
  try {
    const res = await fetch("/api/voices");
    if (!res.ok) throw new Error("Không thể tải danh sách giọng");
    voicesData = await res.json();
    
    // Cập nhật số lượng
    document.getElementById("voice-count-badge").textContent = voicesData.length;

    // Render dropdown ở Studio Tab
    renderVoiceSelect();

    // Render grid ở Thư Viện Giọng Tab
    renderVoicesGrid();
  } catch (err) {
    console.error("Lỗi fetchVoices:", err);
  }
}

// Render Dropdown chọn giọng
function renderVoiceSelect() {
  const select = document.getElementById("voice-select");
  if (!voicesData.length) {
    select.innerHTML = `<option value="" disabled selected>Chưa có giọng đọc nào</option>`;
    return;
  }

  let html = `<option value="" disabled selected>-- Chọn giọng đọc phù hợp --</option>`;
  
  // Nhóm Giọng Preset
  const presets = voicesData.filter(v => v.type === "preset");
  if (presets.length) {
    html += `<optgroup label="🌟 Giọng Mẫu Có Sẵn (ZeroTTS)">`;
    presets.forEach(v => {
      html += `<option value="${v.id}">${v.name} (${v.description || 'Tiếng Việt'})</option>`;
    });
    html += `</optgroup>`;
  }

  // Nhóm Giọng Clone
  const cloned = voicesData.filter(v => v.type === "cloned");
  if (cloned.length) {
    html += `<optgroup label="🎙️ Giọng Đã Clone (Custom Voices)">`;
    cloned.forEach(v => {
      html += `<option value="${v.id}">${v.name} - ${v.description || 'Giọng cá nhân'}</option>`;
    });
    html += `</optgroup>`;
  }

  select.innerHTML = html;
}

// Khi thay đổi giọng được chọn
function handleVoiceSelectChange(e) {
  const voiceId = e.target.value;
  const voice = voicesData.find(v => v.id === voiceId);
  const previewBox = document.getElementById("selected-voice-preview");

  if (voice) {
    previewBox.style.display = "flex";
    const badge = document.getElementById("brief-voice-badge");
    badge.className = voice.type === "preset" ? "badge-preset" : "badge-cloned";
    badge.textContent = voice.type.toUpperCase();

    document.getElementById("brief-voice-name").textContent = voice.name;
    document.getElementById("brief-voice-desc").textContent = voice.description || "";
  } else {
    previewBox.style.display = "none";
  }
}

// Render Grid Thư viện giọng
function renderVoicesGrid() {
  const grid = document.getElementById("voices-grid");
  if (!voicesData.length) {
    grid.innerHTML = `<p class="card-desc">Chưa có giọng nào trong cơ sở dữ liệu.</p>`;
    return;
  }

  grid.innerHTML = voicesData.map(v => {
    const isPreset = v.type === "preset";
    const badgeClass = isPreset ? "badge-preset" : "badge-cloned";
    const badgeText = isPreset ? "PRESET" : "CLONED";

    return `
      <div class="voice-card">
        <div class="voice-card-top">
          <h3 class="voice-card-title">${v.name}</h3>
          <span class="${badgeClass}">${badgeText}</span>
        </div>
        <p class="voice-card-desc">${v.description || "Không có mô tả chi tiết."}</p>
        <div class="voice-card-actions">
          ${v.ref_audio_path ? `
            <button class="btn-listen" onclick="playAudio('/${v.ref_audio_path.replace(/\\\\/g, '/')}')">
              ▶ Nghe thử mẫu
            </button>
          ` : `<span style="font-size:0.75rem; color:var(--text-dim)">Built-in voice</span>`}
          ${!isPreset ? `
            <button class="btn-delete" onclick="handleDeleteVoice('${v.id}')" title="Xóa giọng clone này">
              🗑️
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join("");
}

// Phát âm thanh mẫu
function playAudio(url) {
  if (currentAudioPlayer) {
    currentAudioPlayer.pause();
  }
  currentAudioPlayer = new Audio(url);
  currentAudioPlayer.play().catch(e => console.log("Lỗi phát audio:", e));
}

// Xóa giọng clone
async function handleDeleteVoice(voiceId) {
  if (!confirm("Bạn có chắc chắn muốn xóa giọng clone này khỏi kho?")) return;
  try {
    const res = await fetch(`/api/voices/${voiceId}`, { method: "DELETE" });
    if (res.ok) {
      fetchVoices();
    } else {
      const err = await res.json();
      alert(err.detail || "Không thể xóa giọng này.");
    }
  } catch (err) {
    alert("Lỗi kết nối server.");
  }
}

// Kéo thả file & Chọn file
function initDropzones() {
  // Video dropzone
  const videoDrop = document.getElementById("video-dropzone");
  videoDrop.addEventListener("dragover", (e) => { e.preventDefault(); videoDrop.classList.add("dragover"); });
  videoDrop.addEventListener("dragleave", () => { videoDrop.classList.remove("dragover"); });
  videoDrop.addEventListener("drop", (e) => {
    e.preventDefault();
    videoDrop.classList.remove("dragover");
    if (e.dataTransfer.files.length) {
      applySelectedVideo(e.dataTransfer.files[0]);
    }
  });

  // Audio dropzone
  const audioDrop = document.getElementById("audio-dropzone");
  audioDrop.addEventListener("dragover", (e) => { e.preventDefault(); audioDrop.classList.add("dragover"); });
  audioDrop.addEventListener("dragleave", () => { audioDrop.classList.remove("dragover"); });
  audioDrop.addEventListener("drop", (e) => {
    e.preventDefault();
    audioDrop.classList.remove("dragover");
    if (e.dataTransfer.files.length) {
      applySelectedAudio(e.dataTransfer.files[0]);
    }
  });
}

function handleVideoSelect(e) {
  if (e.target.files.length) {
    applySelectedVideo(e.target.files[0]);
  }
}

function applySelectedVideo(file) {
  selectedVideoFile = file;
  document.getElementById("dropzone-empty-state").style.display = "none";
  const state = document.getElementById("video-selected-state");
  state.style.display = "flex";
  document.getElementById("video-file-name").textContent = file.name;
  document.getElementById("video-file-size").textContent = (file.size / (1024 * 1024)).toFixed(2) + " MB";
}

function clearSelectedVideo(e) {
  if (e) e.stopPropagation();
  selectedVideoFile = null;
  document.getElementById("video-file-input").value = "";
  document.getElementById("dropzone-empty-state").style.display = "block";
  document.getElementById("video-selected-state").style.display = "none";
}

function handleAudioSelect(e) {
  if (e.target.files.length) {
    applySelectedAudio(e.target.files[0]);
  }
}

function applySelectedAudio(file) {
  selectedAudioFile = file;
  document.getElementById("audio-empty-state").style.display = "none";
  const state = document.getElementById("audio-selected-state");
  state.style.display = "flex";
  document.getElementById("audio-file-name").textContent = file.name;
  document.getElementById("audio-file-size").textContent = (file.size / (1024 * 1024)).toFixed(2) + " MB";
}

function clearSelectedAudio(e) {
  if (e) e.stopPropagation();
  selectedAudioFile = null;
  document.getElementById("audio-file-input").value = "";
  document.getElementById("audio-empty-state").style.display = "block";
  document.getElementById("audio-selected-state").style.display = "none";
}

// Xử lý Clone Giọng Mới
async function handleCloneVoice(e) {
  e.preventDefault();
  const name = document.getElementById("clone-name").value.trim();
  const desc = document.getElementById("clone-desc").value.trim();
  const submitBtn = document.getElementById("clone-submit-btn");

  if (!selectedAudioFile) {
    alert("Vui lòng chọn file âm thanh mẫu (3-30s sạch tiếng).");
    return;
  }

  const formData = new FormData();
  formData.append("name", name);
  formData.append("description", desc);
  formData.append("audio_file", selectedAudioFile);

  submitBtn.disabled = true;
  submitBtn.innerHTML = "Đang lưu & clone giọng...";

  try {
    const res = await fetch("/api/voices/clone", {
      method: "POST",
      body: formData
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Không thể tạo giọng clone.");
    }

    alert(`Đã thêm giọng "${name}" vào Kho Giọng Đọc thành công!`);
    document.getElementById("clone-voice-form").reset();
    clearSelectedAudio();
    fetchVoices();
  } catch (err) {
    alert("Lỗi: " + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="16"></line>
        <line x1="8" y1="12" x2="16" y2="12"></line>
      </svg>
      Lưu & Thêm Vào Kho Giọng
    `;
  }
}

// Xử lý Bắt Đầu Lồng Tiếng Video
async function handleStartDubbing(e) {
  e.preventDefault();

  if (!selectedVideoFile) {
    alert("Vui lòng kéo thả hoặc chọn 1 file video.");
    return;
  }

  const voiceId = document.getElementById("voice-select").value;
  if (!voiceId) {
    alert("Vui lòng chọn 1 giọng đọc từ danh sách.");
    return;
  }

  const submitBtn = document.getElementById("start-dub-btn");
  submitBtn.disabled = true;
  submitBtn.innerHTML = "Đang khởi tạo tác vụ...";

  const formData = new FormData();
  formData.append("video_file", selectedVideoFile);
  formData.append("voice_id", voiceId);

  try {
    const res = await fetch("/api/dubbing/start", {
      method: "POST",
      body: formData
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Không thể bắt đầu lồng tiếng.");
    }

    const task = await res.json();
    
    // Ẩn Empty State, hiện Pipeline Tracker
    document.getElementById("monitor-empty").style.display = "none";
    document.getElementById("video-result-box").style.display = "none";
    document.getElementById("pipeline-tracker").style.display = "block";

    // Bắt đầu lắng nghe tiến trình
    startPolling(task.id);
  } catch (err) {
    alert("Lỗi: " + err.message);
    submitBtn.disabled = false;
    submitBtn.innerHTML = `Bắt Đầu Lồng Tiếng AI`;
  }
}

// Lắng nghe tiến độ định kỳ (Polling status)
function startPolling(taskId) {
  if (activePollingInterval) clearInterval(activePollingInterval);

  activePollingInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/dubbing/${taskId}`);
      if (!res.ok) return;
      const task = await res.json();

      updatePipelineUI(task);

      if (task.status === "completed" || task.status === "failed") {
        clearInterval(activePollingInterval);
        document.getElementById("start-dub-btn").disabled = false;
        document.getElementById("start-dub-btn").innerHTML = `Bắt Đầu Lồng Tiếng AI`;

        if (task.status === "completed") {
          showVideoResult(task);
        } else {
          alert("Quá trình lồng tiếng bị lỗi: " + (task.error_message || "Không rõ"));
        }
      }
    } catch (e) {
      console.error("Lỗi polling:", e);
    }
  }, 1000);
}

// Cập nhật trạng thái từng bước trên UI
function updatePipelineUI(task) {
  const progressBar = document.getElementById("task-progress-bar");
  const pctText = document.getElementById("task-pct-text");
  const statusText = document.getElementById("task-status-text");

  progressBar.style.width = task.progress + "%";
  pctText.textContent = task.progress + "%";

  const stepMap = {
    "queued": { step: 0, text: "Đang xếp hàng..." },
    "extracting_audio": { step: 1, text: "Đang trích xuất audio..." },
    "separating_audio": { step: 2, text: "Demucs đang tách giọng & nhạc nền..." },
    "transcribing": { step: 3, text: "Whisper đang nhận diện giọng nói..." },
    "removing_old_vocals": { step: 4, text: "Đang hủy bỏ giọng review cũ..." },
    "translating": { step: 5, text: "Đang dịch câu thoại sang tiếng Việt..." },
    "generating_tts": { step: 6, text: "ZeroTTS đang sinh giọng đọc mới..." },
    "aligning_and_mixing": { step: 7, text: "Đang đồng bộ timeline & mix nhạc nền..." },
    "merging_video": { step: 8, text: "Đang render video thành phẩm..." },
    "completed": { step: 8, text: "Hoàn tất lồng tiếng!" },
    "failed": { step: -1, text: "Gặp sự cố!" }
  };

  const current = stepMap[task.current_step] || { step: 0, text: "Đang xử lý..." };
  statusText.textContent = current.text;

  const stepIds = [
    "step-extract",
    "step-demucs",
    "step-whisper",
    "step-remove",
    "step-translate",
    "step-tts",
    "step-align-mix",
    "step-merge"
  ];

  stepIds.forEach((id, index) => {
    const el = document.getElementById(id);
    const icon = el.querySelector(".step-status-icon");
    const stepNum = index + 1;

    el.classList.remove("active", "completed");

    if (task.status === "completed" || stepNum < current.step) {
      el.classList.add("completed");
      icon.textContent = "✅";
    } else if (stepNum === current.step) {
      el.classList.add("active");
      icon.textContent = "⚡";
    } else {
      icon.textContent = "⏳";
    }
  });
}

// Hiển thị kết quả video hoàn thành
function showVideoResult(task) {
  const resultBox = document.getElementById("video-result-box");
  const player = document.getElementById("final-video-player");
  const downloadBtn = document.getElementById("download-video-btn");

  const videoUrl = "/" + task.output_video_path.replace(/\\\\/g, "/");
  player.src = videoUrl;
  downloadBtn.href = videoUrl;

  // Hiển thị kịch bản / subtitles
  const subList = document.getElementById("subtitles-list");
  if (task.segments_data && task.segments_data.length) {
    subList.innerHTML = task.segments_data.map(seg => `
      <div class="subtitle-row">
        <span class="sub-time">[${seg.actual_start}s - ${seg.actual_end}s]</span>
        <span class="sub-text"><strong>${seg.translated_text || seg.text}</strong></span>
      </div>
    `).join("");
    document.getElementById("subtitles-accordion").style.display = "block";
  } else {
    document.getElementById("subtitles-accordion").style.display = "none";
  }

  resultBox.style.display = "block";
}

function resetStudio() {
  clearSelectedVideo();
  document.getElementById("pipeline-tracker").style.display = "none";
  document.getElementById("video-result-box").style.display = "none";
  document.getElementById("monitor-empty").style.display = "block";
}
